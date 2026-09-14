package com.lycoris.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lycoris.dto.MarkerCreateRequest;
import com.lycoris.entity.MapMarker;
import com.lycoris.repository.MapMarkerRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MapMarkerServiceTest {

    @Test
    void createReturnsExistingMarkerForRepeatedClientRequestId() {
        MapMarkerRepository repo = mock(MapMarkerRepository.class);
        MapMarkerService service = serviceWith(repo);
        MarkerCreateRequest request = validRequest();
        request.setClientRequestId("draft-123");

        AtomicReference<MapMarker> savedMarker = new AtomicReference<>();
        when(repo.findByUserPublicIdAndClientRequestId("public-1", "draft-123"))
                .thenAnswer(invocation -> Optional.ofNullable(savedMarker.get()));
        when(repo.save(any(MapMarker.class))).thenAnswer(invocation -> {
            MapMarker marker = invocation.getArgument(0);
            marker.setId(42L);
            savedMarker.set(marker);
            return marker;
        });

        MapMarker first = service.create("nora", "public-1", request);
        MapMarker second = service.create("nora", "public-1", request);

        assertThat(first.getId()).isEqualTo(42L);
        assertThat(second.getId()).isEqualTo(42L);
        assertThat(second.getTitle()).isEqualTo(first.getTitle());
        assertThat(first.getClientRequestId()).isEqualTo("draft-123");
        verify(repo, times(1)).save(any(MapMarker.class));
    }

    @Test
    void createWithoutClientRequestIdSavesEachRequest() {
        MapMarkerRepository repo = mock(MapMarkerRepository.class);
        MapMarkerService service = serviceWith(repo);
        MarkerCreateRequest request = validRequest();
        request.setClientRequestId(" ");
        AtomicLong nextId = new AtomicLong(1);

        when(repo.save(any(MapMarker.class))).thenAnswer(invocation -> {
            MapMarker marker = invocation.getArgument(0);
            marker.setId(nextId.getAndIncrement());
            return marker;
        });

        MapMarker first = service.create("nora", "public-1", request);
        MapMarker second = service.create("nora", "public-1", request);

        assertThat(first.getId()).isEqualTo(1L);
        assertThat(second.getId()).isEqualTo(2L);
        verify(repo, never()).findByUserPublicIdAndClientRequestId(any(), any());
        verify(repo, times(2)).save(any(MapMarker.class));
    }

    private MapMarkerService serviceWith(MapMarkerRepository repo) {
        @SuppressWarnings("unchecked")
        ObjectProvider<StringRedisTemplate> redisProvider = mock(ObjectProvider.class);
        when(redisProvider.getIfAvailable()).thenReturn(null);
        return new MapMarkerService(
                repo,
                redisProvider,
                new ObjectMapper(),
                "Asia/Shanghai",
                false,
                12,
                10
        );
    }

    private MarkerCreateRequest validRequest() {
        MarkerCreateRequest request = new MarkerCreateRequest();
        request.setLat(31.2304);
        request.setLng(121.4737);
        request.setCategory("accessible_toilet");
        request.setTitle("人民广场无障碍卫生间");
        request.setDescription("靠近地铁站出口");
        request.setIsPublic(true);
        request.setIsActive(true);
        return request;
    }
}
