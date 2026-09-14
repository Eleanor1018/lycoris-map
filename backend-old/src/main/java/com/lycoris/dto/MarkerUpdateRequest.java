package com.lycoris.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MarkerUpdateRequest {
    private String category;
    private String title;
    private String description;
    private String language;
    private Boolean isPublic;
    private Boolean isActive;
    private String openTimeStart;
    private String openTimeEnd;
}
