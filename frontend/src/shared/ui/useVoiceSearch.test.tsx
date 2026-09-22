import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiLanguage } from '@/shared/i18n/ui'
import { SearchField } from './design-primitives'
import { useVoiceSearch, VOICE_STOP_TIMEOUT_MS, voiceSearchSupported } from './useVoiceSearch'

type Listener = (event: unknown) => void
type EndListener = () => void
class FakeRecognition {
    static instances: FakeRecognition[] = []
    lang = ''
    continuous = true
    interimResults = true
    maxAlternatives = 0
    onstart: EndListener | null = null
    onresult: Listener | null = null
    onerror: Listener | null = null
    onend: EndListener | null = null
    startCalls = 0
    stopCalls = 0
    abortCalls = 0
    /** When true `stop()` does not emit `end`, like engines that never answer. */
    silentStop = false
    constructor() {
        FakeRecognition.instances.push(this)
    }
    start() {
        this.startCalls++
        this.onstart?.()
    }
    stop() {
        this.stopCalls++
        if (!this.silentStop) this.onend?.()
    }
    abort() {
        this.abortCalls++
    }
    /**
     * Mirrors the Web Speech contract: `results` is always the engine's full
     * session list, and `resultIndex` marks the first entry that changed.
     */
    emitResults(entries: { transcript: string; final: boolean }[], resultIndex = 0) {
        this.onresult?.({
            resultIndex,
            results: Object.assign(
                entries.map(({ transcript, final }) => ({
                    isFinal: final,
                    0: { transcript },
                })),
                { length: entries.length },
            ),
        })
    }
    emitResult(transcript: string, final = true) {
        this.emitResults([{ transcript, final }])
    }
    emitError(error: string) {
        this.onerror?.({ error })
    }
}
function stubRecognition() {
    FakeRecognition.instances = []
    vi.stubGlobal('SpeechRecognition', FakeRecognition)
    return () => {
        const instance = FakeRecognition.instances.at(-1)
        if (!instance) throw new Error('No recognition instance created')
        return instance
    }
}
afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    FakeRecognition.instances = []
})

it('never starts recognition before a user click', () => {
    const last = stubRecognition()
    renderHook(() => useVoiceSearch({ language: 'en', onResult: vi.fn() }))
    expect(FakeRecognition.instances).toHaveLength(0)
    expect(voiceSearchSupported()).toBe(true)
    void last
})

it('stops the same recogniser without aborting it, and still submits its text once', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'zh', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    expect(instance.lang).toBe('zh-CN')
    expect(instance.continuous).toBe(true)
    expect(instance.interimResults).toBe(true)
    expect(result.current.listening).toBe(true)
    act(() => instance.emitResults([{ transcript: '医', final: false }]))
    act(() => result.current.toggle())
    // A normal Stop asks the engine to finish and keeps the accumulated interim.
    expect(instance.stopCalls).toBe(1)
    expect(instance.abortCalls).toBe(0)
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('医')
    expect(result.current.listening).toBe(false)
})

it('keeps interim text out of onChange until a segment is final', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    expect(instance.lang).toBe('en-US')
    act(() => instance.emitResults([{ transcript: 'toile', final: false }]))
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.transcript).toBe('toile')
    act(() => instance.emitResults([{ transcript: 'toilets', final: false }]))
    expect(onResult).not.toHaveBeenCalled()
    act(() => instance.emitResults([{ transcript: 'toilets', final: true }]))
    expect(onResult).not.toHaveBeenCalled()
    act(() => result.current.stop())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('toilets')
})

it('accumulates multi-segment revisions without duplicates or dropped text', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    // First interim segment at index 0.
    act(() => instance.emitResults([{ transcript: 'accessible ', final: false }], 0))
    // The engine revises index 0 and adds interim index 1.
    act(() =>
        instance.emitResults(
            [
                { transcript: 'accessible ', final: false },
                { transcript: 'toilets', final: false },
            ],
            1,
        ),
    )
    expect(result.current.transcript).toBe('accessible toilets')
    // Index 0 becomes final and index 1 is revised again.
    act(() =>
        instance.emitResults(
            [
                { transcript: 'accessible ', final: true },
                { transcript: 'toilets', final: false },
            ],
            0,
        ),
    )
    act(() =>
        instance.emitResults(
            [
                { transcript: 'accessible ', final: true },
                { transcript: 'toilets', final: true },
            ],
            1,
        ),
    )
    act(() => result.current.stop())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('accessible toilets')
})

it('drops a trailing interim segment the engine removes from its result list', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    // Two interim segments at first.
    act(() =>
        instance.emitResults(
            [
                { transcript: 'accessible ', final: false },
                { transcript: 'toilets', final: false },
            ],
            0,
        ),
    )
    expect(result.current.transcript).toBe('accessible toilets')
    // The engine shrinks its list back to a single entry.
    act(() => instance.emitResults([{ transcript: 'accessible', final: true }], 0))
    expect(result.current.transcript).toBe('accessible')
    act(() => instance.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('accessible')
})

