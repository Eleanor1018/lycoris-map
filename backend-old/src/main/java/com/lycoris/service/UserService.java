package com.lycoris.service;

import com.lycoris.entity.User;
import com.lycoris.repository.UserRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    public UserService(UserRepository userRepository,  PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    public User login(String usernameOrEmail, String rawPassword) {
        if (usernameOrEmail == null || rawPassword == null) {
            return null;
        }
        String identity = usernameOrEmail.trim();
        if (identity.isEmpty()) {
            return null;
        }

        Optional<User> userOpt =
                identity.contains("@")
                        ? userRepository.findByEmailAndDeletedFalse(identity.toLowerCase(Locale.ROOT))
                        : userRepository.findByUsernameAndDeletedFalse(identity);

        if (userOpt.isEmpty()) return null;

        User user = userOpt.get();
        if (!matchesPasswordSafely(rawPassword, user.getPassword())) {
            return null;
        }
        migrateLegacyPasswordIfNeeded(user, rawPassword);
        return user;
    }

    @Transactional
    public User register(String username, String nickname, String email, String rawPassword) {
        //calibrate
        if (username == null || username.isEmpty()) return null;
        if (email == null || email.isEmpty()) return null;
        if (rawPassword == null || rawPassword.length() < 4) return null;

        //uniqueness
        if(userRepository.existsByUsername(username)) {return null;}
        if(userRepository.existsByEmail(email)) {return null;}

        //create account
        User user = new User();
        user.setUsername(username.trim());
        user.setNickname(nickname == null || nickname.isBlank() ? username.trim() : nickname.trim());
        user.setEmail(email.trim().toLowerCase());
        user.setPassword(passwordEncoder.encode(rawPassword));
        user.setRole("USER");


        return userRepository.save(user);
    }

    public Optional<User> findById(Integer id) {
        return userRepository.findByIdAndDeletedFalse(id);
    }

    public Optional<User> findByPublicId(String publicId) {
        if (publicId == null || publicId.isBlank()) {
            return Optional.empty();
        }
        try {
            UUID uuid = UUID.fromString(publicId.trim());
            return userRepository.findByPublicIdAndDeletedFalse(uuid);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    public Optional<User> findAnyById(Integer id) {
        return userRepository.findById(id);
    }

    public User save(User user) {
        return userRepository.save(user);
    }

    public Page<User> searchForAdmin(String q, Pageable pageable) {
        String keyword = q == null ? "" : q.trim();
        return userRepository.searchForAdmin(keyword, pageable);
    }

    @Transactional
    public boolean deleteById(Integer id) {
        if (id == null) {
            return false;
        }
        Optional<User> userOpt = userRepository.findByIdAndDeletedFalse(id);
        if (userOpt.isEmpty()) {
            return false;
        }
        User user = userOpt.get();
        user.setDeleted(true);
        user.setDeletedAt(Instant.now());
        revokeSessions(user);
        userRepository.save(user);
        return true;
    }

    @Transactional
    public User restore(User user) {
        if (user == null) {
            return null;
        }
        user.setDeleted(false);
        user.setDeletedAt(null);
        revokeSessions(user);
        return userRepository.save(user);
    }

    @Transactional
    public User resetPassword(User user, String rawPassword) {
        user.setPassword(passwordEncoder.encode(rawPassword));
        revokeSessions(user);
        return userRepository.save(user);
    }

    @Transactional
    public boolean changePassword(User user, String oldPassword, String newPassword) {
        if (user == null) return false;
        if (newPassword == null || newPassword.length() < 4) return false;
        if (!matchesPasswordSafely(oldPassword, user.getPassword())) return false;
        user.setPassword(passwordEncoder.encode(newPassword));
        revokeSessions(user);
        userRepository.save(user);
        return true;
    }

    private boolean matchesPasswordSafely(String rawPassword, String storedPassword) {
        if (rawPassword == null || storedPassword == null || storedPassword.isBlank()) {
            return false;
        }
        // Encoded credentials must never fall back to literal equality.
        if (looksLikeBcryptHash(storedPassword) || storedPassword.startsWith("{")) {
            try {
                return passwordEncoder.matches(rawPassword, storedPassword);
            } catch (IllegalArgumentException ignored) {
                return false;
            }
        }
        return rawPassword.equals(storedPassword);
    }

    private void revokeSessions(User user) {
        user.setSessionVersion(Math.addExact(user.getSessionVersion() == null ? 0L : user.getSessionVersion(), 1L));
    }

    private void migrateLegacyPasswordIfNeeded(User user, String rawPassword) {
        String storedPassword = user.getPassword();
        if (storedPassword == null || storedPassword.isBlank()) {
            return;
        }
        if (looksLikeBcryptHash(storedPassword)) {
            return;
        }
        user.setPassword(passwordEncoder.encode(rawPassword));
        userRepository.save(user);
    }

    private boolean looksLikeBcryptHash(String value) {
        return value.startsWith("$2a$")
                || value.startsWith("$2b$")
                || value.startsWith("$2y$");
    }

}
