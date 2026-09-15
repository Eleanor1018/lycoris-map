import type { ComponentProps } from 'react'
import { Button } from '@/shared/ui/button'
import { FigmaIcon, type FigmaIconName } from '@/shared/ui/figma-icon'
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
    return (
        <DesignButton aria-label={label} {...props}>
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
    const placeholder = mobile
        ? 'Search Positions'
        : bookmarks
          ? 'Search Bookmarks'
          : 'Lycoris Maps'
    return (
        <div className={`design-search ${mobile ? 'mobile-search' : ''}`}>
            <FigmaIcon name="search" size={20} />
            <input
                aria-label={placeholder}
                placeholder={placeholder}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                autoComplete="off"
            />
            <IconButton
                icon={mobile ? 'mobileMicrophone' : 'microphone'}
                size={20}
                label="Microphone"
                available={false}
            />
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
}: {
    mobile?: boolean
    half?: boolean
}) {
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
                <DesignButton className="category-card" available={false} key={category}>
                    <CategoryBadge category={category} />
                    <span className="card-title">{title}</span>
                </DesignButton>
            ))}
        </div>
    )
}
