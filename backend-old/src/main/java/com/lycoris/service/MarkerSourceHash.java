package com.lycoris.service;

import com.lycoris.entity.MapMarker;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** SHA-256 of UTF-8 JSON [sourceLanguage,title,description], null text as "".
 * No whitespace/Unicode normalization; JSON is compact, non-ASCII is unescaped,
 * and control-character hexadecimal escapes are lowercase (Python ensure_ascii=False).
 */
public final class MarkerSourceHash {
    private MarkerSourceHash() {}

    public static String of(MapMarker marker) {
        String json = "[" + quote(MarkerLanguage.normalize(marker.getSourceLanguage())) + ","
                + quote(marker.getTitle()) + "," + quote(marker.getDescription()) + "]";
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(json.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static String quote(String value) {
        StringBuilder json = new StringBuilder("\"");
        if (value != null) {
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                switch (c) {
                    case '"' -> json.append("\\\"");
                    case '\\' -> json.append("\\\\");
                    case '\b' -> json.append("\\b");
                    case '\f' -> json.append("\\f");
                    case '\n' -> json.append("\\n");
                    case '\r' -> json.append("\\r");
                    case '\t' -> json.append("\\t");
                    default -> {
                        if (c < 0x20) json.append(String.format("\\u%04x", (int) c));
                        else json.append(c);
                    }
                }
            }
        }
        return json.append('"').toString();
    }
}
