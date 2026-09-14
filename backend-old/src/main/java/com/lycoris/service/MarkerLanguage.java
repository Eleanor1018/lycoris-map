package com.lycoris.service;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import java.util.Locale;

/** Supported content languages, independent of the server's default locale. */
public final class MarkerLanguage {
    private MarkerLanguage() {}

    public static String normalize(String value) {
        String supported = supported(value);
        return supported == null ? "zh" : supported;
    }

    private static String supported(String value) {
        if (value == null) return null;
        String language = value.trim().toLowerCase(Locale.ROOT).replace('_', '-');
        if (language.equals("en") || language.startsWith("en-")) return "en";
        if (language.equals("zh") || language.startsWith("zh-")) return "zh";
        return null;
    }

    public static String forRead(HttpServletRequest request) {
        String explicit = request.getParameter("lang");
        return explicit != null ? normalize(explicit) : fromHeaders(request);
    }

    public static String forWrite(String bodyLanguage) {
        if (bodyLanguage != null) return normalize(bodyLanguage);
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return fromHeaders(attributes.getRequest());
        }
        return "zh";
    }

    private static String fromHeaders(HttpServletRequest request) {
        String accept = request.getHeader("Accept-Language");
        if (accept != null && !accept.isBlank()) {
            try {
                for (Locale.LanguageRange range : Locale.LanguageRange.parse(accept)) {
                    String language = supported(range.getRange());
                    if (range.getWeight() > 0 && language != null) return language;
                }
            } catch (IllegalArgumentException ignored) {
                return "zh";
            }
            return "zh";
        }
        return normalize(request.getHeader("X-App-Language"));
    }
}
