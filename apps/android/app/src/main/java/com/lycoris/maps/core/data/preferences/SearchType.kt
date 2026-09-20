package com.lycoris.maps.core.data.preferences

import com.lycoris.maps.core.model.Language
import com.lycoris.maps.core.model.PlaceCategory

enum class SearchType(val storedValue: String, val category: PlaceCategory?) {
    ALL("all", null),
    TOILET("toilet", PlaceCategory.ACCESSIBLE_TOILET),
    NURSING("nursing", PlaceCategory.BABY_ROOM),
    MEDICAL("medical", PlaceCategory.FRIENDLY_CLINIC);

    fun title(language: Language): String = when (this) {
        ALL -> if (language == Language.ZH) "全部" else "All"
        TOILET -> if (language == Language.ZH) "无障碍卫生间" else "Accessible Toilets"
        NURSING -> if (language == Language.ZH) "母婴室" else "Nursing Rooms"
        MEDICAL -> if (language == Language.ZH) "医疗机构" else "Medical Institutions"
    }

    companion object {
        fun fromStored(value: String?): SearchType = entries.firstOrNull { it.storedValue == value } ?: ALL
    }
}
