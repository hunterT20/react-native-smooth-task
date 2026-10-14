/**
 * React integration contracts — LOCKED.
 *
 * This is the only layer that may import react / react-native. Code that
 * needs @react-navigation must live in the `/stack` entry point so the
 * root entry stays usable without navigation installed.
 */

import type { NavigationCoordinator, NavigationTreeState } from '../navigation/types';
import type { TaskScheduler } from '../core/types';
import type { Diagnostics } from '../diagnostics/types';
import type { DeferredMountOptions } from '../types';
import type { ReactNode } from 'react';

/** What SmoothTaskProvider puts into context. */
export interface SmoothTaskContextValue {
  scheduler: TaskScheduler;
  /**
   * Always created by the provider. It becomes "navigation-aware" once the
   * app wires `useSmoothNavigationContainer` to a NavigationContainer.
   */
  coordinator: NavigationCoordinator;
  diagnostics: Diagnostics;
}

export interface SmoothTaskProviderProps {
  children?: ReactNode;
  /**
   * `true` → console sink. Custom sinks allowed. Default: noop.
   */
  diagnostics?: boolean | { emit(event: import('../diagnostics/types').DiagnosticEvent): void };
  /**
   * When true (default), route-scoped tasks are ineligible while the app is
   * not in 'active' AppState. App-scoped tasks are never affected.
   */
  pauseInBackground?: boolean;
}

/** Result of useSmoothNavigationContainer — spread onto NavigationContainer. */
export interface NavigationContainerObservers {
  onReady(): void;
  onStateChange(state: NavigationTreeState | undefined): void;
}

export interface UseSmoothNavigationContainerOptions {
  /** Composed AFTER internal observers run — never overridden. */
  onReady?: () => void;
  /** Composed AFTER internal observers run — never overridden. */
  onStateChange?: (state: NavigationTreeState | undefined) => void;
}

export interface DeferredViewProps {
  /** Rendered until the deferred content is ready. Default: null. */
  fallback?: ReactNode;
  /** Forwarded to the internal useDeferredMount call. */
  scheduling?: DeferredMountOptions['scheduling'];
  children?: ReactNode;
}

/**
 * Options accepted by the /stack variant of the listener hook.
 * `id` labels the navigator for diagnostics; a unique instanceId is
 * generated internally so same-id navigators never collide.
 */
export interface SmoothStackListenersOptions {
  id?: string;
}
