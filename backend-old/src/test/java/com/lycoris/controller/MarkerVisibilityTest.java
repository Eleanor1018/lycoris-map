package com.lycoris.controller;

import com.lycoris.dto.MarkerUpdateRequest;
import com.lycoris.entity.*;
import com.lycoris.repository.*;
import com.lycoris.service.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.mock.web.MockMultipartFile;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class MarkerVisibilityTest {
    private final MapMarkerService markers = mock(MapMarkerService.class);
    private final UserService users = mock(UserService.class);
    private final MarkerFavoriteRepository favorites = mock(MarkerFavoriteRepository.class);
    private final MarkerImageProposalRepository images = mock(MarkerImageProposalRepository.class);
    private final MarkerEditProposalRepository edits = mock(MarkerEditProposalRepository.class);
    private final ImageUploadService uploads = mock(ImageUploadService.class);
    private final MarkerController controller = new MarkerController(markers, users, favorites, images, edits, uploads);
    private User viewer;
    private MapMarker marker;
    private MockHttpSession session;

    @BeforeEach void prepare() {
        viewer = new User();
        viewer.setId(12);
        viewer.setUsername("test-viewer");
        viewer.setPublicId(UUID.randomUUID());
        marker = new MapMarker();
        marker.setId(42L);
        marker.setTitle("test-private-marker");
        marker.setUserPublicId(UUID.randomUUID().toString());
        marker.setCategory("accessible_toilet");
        session = new MockHttpSession();
        session.setAttribute("userId", 12);
        session.setAttribute("username", viewer.getUsername());
        when(users.findById(12)).thenReturn(Optional.of(viewer));
        when(markers.findById(42L)).thenReturn(Optional.of(marker));
        when(markers.listByIds(List.of(42L))).thenReturn(List.of(marker));
        var favorite = new MarkerFavorite();
        favorite.setMarkerId(42L);
        when(favorites.findByUserPublicId(viewer.getPublicId().toString())).thenReturn(List.of(favorite));
    }

    @ParameterizedTest
    @CsvSource({"false,APPROVED", "true,PENDING", "true,REJECTED", "false,PENDING"})
    void inaccessibleMarkerCannotBeReadOrContributedTo(boolean isPublic, String status) throws Exception {
        marker.setIsPublic(isPublic);
        marker.setReviewStatus(status);
        assertThat(controller.detail(42L, null).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.detail(42L, session).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.favorite(42L, session).getStatusCode().value()).isEqualTo(404);
        assertThat(controller.updateMarker(42L, new MarkerUpdateRequest(), session).getStatusCode().value()).isEqualTo(404);
        var file = new MockMultipartFile("file", "test.png", "image/png", new byte[]{1});
        assertThat(controller.uploadMarkerImage(42L, file, session).getStatusCode().value()).isEqualTo(404);
        assertThat((List<?>) controller.myFavoriteMarkers(session).getBody()).isEmpty();
        assertThat((List<?>) controller.myFavorites(session).getBody()).isEmpty();
        verify(favorites, never()).save(any());
        verify(edits, never()).save(any());
        verify(uploads, never()).storeImage(any(), anyString(), anyString());
    }

    @Test void ownerCanReadAndProposeChangesToOwnPendingMarker() {
        marker.setIsPublic(false);
        marker.setReviewStatus("PENDING");
        marker.setUserPublicId(viewer.getPublicId().toString());
        marker.setVersion(3L);
        when(markers.resolveEditText(any(), any())).thenCallRealMethod();
        assertThat(controller.detail(42L, session).getStatusCode().value()).isEqualTo(200);
        assertThat(controller.updateMarker(42L, new MarkerUpdateRequest(), session).getStatusCode().value()).isEqualTo(200);
        var proposal = org.mockito.ArgumentCaptor.forClass(MarkerEditProposal.class);
        verify(edits).save(proposal.capture());
        assertThat(proposal.getValue().getBaseMarkerVersion()).isEqualTo(3L);
        assertThat(proposal.getValue().getLanguage()).isEqualTo("zh");
    }

    @Test void publicApprovedMarkerRemainsReadableAndFavoritable() {
        assertThat(controller.detail(42L, null).getStatusCode().value()).isEqualTo(200);
        assertThat(controller.favorite(42L, session).getStatusCode().value()).isEqualTo(200);
        assertThat((List<?>) controller.myFavoriteMarkers(session).getBody()).hasSize(1);
    }

    @Test void adminCanReadPrivateMarkerButSessionRoleAloneIsNotEnough() {
        marker.setIsPublic(false);
        session.setAttribute("role", "ADMIN");
        assertThat(controller.detail(42L, session).getStatusCode().value()).isEqualTo(404);
        viewer.setRole("ADMIN");
        assertThat(controller.detail(42L, session).getStatusCode().value()).isEqualTo(200);
    }
}
