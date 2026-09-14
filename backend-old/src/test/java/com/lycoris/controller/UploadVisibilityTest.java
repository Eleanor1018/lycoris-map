package com.lycoris.controller;

import com.lycoris.entity.*;
import com.lycoris.repository.*;
import com.lycoris.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockHttpSession;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class UploadVisibilityTest {
    @TempDir Path root;
    private final MapMarkerRepository markers = mock(MapMarkerRepository.class);
    private final MarkerImageProposalRepository proposals = mock(MarkerImageProposalRepository.class);
    private final UserService users = mock(UserService.class);
    private UploadController controller;
    private MapMarker marker;
    private User viewer;
    private MockHttpSession session;

    @BeforeEach void prepare() throws Exception {
        controller = new UploadController(root.toString(), markers, proposals, users);
        Files.createDirectories(root.resolve("markers"));
        Files.write(root.resolve("markers/test.png"), new byte[]{1});
        marker = new MapMarker();
        marker.setId(42L);
        marker.setMarkImage("/uploads/markers/test.png");
        marker.setUserPublicId(UUID.randomUUID().toString());
        viewer = new User();
        viewer.setId(12);
        viewer.setPublicId(UUID.randomUUID());
        session = new MockHttpSession();
        session.setAttribute("userId", 12);
        when(users.findById(12)).thenReturn(Optional.of(viewer));
        when(markers.findByMarkImage(marker.getMarkImage())).thenReturn(List.of(marker));
        when(markers.findById(42L)).thenReturn(Optional.of(marker));
    }

    @Test void publicImageIsReadableButImmediatelyStopsBeingPublicWhenMarkerChanges() {
        assertThat(controller.image("markers", "test.png", null).getStatusCode().value()).isEqualTo(200);
        marker.setIsPublic(false);
        assertThat(controller.image("markers", "test.png", null).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.image("markers", "test.png", session).getStatusCode().value()).isEqualTo(404);
        marker.setUserPublicId(viewer.getPublicId().toString());
        var response = controller.image("markers", "test.png", session);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test void unreviewedImageOnlyVisibleToContributorOwnerOrAdmin() {
        when(markers.findByMarkImage(marker.getMarkImage())).thenReturn(List.of());
        var proposal = new MarkerImageProposal();
        proposal.setMarkerId(42L);
        proposal.setProposerPublicId(viewer.getPublicId().toString());
        when(proposals.findByImageUrl(marker.getMarkImage())).thenReturn(List.of(proposal));
        assertThat(controller.image("markers", "test.png", null).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.image("markers", "test.png", session).getStatusCode().value()).isEqualTo(200);
        proposal.setProposerPublicId("different-contributor");
        assertThat(controller.image("markers", "test.png", session).getStatusCode().value()).isEqualTo(404);
        viewer.setRole("ADMIN");
        assertThat(controller.image("markers", "test.png", session).getStatusCode().value()).isEqualTo(200);
    }

    @Test void nonImageExtensionsAndPathTraversalAreNotServed() {
        assertThat(controller.image("avatars", "test.html", null).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.image("markers", "../test.png", null).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.image("unknown", "test.png", null).getStatusCode().value()).isEqualTo(404);
    }
}
