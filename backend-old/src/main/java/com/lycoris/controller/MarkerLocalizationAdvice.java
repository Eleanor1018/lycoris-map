package com.lycoris.controller;

import com.lycoris.entity.MapMarker;
import com.lycoris.service.MarkerLanguage;
import com.lycoris.service.MarkerLocalizationService;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;
import java.util.List;

/** Localize copies only at the HTTP boundary; repositories and Redis retain source text. */
@RestControllerAdvice
public class MarkerLocalizationAdvice implements ResponseBodyAdvice<Object> {
    private final MarkerLocalizationService localization;

    public MarkerLocalizationAdvice(MarkerLocalizationService localization) {
        this.localization = localization;
    }

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body, MethodParameter returnType, MediaType contentType,
            Class<? extends HttpMessageConverter<?>> converterType, ServerHttpRequest request,
            ServerHttpResponse response) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) return body;
        String language = MarkerLanguage.forRead(servletRequest.getServletRequest());
        if (body instanceof MapMarker marker) {
            response.getHeaders().add(HttpHeaders.VARY, "Accept-Language, X-App-Language");
            return localization.localize(marker, language);
        }
        if (body instanceof List<?> list && !list.isEmpty() && list.stream().allMatch(MapMarker.class::isInstance)) {
            response.getHeaders().add(HttpHeaders.VARY, "Accept-Language, X-App-Language");
            return localization.localize(list.stream().map(MapMarker.class::cast).toList(), language);
        }
        return body;
    }
}
