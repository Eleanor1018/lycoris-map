package com.lycoris.security;

import com.lycoris.config.SecurityConfig;
import com.lycoris.config.SessionCookieConfig;
import com.lycoris.controller.AuthController;
import com.lycoris.entity.User;
import com.lycoris.service.ImageUploadService;
import com.lycoris.service.RegisterRateLimitService;
import com.lycoris.service.UserService;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.session.MapSessionRepository;
import org.springframework.session.SessionRepository;
import org.springframework.session.data.redis.RedisSessionRepository;
import org.springframework.session.config.annotation.web.http.EnableSpringHttpSession;
import org.springframework.session.web.http.SessionRepositoryFilter;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Real HTTP and Spring Session cookie/filter regression; never supplies MockHttpSession.
 * Normally uses an in-memory Spring Session repository. To exercise actual Redis too,
 * set LYCORIS_TEST_REDIS_PORT to a disposable Redis port on 127.0.0.1; no database,
 * external Redis host, password, or production namespace is accepted by this test.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        classes = SessionCookieIntegrationTest.TestApplication.class,
        properties = {
                "server.ssl.enabled=false", "server.address=127.0.0.1",
                "server.servlet.session.cookie.name=LYCORIS_SESSION",
                "server.servlet.session.cookie.domain=",
                "server.servlet.session.cookie.secure=false",
                "server.servlet.session.cookie.http-only=true",
                "server.servlet.session.cookie.same-site=lax",
                "spring.data.redis.host=127.0.0.1", "spring.data.redis.password=",
                "spring.data.redis.username=", "spring.data.redis.database=0",
                "spring.data.redis.repositories.enabled=false",
                "spring.data.redis.connect-timeout=2s", "spring.data.redis.timeout=2s",
                "app.upload-dir=target/session-cookie-test-uploads"
        })
class SessionCookieIntegrationTest {
    private static final String COOKIE_NAME = "LYCORIS_SESSION";
    private static final String USERNAME = "cookie-test-user";
    private static final String NAMESPACE = "lycoris:test:cookie:" + UUID.randomUUID();
    private static final String REDIS_PORT = System.getenv("LYCORIS_TEST_REDIS_PORT");
    private static final boolean USE_REDIS = REDIS_PORT != null && !REDIS_PORT.isBlank();

    @LocalServerPort int port;
    @Autowired SessionRepositoryFilter<?> springSessionFilter;
    @Autowired SessionRepository<?> sessionRepository;
    @MockitoBean UserService users;
    @MockitoBean RegisterRateLimitService limiter;
    @MockitoBean ImageUploadService images;

    private User user;
    private CookieManager cookies;
    private HttpClient client;

    @DynamicPropertySource
    static void sessionStore(DynamicPropertyRegistry registry) {
        registry.add("test.session.use-redis", () -> USE_REDIS);
        registry.add("spring.data.redis.port", () -> USE_REDIS ? Integer.parseInt(REDIS_PORT) : 6379);
        registry.add("spring.session.redis.namespace", () -> NAMESPACE);
    }

    @BeforeEach
    void prepareUserAndFreshCookieJar() {
        assertThat(springSessionFilter).isNotNull();
        assertThat(sessionRepository).isInstanceOf(USE_REDIS
                ? RedisSessionRepository.class : MapSessionRepository.class);
        user = new User();
        user.setId(1201);
        user.setPublicId(UUID.fromString("8f26a833-87c3-407c-86b3-cbd30a0a41ba"));
        user.setUsername(USERNAME);
        user.setEmail("cookie-test@example.invalid");
        user.setSessionVersion(7L);
        when(users.login(USERNAME, "test-password-only")).thenReturn(user);
        when(users.findById(user.getId())).thenAnswer(ignored -> Optional.of(user));
        cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        client = HttpClient.newBuilder().cookieHandler(cookies)
                .connectTimeout(Duration.ofSeconds(5)).build();
    }

    @Test
    void loginCookieRestoresIdentityOnRepeatedIndependentHttpRequests() throws Exception {
        assertThat(login().statusCode()).isEqualTo(200);
        String cookie = currentCookie();
        assertThat(cookie).isNotBlank();
        var observedCookies = new ArrayList<String>();
        observedCookies.add(cookie);
        for (int request = 0; request < 3; request++) {
            HttpResponse<String> me = getMe(client);
            assertThat(me.statusCode()).as("GET /me after login, request %s: %s", request, me.body()).isEqualTo(200);
            assertThat(me.body()).contains(USERNAME, user.getPublicId().toString());
            observedCookies.add(currentCookie());
        }
        assertThat(observedCookies.stream().distinct().count())
                .as("Only login should rotate the cookie; later requests must preserve in-flight request credentials")
                .isEqualTo(1);
    }

