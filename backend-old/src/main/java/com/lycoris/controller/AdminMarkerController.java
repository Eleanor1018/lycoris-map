package com.lycoris.controller;

import com.lycoris.dto.MarkerUpdateRequest;
import com.lycoris.entity.MapMarker;
import com.lycoris.entity.MarkerEditProposal;
import com.lycoris.entity.MarkerImageProposal;
import com.lycoris.repository.MarkerEditProposalRepository;
import com.lycoris.repository.MarkerImageProposalRepository;
import com.lycoris.service.MapMarkerService;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;
import java.util.Objects;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin/markers")
public class AdminMarkerController {

    private final MapMarkerService markerService;
    private final MarkerImageProposalRepository imageProposalRepo;
    private final MarkerEditProposalRepository editProposalRepo;
    private final boolean adminSecondFactorEnabled;
    private static final long SECOND_FACTOR_TTL_MS = 30 * 60 * 1000L;
    @Value("${app.upload-dir}")
    private String uploadDir;

    public AdminMarkerController(
            MapMarkerService markerService,
            MarkerImageProposalRepository imageProposalRepo,
            MarkerEditProposalRepository editProposalRepo,
            @Value("${admin.second-factor-enabled:true}") boolean adminSecondFactorEnabled
    ) {
        this.markerService = markerService;
        this.imageProposalRepo = imageProposalRepo;
        this.editProposalRepo = editProposalRepo;
        this.adminSecondFactorEnabled = adminSecondFactorEnabled;
    }

    @GetMapping("/pending")
    public ResponseEntity<?> pendingList(HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return ResponseEntity.ok(markerService.listPendingReview());
    }

    @PostMapping("/{id}/approve")
    public ResponseEntity<?> approve(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return markerService.findById(id)
                .<ResponseEntity<?>>map(marker -> {
                    marker.setReviewStatus("APPROVED");
                    MapMarker updated = markerService.save(marker);
                    return ResponseEntity.ok(updated);
                })
                .orElseGet(() -> ResponseEntity.status(404).body("点位不存在"));
    }

