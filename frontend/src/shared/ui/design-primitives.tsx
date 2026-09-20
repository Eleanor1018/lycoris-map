import { useUi } from '@/shared/i18n/ui'
import { useCallback, useEffect, useRef, type ComponentProps } from 'react'
import { Button } from '@/shared/ui/button'
import { FigmaIcon, type FigmaIconName } from '@/shared/ui/figma-icon'
import { useVoiceSearch } from '@/shared/ui/useVoiceSearch'

/** Voice phase exposed to the mobile sheet so it can expand before listening. */
export type VoiceSearchState = { active: boolean; starting: boolean; finishing: boolean }
export function DesignButton({
    className = '',
    available = true,
    onClick,
    ...props
}: ComponentProps<'button'> & { available?: boolean }) {
    return (
        <Button
            type="button"
            variant="figma"
            size="figma"
            className={`design-button ${className}`}
            aria-disabled={!available || undefined}
            onClick={available ? onClick : undefined}
            {...props}
        />
    )
}
export function IconButton({
    icon,
    label,
    size = 24,
    ...props
}: ComponentProps<typeof DesignButton> & { icon: FigmaIconName; label: string; size?: number }) {
    const ui = useUi()
    return (
        <DesignButton aria-label={ui.message(label) ?? undefined} {...props}>
            <FigmaIcon name={icon} size={size} />
        </DesignButton>
    )
}
export function SearchField({
    value,
    onChange,
    bookmarks = false,
    mobile = false,
    onVoiceStart,
    onVoiceChange,
}: {
    value: string
    onChange: (value: string) => void
    bookmarks?: boolean
    mobile?: boolean
    /** Runs on the same microphone click that starts recognition. */
    onVoiceStart?: (() => void) | undefined
    /** Reports the voice phase so the container can size/show the body. */
    onVoiceChange?: ((voice: VoiceSearchState) => void) | undefined
}) {
    const ui = useUi()
    const input = useRef<HTMLInputElement>(null)
    const handleResult = useCallback(
        (text: string) => {
            // Never clear an existing search with an empty transcript.
            if (!text) return
            onChange(text)
        },
        [onChange],
    )
    const voice = useVoiceSearch({ language: ui.language, onResult: handleResult })
    useEffect(() => {
        onVoiceChange?.({
            active: voice.active,
            starting: voice.starting,
            finishing: voice.finishing,
        })
    }, [onVoiceChange, voice.active, voice.starting, voice.finishing])
    // When the field is replaced (e.g. by the details panel) the container must
    // not stay stuck in its voice layout.
    useEffect(
        () => () => onVoiceChange?.({ active: false, starting: false, finishing: false }),
        [onVoiceChange],
    )
    const placeholder = mobile
        ? 'Search Positions'
        : bookmarks
          ? 'Search Bookmarks'
          : 'Lycoris Maps'
    const engaged = voice.active || voice.finishing
    return (
        <>
            <div
                className={`design-search ${mobile ? 'mobile-search' : ''} ${engaged ? 'is-listening' : ''}`}
                onClick={(event) => {
                    if (!(event.target instanceof Element) || event.target.closest('button')) return
                    input.current?.focus()
                }}
            >
                <FigmaIcon name="search" size={20} />
                <input
                    ref={input}
                    aria-label={ui.message(placeholder) ?? undefined}
                    placeholder={ui.message(placeholder) ?? undefined}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    autoComplete="off"
                />
                <IconButton
                    icon={mobile ? 'mobileMicrophone' : 'microphone'}
                    size={20}
                    label={engaged ? 'Stop listening' : 'Start voice search'}
                    aria-pressed={engaged}
                    aria-busy={voice.starting || undefined}
                    onClick={() => {
                        // Expand/show the voice body on this same click, then
                        // start or stop recognition without waiting for a result.
                        if (!engaged) onVoiceStart?.()
                        voice.toggle()
                    }}
                />
            </div>
            {engaged && (
                <div
                    className="voice-search-body"
                    role="group"
                    aria-label={ui.text('Voice search')}
                >
                    <span className="voice-search-status" role="status">
                        {ui.text(
                            voice.finishing
                                ? 'Finishing voice search…'
                                : voice.starting
                                  ? 'Waiting for microphone access…'
                                  : 'Voice search is listening…',
                        )}
                    </span>
                    <p className="voice-search-text">{voice.transcript || ui.text('Speak now…')}</p>
                    <button
                        type="button"
                        className="voice-search-stop"
                        onClick={voice.stop}
                        disabled={voice.finishing}
                    >
                        {ui.text(voice.finishing ? 'Finishing voice search…' : 'Stop voice search')}
                    </button>
                </div>
            )}
            {voice.error && (
                <div className="voice-search-error" role="alert">
                    <span>{ui.text(voice.error)}</span>
                    <IconButton
                        className="voice-search-dismiss"
                        icon="close"
                        size={14}
                        label="Dismiss notification"
                        onClick={voice.dismissError}
                    />
                </div>
            )}
        </>
    )
}
export function CategoryBadge({ category }: { category: 'toilet' | 'nursing' | 'medical' }) {
    return (
        <span className={`category-badge badge-${category}`}>
            <FigmaIcon name={category} />
        </span>
    )
}
export function NearbyCards({
    mobile = false,
    onSelect,
}: {
    mobile?: boolean
    onSelect?: ((category: 'toilet' | 'nursing' | 'medical') => void) | undefined
}) {
    const ui = useUi()
    // Every phone title is exactly two lines so the two-line labels align on the
    // same left edge; Nursing is no longer padded with a leading space.
    const entries = [
        { category: 'toilet', title: mobile ? 'Accessible\nToilets' : 'Accessible Toilets' },
        { category: 'nursing', title: mobile ? 'Nursing\nRooms' : 'Nursing Rooms' },
        { category: 'medical', title: mobile ? 'Medical\nInstitutions' : 'Medical Institutions' },
    ] as const
    return (
        <div className="nearby-cards">
            {entries.map(({ category, title }) => (
                <DesignButton
                    id={`${mobile ? 'mobile' : 'desktop'}-nearby-${category}`}
                    className="category-card"
                    aria-label={ui.message(title.replace(/\s+/g, ' ')) ?? undefined}
                    available={!!onSelect}
                    key={category}
                    onClick={() => onSelect?.(category)}
                >
                    <CategoryBadge category={category} />
                    <span className="card-title">
                        {ui.language === 'en' ? title : ui.message(title.replace(/\s+/g, ' '))}
                    </span>
                </DesignButton>
            ))}
        </div>
    )
}
