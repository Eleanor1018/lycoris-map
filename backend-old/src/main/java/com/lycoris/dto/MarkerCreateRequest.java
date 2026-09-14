package com.lycoris.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MarkerCreateRequest {
    private Double lat;
    private Double lng;
    private String category;
    private String title;
    private String description;
    private String language;
    private Boolean isPublic = true;
    private Boolean isActive = true;
    private String openTimeStart;
    private String openTimeEnd;
    private String clientRequestId;

    // markImage 先允许传空字符串或不传
    private String markImage;

}
