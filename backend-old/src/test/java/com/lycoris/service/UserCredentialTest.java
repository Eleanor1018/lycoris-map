package com.lycoris.service;

import com.lycoris.entity.User;
import com.lycoris.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class UserCredentialTest {
    private final UserRepository users = mock(UserRepository.class);
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
    private final UserService service = new UserService(users, encoder);

    private User user(String password) {
        User user = new User();
        user.setId(12);
        user.setUsername("test-user");
        user.setPassword(password);
        when(users.findByUsernameAndDeletedFalse("test-user")).thenReturn(Optional.of(user));
        when(users.findByIdAndDeletedFalse(12)).thenReturn(Optional.of(user));
        when(users.save(user)).thenReturn(user);
        return user;
    }

    @Test
    void encodedPasswordCanOnlyBeVerifiedByEncoder() {
        User user = user(encoder.encode("test-original-password"));
        String storedHash = user.getPassword();
        assertThat(service.login("test-user", "test-original-password")).isSameAs(user);
        assertThat(service.login("test-user", "wrong-password")).isNull();
        assertThat(service.login("test-user", storedHash)).isNull();
        assertThat(service.changePassword(user, storedHash, "test-new-password")).isFalse();
        assertThat(user.getPassword()).isEqualTo(storedHash);
    }

    @Test
    void malformedEncodedPasswordIsNotAPlaintextCredential() {
        user("$2a$malformed");
        assertThat(service.login("test-user", "$2a$malformed")).isNull();
    }

    @Test
    void successfulLegacyLoginMigratesPlaintext() {
        User user = user("legacy-test-password");
        assertThat(service.login("test-user", "legacy-test-password")).isSameAs(user);
        assertThat(user.getPassword()).isNotEqualTo("legacy-test-password");
        assertThat(encoder.matches("legacy-test-password", user.getPassword())).isTrue();
        verify(users).save(user);
    }

    @Test
    void passwordAndAccountChangesRevokeEarlierSessions() {
        User user = user(encoder.encode("test-original-password"));
        assertThat(service.changePassword(user, "wrong-password", "test-new-password")).isFalse();
        assertThat(user.getSessionVersion()).isZero();
        assertThat(service.changePassword(user, "test-original-password", "test-new-password")).isTrue();
        assertThat(user.getSessionVersion()).isEqualTo(1L);
        service.resetPassword(user, "test-reset-password");
        assertThat(user.getSessionVersion()).isEqualTo(2L);
        assertThat(service.deleteById(12)).isTrue();
        assertThat(user.getSessionVersion()).isEqualTo(3L);
        service.restore(user);
        assertThat(user.getSessionVersion()).isEqualTo(4L);
    }
}