it('submits the complete text once on a natural end', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    act(() => instance.emitResults([{ transcript: 'hospital', final: true }]))
    act(() => instance.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('hospital')
    expect(result.current.active).toBe(false)
    expect(result.current.finishing).toBe(false)
})

it('keeps the last visible text when a stop only has interim results and no end', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    instance.silentStop = true
    act(() => instance.emitResults([{ transcript: 'clinic', final: false }]))
    act(() => result.current.stop())
    expect(result.current.finishing).toBe(true)
    expect(onResult).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('clinic')
    expect(result.current.finishing).toBe(false)
})

it('does not submit an empty search and does not clear an existing one', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    instance.silentStop = true
    act(() => result.current.stop())
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS))
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/No speech/)
})

it('callable without a text result does not clear a filled search field', () => {
    const last = stubRecognition()
    const onChange = vi.fn()
    render(
        <UiLanguage language="en">
            <SearchField value="existing" onChange={onChange} />
        </UiLanguage>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start voice search' }))
    const instance = last()
    act(() => instance.emitError('no-speech'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveValue('existing')
})

it('a repeated Stop while finishing does not submit twice', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    instance.silentStop = true
    act(() => instance.emitResults([{ transcript: 'park', final: false }]))
    act(() => result.current.stop())
    act(() => result.current.stop())
    act(() => result.current.toggle())
    expect(result.current.finishing).toBe(true)
    expect(instance.stopCalls).toBe(1)
    expect(instance.abortCalls).toBe(0)
    act(() => instance.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('park')
})

it('bounds the wait when the engine never sends end, then isolates the next session', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const first = last()
    first.silentStop = true
    act(() => first.emitResults([{ transcript: 'one', final: true }]))
    act(() => result.current.stop())
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS))
    expect(onResult).toHaveBeenLastCalledWith('one')
    // A late end from the timed-out session must not write again.
    act(() => first.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    // The next session is independent: its own text is submitted, not the old one.
    act(() => result.current.toggle())
    const second = last()
    act(() => second.emitResults([{ transcript: 'two', final: true }]))
    act(() => second.onend?.())
    expect(onResult).toHaveBeenLastCalledWith('two')
    expect(onResult).toHaveBeenCalledTimes(2)
})

it('releases a stuck engine through the fallback and ignores its late callbacks', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const first = last()
    // The engine ignores stop(): no final, no end, microphone still open.
    first.silentStop = true
    act(() => first.emitResults([{ transcript: 'open', final: false }]))
    act(() => result.current.stop())
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS))
    // The fallback submits once and actually aborts the still-open instance.
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('open')
    expect(first.abortCalls).toBe(1)
    // Late callbacks from the released session cannot touch the next one.
    act(() => first.emitResults([{ transcript: 'stale', final: true }]))
    act(() => first.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    act(() => result.current.toggle())
    const second = last()
    act(() => second.emitResults([{ transcript: 'fresh', final: true }]))
    act(() => second.onend?.())
    expect(onResult).toHaveBeenCalledTimes(2)
    expect(onResult).toHaveBeenLastCalledWith('fresh')
})

it('aborts the instance when stop throws and never schedules a duplicate timer', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    class ThrowingStopRecognition extends FakeRecognition {
        override stop() {
            this.stopCalls++
            throw new Error('cannot stop')
        }
    }
    vi.stubGlobal('SpeechRecognition', ThrowingStopRecognition)
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last() as ThrowingStopRecognition
    act(() => instance.emitResults([{ transcript: 'held', final: false }]))
    act(() => result.current.stop())
    expect(result.current.finishing).toBe(true)
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS))
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('held')
    expect(instance.abortCalls).toBe(1)
})

it('does not schedule a fallback timer when stop ends synchronously', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    act(() => instance.emitResults([{ transcript: 'sync', final: true }]))
    // FakeRecognition.stop() fires onend synchronously.
    act(() => result.current.stop())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('sync')
    // No pending timer may fire later and submit a second time.
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS * 2))
    expect(onResult).toHaveBeenCalledTimes(1)
})

it('surfaces denied, no-speech, network and Siri-unavailable errors as dismissible messages', () => {
    const last = stubRecognition()
    const cases = [
        ['not-allowed', /denied/],
        ['no-speech', /No speech/],
        ['network', /network error/],
        ['language-not-supported', /Siri and dictation/],
    ] as const
    for (const [error, pattern] of cases) {
        const { result, unmount } = renderHook(() =>
            useVoiceSearch({ language: 'en', onResult: vi.fn() }),
        )
        act(() => result.current.toggle())
        act(() => last().emitError(error))
        expect(result.current.listening).toBe(false)
        expect(result.current.error).toMatch(pattern)
        act(() => result.current.dismissError())
        expect(result.current.error).toBeNull()
        unmount()
    }
})

