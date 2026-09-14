package com.lycoris.repository;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Optional native PostgreSQL regression and synthetic benchmark, with no new dependencies.
 * Set LYCORIS_RUN_NEARBY_POSTGRES_TESTS=true and run this test with Maven. Requires the
 * local postgres:17 image. Creates its own unnetworked container and fake database;
 * never accepts a database URL, mounts an existing volume, or contacts production.
 */
@EnabledIfEnvironmentVariable(named = "LYCORIS_RUN_NEARBY_POSTGRES_TESTS", matches = "true")
class MapMarkerNearbyPostgresTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String CONTAINER = "lycoris-nearby-verify-" + UUID.randomUUID().toString().substring(0, 12);
    private static final String LABEL = "com.lycoris.test=nearby-query";
    private static final double[][] CASES = {
            {0, 0, 1}, {31.2304, 121.4737, 1000}, {-33.8, 151.2, 50000},
            {89.99999, 179.9999, 1}, {-89.99999, -179.9999, 1},
            {89.5, 170, 50000}, {-89.5, -170, 50000},
            {89.7, 170, 50000}, {-89.7, -170, 50000},
            {0, 179.999, 1000}, {0, -179.999, 1000},
            {0, 180, 1000}, {0, -180, 1000}, {90, 75, 50000}, {-90, 75, 50000}
    };
    private static boolean started;

    @BeforeAll static void startDisposablePostgres() throws Exception {
        command(null, "docker", "image", "inspect", "postgres:17");
        command(null, "docker", "run", "--detach", "--pull", "never", "--name", CONTAINER,
                "--network", "none", "--label", LABEL,
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=nearby_test",
                "-e", "POSTGRES_USER=nearby_test", "postgres:17");
        started = true;
        try {
            boolean ready = false;
            for (int attempt = 0; attempt < 60; attempt++) {
                try {
                    command(null, "docker", "exec", CONTAINER, "pg_isready", "-h", "127.0.0.1",
                            "-U", "nearby_test", "-d", "nearby_test");
                    ready = true;
                    break;
                } catch (AssertionError notReady) {
                    Thread.sleep(250);
                }
            }
            assertThat(ready).as("isolated PostgreSQL became ready").isTrue();
            sql("""
                    create table map_markers (
                        id bigint generated always as identity primary key,
                        lat double precision not null, lng double precision not null,
                        category varchar(64) not null default 'accessible_toilet',
                        is_public boolean not null default true,
                        review_status varchar(16) not null default 'APPROVED',
                        title varchar(120) not null default 'Synthetic nearby test marker',
                        description text not null default 'Synthetic content; no production data',
                        source_language varchar(2) not null default 'zh',
                        is_active boolean not null default true
                    );
                    insert into map_markers(lat,lng)
                    select -70 + ((g * 7919::bigint) % 1400000) / 10000.0,
                           -180 + ((g * 104729::bigint) % 3600000) / 10000.0
                    from generate_series(1,250000) g;
                    insert into map_markers(lat,lng)
                    select 31.2304 + (g % 41 - 20) * 0.0004,
                           121.4737 + (g / 41 - 12) * 0.0004
                    from generate_series(0,999) g;
                    insert into map_markers(lat,lng,is_public,review_status,category) values
                        (31.2304,121.4737,false,'APPROVED','accessible_toilet'),
                        (31.2304,121.4737,true,'REJECTED','accessible_toilet'),
                        (31.2304,121.4737,true,'PENDING','accessible_toilet'),
                        (31.2304,121.4737,true,'APPROVED','baby_room'),
                        (0,360,true,'APPROVED','accessible_toilet'),
                        (360,0,true,'APPROVED','accessible_toilet'),
                        (0,180,true,'APPROVED','accessible_toilet'),
                        (0,-180,true,'APPROVED','accessible_toilet');
                    """);
            StringBuilder fixture = new StringBuilder("insert into map_markers(lat,lng) values ");
            for (double[] c : CASES) {
                for (int bearing = 0; bearing < 360; bearing += 5) {
                    for (double scale : new double[]{0.999, 1, 1.001}) {
                        double[] point = MapMarkerNearbyQueryTest.destination(c[0], c[1], c[2] * scale, bearing);
                        fixture.append('(').append(point[0]).append(',').append(point[1]).append("),");
                    }
                }
                double tangentCosine = Math.tan(c[2] / 6371000.0) * Math.tan(Math.toRadians(c[0]));
                if (Math.abs(tangentCosine) < 1) {
                    double tangent = Math.toDegrees(Math.acos(tangentCosine));
                    for (double bearing : new double[]{tangent, 360 - tangent}) {
                        for (double scale : new double[]{0.99999999, 1, 1.00000001}) {
                            double[] point = MapMarkerNearbyQueryTest.destination(c[0], c[1], c[2] * scale, bearing);
                            fixture.append('(').append(point[0]).append(',').append(point[1]).append("),");
                        }
                    }
                }
            }
            fixture.setCharAt(fixture.length() - 1, ';');
            sql(fixture + " analyze map_markers;");
        } catch (Throwable failure) {
            removeDisposablePostgres();
            throw failure;
        }
    }

    @AfterAll static void removeDisposablePostgres() throws Exception {
        if (!started) return;
        String label = JSON.readTree(command(null, "docker", "inspect", CONTAINER))
                .get(0).path("Config").path("Labels").path("com.lycoris.test").asText();
        assertThat(label).isEqualTo("nearby-query");
        command(null, "docker", "rm", "--force", "--volumes", CONTAINER);
        started = false;
    }

    @Test void nativePostgresMatchesLegacyAtDateLinePolesAndRadiusBoundary() throws Exception {
        List<double[]> cases = new ArrayList<>(List.of(CASES));
        cases.addAll(List.of(new double[]{0, 0, -1}, new double[]{0, 0, 0},
                new double[]{0, 0, 100000}, new double[]{0, 181, 1000}, new double[]{360, 0, 1000}));
        for (double[] c : cases) {
            int radius = (int) c[2];
            String optimized = actualQuery(c[0], c[1], radius);
            JsonNode actual = JSON.readTree(sql("select coalesce(json_agg(q.id), '[]') from (" + optimized + ") q;"));
            String legacy = bind(MapMarkerNearbyQueryTest.LEGACY_QUERY, parameters(c[0], c[1], radius));
            JsonNode expected = JSON.readTree(sql("select coalesce(json_agg(q), '[]') from (" + legacy + ") q;"));
            Map<Long, Double> distances = new HashMap<>();
            expected.forEach(row -> distances.put(row.path("id").asLong(), row.path("distance").asDouble()));
            List<Long> ids = new ArrayList<>();
            actual.forEach(id -> ids.add(id.asLong()));
            assertThat(ids).as("lat=%s lng=%s radius=%s", c[0], c[1], radius)
                    .containsExactlyInAnyOrderElementsOf(distances.keySet());
            assertThat(ids.stream().map(distances::get).toList()).isSorted();
        }
    }

    @Test void reportsQueryTimesOnSyntheticGlobalAndLocalMarkers() throws Exception {
        String optimized = actualQuery(31.2304, 121.4737, 1000);
        String legacy = bind("""
                select m.* from map_markers m where m.is_public = true
                and m.review_status = 'APPROVED' and m.category = :category and (
                """ + MapMarkerNearbyQueryTest.LEGACY_DISTANCE + ") <= :radius order by ("
                + MapMarkerNearbyQueryTest.LEGACY_DISTANCE + ") asc", parameters(31.2304, 121.4737, 1000));
        explainMilliseconds(legacy);
        explainMilliseconds(optimized);
        List<Double> before = new ArrayList<>();
        List<Double> after = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            if (i % 2 == 0) {
                before.add(explainMilliseconds(legacy));
                after.add(explainMilliseconds(optimized));
            } else {
                after.add(explainMilliseconds(optimized));
                before.add(explainMilliseconds(legacy));
            }
        }
        Collections.sort(before);
        Collections.sort(after);
        String rows = sql("select count(*) from map_markers;").trim();
        System.out.printf(Locale.ROOT,
                "Nearby PostgreSQL 17 synthetic benchmark: rows=%s; old median=%.3f ms; bounded median=%.3f ms; speedup=%.2fx%n",
                rows, before.get(2), after.get(2), before.get(2) / after.get(2));
        // Timing is evidence for manual review, not a machine-load-dependent assertion.
        assertThat(before).allMatch(time -> time > 0);
        assertThat(after).allMatch(time -> time > 0);
    }

    private static double explainMilliseconds(String query) throws Exception {
        return JSON.readTree(sql("explain (analyze, buffers, format json) " + query))
                .get(0).path("Execution Time").asDouble();
    }

    private static String actualQuery(double lat, double lng, int radius) {
        AtomicReference<String> result = new AtomicReference<>();
        MapMarkerRepository repository = (MapMarkerRepository) Proxy.newProxyInstance(
                MapMarkerRepository.class.getClassLoader(), new Class<?>[]{MapMarkerRepository.class},
                (proxy, method, args) -> {
                    if (method.isDefault()) return InvocationHandler.invokeDefault(proxy, method, args);
                    Map<String, Object> parameters = new HashMap<>();
                    for (int i = 0; i < method.getParameterCount(); i++) {
                        parameters.put(method.getParameters()[i].getAnnotation(Param.class).value(), args[i]);
                    }
                    result.set(bind(method.getAnnotation(Query.class).value(), parameters));
                    return List.of();
                });
        repository.findNearbyByCategory(lat, lng, radius, "accessible_toilet");
        return result.get();
    }

    private static Map<String, Object> parameters(double lat, double lng, int radius) {
        return Map.of("lat", lat, "lng", lng, "radius", radius, "category", "accessible_toilet");
    }

    private static String bind(String query, Map<String, Object> parameters) {
        return Pattern.compile(":([a-zA-Z][a-zA-Z0-9]*)").matcher(query).replaceAll(match -> {
            Object value = parameters.get(match.group(1));
            if (value == null) throw new IllegalArgumentException("Missing test query parameter " + match.group(1));
            return value instanceof String text ? "'" + text.replace("'", "''") + "'" : value.toString();
        });
    }

    private static String sql(String statement) throws Exception {
        return command("set jit=off; set max_parallel_workers_per_gather=0; " + statement,
                "docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t",
                "-v", "ON_ERROR_STOP=1", "-U", "nearby_test", "-d", "nearby_test");
    }

    private static String command(String input, String... arguments) throws Exception {
        Process process = new ProcessBuilder(arguments).redirectErrorStream(true).start();
        CompletableFuture<String> output = CompletableFuture.supplyAsync(() -> {
            try {
                return new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            } catch (Exception failure) {
                throw new IllegalStateException(failure);
            }
        });
        try (var stdin = process.getOutputStream()) {
            if (input != null) stdin.write(input.getBytes(StandardCharsets.UTF_8));
        }
        if (!process.waitFor(60, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new AssertionError("Timed out running isolated PostgreSQL test command");
        }
        String result = output.get(5, TimeUnit.SECONDS);
        assertThat(process.exitValue()).as("%s: %s", arguments[0], result).isZero();
        return result;
    }
}
