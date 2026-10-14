/**
 * useAfterTransition — app-scope variant. Runs the callback once the app
 * scope is eligible (immediately); `mode: 'every-focus'` has no additional
 * effect outside a route scope.
 */

import { APP_SCOPE_ID, type TaskCallback } from '../core/types';
import type { AfterTransitionOptions } from '../types';
import { useScopedAfterTransition } from './useScopedScheduling';

export function useAfterTransition(
  callback: TaskCallback,
  options?: AfterTransitionOptions
): void {
  useScopedAfterTransition(APP_SCOPE_ID, callback, options, 'useAfterTransition');
}
