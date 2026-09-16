/**
 * `/health/live` and `/health/ready` diagnostics.
 *
 * `/health/ready` is the only readiness signal: it checks PostgreSQL and Redis
 * concurrently and answers 503 when either is down. `/health/live` is a
 * process-liveness probe and must NOT be treated as "backend ready".
 *
 * Readiness is locally proxied by Vite (`/health` -> 127.0.0.1:8080) for
 * diagnostics only.
 */

import { z } from 'zod'
import { request } from './transport'

export const healthCheckSchema = z.enum(['ok', 'down'])

export const readinessSchema = z.object({
    status: z.enum(['ok', 'unavailable']),
    checks: z.object({
        postgres: healthCheckSchema,
        redis: healthCheckSchema,
    }),
})

export type Readiness = z.infer<typeof readinessSchema>

export const livenessSchema = z.object({ status: z.literal('ok') })

export type Liveness = z.infer<typeof livenessSchema>

/**
 * Liveness probe. Resolves `true` when the process answers; it says nothing
 * about PostgreSQL/Redis availability.
 */
export async function fetchLiveness(signal?: AbortSignal): Promise<boolean> {
    const body = await request('/health/live', signal ? { signal } : {})
    return livenessSchema.safeParse(body).success
}

/** Readiness probe; throws `ApiError` (503) when a dependency is unavailable. */
export async function fetchReadiness(signal?: AbortSignal): Promise<Readiness> {
    const body = await request('/health/ready', signal ? { signal } : {})
    return readinessSchema.parse(body)
}
