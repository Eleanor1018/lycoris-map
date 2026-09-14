package com.lycoris.security;

import com.lycoris.config.SecurityConfig;
import com.lycoris.entity.User;
import com.lycoris.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Optional;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest
@ContextConfiguration(classes = {SecurityConfig.class, SessionSecurityIntegrationTest.ProbeController.class})
class SessionSecurityIntegrationTest {
    @Autowired MockMvc mvc;
    @MockitoBean UserService users;
    private User user;
    private MockHttpSession session;

    @BeforeEach
    void prepare() {
        user = new User();
        user.setId(12);
        user.setUsername("test-admin");
        user.setRole("ADMIN");
        session = new MockHttpSession();
        session.setAttribute("userId", 12);
        session.setAttribute("username", "test-admin");
        session.setAttribute("role", "ADMIN");
        session.setAttribute("sessionVersion", 0L);
        session.setAttribute("adminSecondVerified", true);
        when(users.findById(12)).thenReturn(Optional.of(user));
    }

    @Test void currentAdminSessionCanAccessAdminEndpoint() throws Exception {
        mvc.perform(get("/api/admin/probe").session(session)).andExpect(status().isOk());
    }

    @Test void deletedAccountCannotUseItsExistingSession() throws Exception {
        user.setDeleted(true);
        mvc.perform(get("/api/admin/probe").session(session)).andExpect(status().isUnauthorized());
        assertThat(session.isInvalid()).isTrue();
    }

    @Test void changedCredentialVersionInvalidatesOldSession() throws Exception {
        user.setSessionVersion(1L);
        mvc.perform(get("/api/admin/probe").session(session)).andExpect(status().isUnauthorized());
        assertThat(session.isInvalid()).isTrue();
    }

    @Test void sessionWithoutVersionRequiresLogin() throws Exception {
        session.removeAttribute("sessionVersion");
        mvc.perform(get("/api/admin/probe").session(session)).andExpect(status().isUnauthorized());
    }

    @Test void roleChangesOverrideCachedAdminRole() throws Exception {
        user.setRole("USER");
        mvc.perform(get("/api/admin/probe").session(session)).andExpect(status().isForbidden());
        assertThat(session.getAttribute("role")).isEqualTo("USER");
        assertThat(session.getAttribute("adminSecondVerified")).isNull();
    }

    @Test void publicNumericDetailDoesNotExposeAdminOrUserLists() throws Exception {
        mvc.perform(get("/api/markers/123").servletPath("/api/markers/123")).andExpect(status().isOk());
        mvc.perform(get("/api/markers/all")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/markers/me/created")).andExpect(status().isUnauthorized());
    }

    @RestController
    static class ProbeController {
        @GetMapping({"/api/admin/probe", "/api/markers/123", "/api/markers/all", "/api/markers/me/created"})
        public String get() { return "ok"; }
    }
}
