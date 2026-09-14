package com.lycoris.controller;

import com.lycoris.dto.ApiResponse;
import com.lycoris.dto.ChangePasswordRequest;
import com.lycoris.dto.LoginRequest;
import com.lycoris.dto.UpdateProfileRequest;
import com.lycoris.entity.User;
import com.lycoris.dto.RegisterRequest;
import com.lycoris.dto.UserResponse;
import com.lycoris.service.RegisterRateLimitService;
import com.lycoris.service.UserService;
import com.lycoris.service.ImageUploadService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StringUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.Duration;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.concurrent.TimeUnit;


@RestController
@RequestMapping("/api")
public class AuthController {
    private static final Duration DEFAULT_SESSION_TIMEOUT = Duration.ofDays(30);

    private final UserService userService;
    private final RegisterRateLimitService registerRateLimitService;
    private final ImageUploadService imageUploadService;
    @Value("${app.upload-dir}")
    private String uploadDir;
    @Value("${server.servlet.session.timeout:30d}")
    private String sessionTimeout;

    public AuthController(UserService userService, RegisterRateLimitService registerRateLimitService,
                          ImageUploadService imageUploadService) {
        this.userService = userService;
        this.registerRateLimitService = registerRateLimitService;
        this.imageUploadService = imageUploadService;
    }

