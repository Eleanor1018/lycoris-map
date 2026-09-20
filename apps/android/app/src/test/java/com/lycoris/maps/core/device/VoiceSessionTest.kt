package com.lycoris.maps.core.device

import org.junit.Assert.*
import org.junit.Test

class VoiceSessionTest {
    @Test fun `no service or permission never enters recording state`() {
        val machine = VoiceSessionMachine()
        assertNull(machine.begin(hasPermission = false, available = false))
        assertEquals(VoiceStatus.UNAVAILABLE, machine.state.value.status)
        assertNull(machine.begin(hasPermission = false, available = true))
        assertEquals(VoiceStatus.PERMISSION_REQUIRED, machine.state.value.status)
        assertFalse(machine.state.value.isActive)
    }

    @Test fun `successful recognition delivers trimmed first nonempty result once`() {
        val machine = VoiceSessionMachine()
        val token = machine.begin(true, true)!!
        assertEquals(VoiceStatus.STARTING, machine.state.value.status)
        machine.listening(token)
        assertEquals(VoiceStatus.LISTENING, machine.state.value.status)
        machine.processing(token)
        assertEquals(VoiceStatus.PROCESSING, machine.state.value.status)
        machine.result(token, listOf(" ", "  nursing room  ", "other"))
        assertEquals(VoiceState(VoiceStatus.RESULT, "nursing room"), machine.state.value)
        machine.result(token, listOf("late result"))
        machine.fail(token, VoiceError.SERVICE)
        assertEquals("nursing room", machine.state.value.transcript)
    }

    @Test fun `cancel before ready rejects all late callbacks`() {
        val machine = VoiceSessionMachine()
        val token = machine.begin(true, true)!!
        machine.cancel()
        machine.listening(token)
        machine.processing(token)
        machine.result(token, listOf("must not search"))
        machine.fail(token, VoiceError.SERVICE)
        assertEquals(VoiceState(), machine.state.value)
    }

    @Test fun `old session cannot overwrite a replacement session`() {
        val machine = VoiceSessionMachine()
        val old = machine.begin(true, true)!!
        val current = machine.begin(true, true)!!
        machine.listening(current)
        machine.result(old, listOf("stale"))
        machine.fail(old, VoiceError.PERMISSION)
        assertEquals(VoiceStatus.LISTENING, machine.state.value.status)
        machine.result(current, listOf("current"))
        assertEquals("current", machine.state.value.transcript)
    }

    @Test fun `permission revocation finishes recording and cannot later accept text`() {
        val machine = VoiceSessionMachine()
        val token = machine.begin(true, true)!!
        machine.listening(token)
        machine.fail(token, VoiceError.PERMISSION)
        assertEquals(VoiceStatus.PERMISSION_REQUIRED, machine.state.value.status)
        assertFalse(machine.state.value.isActive)
        machine.result(token, listOf("forbidden"))
        assertEquals("", machine.state.value.transcript)
    }

    @Test fun `empty and null final results report no match`() {
        val machine = VoiceSessionMachine()
        var token = machine.begin(true, true)!!
        machine.result(token, null)
        assertEquals(VoiceError.NO_MATCH, machine.state.value.error)
        token = machine.begin(true, true)!!
        machine.result(token, listOf(" ", ""))
        assertEquals(VoiceError.NO_MATCH, machine.state.value.error)
    }

    @Test fun `destroy is terminal even if callbacks arrive or caller retries`() {
        val machine = VoiceSessionMachine()
        val token = machine.begin(true, true)!!
        machine.destroy()
        machine.result(token, listOf("late"))
        machine.cancel()
        assertNull(machine.begin(true, true))
        assertEquals(VoiceStatus.DESTROYED, machine.state.value.status)
    }

    @Test fun `timed out recognition can be explicitly retried`() {
        val machine = VoiceSessionMachine()
        val old = machine.begin(true, true)!!
        machine.fail(old, VoiceError.TIMED_OUT)
        assertFalse(machine.state.value.isActive)
        val retry = machine.begin(true, true)!!
        machine.result(old, listOf("timed out"))
        machine.result(retry, listOf("retry"))
        assertEquals(VoiceState(VoiceStatus.RESULT, "retry"), machine.state.value)
    }
}
