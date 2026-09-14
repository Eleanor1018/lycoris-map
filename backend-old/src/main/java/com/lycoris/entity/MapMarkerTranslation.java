package com.lycoris.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.time.Instant;

@Entity
@Getter
@Setter
@NoArgsConstructor
@Table(name = "map_marker_translations", uniqueConstraints =
        @UniqueConstraint(name = "uk_map_marker_translation_language", columnNames = {"marker_id", "language"}))
public class MapMarkerTranslation {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long markerId;

    @Column(nullable = false, length = 2)
    private String language;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    @Column(nullable = false, length = 64)
    private String sourceHash;

    @Column(nullable = false, length = 16, columnDefinition = "varchar(16) not null default 'MACHINE'")
    private String origin = "MACHINE";

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();
}
