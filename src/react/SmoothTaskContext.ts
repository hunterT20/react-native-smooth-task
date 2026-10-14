/**
 * React context carrying the scheduler + navigation coordinator created by
 * <SmoothTaskProvider>. Every public hook in this package resolves the
 * context through useSmoothTask() so a missing provider fails fast with a
 * descriptive error naming the calling hook.
 */

import { createContext, useContext } from 'react';
import type { SmoothTaskContextValue } from './types';

export const SmoothTaskContext = createContext<SmoothTaskContextValue | null>(null);

/**
 * Read the SmoothTask context. Throws when called outside
 * <SmoothTaskProvider>.
 *
 * @param hookName Public hook name used in the error message — internal
 *   helpers pass the name of the hook the user actually called.
 */
export function useSmoothTask(hookName = 'useSmoothTask'): SmoothTaskContextValue {
  const value = useContext(SmoothTaskContext);
  if (value === null) {
    throw new Error(
      `react-native-smooth-task: ${hookName} must be used within <SmoothTaskProvider>`
    );
  }
  return value;
}
