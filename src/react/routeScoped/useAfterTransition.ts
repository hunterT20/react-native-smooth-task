/**
 * useAfterTransition — route-scoped variant (from
 * 'react-native-smooth-task/stack'). Runs the callback when the current
 * route becomes settled; with `mode: 'every-focus'` it re-runs once per
 * focus epoch of this route.
 *
 * Must be rendered inside a route (uses useRoute().key).
 */

import { useRoute } from '@react-navigation/native';
import { routeScopeId, type TaskCallback } from '../../core/types';
import type { AfterTransitionOptions } from '../../types';
import { useScopedAfterTransition } from '../useScopedScheduling';

export function useAfterTransition(callback: TaskCallback, options?: AfterTransitionOptions): void {
  const route = useRoute();
  useScopedAfterTransition(routeScopeId(route.key), callback, options, 'useAfterTransition');
}
