package com.lycoris.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class ImageUploadService {
    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final long MAX_PIXELS = 25_000_000;
    private static final Set<String> FORMATS = Set.of("jpeg", "jpg", "png", "gif", "webp");
    private final Path uploadRoot;

    public ImageUploadService(@Value("${app.upload-dir}") String uploadDir) {
        this.uploadRoot = Path.of(uploadDir).toAbsolutePath().normalize();
    }

    public String storeImage(MultipartFile file, String subdirectory, String prefix) throws IOException {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("文件为空");
        if (file.getSize() > MAX_BYTES) throw new IllegalArgumentException("图片不能超过 5MB");
        if (!Set.of("avatars", "markers").contains(subdirectory) || !prefix.matches("[A-Za-z0-9-]+")) {
            throw new IllegalArgumentException("图片保存位置无效");
        }
        BufferedImage decoded;
        try (var input = new MemoryCacheImageInputStream(file.getInputStream())) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw new IllegalArgumentException("请选择有效的 JPG、PNG、GIF 或 WebP 图片");
            ImageReader reader = readers.next();
            try {
                reader.setInput(input, true, true);
                if (!FORMATS.contains(reader.getFormatName().toLowerCase(Locale.ROOT))) {
                    throw new IllegalArgumentException("请选择 JPG、PNG、GIF 或 WebP 图片");
                }
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 10000 || height > 10000
                        || (long) width * height > MAX_PIXELS) {
                    throw new IllegalArgumentException("图片尺寸过大，请缩小后上传");
                }
                decoded = reader.read(0);
                if (decoded == null) throw new IllegalArgumentException("图片内容无效");
            } finally {
                reader.dispose();
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("图片损坏或无法解码，请换一张图片", e);
        }

        boolean alpha = decoded.getColorModel().hasAlpha();
        BufferedImage clean = new BufferedImage(decoded.getWidth(), decoded.getHeight(),
                alpha ? BufferedImage.TYPE_INT_ARGB : BufferedImage.TYPE_INT_RGB);
        var graphics = clean.createGraphics();
        try { graphics.drawImage(decoded, 0, 0, null); } finally { graphics.dispose(); }
        String format = alpha ? "png" : "jpg";
        String filename = prefix + "-" + UUID.randomUUID() + "." + format;
        Path directory = uploadRoot.resolve(subdirectory);
        Files.createDirectories(directory);
        Path target = directory.resolve(filename);
        try {
            if (!ImageIO.write(clean, format, target.toFile())) throw new IOException("图片编码失败");
        } catch (IOException e) {
            Files.deleteIfExists(target);
            throw e;
        }
        return "/uploads/" + subdirectory + "/" + filename;
    }
}
