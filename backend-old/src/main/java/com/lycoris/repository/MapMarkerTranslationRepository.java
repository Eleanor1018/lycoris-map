package com.lycoris.repository;

import com.lycoris.entity.MapMarkerTranslation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface MapMarkerTranslationRepository extends JpaRepository<MapMarkerTranslation, Long> {
    Optional<MapMarkerTranslation> findByMarkerIdAndLanguage(Long markerId, String language);
    List<MapMarkerTranslation> findByMarkerIdInAndLanguage(List<Long> markerIds, String language);
    void deleteByMarkerId(Long markerId);

    @Query("""
            select t from MapMarkerTranslation t, MapMarker m
            where t.markerId = m.id and m.isPublic = true and m.reviewStatus = 'APPROVED'
              and (lower(t.title) like lower(concat('%', :query, '%'))
                or lower(t.description) like lower(concat('%', :query, '%')))
            """)
    List<MapMarkerTranslation> searchPublicText(@Param("query") String query);
}
