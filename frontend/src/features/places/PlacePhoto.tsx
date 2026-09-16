import { useLayoutEffect, useRef, useState } from 'react'
import './place-photo.css'

type Props = {
    src: string
    className: string
    loading?: 'eager' | 'lazy'
}

export function PlacePhoto(props: Props) {
    // A new URL gets its own load lifecycle, including after a failed image.
    return <Photo key={props.src} {...props} />
}

function Photo({ src, className, loading = 'eager' }: Props) {
    const image = useRef<HTMLImageElement>(null)
    const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')

    useLayoutEffect(() => {
        const element = image.current
        // Cached images can finish before React attaches the load listener.
        if (element?.complete) setState(element.naturalWidth > 0 ? 'loaded' : 'failed')
    }, [])

    if (state === 'failed') return null

    return (
        <div className={`${className} place-photo-frame`} data-state={state} aria-hidden="true">
            <div className="place-photo-content">
                <img
                    ref={image}
                    src={src}
                    alt=""
                    loading={loading}
                    decoding="async"
                    onLoad={() => setState('loaded')}
                    onError={() => setState('failed')}
                />
            </div>
        </div>
    )
}
