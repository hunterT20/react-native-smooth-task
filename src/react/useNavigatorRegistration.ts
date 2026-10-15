/**
 * useNavigatorRegistration — shared mount/unmount registration effect for
 * navigator adapters. Generates a unique `instanceId`
 * (`<kind>:<id|anon>:<n>`) per mounted hook instance so same-id navigators
 * never collide.
 */

import { useEffect } from 'react';
import type { NavigationCoordinator, NavigatorKind } from '../navigation/types';

let instanceCounter = 0;

export function useNavigatorRegistration(
  coordinator: NavigationCoordinator,
  kind: NavigatorKind,
  id: string | undefined
): void {
  // Unique instanceId generated inside the effect — render stays pure.
  // If `id` changes the navigator is re-registered under a fresh instanceId.
  useEffect(() => {
    instanceCounter += 1;
    const instanceId = `${kind}:${id ?? 'anon'}:${instanceCounter}`;
    coordinator.registerNavigator({
      instanceId,
      kind,
      ...(id !== undefined ? { label: id } : {}),
    });
    return () => coordinator.unregisterNavigator(instanceId);
  }, [coordinator, kind, id]);
}
