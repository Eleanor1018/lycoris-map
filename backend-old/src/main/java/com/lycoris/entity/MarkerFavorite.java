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
@Table(
        name = "marker_favorites",
        uniqueConstraints = {
                @UniqueConstraint(name = "uq_marker_fav_user_marker", columnNames = {"userPublicId", "markerId"})
        }
)
public class MarkerFavorite {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 64)
    private String userPublicId;

    @Column(nullable = false)
    private Long markerId;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();
}