    private Integer resolveSessionUserId(HttpSession session) {
        if (session == null) return null;
        Object rawUserId = session.getAttribute("userId");
        if (rawUserId instanceof Number n) {
            return n.intValue();
        }
        if (rawUserId instanceof String s && !s.isBlank()) {
            try {
                return Integer.parseInt(s.trim());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<UserResponse>> login(
            @RequestBody LoginRequest request,
            HttpServletRequest httpRequest,
            HttpSession session
    ){
        User user = userService.login(request.getUsername(), request.getPassword());

        if (user == null) {
            return ResponseEntity.status(401).body(ApiResponse.error(4001, "Invalid username or password"));
        }

        rememberUserInSession(httpRequest, session, user);

        UserResponse data = new UserResponse(
                String.valueOf(user.getPublicId()),
                user.getUsername(),
                user.getNickname(),
                user.getEmail(),
                user.getAvatarUrl(),
                user.getPronouns(),
                user.getSignature()
        );
        return ResponseEntity.ok(ApiResponse.success(data));
    }

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<UserResponse>> register(@RequestBody RegisterRequest request, HttpSession session, HttpServletRequest httpRequest){
        if (request.getWebsite() != null && !request.getWebsite().isBlank()) {
            return ResponseEntity.status(400).body(ApiResponse.error(4004, "注册请求无效"));
        }
        String clientIp = resolveClientIp(httpRequest);
        if (!registerRateLimitService.tryAcquire(clientIp)) {
            return ResponseEntity.status(429).body(ApiResponse.error(429, "请求过于频繁，请稍后再试"));
        }
        User created = userService.register(
                request.getUsername(),
                request.getNickname(),
                request.getEmail(),
                request.getPassword()
        );
        if (created == null) {
            return ResponseEntity.status(400).body(ApiResponse.error(4002, "Username or email already exists"));
        }

        rememberUserInSession(httpRequest, session, created);

        UserResponse data = new UserResponse(
                String.valueOf(created.getPublicId()),
                created.getUsername(),
                created.getNickname(),
                created.getEmail(),
                created.getAvatarUrl(),
                created.getPronouns(),
                created.getSignature()
        );
        return ResponseEntity.ok(ApiResponse.success(data));
    }

    @GetMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> me(HttpSession session){
        Integer userId = resolveSessionUserId(session);

        if (userId == null) {
            return ResponseEntity.status(401).body(ApiResponse.error(401, "未登录"));
        }

        return userService.findById(userId).map(user -> ResponseEntity.ok(
                ApiResponse.success(
                        new UserResponse(
                                String.valueOf(user.getPublicId()),
                                user.getUsername(),
                                user.getNickname(),
                                user.getEmail(),
                                user.getAvatarUrl(),
                                user.getPronouns(),
                                user.getSignature()
                        )
                )
        )).orElseGet(
                () -> {
                    session.removeAttribute("userId");
                    session.removeAttribute("username");
                    session.removeAttribute("email");
                    session.removeAttribute("role");
                    return ResponseEntity.status(401).body(ApiResponse.error(401, "未登录"));
                }
        );
    }

    @GetMapping("/me/avatar")
    public ResponseEntity<byte[]> meAvatar(HttpSession session) {
        Integer userId = resolveSessionUserId(session);
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }

        return userService.findById(userId)
                .map(this::buildAvatarFileResponse)
                .orElseGet(() -> ResponseEntity.status(401).build());
    }

    @GetMapping("/users/{publicId}/avatar")
    public ResponseEntity<byte[]> userAvatarByPublicId(@PathVariable String publicId) {
        return userService.findByPublicId(publicId)
                .map(this::buildAvatarFileResponse)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PatchMapping("/me")
    public ResponseEntity<ApiResponse<UserResponse>> updateMe(@RequestBody UpdateProfileRequest request, HttpSession session) {
        Integer userId = resolveSessionUserId(session);
        if (userId == null) {
            return ResponseEntity.status(401).body(ApiResponse.error(401, "未登录"));
        }

        return userService.findById(userId).map(user -> {
            String nickname = request.getNickname();
            if (nickname != null) {
                String normalizedNickname = nickname.trim();
                user.setNickname(normalizedNickname.isBlank() ? user.getUsername() : normalizedNickname);
            }
            String pronouns = request.getPronouns();
            if (pronouns != null) {
                String normalizedPronouns = pronouns.trim();
                user.setPronouns(normalizedPronouns.isBlank() ? null : normalizedPronouns);
            }
            String signature = request.getSignature();
            if (signature != null) {
                String normalizedSignature = signature.trim();
                user.setSignature(normalizedSignature.isBlank() ? null : normalizedSignature);
            }
            User updated = userService.save(user);
            UserResponse data = new UserResponse(
                    String.valueOf(updated.getPublicId()),
                    updated.getUsername(),
                    updated.getNickname(),
                    updated.getEmail(),
                    updated.getAvatarUrl(),
                    updated.getPronouns(),
                    updated.getSignature()
            );
            return ResponseEntity.ok(ApiResponse.success(data));
        }).orElseGet(() -> ResponseEntity.status(404).body(ApiResponse.<UserResponse>error(404, "用户不存在")));
    }

    @PostMapping(value = "/me/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<UserResponse>> uploadAvatar(
            @RequestParam("file") MultipartFile file,
            HttpSession session
    ) {
        Integer userId = resolveSessionUserId(session);
        if (userId == null) {
            return ResponseEntity.status(401).body(ApiResponse.error(401, "未登录"));
        }
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(ApiResponse.error(400, "文件为空"));
        }

        return userService.findById(userId).map(user -> {
            try {
                String avatarUrl = imageUploadService.storeImage(file, "avatars", "avatar-" + user.getPublicId());
                user.setAvatarUrl(avatarUrl);
                User updated = userService.save(user);

                UserResponse data = new UserResponse(
                        String.valueOf(updated.getPublicId()),
                        updated.getUsername(),
                        updated.getNickname(),
                        updated.getEmail(),
                        updated.getAvatarUrl(),
                        updated.getPronouns(),
                        updated.getSignature()
                );
                return ResponseEntity.ok(ApiResponse.success(data));
            } catch (IllegalArgumentException e) {
                return ResponseEntity.badRequest().body(ApiResponse.<UserResponse>error(400, e.getMessage()));
            } catch (Exception e) {
                return ResponseEntity.status(500).body(ApiResponse.<UserResponse>error(500, "上传失败"));
            }
        }).orElseGet(() -> ResponseEntity.status(404).body(ApiResponse.<UserResponse>error(404, "用户不存在")));
    }

    @PostMapping("/me/password")
    public ResponseEntity<ApiResponse<Void>> changePassword(@RequestBody ChangePasswordRequest request, HttpSession session) {
        Integer userId = resolveSessionUserId(session);
        if (userId == null) {
            return ResponseEntity.status(401).body(ApiResponse.<Void>error(401, "未登录"));
        }
        if (request.getOldPassword() == null || request.getNewPassword() == null) {
            return ResponseEntity.badRequest().body(ApiResponse.<Void>error(400, "缺少参数"));
        }

        return userService.findById(userId)
                .map(user -> {
                    boolean ok = userService.changePassword(user, request.getOldPassword(), request.getNewPassword());
                    if (!ok) {
                        return ResponseEntity.status(400).body(ApiResponse.<Void>error(400, "原密码错误或新密码不合法"));
                    }
                    session.setAttribute("sessionVersion", user.getSessionVersion());
                    session.removeAttribute("adminSecondVerified");
                    session.removeAttribute("adminSecondVerifiedAt");
                    return ResponseEntity.ok(ApiResponse.<Void>success(null));
                })
                .orElseGet(() -> ResponseEntity.status(404).body(ApiResponse.<Void>error(404, "用户不存在")));
    }

    @PostMapping("/logout")
    public ResponseEntity<ApiResponse<Void>> logout(HttpSession session){
        session.invalidate();
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private static String resolveClientIp(HttpServletRequest request) {
        String xff = request.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] parts = xff.split(",");
            if (parts.length > 0 && !parts[0].isBlank()) {
                return parts[0].trim();
            }
        }
        return request.getRemoteAddr();
    }

    private void rememberUserInSession(HttpServletRequest request, HttpSession session, User user) {
        rotateSessionId(request);
        session.setMaxInactiveInterval(resolveSessionTimeoutSeconds());
        session.setAttribute("userId", user.getId());
        session.setAttribute("username", user.getUsername());
        session.setAttribute("email", user.getEmail());
        session.setAttribute("role", user.getRole());
        session.setAttribute("sessionVersion", user.getSessionVersion());
        session.removeAttribute("adminSecondVerified");
        session.removeAttribute("adminSecondVerifiedAt");
    }

    private static void rotateSessionId(HttpServletRequest request) {
        try {
            request.changeSessionId();
        } catch (IllegalStateException ignored) {
            // If the container already invalidated the old session, continue with the fresh one.
        }
    }

    private int resolveSessionTimeoutSeconds() {
        Duration duration = parseDuration(sessionTimeout, DEFAULT_SESSION_TIMEOUT);
        long seconds = duration.getSeconds();
        if (seconds <= 0) {
            seconds = DEFAULT_SESSION_TIMEOUT.getSeconds();
        }
        return seconds > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) seconds;
    }

