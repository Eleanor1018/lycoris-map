import { useCallback, useEffect, useRef, useState } from 'react'
import type { Language } from '@/shared/query/keys'

type SpeechRecognitionAlternative = { transcript: string }
type SpeechRecognitionResult = {
    isFinal: boolean
    length: number
    [index: number]: SpeechRecognitionAlternative
}
type SpeechRecognitionEvent = {
    resultIndex: number
    results: { length: number; [index: number]: SpeechRecognitionResult }
}
type SpeechRecognitionErrorEvent = { error: string; message?: string }
type SpeechRecognitionInstance = {
    lang: string
    continuous: boolean
    interimResults: boolean
    maxAlternatives: number
    start: () => void
    stop: () => void
    abort: () => void
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
    onend: (() => void) | null
    onstart: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance
type SpeechWindow = typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export type VoiceSearchError =
    | 'Voice search is unavailable in this browser.'
    | 'Voice search was denied. Allow microphone access to use it.'
    | 'No speech was heard. Try again.'
    | 'Voice search network error. Try again.'
    | 'Voice search is unavailable. Check that Siri and dictation are enabled.'
    | 'Voice search failed. Type your search instead.'

/**
 * Upper bound on how long a normal Stop waits for the engine's final result or
 * `end` after `recognition.stop()`. Some engines never deliver either, so the
 * transcript that is already visible is submitted instead of being lost.
 */
export const VOICE_STOP_TIMEOUT_MS = 2000

function recognitionConstructor(): SpeechRecognitionConstructor | undefined {
    const speech = window as SpeechWindow
    return speech.SpeechRecognition ?? speech.webkitSpeechRecognition
}

/** Feature detection only; never constructs or starts a recogniser. */
export function voiceSearchSupported(): boolean {
    return typeof recognitionConstructor() === 'function'
}

function messageFor(error: string): VoiceSearchError {
    switch (error) {
        case 'not-allowed':
        case 'service-not-allowed':
            return 'Voice search was denied. Allow microphone access to use it.'
        case 'no-speech':
            return 'No speech was heard. Try again.'
        case 'network':
            return 'Voice search network error. Try again.'
        case 'language-not-supported':
        case 'audio-capture':
            // Safari powered by Siri reports unsupported language / audio here
            // when Siri or dictation is disabled.
            return 'Voice search is unavailable. Check that Siri and dictation are enabled.'
        default:
            return 'Voice search failed. Type your search instead.'
    }
}

type VoiceSession = {
    token: number
    instance: SpeechRecognitionInstance
    /** Every result index the engine has reported so far, including interim. */
    segments: SpeechRecognitionResult[]
    finalText: string
    interimText: string
    /** A normal Stop is waiting for `final`/`end` before submitting. */
    finishing: boolean
    /** `onstart` has fired; the instance can be asked to stop. */
    started: boolean
    ended: boolean
    timer: ReturnType<typeof setTimeout> | null
}

/**
 * Voice input for search. Recognition starts only from a real user click (never
 * on mount). `toggle`/`stop` are normal stops: the engine is asked to finish,
 * the accumulated transcript survives any late revision and is submitted once.
 * `abort` (unmount, hidden tab, language change) releases the microphone without
 * submitting. A fully independent sessions ref keeps late callbacks and timers
 * from a previous session out of the next one.
 */
export function useVoiceSearch({
    language,
    onResult,
}: {
    language: Language
    onResult: (value: string) => void
}) {
    const supported = voiceSearchSupported()
    // `active` covers both the permission wait (before `onstart`) and listening,
    // so a second click stops even before the engine started.
    const [active, setActive] = useState(false)
    const [starting, setStarting] = useState(false)
    const [finishing, setFinishing] = useState(false)
    const [transcript, setTranscript] = useState('')
    const [error, setError] = useState<VoiceSearchError | null>(null)
    const session = useRef<VoiceSession | null>(null)
    // Bumping the token invalidates every pending callback/timer from the old session.
    const token = useRef(0)
    const result = useRef(onResult)
    result.current = onResult

    const clearTimer = (current: VoiceSession | null) => {
        if (current?.timer) clearTimeout(current.timer)
        if (current) current.timer = null
    }

    /** Invalidates the session, detaches every callback and drops the instance. */
    const detach = useCallback(() => {
        token.current++
        const current = session.current
        session.current = null
        clearTimer(current)
        const instance = current?.instance
        if (!instance) return null
        instance.onresult = null
        instance.onerror = null
        instance.onend = null
        instance.onstart = null
        return instance
    }, [])

    /** Releases a still-open recogniser; an ended engine must never be aborted. */
    const kill = (instance: SpeechRecognitionInstance | null, ended: boolean) => {
        if (!instance || ended) return
        try {
            instance.abort()
        } catch {
            // Some engines throw if the session already ended.
        }
    }

    /** Cancels without submitting, for unmount/hidden/language change. */
    const abort = useCallback(() => {
        const current = session.current
        const ended = current?.ended ?? true
        const instance = detach()
        setActive(false)
        setStarting(false)
        setFinishing(false)
        setTranscript('')
        kill(instance, ended)
    }, [detach])

    /** Commits the complete text exactly once, then tears the session down. */
    const finish = useCallback(
        (current: VoiceSession, submit: boolean) => {
            if (token.current !== current.token) return
            const value = `${current.finalText}${current.interimText}`.trim()
            const instance = detach()
            setActive(false)
            setStarting(false)
            setFinishing(false)
            setTranscript('')
            kill(instance, current.ended)
            if (!submit) return
            if (value) result.current(value)
            else setError('No speech was heard. Try again.')
        },
        [detach],
    )

    /** Normal Stop: ask the engine to finish; never abort or drop the text. */
    const stop = useCallback(() => {
        const current = session.current
        // Idempotent: a second Stop while finishing must not send another stop.
        if (!current || current.finishing) return
        // Stop before `onstart`: nothing was captured, so the microphone is
        // released outright instead of waiting for an engine that never ran.
        if (!current.started) {
            abort()
            return
        }
        current.finishing = true
        setActive(false)
        setStarting(false)
        setFinishing(true)
        // The final transcript arrives through `onresult`/`onend`; only an engine
        // that never answers needs the bounded fallback below. A throw still
        // leaves the device open, so the fallback aborts it before submitting.
        try {
            if (!current.ended) current.instance.stop()
        } catch {
            // Handled by the bounded fallback below.
        }
        // `stop()` may have synchronously fired `onerror`/`onend` (which detach
        // the session) or re-entered; only schedule the fallback while this
        // session is still the live, unfinished one.
        if (token.current !== current.token || current.ended) return
        clearTimer(current)
        current.timer = setTimeout(() => {
            if (token.current !== current.token) return
            // The engine never ended: release the microphone, then submit the
            // last visible text instead of leaving it recording.
            finish(current, true)
        }, VOICE_STOP_TIMEOUT_MS)
    }, [abort, finish])

    const start = useCallback(() => {
        setError(null)
        setTranscript('')
        const Constructor = recognitionConstructor()
        if (!Constructor) {
            setError('Voice search is unavailable in this browser.')
            return
        }
        // A fresh start always invalidates and releases anything still pending.
        const previousEnded = session.current?.ended ?? true
        kill(detach(), previousEnded)
        const token$ = ++token.current
        let instance: SpeechRecognitionInstance
        // Construction can throw on restricted WebKit builds; never let it
        // escape a click handler.
        try {
            instance = new Constructor()
        } catch {
            setActive(false)
            setStarting(false)
            setError('Voice search failed. Type your search instead.')
            return
        }
        const current: VoiceSession = {
            token: token$,
            instance,
            segments: [],
            finalText: '',
            interimText: '',
            finishing: false,
            started: false,
            ended: false,
            timer: null,
        }
        instance.lang = language === 'zh' ? 'zh-CN' : 'en-US'
        instance.continuous = true
        instance.interimResults = true
        instance.maxAlternatives = 1
        instance.onstart = () => {
            if (token.current !== current.token) return
            current.started = true
            setStarting(false)
        }
        instance.onresult = (event) => {
            if (token.current !== current.token) return
            accumulate(current, event)
        }
        instance.onerror = (event) => {
            if (token.current !== current.token) return
            // An error releases the microphone and only shows a dismissible
            // notice. It never submits a half phrase and never clears the search.
            finish(current, false)
            setError(messageFor(event.error))
        }
        instance.onend = () => {
            if (token.current !== current.token) return
            current.ended = true
            current.finishing = false
            // A natural end submits the complete text once; an empty result only
            // reports "No speech" when the engine ended with nothing to submit.
            finish(current, true)
        }
        session.current = current
        setActive(true)
        setStarting(true)
        try {
            instance.start()
        } catch {
            if (token.current !== current.token) return
            // Capture `ended` before detaching, then safely abort the still-live
            // instance so `start` throwing never leaves the device recording.
            const ended = current.ended
            kill(detach(), ended)
            setActive(false)
            setStarting(false)
            setFinishing(false)
            setError('Voice search failed. Type your search instead.')
        }
    }, [detach, finish, language])

    const toggle = useCallback(() => {
        const current = session.current
        if (current && !current.finishing) stop()
        else if (!current) start()
    }, [start, stop])

    useEffect(() => {
        // Installed for the whole hook lifetime so hiding during the permission
        // wait (before `onstart`) also releases the microphone.
        const hidden = () => {
            if (!document.hidden) return
            abort()
        }
        document.addEventListener('visibilitychange', hidden)
        return () => document.removeEventListener('visibilitychange', hidden)
    }, [abort])

    // Unmount and a language switch cancel an in-flight recogniser so transcripts
    // from the previous session/locale can never leak into the next one.
    useEffect(() => {
        return () => abort()
    }, [abort, language])

    return {
        supported,
        active,
        starting,
        finishing,
        listening: active && !starting,
        transcript,
        error,
        toggle,
        stop,
        dismissError: () => setError(null),
    }

    function accumulate(current: VoiceSession, event: SpeechRecognitionEvent) {
        // `event.results` is always the engine's full session list, so its length
        // is authoritative: truncating first drops a tail the engine revised or
        // removed (e.g. results shrinking from two entries to one).
        current.segments.length = Math.min(current.segments.length, event.results.length)
        // `resultIndex` marks the first result that changed; everything from
        // there on is replaced rather than appended, so a revised final result
        // never duplicates its interim counterpart.
        const start = Math.max(0, Math.min(event.resultIndex, event.results.length))
        for (let i = start; i < event.results.length; i++) {
            const entry = event.results[i]
            if (entry) current.segments[i] = entry
        }
        let finalText = ''
        let interimText = ''
        for (let i = 0; i < event.results.length; i++) {
            const entry = current.segments[i] ?? event.results[i]
            if (!entry) continue
            const text = entry[0]?.transcript ?? ''
            if (entry.isFinal) finalText += text
            else interimText += text
        }
        current.finalText = finalText
        current.interimText = interimText
        if (token.current !== current.token) return
        setTranscript(visibleTranscript(current))
    }
}

/** Everything the user can currently see, final segments first. */
function visibleTranscript(current: VoiceSession): string {
    return `${current.finalText}${current.interimText}`.trim() || current.interimText
}
