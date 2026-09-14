package com.lycoris.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;

class ImageUploadServiceTest {
    @TempDir Path root;

    private byte[] png(int width, int height) throws Exception {
        var output = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB), "png", output);
        return output.toByteArray();
    }

    @Test void rejectsNonImageRegardlessOfClaimedType() throws Exception {
        var service = new ImageUploadService(root.toString());
        var file = new MockMultipartFile("file", "photo.png", "image/png", "this is not an image".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> service.storeImage(file, "markers", "proposal-marker-1"))
                .isInstanceOf(IllegalArgumentException.class);
        try (var files = Files.list(root)) { assertThat(files).isEmpty(); }
    }

    @Test void reencodesRealImageAndDiscardsClientFilenameAndTrailingBytes() throws Exception {
        byte[] original = png(2, 3);
        var bytes = new ByteArrayOutputStream();
        bytes.write(original);
        bytes.write("trailing-test-content".getBytes(StandardCharsets.UTF_8));
        var file = new MockMultipartFile("file", "untrusted-name.html", "text/html", bytes.toByteArray());
        String url = new ImageUploadService(root.toString()).storeImage(file, "avatars", "avatar-test");
        assertThat(url).startsWith("/uploads/avatars/avatar-test-").endsWith(".png");
        Path saved = root.resolve(url.substring("/uploads/".length()));
        var decoded = ImageIO.read(saved.toFile());
        assertThat(decoded.getWidth()).isEqualTo(2);
        assertThat(decoded.getHeight()).isEqualTo(3);
        assertThat(new String(Files.readAllBytes(saved), StandardCharsets.ISO_8859_1)).doesNotContain("trailing-test-content");
    }

    @Test void rejectsOversizedDimensionsBeforeFullDecode() throws Exception {
        var file = new MockMultipartFile("file", "large.png", "image/png", png(10001, 1));
        assertThatThrownBy(() -> new ImageUploadService(root.toString()).storeImage(file, "markers", "test"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("尺寸");
    }

    @Test void rejectsOversizedFiles() {
        var file = new MockMultipartFile("file", "large.png", "image/png", new byte[5 * 1024 * 1024 + 1]);
        assertThatThrownBy(() -> new ImageUploadService(root.toString()).storeImage(file, "avatars", "test"))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("5MB");
    }

    @Test void webpReaderRemainsAvailable() {
        var readers = ImageIO.getImageReadersByFormatName("webp");
        assertThat(readers.hasNext()).isTrue();
        readers.next().dispose();
    }
}
