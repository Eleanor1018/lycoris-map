package com.lycoris.controller;

import com.lycoris.repository.MarkerEditProposalRepository;
import com.lycoris.repository.MarkerImageProposalRepository;
import com.lycoris.service.MapMarkerService;
import com.lycoris.service.UserService;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpSession;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AdminSecondFactorToggleTest {

    @Test
    void markerAdminEndpointsRejectWhenSecondFactorIsEnabledAndSessionIsUnverified() {
        MapMarkerService markerService = mock(MapMarkerService.class);
        AdminMarkerController controller = new AdminMarkerController(
                markerService,
                mock(MarkerImageProposalRepository.class),
                mock(MarkerEditProposalRepository.class),
                true
        );

        ResponseEntity<?> response = controller.pendingList(new MockHttpSession());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isEqualTo("需要二级密码");
        verify(markerService, never()).listPendingReview();
    }

    @Test
    void markerAdminEndpointsAllowAdminRoleOnlyWhenSecondFactorIsDisabled() {
        MapMarkerService markerService = mock(MapMarkerService.class);
        when(markerService.listPendingReview()).thenReturn(List.of());
        AdminMarkerController controller = new AdminMarkerController(
                markerService,
                mock(MarkerImageProposalRepository.class),
                mock(MarkerEditProposalRepository.class),
                false
        );

        ResponseEntity<?> response = controller.pendingList(new MockHttpSession());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).isEqualTo(List.of());
        verify(markerService).listPendingReview();
    }

    @Test
    void userAdminEndpointsAllowAdminRoleOnlyWhenSecondFactorIsDisabled() {
        UserService userService = mock(UserService.class);
        when(userService.searchForAdmin(isNull(), any(Pageable.class))).thenReturn(Page.empty());
        AdminUserController controller = new AdminUserController(userService, false);

        ResponseEntity<?> response = controller.listUsers(0, 10, null, new MockHttpSession());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        verify(userService).searchForAdmin(isNull(), any(Pageable.class));
    }

    @Test
    void userAdminEndpointsRejectWhenSecondFactorIsEnabledAndSessionIsUnverified() {
        UserService userService = mock(UserService.class);
        AdminUserController controller = new AdminUserController(userService, true);

        ResponseEntity<?> response = controller.listUsers(0, 10, null, mock(HttpSession.class));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(response.getBody()).isEqualTo("需要二级密码");
        verify(userService, never()).searchForAdmin(any(), any());
    }
}
