import { Link } from 'react-router'
import { useAccountFlow } from '@/features/auth/AccountFlow'
import { FigmaIcon } from '@/shared/ui/figma-icon'
import { useAdminAccess } from './useAdminAccess'
import { useAdminUi } from './ui'
export function AdminEntry() {
    const { access } = useAdminAccess(),
        ui = useAdminUi(),
        flow = useAccountFlow()
    if (access.data !== 'ready' && access.data !== 'verify') return null
    return (
        <Link
            className="setting-card"
            to={`/admin?lang=${ui.language}`}
            onClick={() => flow?.close()}
        >
            <span>{ui.message('Administration')}</span>
            <FigmaIcon name="chevron" />
        </Link>
    )
}
