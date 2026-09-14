package com.lycoris.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

@Getter
@Setter
@Entity
@Table(name = "users")

public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)

    private Integer id;
    @Column(name = "public_id", nullable = false, unique = true)
    private UUID publicId;
    private String username;
    private String nickname;
    private String email;
    private String password;
    @Column(name = "avatar_url")
    private String avatarUrl;
    @Column(length = 64)
    private String pronouns;
    @Column(length = 200)
    private String signature;

    @Column(nullable = false, length = 32)
    private String role = "USER";

    @Column(nullable = false, columnDefinition = "boolean not null default false")
    private Boolean deleted = false;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(nullable = false, columnDefinition = "bigint not null default 0")
    private Long sessionVersion = 0L;

    @Version
    @Column(nullable = false, columnDefinition = "bigint not null default 0")
    private Long rowVersion = 0L;

    @PrePersist
    public void ensurePublicId() {
        if (publicId == null) {
            publicId = UUID.randomUUID();
        }
    }
}
