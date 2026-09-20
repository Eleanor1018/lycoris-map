package com.lycoris.maps.feature.contributions

import com.lycoris.maps.core.model.Marker
import com.lycoris.maps.core.network.CreateMarkerRequest
import com.lycoris.maps.core.network.LycorisJson
import java.util.UUID
import org.junit.Assert.*
import org.junit.Test

class ContributionDraftTest {
    @Test fun validationCountsUnicodeScalarsAndRequiresCompleteHours() {
        val fields = ContributionFields(title = "😀".repeat(120))
        assertTrue(fields.isValid())
        assertFalse(fields.copy(title = "😀".repeat(121)).isValid())
        assertFalse(fields.copy(title = " \n ").isValid())
        assertFalse(fields.copy(openTimeStart = "09:00").isValid())
        assertFalse(fields.copy(openTimeStart = "24:00", openTimeEnd = "12:00").isValid())
        assertTrue(fields.copy(openTimeStart = "09:00", openTimeEnd = "23:59").isValid())
        assertFalse(fields.copy(category = "unexpected").isValid())
    }
    @Test fun frozenCreationContainsExactKeyAndNoPrivateVisibilityOrImageField() {
        val draft = ContributionDraft(UUID.randomUUID().toString(), "a", "https://example.test/", 31.2, 121.5, ContributionFields(title = "  Place  "))
        val raw = draft.frozenBody()
        val decoded = LycorisJson.decodeFromString<CreateMarkerRequest>(raw)
        assertEquals("Place", decoded.title)
        assertEquals(draft.creationRequestId, decoded.clientRequestId)
        assertFalse(raw.contains("isPublic"))
        assertFalse(raw.contains("markImage"))
        val frozen = draft.copy(phase = DraftPhase.CREATING, frozenRequest = raw)
        assertFalse(frozen.editable)
        assertTrue(frozen.safelyResumable)
        assertEquals(raw, frozen.copy(attempts = 3).frozenRequest)
    }
    @Test fun unchangedEditDoesNotCreateTextProposalAndUncertaintyIsNeverResumable() {
        val marker = Marker(17, 31.2, 121.5, "baby_room", "Place")
        val draft = ContributionDraft(UUID.randomUUID().toString(), "a", "https://example.test/", marker.lat, marker.lng, ContributionFields.fromMarker(marker), original = marker)
        assertFalse(draft.hasTextChanges)
        assertFalse(draft.canSubmit)
        assertTrue(draft.copy(fields = draft.fields.copy(title = "Updated")).canSubmit)
        assertFalse(draft.copy(phase = DraftPhase.UNCERTAIN_EDIT).safelyResumable)
        assertFalse(draft.copy(latitude = 0.0).isValidCheckpoint())
    }
}
