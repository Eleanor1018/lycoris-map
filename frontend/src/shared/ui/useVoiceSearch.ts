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

/**
 * Voice input for search. Speech recognition starts only from a real user
 * click (never on mount), and a second click stops or cancels the active
 * session. Any late recogniser callback after stop/unmount/screen-hide is
 * ignored instead of writing a stale transcript.
 */
export function useVoiceSearch({
    language,
    onResult,
}: {
    language: Language
    onResult: (value: string) => void
}) {
    const supported = voiceSearchSupported()
    // `active` covers both the startup (waiting for permission) and the
    // listening phase, so a second click cancels even before `onstart` fires.
    // `starting` distinguishes the permission wait from real listening.
    const [active, setActive] = useState(false)
    const [starting, setStarting] = useState(false)
    const [error, setError] = useState<VoiceSearchError | null>(null)
    const recognition = useRef<SpeechRecognitionInstance | null>(null)
    // Bumping the token invalidates every pending callback from the old session.
    const session = useRef(0)
    const result = useRef(onResult)
    result.current = onResult

    const detach = (instance: SpeechRecognitionInstance | null) => {
        if (!instance) return
        instance.onresult = null
        instance.onerror = null
        instance.onend = null
        instance.onstart = null
    }
    /**
     * Invalidates the current session and drops the instance. `abort` is used
     * for user cancel / unmount / screen-hide; an engine that already ended is
     * never aborted again.
     */
    const release = useCallback((abort: boolean) => {
        session.current++
        const instance = recognition.current
        recognition.current = null
        detach(instance)
        if (!instance) return
        try {
            if (abort) instance.abort()
            else instance.stop()
        } catch {
            // Some engines throw if the session already ended.
        }
    }, [])

    const finish = useCallback(() => {
        setActive(false)
        setStarting(false)
    }, [])

    const stop = useCallback(() => {
        release(true)
        finish()
    }, [finish, release])

    const start = useCallback(() => {
        setError(null)
        const Constructor = recognitionConstructor()
        if (!Constructor) {
            setError('Voice search is unavailable in this browser.')
            return
        }
        release(true)
        const token = ++session.current
        let instance: SpeechRecognitionInstance
        // Construction can throw on restricted WebKit builds; never let it
        // escape a click handler.
        try {
            instance = new Constructor()
        } catch {
            finish()
            setError('Voice search failed. Type your search instead.')
            return
        }
        instance.lang = language === 'zh' ? 'zh-CN' : 'en-US'
        instance.continuous = false
        instance.interimResults = false
        instance.maxAlternatives = 1
        instance.onstart = () => {
            if (token !== session.current) return
            setStarting(false)
            setActive(true)
        }
        instance.onresult = (event) => {
            if (token !== session.current) return
            let transcript = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const entry = event.results[i]
                if (entry?.isFinal) transcript += entry[0]?.transcript ?? ''
            }
            const value = transcript.trim()
            if (!value) return
            // A final transcript ends the session before the value is applied.
            release(true)
            finish()
            result.current(value)
        }
        instance.onerror = (event) => {
            if (token !== session.current) return
            release(true)
            finish()
            setError(messageFor(event.error))
        }
        instance.onend = () => {
            if (token !== session.current) return
            // End invalidates the token and detaches, so a late result after
            // `end` can never write into a search.
            release(false)
            finish()
        }
        recognition.current = instance
        setActive(true)
        setStarting(true)
        try {
            instance.start()
        } catch {
            release(true)
            finish()
            setError('Voice search failed. Type your search instead.')
        }
    }, [finish, language, release])

    const toggle = useCallback(() => {
        // The recogniser ref is set before `start` resolves, but `active` also
        // covers a construction that failed synchronously.
        if (recognition.current) stop()
        else start()
    }, [start, stop])

    useEffect(() => {
        // Installed for the whole hook lifetime so hiding during the permission
        // wait (before `onstart`) also cancels a starting recogniser.
        const hidden = () => {
            if (document.hidden) {
                release(true)
                finish()
            }
        }
        document.addEventListener('visibilitychange', hidden)
        return () => {
            document.removeEventListener('visibilitychange', hidden)
            release(true)
        }
    }, [finish, release])

    // Switching language cancels an in-flight recogniser so transcripts from
    // the previous locale cannot leak into the new one.
    useEffect(() => {
        return () => {
            release(true)
            finish()
        }
    }, [finish, language, release])

    return {
        supported,
        active,
        starting,
        listening: active && !starting,
        error,
        toggle,
        stop,
        dismissError: () => setError(null),
    }
}
