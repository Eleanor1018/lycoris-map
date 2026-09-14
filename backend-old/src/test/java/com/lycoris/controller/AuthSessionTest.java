package com.lycoris.controller;

import com.lycoris.dto.ChangePasswordRequest;
import com.lycoris.dto.LoginRequest;
import com.lycoris.entity.User;
import com.lycoris.service.ImageUploadService;
import com.lycoris.service.RegisterRateLimitService;
import com.lycoris.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class AuthSessionTest {
    @Test void loggingInRecordsVersionAndClearsPriorSecondFactor() {
        UserService users = mock(UserService.class);
        User user = new User();
        user.setId(12);
        user.setUsername("test-user");
        user.setSessionVersion(7L);
        when(users.login("test-user", "test-password")).thenReturn(user);
        var controller = new AuthController(users, mock(RegisterRateLimitService.class), mock(ImageUploadService.class));
        var request = new LoginRequest();
        request.setUsername("test-user");
        request.setPassword("test-password");
        var session = new MockHttpSession();
        session.setAttribute("adminSecondVerified", true);
        session.setAttribute("adminSecondVerifiedAt", 100L);
        var http = new MockHttpServletRequest();
        http.setSession(session);
        assertThat(controller.login(request, http, session).getStatusCode().value()).isEqualTo(200);
        assertThat(session.getAttribute("sessionVersion")).isEqualTo(7L);
        assertThat(session.getAttribute("adminSecondVerified")).isNull();
        assertThat(session.getAttribute("adminSecondVerifiedAt")).isNull();
    }

    @Test void changingPasswordRefreshesOnlyCurrentSession() {
        UserService users = mock(UserService.class);
        User user = new User();
        user.setId(12);
        when(users.findById(12)).thenReturn(Optional.of(user));
        when(users.changePassword(user, "old-test-password", "new-test-password")).thenAnswer(call -> {
            user.setSessionVersion(1L);
            return true;
        });
        var controller = new AuthController(users, mock(RegisterRateLimitService.class), mock(ImageUploadService.class));
        var session = new MockHttpSession();
        session.setAttribute("userId", 12);
        session.setAttribute("sessionVersion", 0L);
        session.setAttribute("adminSecondVerified", true);
        var request = new ChangePasswordRequest();
        request.setOldPassword("old-test-password");
        request.setNewPassword("new-test-password");
        assertThat(controller.changePassword(request, session).getStatusCode().value()).isEqualTo(200);
        assertThat(session.getAttribute("sessionVersion")).isEqualTo(1L);
        assertThat(session.getAttribute("adminSecondVerified")).isNull();
    }
}
