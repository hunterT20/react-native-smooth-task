/**
 * Dedupe and settle helpers shared by the scheduler and the React hooks that
 * mirror its pending-key index.
 */

import type { ScopeId } from './types';

/** Dedupe index key — scope-scoped, mode-agnostic ("latest wins"). */
export function scopedDedupeKey(scopeId: ScopeId, key: string): string {
  return JSON.stringify([scopeId, key]);
}

/** True when a task callback returned a promise-like result. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value != null && typeof (value as { then?: unknown }).then === 'function';
}
