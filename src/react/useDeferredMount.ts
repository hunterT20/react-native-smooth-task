/**
 * useDeferredMount — app-scope variant. Renders ready once a transition-mode
 * task has run; never gated by navigation state or AppState.
 */

import { APP_SCOPE_ID } from '../core/types';
import type { DeferredMountOptions } from '../types';
import { useScopedDeferredMount } from './useScopedScheduling';

export function useDeferredMount(options?: DeferredMountOptions): boolean {
  return useScopedDeferredMount(APP_SCOPE_ID, options, 'useDeferredMount');
}
