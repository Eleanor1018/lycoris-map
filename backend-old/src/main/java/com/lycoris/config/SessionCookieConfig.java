package com.lycoris.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.util.StringUtils;

import java.time.Duration;

@Configuration
public class SessionCookieConfig {
    private static final Duration DEFAULT_COOKIE_MAX_AGE = Duration.ofDays(30);

    @Bean
    public CookieSerializer cookieSerializer(
            @Value("${server.servlet.session.cookie.name:LYCORIS_SESSION}") String cookieName,
            @Value("${server.servlet.session.cookie.domain:}") String cookieDomain,
            @Value("${server.servlet.session.cookie.secure:false}") boolean secure,
            @Value("${server.servlet.session.cookie.http-only:true}") boolean httpOnly,
            @Value("${server.servlet.session.cookie.same-site:lax}") String sameSite,
            @Value("${server.servlet.session.cookie.max-age:30d}") String cookieMaxAge
    ) {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName(cookieName);
        serializer.setCookiePath("/");
        serializer.setUseSecureCookie(secure);
        serializer.setUseHttpOnlyCookie(httpOnly);
        serializer.setSameSite(normalizeSameSite(sameSite));
        serializer.setCookieMaxAge(toCookieMaxAgeSeconds(cookieMaxAge));

        if (StringUtils.hasText(cookieDomain)) {
            serializer.setDomainName(cookieDomain.trim());
        }

        return serializer;
    }

    private static int toCookieMaxAgeSeconds(String rawValue) {
        Duration duration = parseDuration(rawValue, DEFAULT_COOKIE_MAX_AGE);
        long seconds = duration.getSeconds();
        if (seconds < 0) return -1;
        return seconds > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) seconds;
    }

    private static Duration parseDuration(String rawValue, Duration fallback) {
        if (!StringUtils.hasText(rawValue)) return fallback;
        try {
            return DurationStyle.detectAndParse(rawValue.trim());
        } catch (RuntimeException ignored) {
            return fallback;
        }
    }

    private static String normalizeSameSite(String rawValue) {
        if (!StringUtils.hasText(rawValue)) return "Lax";
        String normalized = rawValue.trim().toLowerCase();
        return switch (normalized) {
            case "none" -> "None";
            case "strict" -> "Strict";
            default -> "Lax";
        };
    }
}
