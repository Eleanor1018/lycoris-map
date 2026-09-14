package com.lycoris.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lycoris.entity.MapMarker;
import com.lycoris.entity.MapMarkerTranslation;
import com.lycoris.repository.MapMarkerRepository;
import com.lycoris.repository.MapMarkerTranslationRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

class MarkerLocalizationCacheTest {
    @Test
    @SuppressWarnings("unchecked")
    void oneSourceCacheEntryServesBothLanguagesWithoutSharingLocalizedMutations() throws Exception {
        MapMarkerRepository markers = mock(MapMarkerRepository.class);
        MapMarkerTranslationRepository translations = mock(MapMarkerTranslationRepository.class);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        ObjectProvider<StringRedisTemplate> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(redis);
        when(redis.opsForValue()).thenReturn(values);
        ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
        MapMarkerService service = new MapMarkerService(markers, provider, mapper, "Asia/Shanghai", true, 12, 10);
        MarkerLocalizationService localization = new MarkerLocalizationService(translations, markers);
        MapMarker source = new MapMarker();
        source.setId(7L);
        source.setTitle("中文原文");
        source.setCategory("friendly_clinic");
        when(values.get(anyString())).thenReturn(mapper.writeValueAsString(List.of(source)));
        when(markers.findByIdIn(List.of(7L))).thenReturn(List.of(source));
        MapMarkerTranslation english = new MapMarkerTranslation();
        english.setMarkerId(7L);
        english.setLanguage("en");
        english.setTitle("English translation");
        english.setSourceHash(MarkerSourceHash.of(source));
        when(translations.findByMarkerIdInAndLanguage(List.of(7L), "en")).thenReturn(List.of(english));

        List<MapMarker> englishResponse = localization.localize(
                service.nearbyPublicActive(22.3, 114.2, 1000, "friendly_clinic"), "en");
        List<MapMarker> chineseResponse = localization.localize(
                service.nearbyPublicActive(22.3, 114.2, 1000, "friendly_clinic"), "zh");

        assertThat(englishResponse.getFirst().getTitle()).isEqualTo("English translation");
        assertThat(chineseResponse.getFirst().getTitle()).isEqualTo("中文原文");
        assertThat(source.getTitle()).isEqualTo("中文原文");
        ArgumentCaptor<String> keys = ArgumentCaptor.forClass(String.class);
        verify(values, times(2)).get(keys.capture());
        assertThat(keys.getAllValues()).hasSize(2).containsOnly(keys.getValue());
    }
}
