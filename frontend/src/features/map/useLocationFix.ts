import { useCallback, useEffect, useRef, useState } from 'react'
import { assertLatLng, type LatLng } from './coords'

export function useLocationFix(onFound: (point: LatLng) => void) {
    const [position, setPosition] = useState<LatLng | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    useEffect(
        () => () => {
            generation.current++
            clearTimeout(timer.current)
        },
        [],
    )
    const locate = useCallback(() => {
        const request = ++generation.current
        clearTimeout(timer.current)
        setError(null)
        if (!navigator.geolocation) {
            setError('Location is not supported. You can still search or move the map.')
            return
        }
        setPending(true)
        const fail = (message: string) => {
            if (request !== generation.current) return
            generation.current++
            clearTimeout(timer.current)
            setPending(false)
            setError(message)
        }
        timer.current = setTimeout(
            () => fail('Location timed out. Try again or move the map.'),
            20_000,
        )
        navigator.geolocation.getCurrentPosition(
            (result) => {
                if (request !== generation.current) return
                try {
                    const point = assertLatLng({
                        lat: result.coords.latitude,
                        lng: result.coords.longitude,
                    })
                    clearTimeout(timer.current)
                    setPosition(point)
                    setPending(false)
                    onFound(point)
                } catch {
                    fail('Location is unavailable. You can still search or move the map.')
                }
            },
            (reason) =>
                fail(
                    reason.code === 1
                        ? 'Location permission was denied. You can still search or move the map.'
                        : reason.code === 3
                          ? 'Location timed out. Try again or move the map.'
                          : 'Location is unavailable. You can still search or move the map.',
                ),
            { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 },
        )
    }, [onFound])
    return { position, pending, error, locate }
}
