import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root element is missing')

createRoot(container).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
