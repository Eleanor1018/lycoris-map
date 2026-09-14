package com.lycoris.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class RegisterRequest {
    private String username;
    private String nickname;
    private String email;
    private String password;
    private String website;
}