it('an error never submits recognised text or a half phrase', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    // Text was recognised, then the engine errored before the user finished.
    act(() => instance.emitResults([{ transcript: 'half a phrase', final: false }]))
    act(() => instance.emitError('network'))
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/network error/)
    // The instance is released even though the engine failed.
    expect(instance.abortCalls).toBe(1)
})

it('an error with no recognised text still only shows a notice', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    act(() => instance.emitError('audio-capture'))
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.error).toMatch(/Siri and dictation/)
    expect(instance.abortCalls).toBe(1)
})

it('a normal Stop still submits the text after a dismissed error', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const first = last()
    act(() => first.emitError('no-speech'))
    act(() => result.current.dismissError())
    // A fresh session after the error behaves normally.
    act(() => result.current.toggle())
    const second = last()
    act(() => second.emitResults([{ transcript: 'recovered', final: true }]))
    act(() => second.onend?.())
    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith('recovered')
})

it('aborts the active session on unmount and on hiding the page, including before onstart', () => {
    const last = stubRecognition()
    const first = renderHook(() => useVoiceSearch({ language: 'en', onResult: vi.fn() }))
    act(() => first.result.current.toggle())
    const instance = last()
    first.unmount()
    expect(instance.abortCalls).toBe(1)

    const visible = renderHook(() => useVoiceSearch({ language: 'en', onResult: vi.fn() }))
    act(() => visible.result.current.toggle())
    const hidden = last()
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(hidden.abortCalls).toBe(1)
    expect(visible.result.current.active).toBe(false)
    vi.restoreAllMocks()
})

it('a hidden page cancels without submitting residual recognition', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    act(() => instance.emitResults([{ transcript: 'half a phrase', final: false }]))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(onResult).not.toHaveBeenCalled()
    expect(result.current.transcript).toBe('')
    vi.restoreAllMocks()
})

it('a stop before onstart still releases cleanly and never submits on abort', () => {
    const last = stubRecognition()
    class StartingRecognition extends FakeRecognition {
        override start() {
            this.startCalls++
            // Deliberately never fires onstart: still waiting for permission.
        }
    }
    vi.stubGlobal('SpeechRecognition', StartingRecognition)
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
    const instance = last()
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(result.current.finishing).toBe(false)
    // The engine never started, so it is aborted rather than asked to stop.
    expect(instance.abortCalls).toBe(1)
    expect(instance.stopCalls).toBe(0)
    act(() => instance.onend?.())
    expect(onResult).not.toHaveBeenCalled()
})

it('ignores a late result delivered after the recogniser has ended', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    act(() => instance.onend?.())
    expect(result.current.active).toBe(false)
    act(() => instance.emitResult('stale transcript'))
    expect(onResult).not.toHaveBeenCalled()
})

it('reports a synchronous construction failure instead of throwing from the handler', () => {
    vi.stubGlobal(
        'SpeechRecognition',
        class {
            constructor() {
                throw new Error('restricted')
            }
        },
    )
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult: vi.fn() }))
    expect(() => act(() => result.current.toggle())).not.toThrow()
    expect(result.current.active).toBe(false)
    expect(result.current.error).toMatch(/Type your search instead/)
})

it('aborts a live instance when start throws and never submits', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    class ThrowingRecognition extends FakeRecognition {
        override start() {
            this.startCalls++
            throw new Error('denied')
        }
    }
    vi.stubGlobal('SpeechRecognition', ThrowingRecognition)
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    expect(() => act(() => result.current.toggle())).not.toThrow()
    const instance = last() as ThrowingRecognition
    // The instance never ended, so it must be aborted rather than left open.
    expect(instance.abortCalls).toBe(1)
    expect(result.current.active).toBe(false)
    expect(result.current.error).toMatch(/Type your search instead/)
    // No fallback timer may later submit anything from the failed session.
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS * 2))
    expect(onResult).not.toHaveBeenCalled()
})

it('does not schedule a fallback timer when stop synchronously errors', () => {
    vi.useFakeTimers()
    const last = stubRecognition()
    const onResult = vi.fn()
    class ErrorThenEndRecognition extends FakeRecognition {
        override stop() {
            this.stopCalls++
            // The engine synchronously reports an error, which detaches the
            // session before a fallback timer could be created.
            this.onerror?.({ error: 'network' })
        }
    }
    vi.stubGlobal('SpeechRecognition', ErrorThenEndRecognition)
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last() as ErrorThenEndRecognition
    act(() => instance.emitResults([{ transcript: 'pending', final: false }]))
    act(() => result.current.stop())
    // The error is surfaced once, the device is released, nothing is submitted.
    expect(result.current.error).toMatch(/network error/)
    expect(onResult).not.toHaveBeenCalled()
    expect(instance.abortCalls).toBe(1)
    // The detached session must not leave a timer behind.
    act(() => vi.advanceTimersByTime(VOICE_STOP_TIMEOUT_MS * 2))
    expect(onResult).not.toHaveBeenCalled()
})

