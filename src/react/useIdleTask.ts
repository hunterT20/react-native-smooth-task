/**
 * useIdleTask — app-scope variant. Returns a stable function that schedules
 * idle work (priority 'background' by default). All outstanding tasks are
 * cancelled on unmount.
 */

import { APP_SCOPE_ID, type TaskCallback, type TaskHandle } from '../core/types';
import type { IdleTaskOptions } from '../types';
import { useScopedIdleTask } from './useScopedScheduling';

export function useIdleTask(): (
  callback: TaskCallback,
  options?: IdleTaskOptions
) => TaskHandle {
  return useScopedIdleTask(APP_SCOPE_ID, 'useIdleTask');
}
