/**
 * Navigation coordination contracts — LOCKED.
 *
 * This module is pure TypeScript: no react / react-native / @react-navigation
 * imports. Navigation state is described by structural types so real
 * `NavigationState` objects can be passed without a hard dependency.
 */

import type { EligibilityGate, ScopeId, TimerHost } from '../core/types';
import type { DiagnosticsSink } from '../diagnostics/types';

/** Structural subset of a React Navigation route inside a state tree. */
export interface NavigationRouteState {
  key: string;
  name: string;
  /** Nested navigator state, if this route renders a nested navigator. */
  state?: NavigationTreeState;
}

/** Structural subset of React Navigation's state tree (PartialState-safe). */
export interface NavigationTreeState {
  index?: number;
  routes: NavigationRouteState[];
}

export type NavigatorKind = 'stack' | 'tab' | 'unknown';

export interface NavigatorRegistration {
  /** Unique per mounted navigator hook instance (never reused). */
  instanceId: string;
  /** Adapter kind. */
  kind: NavigatorKind;
  /** Optional user-facing label (e.g. 'root') — diagnostics only. */
  label?: string;
}

/**
 * Snapshot of a route's relationship to the navigation tree.
 */
export interface RouteStatus {
  /** Route key exists in the latest navigation state. */
  exists: boolean;
  /**
   * Route is on the focused path at every ancestor level
   * (each ancestor's `index` selects the chain leading to it).
   */
  focusedOnPath: boolean;
  /**
   * At least one open transition barrier exists on a navigator
   * along this route's ancestor path (inclusive of its own navigator).
   */
  hasPendingTransition: boolean;
  /**
   * `exists && focusedOnPath && !hasPendingTransition && ready && appActive`.
   * This is what the scheduler's EligibilityGate uses for route scopes.
   */
  settled: boolean;
  /**
   * Increments each time `focusedOnPath` goes false → true.
   * Used by `every-focus` scheduling. Does NOT increment when only
   * barriers open/close while focus is retained.
   */
  focusEpoch: number;
}

export interface NavigationCoordinatorDeps {
  diagnostics?: DiagnosticsSink;
  /**
   * Warn if a barrier stays open longer than this. Detection only —
   * a timeout must NEVER auto-release a barrier.
   * Defaults to 4000ms.
   */
  stallWarningMs?: number;
  /** Injectable timers for stall warnings — defaults to global timers. */
  timers?: TimerHost;
}

/**
 * Owns route/navigator registration, transition barriers and the
 * EligibilityGate the scheduler consumes.
 *
 * Ordering note: React Navigation dispatches the state update for a pop
 * BEFORE transition events, so the closing route may already be gone when
 * `transitionStarted` arrives — implementations must keep tombstoned
 * route→navigator mappings alive while the owning navigator node still
 * exists in the latest state or has an open barrier.
 */
export interface NavigationCoordinator extends EligibilityGate {
  /**
   * Feed the latest root navigation state (call on onReady via getState()
   * and on every onStateChange). Passing null/undefined leaves `ready`
   * untouched.
   */
  setNavigationState(state: NavigationTreeState | null | undefined): void;

  /** True once at least one state has been delivered. */
  readonly ready: boolean;

  /** Route-scoped tasks are ineligible while the app is not active. */
  setAppActive(active: boolean): void;

  /** Register a navigator adapter instance (called by listener hooks). */
  registerNavigator(registration: NavigatorRegistration): void;
  unregisterNavigator(instanceId: string): void;
  /** Count of currently registered navigator instances. */
  readonly navigatorCount: number;

  /**
   * Stack adapter events. `routeKey` is the event `target` (the screen that
   * fired the listener).
   *
   * - transitionStarted: opens a barrier on the route's navigator node.
   * - transitionFinished: closes the barrier on the route's navigator node —
   *   must also close a barrier opened by a sibling route (pop case).
   * - gestureCancelled: ensures the barrier stays/becomes open and waits for
   *   the recovery animation's transitionFinished; never auto-releases.
   * - routeFocused/routeBlurred: optional hints from focus/blur events;
   *   authoritative focus comes from the state tree.
   */
  transitionStarted(routeKey: string): void;
  transitionFinished(routeKey: string): void;
  gestureCancelled(routeKey: string): void;
  routeFocused(routeKey: string): void;
  routeBlurred(routeKey: string): void;

  /** Latest status for a route key. */
  getRouteStatus(routeKey: string): RouteStatus;

  /** Scope id bound to a route (`route:<key>`). */
  routeScopeId(routeKey: string): ScopeId;

  /** Cancel timers/listeners. */
  dispose(): void;
}

/** Factory — implemented in NavigationCoordinator.ts. */
export declare function createNavigationCoordinator(
  deps?: NavigationCoordinatorDeps
): NavigationCoordinator;
