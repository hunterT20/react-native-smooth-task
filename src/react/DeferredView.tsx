/**
 * DeferredView — app-scope variant. Renders `fallback` (default: nothing)
 * until the deferred-mount task runs, then renders `children` — permanently.
 */

import type { ReactElement } from 'react';
import { APP_SCOPE_ID } from '../core/types';
import type { DeferredViewProps } from './types';
import { useScopedDeferredMount } from './useScopedScheduling';

export function DeferredView({
  fallback = null,
  scheduling,
  children,
}: DeferredViewProps): ReactElement {
  const ready = useScopedDeferredMount(
    APP_SCOPE_ID,
    scheduling === undefined ? undefined : { scheduling },
    'DeferredView'
  );
  return <>{ready ? children : fallback}</>;
}
