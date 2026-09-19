import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UiLanguage } from '@/shared/i18n/ui'
import { SearchField } from './design-primitives'
import { useVoiceSearch, voiceSearchSupported } from './useVoiceSearch'

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
    constructor() {
        FakeRecognition.instances.push(this)
    }
    start() {
        this.startCalls++
        this.onstart?.()
    }
    stop() {
        this.stopCalls++
        this.onend?.()
    }
    abort() {
        this.abortCalls++
    }
    emitResult(transcript: string, final = true) {
        this.onresult?.({
            resultIndex: 0,
            results: Object.assign([{ isFinal: final, 0: { transcript } }], { length: 1 }),
        })
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

it('starts in the language locale, stops on the second click, and never writes after stop', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'zh', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    expect(instance.lang).toBe('zh-CN')
    expect(result.current.listening).toBe(true)
    act(() => result.current.toggle())
    expect(instance.abortCalls).toBe(1)
    expect(result.current.listening).toBe(false)
    act(() => instance.emitResult('医院'))
    expect(onResult).not.toHaveBeenCalled()
})

it('applies only a final transcript in en-US and ignores interim results', () => {
    const last = stubRecognition()
    const onResult = vi.fn()
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult }))
    act(() => result.current.toggle())
    const instance = last()
    expect(instance.lang).toBe('en-US')
    act(() => instance.emitResult('toile', false))
    expect(onResult).not.toHaveBeenCalled()
    act(() => instance.emitResult('toilets'))
    expect(onResult).toHaveBeenCalledWith('toilets')
    expect(result.current.listening).toBe(false)
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

it('cancels a starting recogniser while it waits for permission before onstart', () => {
    const last = stubRecognition()
    class StartingRecognition extends FakeRecognition {
        override start() {
            this.startCalls++
            // Deliberately never fires onstart: the session is still waiting for
            // the browser permission decision.
        }
    }
    vi.stubGlobal('SpeechRecognition', StartingRecognition)
    const { result } = renderHook(() => useVoiceSearch({ language: 'en', onResult: vi.fn() }))
    act(() => result.current.toggle())
    expect(result.current.active).toBe(true)
    const instance = last()
    act(() => result.current.toggle())
    expect(result.current.active).toBe(false)
    expect(instance.abortCalls).toBe(1)
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

it('wires the mic button to start, shows listening state, and feeds a final result to onChange', () => {
    const last = stubRecognition()
    const onChange = vi.fn()
    render(
        <StrictMode>
            <UiLanguage language="en">
                <SearchField value="" onChange={onChange} />
            </UiLanguage>
        </StrictMode>,
    )
    const mic = screen.getByRole('button', { name: 'Start voice search' })
    expect(FakeRecognition.instances).toHaveLength(0)
    fireEvent.click(mic)
    const instance = last()
    expect(instance.lang).toBe('en-US')
    const stop = screen.getByRole('button', { name: 'Stop listening' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Voice search is listening…')).toBeInTheDocument()
    act(() => instance.emitResult('accessible toilets'))
    expect(onChange).toHaveBeenCalledWith('accessible toilets')
    expect(screen.queryByRole('button', { name: 'Stop listening' })).not.toBeInTheDocument()
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
