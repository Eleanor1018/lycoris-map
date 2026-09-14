package com.lycoris.repository;

import com.lycoris.LycorisApplication;
import com.lycoris.entity.MapMarker;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.jdbc.EmbeddedDatabaseConnection;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ContextConfiguration;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Executes the actual native query against an isolated in-memory database. */
@DataJpaTest(showSql = false, properties = {
        "spring.config.location=optional:classpath:/marker-nearby-test-no-config.yml",
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.sql.init.mode=never"
})
@AutoConfigureTestDatabase(connection = EmbeddedDatabaseConnection.H2,
        replace = AutoConfigureTestDatabase.Replace.ANY)
@ContextConfiguration(classes = LycorisApplication.class)
class MapMarkerNearbyQueryTest {
    private static final String CATEGORY = "accessible_toilet";
    // The pre-optimization query is an independent oracle for radius rounding and
    // legacy coordinate handling. Do not add the new bounding predicates here.
    static final String LEGACY_DISTANCE = """
            6371000 * 2 * asin(sqrt(
                power(sin(radians((m.lat - :lat) / 2)), 2)
                + cos(radians(:lat)) * cos(radians(m.lat))
                * power(sin(radians((m.lng - :lng) / 2)), 2)
            ))
            """;
    static final String LEGACY_QUERY = "select m.id, " + LEGACY_DISTANCE + """
             as distance from map_markers m
             where m.is_public = true and m.review_status = 'APPROVED' and m.category = :category
             and (
            """ + LEGACY_DISTANCE + ") <= :radius order by distance asc";

    @Autowired MapMarkerRepository markers;
    @Autowired EntityManager entityManager;
    @Autowired DataSource dataSource;