it('cancels the previous recogniser when the language changes', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result, rerender } = renderHook(
        ({ language }: { language: 'en' | 'zh' }) => useVoiceSearch({ language, onResult }),
        { initialProps: { language: 'en' as 'en' | 'zh' } },
    )
    act(() => result.current.toggle())
    const instance = last()
    rerender({ language: 'zh' })
    expect(instance.abortCalls).toBe(1)
    expect(result.current.active).toBe(false)
    act(() => instance.emitResult('late english'))
    expect(onResult).not.toHaveBeenCalled()
})

it('keeps the mic clickable when unsupported and shows a dismissible reason', () => {
    vi.stubGlobal('SpeechRecognition', undefined)
    vi.stubGlobal('webkitSpeechRecognition', undefined)
    render(
        <UiLanguage language="en">
            <SearchField value="" onChange={vi.fn()} />
        </UiLanguage>,
    )
    const mic = screen.getByRole('button', { name: 'Start voice search' })
    expect(mic).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(mic)
    expect(screen.getByRole('alert')).toHaveTextContent(
        'Voice search is unavailable in this browser.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    // Text search stays available as the fallback.
    expect(screen.getByRole('textbox')).toBeInTheDocument()
})

function ControlledField({ onCommit }: { onCommit?: (value: string) => void } = {}) {
    const [value, setValue] = useState('')
    return (
        <UiLanguage language="en">
            <SearchField
                value={value}
                onChange={(next) => {
                    setValue(next)
                    onCommit?.(next)
                }}
            />
        </UiLanguage>
    )
}

it('shows an explicit Stop button and a live transcript, then submits on Stop', () => {
    const last = stubRecognition()
    const onCommit = vi.fn()
    render(
        <StrictMode>
            <ControlledField onCommit={onCommit} />
        </StrictMode>,
    )
    expect(FakeRecognition.instances).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Start voice search' }))
    const instance = last()
    expect(instance.lang).toBe('en-US')
    const stop = screen.getByRole('button', { name: 'Stop voice search' })
    expect(stop).toBeInTheDocument()
    act(() => instance.emitResults([{ transcript: 'accessible', final: false }]))
    expect(screen.getByText('accessible')).toBeInTheDocument()
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.click(stop)
    // Stop submits the complete text once and the recording UI is gone.
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('accessible')
    expect(screen.queryByRole('button', { name: 'Stop voice search' })).not.toBeInTheDocument()
    // The committed value is restored into the input.
    expect(screen.getByRole('textbox')).toHaveValue('accessible')
    expect(instance.abortCalls).toBe(0)
})

it('restores the input value after Stop without focusing the field', () => {
    const last = stubRecognition()
    const onChange = vi.fn()
    render(
        <UiLanguage language="en">
            <SearchField value="typed" onChange={onChange} />
        </UiLanguage>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start voice search' }))
    const instance = last()
    const input = screen.getByRole('textbox')
    input.blur()
    act(() => instance.emitResults([{ transcript: 'toilets', final: true }]))
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice search' }))
    expect(onChange).toHaveBeenCalledWith('toilets')
    expect(input).not.toHaveFocus()
})

it('shows and dismisses an error from the wired field without pretending success', () => {
    const last = stubRecognition()
    const onChange = vi.fn()
    render(
        <UiLanguage language="en">
            <SearchField value="" onChange={onChange} />
        </UiLanguage>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start voice search' }))
    act(() => last().emitError('not-allowed'))
    expect(screen.getByRole('alert')).toHaveTextContent(/denied/)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('reports the voice phase through onVoiceChange before any result arrives', () => {
    const last = stubRecognition()
    const onVoiceChange = vi.fn()
    render(
        <UiLanguage language="en">
            <SearchField value="" onChange={vi.fn()} onVoiceChange={onVoiceChange} />
        </UiLanguage>,
    )
    act(() => onVoiceChange.mockClear())
    fireEvent.click(screen.getByRole('button', { name: 'Start voice search' }))
    expect(onVoiceChange).toHaveBeenCalled()
    // The fake engine fires onstart synchronously, so the phase settles at
    // "active" immediately; the sheet only needs the engaged flag.
    const lastState = onVoiceChange.mock.calls.at(-1)![0]
    expect(lastState.active).toBe(true)
    const instance = last()
    act(() => instance.onend?.())
    expect(onVoiceChange.mock.calls.at(-1)![0].active).toBe(false)
})