    @GetMapping("/pending-edits")
    public ResponseEntity<?> pendingEditProposals(HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return ResponseEntity.ok(editProposalRepo.findByStatusOrderByCreatedAtDesc("PENDING").stream()
                .map(p -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", p.getId());
                    item.put("markerId", p.getMarkerId());
                    item.put("markerTitle", p.getMarkerTitle());
                    item.put("lat", p.getMarkerLat());
                    item.put("lng", p.getMarkerLng());
                    item.put("category", p.getCategory());
                    item.put("title", p.getTitle());
                    item.put("description", p.getDescription());
                    item.put("language", p.getLanguage());
                    item.put("isPublic", p.getIsPublic());
                    item.put("isActive", p.getIsActive());
                    item.put("openTimeStart", p.getOpenTimeStart());
                    item.put("openTimeEnd", p.getOpenTimeEnd());
                    item.put("proposerUsername", p.getProposerUsername());
                    item.put("proposerPublicId", p.getProposerPublicId());
                    item.put("proposerIsOwner", p.getProposerIsOwner());
                    item.put("status", p.getStatus());
                    item.put("createdAt", p.getCreatedAt());
                    return item;
                })
                .toList());
    }

    @PostMapping("/edit-proposals/{id}/approve")
    @Transactional
    public ResponseEntity<?> approveEditProposal(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return editProposalRepo.findById(id)
                .<ResponseEntity<?>>map(p -> {
                    if (!"PENDING".equalsIgnoreCase(p.getStatus())) {
                        return ResponseEntity.badRequest().body("该提案已处理");
                    }

                    return markerService.findById(p.getMarkerId())
                            .<ResponseEntity<?>>map(marker -> {
                                if (p.getBaseMarkerVersion() == null || !Objects.equals(p.getBaseMarkerVersion(), marker.getVersion())) {
                                    return ResponseEntity.status(409).body("点位已更新或提案缺少版本信息，请按最新内容重新提交后审核");
                                }
                                marker.setCategory(markerService.normalizeCategoryForWrite(p.getCategory()));
                                marker.setIsPublic(p.getIsPublic());
                                marker.setIsActive(p.getIsActive());
                                markerService.applyOpenTimeWindow(marker, p.getOpenTimeStart(), p.getOpenTimeEnd());
                                marker.setReviewStatus("APPROVED");
                                marker.setLastEditedBy(p.getProposerUsername());
                                marker.setLastEditedByPublicId(p.getProposerPublicId());
                                marker.setLastEditedByOwner(p.getProposerIsOwner());
                                MapMarker updated = markerService.saveLocalizedEdit(marker, p.getLanguage(), p.getTitle(), p.getDescription());

                                p.setStatus("APPROVED");
                                p.setReviewedBy(String.valueOf(session.getAttribute("username")));
                                p.setReviewedAt(Instant.now());
                                editProposalRepo.save(p);
                                return ResponseEntity.ok(updated);
                            })
                            .orElseGet(() -> ResponseEntity.status(404).body("关联点位不存在"));
                })
                .orElseGet(() -> ResponseEntity.status(404).body("编辑提案不存在"));
    }

    @PostMapping("/edit-proposals/{id}/reject")
    @Transactional
    public ResponseEntity<?> rejectEditProposal(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return editProposalRepo.findById(id)
                .<ResponseEntity<?>>map(p -> {
                    if (!"PENDING".equalsIgnoreCase(p.getStatus())) {
                        return ResponseEntity.badRequest().body("该提案已处理");
                    }
                    p.setStatus("REJECTED");
                    p.setReviewedBy(String.valueOf(session.getAttribute("username")));
                    p.setReviewedAt(Instant.now());
                    editProposalRepo.save(p);
                    return ResponseEntity.ok().build();
                })
                .orElseGet(() -> ResponseEntity.status(404).body("编辑提案不存在"));
    }

    @PostMapping("/{id}/reject")
    public ResponseEntity<?> reject(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return markerService.findById(id)
                .<ResponseEntity<?>>map(marker -> {
                    marker.setReviewStatus("REJECTED");
                    MapMarker updated = markerService.save(marker);
                    return ResponseEntity.ok(updated);
                })
                .orElseGet(() -> ResponseEntity.status(404).body("点位不存在"));
    }

    @GetMapping("/pending-images")
    public ResponseEntity<?> pendingImages(HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return ResponseEntity.ok(imageProposalRepo.findByStatusOrderByCreatedAtDesc("PENDING").stream()
                .map(p -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("id", p.getId());
                    item.put("markerId", p.getMarkerId());
                    item.put("markerTitle", p.getMarkerTitle());
                    item.put("proposerUsername", p.getProposerUsername());
                    item.put("proposerPublicId", p.getProposerPublicId());
                    item.put("imageUrl", p.getImageUrl());
                    item.put("status", p.getStatus());
                    item.put("createdAt", p.getCreatedAt());
                    return item;
                })
                .toList());
    }

    @PostMapping("/image-proposals/{id}/approve")
    public ResponseEntity<?> approveImageProposal(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return imageProposalRepo.findById(id)
                .<ResponseEntity<?>>map(p -> {
                    if (!"PENDING".equalsIgnoreCase(p.getStatus())) {
                        return ResponseEntity.badRequest().body("该提案已处理");
                    }
                    return markerService.findById(p.getMarkerId())
                            .<ResponseEntity<?>>map(marker -> {
                                marker.setMarkImage(p.getImageUrl());
                                markerService.save(marker);

                                p.setStatus("APPROVED");
                                p.setReviewedBy(String.valueOf(session.getAttribute("username")));
                                p.setReviewedAt(Instant.now());
                                imageProposalRepo.save(p);

                                return ResponseEntity.ok(marker);
                            })
                            .orElseGet(() -> ResponseEntity.status(404).body("关联点位不存在"));
                })
                .orElseGet(() -> ResponseEntity.status(404).body("图片提案不存在"));
    }

    @PostMapping("/image-proposals/{id}/reject")
    public ResponseEntity<?> rejectImageProposal(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return imageProposalRepo.findById(id)
                .<ResponseEntity<?>>map(p -> {
                    if (!"PENDING".equalsIgnoreCase(p.getStatus())) {
                        return ResponseEntity.badRequest().body("该提案已处理");
                    }
                    p.setStatus("REJECTED");
                    p.setReviewedBy(String.valueOf(session.getAttribute("username")));
                    p.setReviewedAt(Instant.now());
                    imageProposalRepo.save(p);
                    return ResponseEntity.ok().build();
                })
                .orElseGet(() -> ResponseEntity.status(404).body("图片提案不存在"));
    }

    @GetMapping("/all")
    public ResponseEntity<?> listAll(HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;
        return ResponseEntity.ok(markerService.listAll());
    }

    @PatchMapping("/{id}")
    @Transactional
    public ResponseEntity<?> adminUpdate(
            @PathVariable("id") Long id,
            @RequestBody MarkerUpdateRequest req,
            HttpSession session
    ) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;

        return markerService.findById(id)
                .<ResponseEntity<?>>map(marker -> {
                    if (req.getCategory() != null) {
                        marker.setCategory(markerService.normalizeCategoryForWrite(req.getCategory()));
                    }
                    MapMarkerService.EditText text = markerService.resolveEditText(marker, req);
                    if (req.getIsPublic() != null) marker.setIsPublic(req.getIsPublic());
                    if (req.getOpenTimeStart() != null || req.getOpenTimeEnd() != null) {
                        markerService.applyOpenTimeWindow(marker, req.getOpenTimeStart(), req.getOpenTimeEnd());
                    }
                    if (req.getIsActive() != null) marker.setIsActive(req.getIsActive());
                    marker.setReviewStatus("APPROVED");

                    MapMarker updated = markerService.saveLocalizedEdit(marker, text.language(), text.title(), text.description());
                    return ResponseEntity.ok(updated);
                })
                .orElseGet(() -> ResponseEntity.status(404).body("点位不存在"));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> adminDelete(@PathVariable("id") Long id, HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;

        return markerService.findById(id)
                .<ResponseEntity<?>>map(marker -> {
                    markerService.delete(marker);
                    return ResponseEntity.ok().build();
                })
                .orElseGet(() -> ResponseEntity.status(404).body("点位不存在"));
    }

    @PostMapping("/cleanup-missing-images")
    public ResponseEntity<?> cleanupMissingImages(HttpSession session) {
        ResponseEntity<?> blocked = requireSecondFactor(session);
        if (blocked != null) return blocked;

        int totalChecked = 0;
        int cleared = 0;

        for (MapMarker marker : markerService.listAll()) {
            String markImage = marker.getMarkImage();
            if (markImage == null || markImage.isBlank()) continue;
            if (!markImage.startsWith("/uploads/markers/")) continue;

            totalChecked++;
            String filename = markImage.substring("/uploads/markers/".length());
            if (filename.isBlank()) continue;

            Path path = Paths.get(uploadDir, "markers", filename);
            if (!Files.exists(path) || !Files.isRegularFile(path)) {
                marker.setMarkImage(null);
                markerService.save(marker);
                cleared++;
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("checked", totalChecked);
        result.put("cleared", cleared);
        result.put("message", "失效图片链接清理完成");
        return ResponseEntity.ok(result);
    }

    private ResponseEntity<?> requireSecondFactor(HttpSession session) {
        if (!adminSecondFactorEnabled) {
            return null;
        }
        Object ok = session.getAttribute("adminSecondVerified");
        Object at = session.getAttribute("adminSecondVerifiedAt");
        if (!(ok instanceof Boolean) || !((Boolean) ok)) {
            return ResponseEntity.status(403).body("需要二级密码");
        }
        if (at instanceof Long) {
            long elapsed = System.currentTimeMillis() - (Long) at;
            if (elapsed > SECOND_FACTOR_TTL_MS) {
                session.removeAttribute("adminSecondVerified");
                session.removeAttribute("adminSecondVerifiedAt");
                return ResponseEntity.status(403).body("二级密码已过期，请重新验证");
            }
        }
        return null;
    }
}
