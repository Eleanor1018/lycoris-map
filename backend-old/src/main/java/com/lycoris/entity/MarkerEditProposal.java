package com.lycoris.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

@Entity
@Getter
@Setter
@NoArgsConstructor
@Table(name = "marker_edit_proposals")
public class MarkerEditProposal {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    @Column(nullable = false, columnDefinition = "bigint not null default 0")
    private Long version = 0L;

    // Null means a proposal predates version tracking and must be resubmitted.
    @Column
    private Long baseMarkerVersion;

    @Column(nullable = false)
    private Long markerId;

    @Column(nullable = false, length = 120)
    private String markerTitle;

    @Column(nullable = false)
    private Double markerLat;

    @Column(nullable = false)
    private Double markerLng;

    @Column(nullable = false, length = 64)
    private String proposerUsername;

    @Column(length = 64)
    private String proposerPublicId;

    @Column(nullable = false)
    private Boolean proposerIsOwner = true;

    @Column(nullable = false, length = 64)
    private String category;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    @Column(nullable = false, length = 2, columnDefinition = "varchar(2) not null default 'zh'")
    private String language = "zh";

    @Column(nullable = false)
    private Boolean isPublic = true;

    @Column(nullable = false)
    private Boolean isActive = true;

    @Column(length = 5)
    private String openTimeStart;

    @Column(length = 5)
    private String openTimeEnd;

    @Column(nullable = false, length = 16)
    private String status = "PENDING";

    @Column(length = 64)
    private String reviewedBy;

    @Column
    private Instant reviewedAt;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();
}