    private static Duration parseDuration(String rawValue, Duration fallback) {
        if (!StringUtils.hasText(rawValue)) return fallback;
        try {
            return DurationStyle.detectAndParse(rawValue.trim());
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private ResponseEntity<byte[]> buildAvatarFileResponse(User user) {
        try {
            String avatarUrl = user.getAvatarUrl();
            if (avatarUrl == null || avatarUrl.isBlank()) {
                return ResponseEntity.notFound().<byte[]>build();
            }
            if (!avatarUrl.startsWith("/uploads/avatars/")) {
                return ResponseEntity.notFound().<byte[]>build();
            }

            String filename = avatarUrl.substring("/uploads/avatars/".length()).trim();
            if (filename.isBlank()) {
                return ResponseEntity.notFound().<byte[]>build();
            }

            Path avatarDir = Paths.get(uploadDir, "avatars").normalize();
            Path avatarPath = avatarDir.resolve(filename).normalize();
            if (!avatarPath.startsWith(avatarDir)) {
                return ResponseEntity.badRequest().<byte[]>build();
            }
            if (!Files.exists(avatarPath) || !Files.isRegularFile(avatarPath)) {
                return ResponseEntity.notFound().<byte[]>build();
            }

            byte[] body = Files.readAllBytes(avatarPath);
            String filenameLower = filename.toLowerCase(Locale.ROOT);
            MediaType mediaType = MediaType.IMAGE_JPEG;
            if (filenameLower.endsWith(".png")) {
                mediaType = MediaType.IMAGE_PNG;
            } else if (filenameLower.endsWith(".webp")) {
                mediaType = MediaType.parseMediaType("image/webp");
            } else if (filenameLower.endsWith(".gif")) {
                mediaType = MediaType.IMAGE_GIF;
            } else if (filenameLower.endsWith(".jpg") || filenameLower.endsWith(".jpeg")) {
                mediaType = MediaType.IMAGE_JPEG;
            }

            return ResponseEntity.ok()
                    .contentType(mediaType)
                    .cacheControl(CacheControl.maxAge(10, TimeUnit.MINUTES).cachePublic())
                    .body(body);
        } catch (Exception e) {
            return ResponseEntity.notFound().<byte[]>build();
        }
    }
}

