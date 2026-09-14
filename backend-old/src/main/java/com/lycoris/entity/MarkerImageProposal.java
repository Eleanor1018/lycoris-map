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
@Table(name = "marker_image_proposals")
public class MarkerImageProposal {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long markerId;

    @Column(nullable = false, length = 120)
    private String markerTitle;

    @Column(nullable = false, length = 64)
    private String proposerUsername;

    @Column(length = 64)
    private String proposerPublicId;

    @Column(nullable = false, length = 512)
    private String imageUrl;

    @Column(nullable = false, length = 16)
    private String status = "PENDING";

    @Column(length = 64)
    private String reviewedBy;

    @Column
    private Instant reviewedAt;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();
}