    @Test
    void loginCookieRemainsUsableForRequestsDispatchedBeforeFirstMeResponse() throws Exception {
        assertThat(login().statusCode()).isEqualTo(200);
        String loginCookie = currentCookie();
        // Model two fetches dispatched with the same cookie before either response
        // updates the browser's cookie jar. Sequential server handling makes this deterministic.
        HttpClient inFlightRequests = HttpClient.newHttpClient();
        HttpRequest alreadyDispatched = HttpRequest.newBuilder(uri("/api/me"))
                .header("Cookie", COOKIE_NAME + "=" + loginCookie).GET().build();
        assertThat(inFlightRequests.send(alreadyDispatched, HttpResponse.BodyHandlers.ofString()).statusCode())
                .isEqualTo(200);
        assertThat(inFlightRequests.send(alreadyDispatched, HttpResponse.BodyHandlers.ofString()).statusCode())
                .as("Another request carrying the just-issued login cookie must stay authenticated")
                .isEqualTo(200);
    }

    @Test
    void loginRotatesExistingAnonymousSessionAndOldCookieCannotAuthenticate() throws Exception {
        String anonymousCookie = startAnonymousSession();
        assertThat(login().statusCode()).isEqualTo(200);
        assertThat(currentCookie()).isNotBlank().isNotEqualTo(anonymousCookie);
        assertThat(getMe(client).statusCode()).isEqualTo(200);
        HttpResponse<String> oldSession = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(uri("/api/me"))
                        .header("Cookie", COOKIE_NAME + "=" + anonymousCookie).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(oldSession.statusCode()).isEqualTo(401);
        assertThat(getMe(client).statusCode()).isEqualTo(200);
    }

    @Test
    void registrationAlsoRotatesAnonymousSessionAndKeepsNewCookieUsable() throws Exception {
        String anonymousCookie = startAnonymousSession();
        when(limiter.tryAcquire(anyString())).thenReturn(true);
        when(users.register(USERNAME, null, "cookie-test@example.invalid", "test-password-only"))
                .thenReturn(user);
        HttpResponse<String> registered = client.send(HttpRequest.newBuilder(uri("/api/register"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("""
                        {"username":"cookie-test-user","email":"cookie-test@example.invalid",
                         "password":"test-password-only"}
                        """))
                .build(), HttpResponse.BodyHandlers.ofString());
        assertThat(registered.statusCode()).isEqualTo(200);
        String registrationCookie = currentCookie();
        assertThat(registrationCookie).isNotBlank().isNotEqualTo(anonymousCookie);
        assertThat(getMe(client).statusCode()).isEqualTo(200);
        assertThat(currentCookie()).isEqualTo(registrationCookie);
        HttpResponse<String> oldSession = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(uri("/api/me"))
                        .header("Cookie", COOKIE_NAME + "=" + anonymousCookie).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(oldSession.statusCode()).isEqualTo(401);
    }

    @Test
    void credentialVersionInvalidatesStoredSessionAndFreshLoginRecovers() throws Exception {
        assertThat(login().statusCode()).isEqualTo(200);
        assertThat(getMe(client).statusCode()).isEqualTo(200);
        user.setSessionVersion(8L);
        assertThat(getMe(client).statusCode()).isEqualTo(401);
        assertThat(login().statusCode()).isEqualTo(200);
        assertThat(getMe(client).statusCode()).isEqualTo(200);
    }

    private HttpResponse<String> login() throws Exception {
        return client.send(HttpRequest.newBuilder(uri("/api/login"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(
                                "{\"username\":\"" + USERNAME + "\",\"password\":\"test-password-only\"}"))
                        .build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> getMe(HttpClient browser) throws Exception {
        return browser.send(HttpRequest.newBuilder(uri("/api/me")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private String startAnonymousSession() throws Exception {
        assertThat(client.send(HttpRequest.newBuilder(uri("/api/markers/public")).GET().build(),
                HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(200);
        String cookie = currentCookie();
        assertThat(cookie).isNotBlank();
        return cookie;
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private String currentCookie() {
        return cookies.getCookieStore().getCookies().stream()
                .filter(cookie -> COOKIE_NAME.equals(cookie.getName()) && !cookie.hasExpired())
                .map(HttpCookie::getValue).findFirst().orElse("");
    }

    @Configuration(proxyBeanMethods = false)
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class,
            HibernateJpaAutoConfiguration.class, JpaRepositoriesAutoConfiguration.class,
            UserDetailsServiceAutoConfiguration.class})
    @Import({AuthController.class, SecurityConfig.class, SessionCookieConfig.class,
            AnonymousSessionProbe.class, InMemorySessionConfiguration.class})
    static class TestApplication {
    }

    @Configuration(proxyBeanMethods = false)
    @ConditionalOnProperty(name = "test.session.use-redis", havingValue = "false", matchIfMissing = true)
    @EnableSpringHttpSession
    static class InMemorySessionConfiguration {
        @Bean
        MapSessionRepository inMemorySessions() {
            return new MapSessionRepository(new ConcurrentHashMap<>());
        }
    }

    @RestController
    static class AnonymousSessionProbe {
        @GetMapping("/api/markers/public")
        String createAnonymousSession(HttpSession session) {
            session.setAttribute("testAnonymousSession", true);
            return "ok";
        }
    }
}
