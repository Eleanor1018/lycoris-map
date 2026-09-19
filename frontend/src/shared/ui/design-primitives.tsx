import { useUi } from '@/shared/i18n/ui'
import { useRef, type ComponentProps } from 'react'
import { Button } from '@/shared/ui/button'
import { FigmaIcon, type FigmaIconName } from '@/shared/ui/figma-icon'
import { useVoiceSearch } from '@/shared/ui/useVoiceSearch'
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
}: {
    value: string
    onChange: (value: string) => void
    bookmarks?: boolean
    mobile?: boolean
}) {
    const ui = useUi()
    const input = useRef<HTMLInputElement>(null)
    const voice = useVoiceSearch({ language: ui.language, onResult: onChange })
    const placeholder = mobile
        ? 'Search Positions'
        : bookmarks
          ? 'Search Bookmarks'
          : 'Lycoris Maps'
    const active = voice.active
    return (
        <div
            className={`design-search ${mobile ? 'mobile-search' : ''} ${active ? 'is-listening' : ''}`}
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
                label={active ? 'Stop listening' : 'Start voice search'}
                aria-pressed={active}
                aria-busy={voice.starting || undefined}
                onClick={voice.toggle}
            />
            {active && (
                <span className="voice-search-status" role="status">
                    {ui.text(
                        voice.starting
                            ? 'Waiting for microphone access…'
                            : 'Voice search is listening…',
                    )}
                </span>
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
        </div>
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
    half = false,
    onSelect,
}: {
    mobile?: boolean
    half?: boolean
    onSelect?: ((category: 'toilet' | 'nursing' | 'medical') => void) | undefined
}) {
    const ui = useUi()
    const entries = [
        { category: 'toilet', title: mobile ? 'Accessible\nToilets' : 'Accessible Toilets' },
        {
            category: 'nursing',
            title: mobile ? `Nursing\n${half ? ' ' : ''}Rooms` : 'Nursing Rooms',
        },
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
