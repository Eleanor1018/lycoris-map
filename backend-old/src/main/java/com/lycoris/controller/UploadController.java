package com.lycoris.controller;

import com.lycoris.entity.User;
import com.lycoris.repository.MapMarkerRepository;
import com.lycoris.repository.MarkerImageProposalRepository;
import com.lycoris.service.MarkerAccess;
import com.lycoris.service.UserService;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;

@RestController
public class UploadController {
    private static final Map<String, String> IMAGE_TYPES = Map.of(
            "jpg", "image/jpeg", "jpeg", "image/jpeg", "png", "image/png",
            "gif", "image/gif", "webp", "image/webp");
    private final Path uploadRoot;
    private final MapMarkerRepository markers;
    private final MarkerImageProposalRepository proposals;
    private final UserService users;

    public UploadController(@Value("${app.upload-dir}") String uploadDir, MapMarkerRepository markers,
                            MarkerImageProposalRepository proposals, UserService users) {
        this.uploadRoot = Path.of(uploadDir).toAbsolutePath().normalize();
        this.markers = markers;
        this.proposals = proposals;
        this.users = users;
    }

    @GetMapping("/uploads/{directory}/{filename:.+}")
    public ResponseEntity<?> image(@PathVariable String directory, @PathVariable String filename, HttpSession session) {
        if ((!"avatars".equals(directory) && !"markers".equals(directory))
                || !filename.matches("[A-Za-z0-9_.-]+")) return ResponseEntity.notFound().build();
        String extension = filename.substring(filename.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        String type = IMAGE_TYPES.get(extension);
        if (type == null) return ResponseEntity.notFound().build();
        String url = "/uploads/" + directory + "/" + filename;
        if ("markers".equals(directory) && !canReadMarkerImage(url, currentUser(session))) {
            return ResponseEntity.notFound().build();
        }
        Path folder = uploadRoot.resolve(directory);
        Path file = folder.resolve(filename).normalize();
        if (!file.startsWith(folder) || !Files.isRegularFile(file)) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type))
                .header("X-Content-Type-Options", "nosniff").cacheControl(CacheControl.noStore())
                .body(new FileSystemResource(file));
    }

    private boolean canReadMarkerImage(String url, User viewer) {
        if (markers.findByMarkImage(url).stream().anyMatch(marker -> MarkerAccess.canView(marker, viewer))) return true;
        if (viewer == null) return false;
        return proposals.findByImageUrl(url).stream().anyMatch(proposal ->
                markers.findById(proposal.getMarkerId()).filter(marker ->
                        "ADMIN".equalsIgnoreCase(viewer.getRole())
                        || viewer.getPublicId() != null && (
                            viewer.getPublicId().toString().equals(marker.getUserPublicId())
                            || viewer.getPublicId().toString().equals(proposal.getProposerPublicId())
                                && MarkerAccess.canView(marker, viewer))).isPresent());
    }

    private User currentUser(HttpSession session) {
        if (session == null || session.getAttribute("userId") == null) return null;
        try {
            return users.findById(Integer.valueOf(String.valueOf(session.getAttribute("userId")))).orElse(null);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
