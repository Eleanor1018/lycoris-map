package com.lycoris.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lycoris.entity.MapMarker;
import com.lycoris.repository.MapMarkerRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class MarkerCacheVisibilityTest {
    @Test void stalePublicCacheCannotReturnPrivateDeletedOrOldMarkerContents() {
        var repository = mock(MapMarkerRepository.class);
        var redis = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") var provider = (ObjectProvider<StringRedisTemplate>) mock(ObjectProvider.class);
        @SuppressWarnings("unchecked") var values = (ValueOperations<String, String>) mock(ValueOperations.class);
        when(provider.getIfAvailable()).thenReturn(redis);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("[{\"id\":1,\"isPublic\":true,\"reviewStatus\":\"APPROVED\"},"
                + "{\"id\":2,\"isPublic\":true,\"reviewStatus\":\"APPROVED\"},"
                + "{\"id\":3,\"isPublic\":true,\"reviewStatus\":\"APPROVED\",\"title\":\"old-title\"}]");
        MapMarker hidden = new MapMarker();
        hidden.setId(1L);
        hidden.setIsPublic(false);
        MapMarker visible = new MapMarker();
        visible.setId(3L);
        visible.setCategory("accessible_toilet");
        visible.setTitle("updated-title");
        when(repository.findByIdIn(List.of(1L, 2L, 3L))).thenReturn(List.of(hidden, visible));
        var service = new MapMarkerService(repository, provider, new ObjectMapper(), "Asia/Shanghai", true, 12, 10);
        var result = service.listPublicActiveInBounds(0, 1, 0, 1, null);
        assertThat(result).extracting(MapMarker::getId).containsExactly(3L);
        assertThat(result.getFirst().getTitle()).isEqualTo("updated-title");
        assertThat(service.nearbyPublicActive(0, 0, 1000, "accessible_toilet"))
                .extracting(MapMarker::getId).containsExactly(3L);
    }

    @Test void readTimeNormalizationDoesNotModifyStoredEntityOrVersion() {
        var repository = mock(MapMarkerRepository.class);
        @SuppressWarnings("unchecked") var provider = (ObjectProvider<StringRedisTemplate>) mock(ObjectProvider.class);
        var marker = new MapMarker();
        marker.setId(42L);
        marker.setCategory("legacy-category");
        marker.setIsActive(false);
        marker.setOpenTimeStart("00:00");
        marker.setOpenTimeEnd("00:00");
        marker.setVersion(3L);
        when(repository.findById(42L)).thenReturn(java.util.Optional.of(marker));
        var service = new MapMarkerService(repository, provider, new ObjectMapper(), "Asia/Shanghai", false, 12, 10);
        var view = service.findById(42L).orElseThrow();
        assertThat(view.getCategory()).isEqualTo("self_definition");
        assertThat(view.getIsActive()).isTrue();
        assertThat(marker.getCategory()).isEqualTo("legacy-category");
        assertThat(marker.getIsActive()).isFalse();
        assertThat(marker.getVersion()).isEqualTo(3L);
    }
}
