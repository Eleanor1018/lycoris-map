import { useCallback, useEffect, useRef, useState } from 'react'
import { assertLatLng, type LatLng } from './coords'
import { requestDeviceHeading } from './useDeviceHeading'

export function useLocationFix(onFound: (point: LatLng, automatic: boolean) => void) {
    const [position, setPosition] = useState<LatLng | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const generation = useRef(0)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const initialRequest = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const found = useRef(onFound)
    found.current = onFound
    useEffect(
        () => () => {
            generation.current++
            clearTimeout(timer.current)
            clearTimeout(initialRequest.current)
        },
        [],
    )
    const requestLocation = useCallback((automatic: boolean) => {
        clearTimeout(initialRequest.current)
        const request = ++generation.current
        clearTimeout(timer.current)
        setError(null)
        if (!navigator.geolocation) {
            if (!automatic)
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
        // The initial browser permission prompt may legitimately stay open.
        // Let geolocation's own timeout begin after the user has answered it.
        if (!automatic)
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
                    found.current(point, automatic)
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
            { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
        )
    }, [])
    useEffect(() => {
        // Defer one task so StrictMode's setup/cleanup cannot prompt twice.
        initialRequest.current = setTimeout(() => requestLocation(true), 0)
        return () => clearTimeout(initialRequest.current)
    }, [requestLocation])
    const locate = useCallback(() => {
        // iOS requires this separate sensor request in a user gesture. Geolocation
        // itself is requested on entry, without waiting for this button.
        requestDeviceHeading()
        requestLocation(false)
    }, [requestLocation])
    return { position, pending, error, locate }
}
