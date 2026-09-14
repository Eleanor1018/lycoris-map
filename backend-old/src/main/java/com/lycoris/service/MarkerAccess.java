package com.lycoris.service;

import com.lycoris.entity.MapMarker;
import com.lycoris.entity.User;

public final class MarkerAccess {
    private MarkerAccess() {}

    public static boolean isPublic(MapMarker marker) {
        return marker != null && Boolean.TRUE.equals(marker.getIsPublic())
                && "APPROVED".equals(marker.getReviewStatus());
    }

    public static boolean canView(MapMarker marker, User viewer) {
        if (marker == null) return false;
        if (viewer != null && !Boolean.TRUE.equals(viewer.getDeleted())) {
            if ("ADMIN".equalsIgnoreCase(viewer.getRole())) return true;
            if (viewer.getPublicId() != null && viewer.getPublicId().toString().equals(marker.getUserPublicId())) return true;
        }
        return isPublic(marker);
    }
}