    @BeforeEach void confirmDisposableDatabase() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            assertThat(connection.getMetaData().getURL()).startsWith("jdbc:h2:mem:");
        }
    }

    @Test void preservesDistanceOrderVisibilityCategoryAndOriginalFields() {
        MapMarker far = save("远处", 0, 0.008);
        MapMarker near = save("近处", 0, 0.001);
        near.setDescription("原文 https://example.test/a");
        near.setIsActive(false); // Availability was never a nearby visibility predicate.
        MapMarker middle = save("中间", 0, 0.004);
        save("private", 0, 0).setIsPublic(false);
        save("rejected", 0, 0).setReviewStatus("REJECTED");
        save("pending", 0, 0).setReviewStatus("PENDING");
        save("other category", 0, 0).setCategory("baby_room");
        save("outside circle, inside rectangle", 0.008, 0.008);
        save("far away", 40, 100);
        markers.flush();
        entityManager.clear();

        List<MapMarker> result = markers.findNearbyByCategory(0, 0, 1000, CATEGORY);
        assertThat(result).extracting(MapMarker::getId)
                .containsExactly(near.getId(), middle.getId(), far.getId());
        assertThat(result.getFirst().getTitle()).isEqualTo("近处");
        assertThat(result.getFirst().getDescription()).isEqualTo("原文 https://example.test/a");
        assertThat(result.getFirst().getSourceLanguage()).isEqualTo("zh");
        assertThat(result.getFirst().getIsActive()).isFalse();
        assertMatchesLegacy(0, 0, 1000);
    }

    @ParameterizedTest
    @CsvSource({"179.999", "-179.999", "180", "-180"})
    void crossesDateLineAndAcceptsBothLongitudeRepresentations(double centerLng) {
        MapMarker east = save("east", 0, 179.998);
        MapMarker west = save("west", 0, -179.998);
        MapMarker positive180 = save("positive date line", 0, 180);
        MapMarker negative180 = save("negative date line", 0, -180);
        save("opposite side of earth", 0, 0);
        markers.flush();

        assertThat(markers.findNearbyByCategory(0, centerLng, 1000, CATEGORY))
                .extracting(MapMarker::getId).containsExactlyInAnyOrder(
                        east.getId(), west.getId(), positive180.getId(), negative180.getId());
        assertMatchesLegacy(0, centerLng, 1000);
    }

    @ParameterizedTest
    @CsvSource({"90", "-90"})
    void disksContainingPoleDoNotRestrictLongitude(double pole) {
        List<Long> inside = new ArrayList<>();
        for (double lng : new double[]{-180, -120, -30, 0, 45, 135, 180}) {
            inside.add(save("near pole " + lng, Math.copySign(89.6, pole), lng).getId());
            save("too far " + lng, Math.copySign(89.5, pole), lng);
        }
        markers.flush();

        assertThat(markers.findNearbyByCategory(pole, 75, 50000, CATEGORY))
                .extracting(MapMarker::getId).containsExactlyInAnyOrderElementsOf(inside);
        assertMatchesLegacy(pole, 75, 50000);
    }

    @ParameterizedTest
    @CsvSource({
            "0,0,1", "31.2304,121.4737,1000", "-33.8,151.2,50000",
            "89.99999,179.9999,1", "-89.99999,-179.9999,1",
            "89.5,170,50000", "-89.5,-170,50000",
            "89.7,170,50000", "-89.7,-170,50000"
    })
    void retainsRadiusBoundaryAndOrderAtAllBearings(double lat, double lng, int radius) {
        for (int bearing = 0; bearing < 360; bearing += 5) {
            for (double scale : new double[]{0.999, 1, 1.001}) {
                double[] point = destination(lat, lng, radius * scale, bearing);
                save("bearing " + bearing + " scale " + scale, point[0], point[1]);
            }
        }
        markers.flush();
        assertMatchesLegacy(lat, lng, radius);
    }

    @ParameterizedTest
    @CsvSource({"89.5,170,50000", "-89.5,-170,50000", "89.99999,180,1", "-89.99999,-180,1"})
    void retainsPointsWhereCircleReachesItsLongitudeExtremum(double lat, double lng, int radius) {
        double tangent = Math.toDegrees(Math.acos(Math.tan(radius / 6371000.0) * Math.tan(Math.toRadians(lat))));
        for (double bearing : new double[]{tangent, 360 - tangent}) {
            for (double scale : new double[]{0.99999999, 1, 1.00000001}) {
                double[] point = destination(lat, lng, radius * scale, bearing);
                save("longitude tangent " + bearing + " " + scale, point[0], point[1]);
            }
        }
        markers.flush();
        assertMatchesLegacy(lat, lng, radius);
    }

    @Test void retainsInclusiveZeroDistanceAndUnusualDirectRepositoryCalls() {
        MapMarker center = save("center", 0, 0);
        save("beyond service radius", 0, 0.5);
        save("near longitude alias", 0, -179);
        // Historical data has no database coordinate-range constraint. These rows
        // must still be checked by the old formula instead of silently disappearing.
        MapMarker alias = save("stored longitude alias", 0, 360);
        MapMarker latitudeAlias = save("stored latitude alias", 360, 0);
        markers.flush();

        assertThat(markers.findNearbyByCategory(0, 0, 0, CATEGORY))
                .extracting(MapMarker::getId).containsExactly(center.getId());
        assertThat(markers.findNearbyByCategory(0, 0, 1, CATEGORY))
                .extracting(MapMarker::getId).containsExactlyInAnyOrder(
                        center.getId(), alias.getId(), latitudeAlias.getId());
        assertMatchesLegacy(0, 0, -1);
        assertMatchesLegacy(0, 0, 0);
        assertMatchesLegacy(0, 0, 100000);
        assertMatchesLegacy(0, 181, 1000);
        assertMatchesLegacy(360, 0, 1000);
    }

    private MapMarker save(String title, double lat, double lng) {
        MapMarker marker = new MapMarker();
        marker.setTitle(title);
        marker.setLat(lat);
        marker.setLng(lng);
        marker.setCategory(CATEGORY);
        marker.setUsername("nearby-test");
        return markers.save(marker);
    }

    @SuppressWarnings("unchecked")
    private void assertMatchesLegacy(double lat, double lng, int radius) {
        List<Object[]> legacy = entityManager.createNativeQuery(LEGACY_QUERY)
                .setParameter("lat", lat).setParameter("lng", lng)
                .setParameter("radius", radius).setParameter("category", CATEGORY).getResultList();
        List<MapMarker> actual = markers.findNearbyByCategory(lat, lng, radius, CATEGORY);
        Map<Long, Double> distances = new HashMap<>();
        for (Object[] row : legacy) {
            distances.put(((Number) row[0]).longValue(), ((Number) row[1]).doubleValue());
        }
        assertThat(actual).extracting(MapMarker::getId)
                .containsExactlyInAnyOrderElementsOf(distances.keySet());
        // Equal-distance ties have no specified order in the original API.
        assertThat(actual.stream().map(m -> distances.get(m.getId())).toList()).isSorted();
    }

    static double[] destination(double lat, double lng, double meters, double bearing) {
        double phi = Math.toRadians(lat);
        double lambda = Math.toRadians(lng);
        double angle = meters / 6371000.0;
        double theta = Math.toRadians(bearing);
        // Vector rotation avoids the loss of precision of asin near the poles.
        double x = Math.cos(angle) * Math.cos(phi) - Math.sin(angle) * Math.sin(phi) * Math.cos(theta);
        double y = Math.sin(angle) * Math.sin(theta);
        double z = Math.cos(angle) * Math.sin(phi) + Math.sin(angle) * Math.cos(phi) * Math.cos(theta);
        double resultLat = Math.toDegrees(Math.atan2(z, Math.hypot(x, y)));
        double resultLng = Math.toDegrees(lambda + Math.atan2(y, x));
        return new double[]{resultLat, ((resultLng + 540) % 360) - 180};
    }
}
