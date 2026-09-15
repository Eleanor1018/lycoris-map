import { useEffect, useId, useRef } from 'react'
import { CategoryBadge, DesignButton, IconButton } from './primitives'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import './contribution-form.css'

export type ContributionDraft = {
    title: string
    category: 'toilet' | 'nursing' | 'medical' | null
    description: string
    openingHour: string
    openingMinute: string
    closingHour: string
    closingMinute: string
    photo: File | null
}

export const emptyContributionDraft: ContributionDraft = {
    title: '',
    category: null,
    description: '',
    openingHour: '',
    openingMinute: '',
    closingHour: '',
    closingMinute: '',
    photo: null,
}

export type ContributionFormProps = {
    draft: ContributionDraft
    onChange: (draft: ContributionDraft) => void
    close: () => void
    point: { lat: number; lng: number } | null
    mobile?: boolean
}

/** The S2 composer keeps a local draft; authenticated submission is the S5 flow. */
export function ContributionForm({
    draft,
    onChange,
    close,
    point,
    mobile = false,
}: ContributionFormProps) {
    const id = useId()
    const heading = useRef<HTMLHeadingElement>(null)
    const photoInput = useRef<HTMLInputElement>(null)
    useEffect(() => {
        heading.current?.focus({ preventScroll: true })
    }, [])
    const update = <K extends keyof ContributionDraft>(key: K, value: ContributionDraft[K]) =>
        onChange({ ...draft, [key]: value })
    const categories = [
        ['toilet', 'Accessible Toilets'],
        ['nursing', 'Nursing Rooms'],
        ['medical', 'Medical Institutions'],
    ] as const
    return (
        <form
            className={`contribution-form ${mobile ? 'contribution-form-mobile' : ''}`}
            aria-label="Contribution draft"
            data-lat={import.meta.env.DEV ? point?.lat : undefined}
            data-lng={import.meta.env.DEV ? point?.lng : undefined}
            onSubmit={(event) => event.preventDefault()}
        >
            <h1 ref={heading} tabIndex={-1}>
                Contribute
            </h1>
            <IconButton
                className="contribution-close"
                icon="close"
                label="Close contribution form"
                onClick={close}
            />
            <label className="contribution-label title-label" htmlFor={`${id}-title`}>
                Title
            </label>
            <input
                id={`${id}-title`}
                className="contribution-input contribution-title"
                placeholder={mobile ? 'Input title here' : undefined}
                value={draft.title}
                onChange={(event) => update('title', event.target.value)}
                autoComplete="off"
            />
            <span id={`${id}-category`} className="contribution-label category-label">
                Category
            </span>
            <div
                className="contribution-categories"
                role="radiogroup"
                aria-labelledby={`${id}-category`}
            >
                {categories.map(([category, label], index) => (
                    <DesignButton
                        key={category}
                        role="radio"
                        aria-label={label}
                        aria-checked={draft.category === category}
                        tabIndex={
                            draft.category === category || (draft.category === null && index === 0)
                                ? 0
                                : -1
                        }
                        onClick={() => update('category', category)}
                        onKeyDown={(event) => {
                            if (
                                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                                    event.key,
                                )
                            )
                                return
                            event.preventDefault()
                            const next =
                                (index +
                                    (event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                                        ? 2
                                        : 1)) %
                                3
                            update('category', categories[next]![0])
                            event.currentTarget.parentElement
                                ?.querySelectorAll<HTMLButtonElement>('[role=radio]')
                                [next]?.focus()
                        }}
                    >
                        <CategoryBadge category={category} />
                    </DesignButton>
                ))}
            </div>
            <label className="contribution-label description-label" htmlFor={`${id}-description`}>
                Description
            </label>
            <textarea
                id={`${id}-description`}
                className="contribution-input contribution-description"
                value={draft.description}
                onChange={(event) => update('description', event.target.value)}
            />
            {(['opening', 'closing'] as const).map((kind) => {
                const label = kind === 'opening' ? 'Opening Time' : 'Closing Time'
                return (
                    <div
                        className={`contribution-time ${kind}-time`}
                        key={kind}
                        role="group"
                        aria-labelledby={`${id}-${kind}`}
                    >
                        <span id={`${id}-${kind}`} className="contribution-label">
                            {label}
                        </span>
                        <div className="time-inputs">
                            {(['Hour', 'Minute'] as const).map((part, index) => (
                                <span className="time-part" key={part}>
                                    {index === 1 && (
                                        <span aria-hidden="true" className="time-colon">
                                            :
                                        </span>
                                    )}
                                    <input
                                        className="contribution-input"
                                        aria-label={`${label} ${part.toLowerCase()}`}
                                        inputMode="numeric"
                                        autoComplete="off"
                                        maxLength={2}
                                        pattern={
                                            part === 'Hour' ? '([01]?[0-9]|2[0-3])' : '[0-5]?[0-9]'
                                        }
                                        value={draft[`${kind}${part}`]}
                                        onChange={(event) =>
                                            update(
                                                `${kind}${part}`,
                                                event.target.value.replace(/\D/g, '').slice(0, 2),
                                            )
                                        }
                                        onBlur={(event) => {
                                            const value = event.currentTarget.value
                                            if (value && event.currentTarget.validity.valid)
                                                update(`${kind}${part}`, value.padStart(2, '0'))
                                        }}
                                    />
                                </span>
                            ))}
                        </div>
                    </div>
                )
            })}
            <span className="contribution-label upload-label" id={`${id}-photo-label`}>
                Upload Photo (Optional)
            </span>
            <input
                ref={photoInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                aria-labelledby={`${id}-photo-label`}
                hidden
                onChange={(event) => {
                    const photo = event.target.files?.[0]
                    if (photo) update('photo', photo)
                    event.target.value = ''
                }}
            />
            <DesignButton
                className="contribution-action contribution-upload"
                aria-label={
                    draft.photo ? `Upload photo: ${draft.photo.name} selected` : 'Upload photo'
                }
                onClick={() => photoInput.current?.click()}
            >
                <span>Upload</span>
                <FigmaIcon name="upload" />
            </DesignButton>
            <DesignButton className="contribution-action contribution-submit" available={false}>
                <span>Submit</span>
                <FigmaIcon name="send" />
            </DesignButton>
        </form>
    )
}
