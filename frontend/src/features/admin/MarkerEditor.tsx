import { useState } from 'react'
import type { Marker } from '@/shared/api/markers'
import { markerTextSchema, type MarkerText } from '@/shared/api/markerWrites'
import { DesignButton } from '@/shared/ui/design-primitives'
import { AccountField } from '@/features/auth/accountFields'
import { categoryLabels } from '@/features/places/model'
import { useAdminUi } from './ui'
import { useAdminWork } from './work'
import { editMarker } from './api'
export function MarkerEditor({ marker, close }: { marker: Marker; close: () => void }) {
    const ui = useAdminUi(),
        work = useAdminWork(),
        [error, setError] = useState('')
    const [draft, setDraft] = useState<MarkerText>({
        title: marker.title,
        category: marker.category,
        description: marker.description ?? '',
        isPublic: marker.isPublic,
        openTimeStart: marker.openTimeStart ?? '',
        openTimeEnd: marker.openTimeEnd ?? '',
        language: marker.contentLanguage === 'en' ? 'en' : 'zh',
    })
    return (
        <section className="admin-card admin-editor">
            <h2>
                {ui.message('Edit approved content')} · #{marker.id}
            </h2>
            <form
                onSubmit={(event) => {
                    event.preventDefault()
                    const result = markerTextSchema.safeParse(draft)
                    if (!result.success) {
                        setError('Check the title and both opening times.')
                        return
                    }
                    setError('')
                    work.confirm({
                        label: `${ui.message('Edit approved content')} · ${draft.title}`,
                        detail: ui.message('This saves the changes as approved content.'),
                        action: async (signal) => {
                            await editMarker(marker.id, result.data, signal)
                            close()
                        },
                    })
                }}
            >
                <fieldset disabled={work.busy}>
                    <AccountField
                        label="Title"
                        required
                        maxLength={120}
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                    <label className="admin-field">
                        {ui.message('Category')}
                        <select
                            value={draft.category}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    category: e.target.value as MarkerText['category'],
                                })
                            }
                        >
                            {Object.entries(categoryLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {ui.message(label)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="admin-field">
                        {ui.message('Description')}
                        <textarea
                            rows={5}
                            value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                        />
                    </label>
                    <AccountField
                        label="Opening Time"
                        type="time"
                        value={draft.openTimeStart}
                        onChange={(e) => setDraft({ ...draft, openTimeStart: e.target.value })}
                    />
                    <AccountField
                        label="Closing Time"
                        type="time"
                        value={draft.openTimeEnd}
                        onChange={(e) => setDraft({ ...draft, openTimeEnd: e.target.value })}
                    />
                    <div className="admin-actions">
                        <DesignButton type="submit">{ui.message('Save')}</DesignButton>
                        <DesignButton onClick={close}>{ui.message('Cancel')}</DesignButton>
                    </div>
                </fieldset>
                {error && <p role="alert">{ui.message(error)}</p>}
            </form>
        </section>
    )
}
