package com.lycoris.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class UserResponse {
    private final String publicId;
    private final String username;
    private final String nickname;
    private final String email;
    private final String avatarUrl;
    private final String pronouns;
    private final String signature;

    public UserResponse(String publicId, String username, String nickname, String email, String avatarUrl, String pronouns, String signature) {
        this.publicId = publicId;
        this.username = username;
        this.nickname = nickname;
        this.email = email;
        this.avatarUrl = avatarUrl;
        this.pronouns = pronouns;
        this.signature = signature;
    }

}
