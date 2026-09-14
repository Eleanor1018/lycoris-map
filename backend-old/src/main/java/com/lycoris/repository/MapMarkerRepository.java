package com.lycoris.repository;

import com.lycoris.entity.MapMarker;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MapMarkerRepository extends JpaRepository<MapMarker, Long> {

    List<MapMarker> findByIsPublicTrueAndReviewStatus(String reviewStatus);

    List<MapMarker> findByUsername(String username);

    List<MapMarker> findByUserPublicId(String userPublicId);

    Optional<MapMarker> findByUserPublicIdAndClientRequestId(String userPublicId, String clientRequestId);

    List<MapMarker> findByIdIn(List<Long> ids);

    List<MapMarker> findByMarkImage(String markImage);

    @Query("""
            select m from MapMarker m
            where m.isPublic = true
              and m.reviewStatus = 'APPROVED'
              and (
                lower(m.title) like lower(concat('%', :q, '%'))
                or lower(m.description) like lower(concat('%', :q, '%'))
                or lower(m.category) like lower(concat('%', :q, '%'))
                or str(m.lat) like concat('%', :q, '%')
                or str(m.lng) like concat('%', :q, '%')
              )
            """)
    List<MapMarker> searchPublicActive(@Param("q") String q);

    default List<MapMarker> findNearbyByCategory(double lat, double lng, int radius, String category) {
        // Keep unusual direct repository calls on the original distance-only path.
        // The public service already limits valid requests to a radius of 1..50,000 m.
        boolean useBounds = Double.isFinite(lat) && Double.isFinite(lng)
                && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && radius >= 1 && radius <= 50000;
        double minLat = -90;
        double maxLat = 90;
        double minLng = -180;
        double maxLng = 180;
        boolean allLongitudes = true;
        if (useBounds) {
            // Expand the spherical cap very slightly before deriving BOTH bounds, so
            // rounding near a pole or the exact radius cannot discard a valid point.
            double angularRadius = radius / 6371000.0 + Math.toRadians(1e-9);
            double latitudeDelta = Math.toDegrees(angularRadius);
            minLat = Math.max(-90, lat - latitudeDelta);
            maxLat = Math.min(90, lat + latitudeDelta);
            allLongitudes = minLat <= -90 || maxLat >= 90;
            if (!allLongitudes) {
                double longitudeDelta = Math.toDegrees(Math.asin(Math.min(1,
                        Math.sin(angularRadius) / Math.cos(Math.toRadians(lat))))) + 1e-9;
                minLng = lng - longitudeDelta;
                maxLng = lng + longitudeDelta;
                // Include both -180 and +180 representations even at an exact bound.
                if (minLng <= -180) minLng += 360;
                if (maxLng >= 180) maxLng -= 360;
            }
        }
        return findNearbyByCategoryWithinBounds(lat, lng, radius, category, useBounds,
                minLat, maxLat, minLng, maxLng, allLongitudes);
    }

    @Query(value = """
            select m.*
            from map_markers m
            where m.is_public = true
              and m.review_status = 'APPROVED'
              and m.category = :category
              and (
                :useBounds = false
                or m.lat not between -90 and 90 or m.lng not between -180 and 180
                or (
                  m.lat between :minLat and :maxLat
                  and (
                    :allLongitudes = true
                    or (:minLng <= :maxLng and m.lng between :minLng and :maxLng)
                    or (:minLng > :maxLng and (m.lng >= :minLng or m.lng <= :maxLng))
                  )
                )
              )
              and (
                6371000 * 2 * asin(sqrt(
                  power(sin(radians((m.lat - :lat) / 2)), 2)
                  + cos(radians(:lat)) * cos(radians(m.lat))
                  * power(sin(radians((m.lng - :lng) / 2)), 2)
                ))
              ) <= :radius
            order by (
                6371000 * 2 * asin(sqrt(
                  power(sin(radians((m.lat - :lat) / 2)), 2)
                  + cos(radians(:lat)) * cos(radians(m.lat))
                  * power(sin(radians((m.lng - :lng) / 2)), 2)
                ))
            ) asc
            """, nativeQuery = true)
    List<MapMarker> findNearbyByCategoryWithinBounds(
            @Param("lat") double lat,
            @Param("lng") double lng,
            @Param("radius") int radius,
            @Param("category") String category,
            @Param("useBounds") boolean useBounds,
            @Param("minLat") double minLat,
            @Param("maxLat") double maxLat,
            @Param("minLng") double minLng,
            @Param("maxLng") double maxLng,
            @Param("allLongitudes") boolean allLongitudes
    );

    List<MapMarker> findByReviewStatusOrderByUpdatedAtDesc(String reviewStatus);

    @Query("""
            select m from MapMarker m
            where m.isPublic = true
              and m.reviewStatus = 'APPROVED'
              and m.lat between :minLat and :maxLat
              and m.lng between :minLng and :maxLng
            """)
    List<MapMarker> findPublicActiveInBounds(
            @Param("minLat") double minLat,
            @Param("maxLat") double maxLat,
            @Param("minLng") double minLng,
            @Param("maxLng") double maxLng
    );

    @Query("""
            select m from MapMarker m
            where m.isPublic = true
              and m.reviewStatus = 'APPROVED'
              and m.lat between :minLat and :maxLat
              and m.lng between :minLng and :maxLng
              and m.category in :categories
            """)
    List<MapMarker> findPublicActiveInBoundsAndCategoryIn(
            @Param("minLat") double minLat,
            @Param("maxLat") double maxLat,
            @Param("minLng") double minLng,
            @Param("maxLng") double maxLng,
            @Param("categories") List<String> categories
    );

    @Query("""
            select m from MapMarker m
            where m.isPublic = true
              and m.reviewStatus = 'APPROVED'
              and abs(m.lat - :lat) <= :eps
              and abs(m.lng - :lng) <= :eps
            """)
    List<MapMarker> findByLatLngNear(
            @Param("lat") double lat,
            @Param("lng") double lng,
            @Param("eps") double eps
    );

}
