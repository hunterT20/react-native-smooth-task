/**
 * React integration contracts — LOCKED.
 *
 * This is the only layer that may import react / react-native. Code that
 * needs @react-navigation must live in the `/stack` entry point so the
 * root entry stays usable without navigation installed.
 */

import type {
  MissingAdapterPolicy,
  NavigationCoordinator,
  NavigationTreeState,
} from '../navigation/types';
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
  /**
   * Policy when no navigation wiring reaches the coordinator (~2s with no
   * state delivery and no navigator registration):
   * - 'strict' (default): route scopes stay gated; a `missing-adapter`
   *   warning fires once. Miswired apps fail closed.
   * - 'degraded': opt-in — all scopes become eligible (previous behavior).
   * App-scoped tasks are unaffected either way.
   */
  missingAdapterPolicy?: MissingAdapterPolicy;
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
  /**
   * Set to `false` when the navigator's screens disable animation entirely
   * (JS stack `screenOptions={{ animationEnabled: false }}` or native-stack
   * `animation: 'none'`). Transition events are then ignored — no barriers
   * are ever opened, so tasks settle on focus alone.
   *
   * Per-screen `animation: 'none'` on an otherwise animated navigator
   * cannot be detected at the screenListeners level: keep the default and
   * rely on the real events; if a `transitionEnd` is ever lost, a
   * `stalled-transition` diagnostic warns (the barrier never auto-releases).
   */
  animationEnabled?: boolean;
}
