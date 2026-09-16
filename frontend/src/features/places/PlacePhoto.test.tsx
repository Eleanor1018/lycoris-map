import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlacePhoto } from './PlacePhoto'

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

it('keeps the photo slot while loading, then reveals the image', () => {
    const { container } = render(
        <PlacePhoto src="/uploads/markers/one.jpg" className="place-photo" loading="lazy" />,
    )
    expect(container.firstChild).toHaveAttribute('data-state', 'loading')
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('loading', 'lazy')
    fireEvent.load(image)
    expect(container.firstChild).toHaveAttribute('data-state', 'loaded')
})

it('removes a broken photo and starts loading again for a different URL', () => {
    const { container, rerender } = render(
        <PlacePhoto src="/uploads/markers/one.jpg" className="place-photo" />,
    )
    fireEvent.error(container.querySelector('img')!)
    expect(container).toBeEmptyDOMElement()
    rerender(<PlacePhoto src="/uploads/markers/two.jpg" className="place-photo" />)
    expect(container.firstChild).toHaveAttribute('data-state', 'loading')
    fireEvent.load(container.querySelector('img')!)
    expect(container.firstChild).toHaveAttribute('data-state', 'loaded')
})

it('does not reuse the loaded state or a late event from a previous URL', () => {
    const { container, rerender } = render(
        <PlacePhoto src="/uploads/markers/one.jpg" className="mobile-photo" />,
    )
    const previous = container.querySelector('img')!
    fireEvent.load(previous)
    rerender(<PlacePhoto src="/uploads/markers/two.jpg" className="mobile-photo" />)
    fireEvent.error(previous)
    expect(container.firstChild).toHaveAttribute('data-state', 'loading')
    fireEvent.load(container.querySelector('img')!)
    expect(container.firstChild).toHaveAttribute('data-state', 'loaded')
})

it('reveals a cached image even when its load event preceded mounting', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(280)
    const { container } = render(
        <PlacePhoto src="/uploads/markers/cached.jpg" className="place-photo" />,
    )
    expect(container.firstChild).toHaveAttribute('data-state', 'loaded')
})
