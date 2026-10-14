/**
 * DeferredView — route-scoped variant (from
 * 'react-native-smooth-task/stack'). Renders `fallback` (default: nothing)
 * until the current route is settled, then renders `children` — permanently.
 *
 * Must be rendered inside a route (uses useRoute().key).
 */

import { useRoute } from '@react-navigation/native';
import type { ReactElement } from 'react';
import { routeScopeId } from '../../core/types';
import type { DeferredViewProps } from '../types';
import { useScopedDeferredMount } from '../useScopedScheduling';

export function DeferredView({
  fallback = null,
  scheduling,
  children,
}: DeferredViewProps): ReactElement {
  const route = useRoute();
  const ready = useScopedDeferredMount(
    routeScopeId(route.key),
    scheduling === undefined ? undefined : { scheduling },
    'DeferredView'
  );
  return <>{ready ? children : fallback}</>;
}
