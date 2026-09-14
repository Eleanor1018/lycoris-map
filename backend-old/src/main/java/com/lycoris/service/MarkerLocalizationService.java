package com.lycoris.service;

import com.lycoris.entity.MapMarker;
import com.lycoris.entity.MapMarkerTranslation;
import com.lycoris.repository.MapMarkerRepository;
import com.lycoris.repository.MapMarkerTranslationRepository;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
public class MarkerLocalizationService {
    private final MapMarkerTranslationRepository translations;
    private final MapMarkerRepository markers;

    public MarkerLocalizationService(MapMarkerTranslationRepository translations, MapMarkerRepository markers) {
        this.translations = translations;
        this.markers = markers;
    }

    public MapMarker localize(MapMarker marker, String language) {
        return localize(List.of(marker), language).getFirst();
    }

    public List<MapMarker> localize(List<MapMarker> source, String language) {
        String target = MarkerLanguage.normalize(language);
        List<Long> ids = source.stream().filter(m -> !target.equals(MarkerLanguage.normalize(m.getSourceLanguage())))
                .map(MapMarker::getId).filter(Objects::nonNull).distinct().toList();
        Map<Long, MapMarkerTranslation> byMarker = new LinkedHashMap<>();
        if (!ids.isEmpty()) {
            translations.findByMarkerIdInAndLanguage(ids, target).forEach(t -> byMarker.put(t.getMarkerId(), t));
        }
        return source.stream().map(marker -> {
            MapMarker copy = new MapMarker();
            BeanUtils.copyProperties(marker, copy);
            copy.setSourceLanguage(MarkerLanguage.normalize(marker.getSourceLanguage()));
            copy.setContentLanguage(copy.getSourceLanguage());
            MapMarkerTranslation translation = byMarker.get(marker.getId());
            if (isCurrent(marker, translation) && target.equals(translation.getLanguage())) {
                copy.setTitle(translation.getTitle());
                copy.setDescription(translation.getDescription());
                copy.setContentLanguage(target);
            }
            return copy;
        }).toList();
    }

    public boolean isCurrent(MapMarker marker, MapMarkerTranslation translation) {
        return translation != null && Objects.equals(marker.getId(), translation.getMarkerId())
                && ("en".equals(translation.getLanguage()) || "zh".equals(translation.getLanguage()))
                && !MarkerLanguage.normalize(marker.getSourceLanguage()).equals(translation.getLanguage())
                && MarkerSourceHash.of(marker).equals(translation.getSourceHash());
    }

    public List<MapMarker> searchPublic(String query) {
        List<MapMarkerTranslation> matches = translations.searchPublicText(query);
        if (matches.isEmpty()) return List.of();
        Map<Long, MapMarker> current = new LinkedHashMap<>();
        markers.findByIdIn(matches.stream().map(MapMarkerTranslation::getMarkerId).distinct().toList())
                .stream().filter(MarkerAccess::isPublic).forEach(m -> current.put(m.getId(), m));
        return matches.stream().filter(t -> current.containsKey(t.getMarkerId()))
                .filter(t -> isCurrent(current.get(t.getMarkerId()), t))
                .map(t -> current.get(t.getMarkerId())).distinct().toList();
    }

    public void saveManual(MapMarker source, String language, String title, String description) {
        String target = MarkerLanguage.normalize(language);
        if (target.equals(MarkerLanguage.normalize(source.getSourceLanguage()))) {
            throw new IllegalArgumentException("原文语言不能保存为译文");
        }
        MapMarkerTranslation translation = translations.findByMarkerIdAndLanguage(source.getId(), target)
                .orElseGet(MapMarkerTranslation::new);
        translation.setMarkerId(source.getId());
        translation.setLanguage(target);
        translation.setTitle(title);
        translation.setDescription(description);
        translation.setSourceHash(MarkerSourceHash.of(source));
        translation.setOrigin("MANUAL");
        translation.setUpdatedAt(Instant.now());
        translations.save(translation);
    }

    public void deleteForMarker(Long markerId) {
        translations.deleteByMarkerId(markerId);
    }
}
