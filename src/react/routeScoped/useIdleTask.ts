/**
 * useIdleTask — route-scoped variant (from
 * 'react-native-smooth-task/stack'). Returns a stable function scheduling
 * idle work in the current route's scope — tasks start only while the route
 * is settled. All outstanding tasks are cancelled on unmount.
 *
 * Must be rendered inside a route (uses useRoute().key).
 */

import { useRoute } from '@react-navigation/native';
import { routeScopeId, type TaskCallback, type TaskHandle } from '../../core/types';
import type { IdleTaskOptions } from '../../types';
import { useScopedIdleTask } from '../useScopedScheduling';

export function useIdleTask(): (callback: TaskCallback, options?: IdleTaskOptions) => TaskHandle {
  const route = useRoute();
  return useScopedIdleTask(routeScopeId(route.key), 'useIdleTask');
}
