import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        maxWorkers: 2,
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        css: false,
        include: ['src/**/*.test.{ts,tsx}'],
    },
})
