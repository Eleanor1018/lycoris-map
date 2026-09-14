/**
 * authEpoch: the login round token used to isolate private data.
 *
 * Rules this module guarantees (all pure, so they are unit-testable without a
 * browser session):
 * - The epoch is monotonic and lives OUTSIDE the identity. Anonymous state has
 *   its own unique number too, so a request issued while anonymous can still be
 *   compared against the current state later.
 * - Every login round (begin) AND every logout (end) increments the epoch.
 *   A→B gets a new epoch even when the previous user is replaced directly.
 * - A stale 401 or a late `/api/me` success from an earlier epoch must be
 *   ignored: it cannot restore an identity that has since logged out.
 * - Clearing private cache clears only private query keys. Public data
 *   (viewport/nearby/search) stays cached, because it is not user-scoped.
 *
 * S1 delivers the pure convention only; the login page and cookie session flow
 * arrive in S4.
 */

export type SessionState = {
    /** `UserResponse.publicId` (UUID string, never numeric); `null` when anonymous. */
    publicId: string | null
    /**
     * Unique, monotonically increasing marker for the current login round.
     * Never `null`: a request issued while anonymous captures a number that
     * becomes stale as soon as anyone logs in or out.
     */
    epoch: number
}

export const initialSessionState: SessionState = { publicId: null, epoch: 0 }

/** The epoch a request must capture; always a number. */
export function currentEpoch(state: SessionState): number {
    return state.epoch
}

/** True when the state represents a logged-in account. */
export function isAuthenticated(state: SessionState): boolean {
    return state.publicId !== null
}

/** Begin a login round: advance the epoch and adopt the new identity. */
export function beginSession(state: SessionState, publicId: string): SessionState {
    return { publicId, epoch: state.epoch + 1 }
}

/** Logout: advance the epoch and drop the identity. */
export function endSession(state: SessionState): SessionState {
    return { publicId: null, epoch: state.epoch + 1 }
}

/**
 * Whether a response/error captured under `requestEpoch` still belongs to the
 * current login round. A stale result returns `false` and must be discarded.
 */
export function isCurrentEpoch(state: SessionState, requestEpoch: number): boolean {
    return state.epoch === requestEpoch
}

/**
 * Whether a 401 for `requestEpoch` should clear the current session.
 *
 * Requires an authenticated current state AND a matching epoch, so a 401 from
 * before login/logout can never clear the session that replaced it.
 */
export function shouldClearSessionForUnauthorized(
    state: SessionState,
    requestEpoch: number,
): boolean {
    return isAuthenticated(state) && isCurrentEpoch(state, requestEpoch)
}

/**
 * Whether a late `/api/me` success for `requestEpoch` may be applied.
 *
 * A success captured while anonymous (or in an earlier round) must not be
 * adopted once the epoch advanced, otherwise a logged-out user could be
 * restored by an in-flight startup request.
 */
export function shouldApplySessionResult(state: SessionState, requestEpoch: number): boolean {
    return isCurrentEpoch(state, requestEpoch)
}
