package com.lycoris.service;

import com.lycoris.entity.MapMarker;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import static org.assertj.core.api.Assertions.assertThat;

class MarkerLanguageTest {
    @AfterEach void clearRequest() { RequestContextHolder.resetRequestAttributes(); }

    @ParameterizedTest
    @CsvSource({"en-US,en", "zh-Hant,zh", "EN,en", "fr,zh", "system,zh", "*,zh"})
    void queryLanguageTakesPriorityAndUnsupportedValuesDefaultToChinese(String requested, String expected) {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("lang", requested);
        request.addHeader("Accept-Language", "en");
        assertThat(MarkerLanguage.forRead(request)).isEqualTo(expected);
    }

    @Test void acceptsWeightedSystemLanguagesButIgnoresZeroQuality() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Accept-Language", "fr, zh;q=0, en-US;q=0.7");
        assertThat(MarkerLanguage.forRead(request)).isEqualTo("en");
    }

    @Test void missingAndMalformedLanguageHeadersDefaultToChinese() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        assertThat(MarkerLanguage.forRead(request)).isEqualTo("zh");
        request.addHeader("Accept-Language", "en;q=broken");
        assertThat(MarkerLanguage.forRead(request)).isEqualTo("zh");
    }

    @Test void clientLanguageHeaderWorksWhenAcceptLanguageIsAbsent() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-App-Language", "en-US");
        assertThat(MarkerLanguage.forRead(request)).isEqualTo("en");
    }

    @Test void writeLanguageUsesBodyThenRequestHeaderAndIgnoresQueryLanguage() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setParameter("lang", "zh");
        request.addHeader("Accept-Language", "en-US,en;q=0.9");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        assertThat(MarkerLanguage.forWrite(null)).isEqualTo("en");
        assertThat(MarkerLanguage.forWrite("zh")).isEqualTo("zh");
        assertThat(MarkerLanguage.forWrite("unsupported")).isEqualTo("zh");
    }

    @Test void canonicalHashMatchesPythonIncludingUnicodeEscapesAndNullText() {
        MapMarker marker = new MapMarker();
        marker.setTitle(null);
        marker.setDescription(null);
        assertThat(MarkerSourceHash.of(marker))
                .isEqualTo("3defae280890f55c022bcd5c252977969064fb6328f2927428ba4a0b02e14840");
        marker.setTitle("中\"文\\\n😀");
        marker.setDescription("line\t\u001f");
        assertThat(MarkerSourceHash.of(marker))
                .isEqualTo("69041ef21862545c32d414958ea2e68ef0287b0b67807d93ebfce3179dae8e87");
    }
}
