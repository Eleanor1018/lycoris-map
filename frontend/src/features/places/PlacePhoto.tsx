import { useLayoutEffect, useRef, useState } from 'react'
import './place-photo.css'

type Props = {
    src: string
    className: string
    loading?: 'eager' | 'lazy'
    variant?: 'thumb' | 'detail'
}

export function PlacePhoto(props: Props) {
    // A new URL gets its own load lifecycle, including after a failed image.
    return <Photo key={`${props.src}:${props.variant ?? 'detail'}`} {...props} />
}

function Photo({ src, className, loading = 'eager', variant = 'detail' }: Props) {
    const image = useRef<HTMLImageElement>(null)
    const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
    const [original, setOriginal] = useState(false)
    const managed = /^\/uploads\/markers\/[A-Za-z0-9_.-]+\.(?:jpe?g|png|webp|gif)$/i.test(src)
    const url = managed && !original ? `${src}?variant=${variant}` : src

    function failed() {
        if (managed && !original) setOriginal(true)
        else setState('failed')
    }

    useLayoutEffect(() => {
        const element = image.current
        // Cached images can finish before React attaches the load listener.
        if (element?.complete) {
            if (element.naturalWidth > 0) setState('loaded')
            else failed()
        }
    }, [url])

    if (state === 'failed') return null

    return (
        <div className={`${className} place-photo-frame`} data-state={state} aria-hidden="true">
            <div className="place-photo-content">
                <img
                    ref={image}
                    key={url}
                    src={url}
                    alt=""
                    loading={loading}
                    decoding="async"
                    onLoad={() => setState('loaded')}
                    onError={failed}
                />
            </div>
        </div>
    )
}
