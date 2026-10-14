/**
 * useDeferredMount — route-scoped variant (from
 * 'react-native-smooth-task/stack'). Schedules in the scope of the current
 * route (`route:<useRoute().key>`): the task starts only once the route is
 * settled — focused on path, no open transition barrier on any ancestor
 * navigator, navigation ready and the app active.
 *
 * Must be rendered inside a route (uses useRoute().key).
 */

import { useRoute } from '@react-navigation/native';
import { routeScopeId } from '../../core/types';
import type { DeferredMountOptions } from '../../types';
import { useScopedDeferredMount } from '../useScopedScheduling';

export function useDeferredMount(options?: DeferredMountOptions): boolean {
  const route = useRoute();
  return useScopedDeferredMount(routeScopeId(route.key), options, 'useDeferredMount');
}
