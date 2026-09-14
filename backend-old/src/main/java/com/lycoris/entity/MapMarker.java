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
        name = "map_markers",
        uniqueConstraints = {
                @UniqueConstraint(
                        name = "uk_map_markers_user_client_request",
                        columnNames = {"user_public_id", "client_request_id"}
                )
        }
)
public class MapMarker {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Version
    @Column(nullable = false, columnDefinition = "bigint not null default 0")
    private Long version = 0L;

    // 坐标
    @Column(nullable = false)
    private Double lat;

    @Column(nullable = false)
    private Double lng;

    // 类别：先用 String（和前端一致），后面想严格再换 enum
    @Column(nullable = false, length = 64)
    private String category;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    @Column(nullable = false, length = 2, columnDefinition = "varchar(2) not null default 'zh'")
    private String sourceLanguage = "zh";

    @Transient
    private String contentLanguage;

    @Column(nullable = false)
    private Boolean isPublic = true;

    // 你新增的字段
    @Column(nullable = false, length = 64)
    private String username;   // 谁标的（先存用户名即可）

    // 关联用户 public_id（用于权限与收藏）
    @Column(length = 64)
    private String userPublicId;

    @Column(length = 64)
    private String clientRequestId;

    @Column(nullable = false)
    private Boolean isActive = true;

    // 每日可用时间（HH:mm），为空表示全天开放
    @Column(length = 5)
    private String openTimeStart;

    @Column(length = 5)
    private String openTimeEnd;

    @Column(nullable = false, length = 16)
    private String reviewStatus = "APPROVED";

    @Column(length = 64)
    private String lastEditedBy;

    @Column(length = 64)
    private String lastEditedByPublicId;

    @Column(nullable = false)
    private Boolean lastEditedByOwner = true;

    // 先留着：未来存图片 URL / key
    @Column(length = 512)
    private String markImage;

    @Column(nullable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    @PreUpdate
    public void onUpdate() {
        this.updatedAt = Instant.now();
    }


}
