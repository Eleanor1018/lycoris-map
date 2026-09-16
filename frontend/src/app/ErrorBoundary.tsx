import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Keeps a render failure from showing a blank page. */
export class AppErrorBoundary extends Component<Props, State> {
    override state: State = { error: null }

    static getDerivedStateFromError(error: Error): State {
        return { error }
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('Application render error', error, info.componentStack)
    }

    override render(): ReactNode {
        const { error } = this.state
        if (!error) return this.props.children

        return (
            <div
                role="alert"
                style={{ padding: 'var(--ui-gap)', fontFamily: 'var(--ui-font-body)' }}
            >
                <h1 style={{ fontFamily: 'var(--ui-font-heading)' }}>Lycoris</h1>
                <p>页面渲染失败，请刷新重试。</p>
                <p style={{ opacity: 0.7 }}>{error.message}</p>
            </div>
        )
    }
}
