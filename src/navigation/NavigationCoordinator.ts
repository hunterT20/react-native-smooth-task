/**
 * NavigationCoordinator — owns the route registry, navigator-scoped
 * transition barriers and the EligibilityGate the scheduler consumes.
 * Pure TypeScript: no react / react-native / @react-navigation imports.
 *
 * Ordering note (per contract): React Navigation dispatches the state
 * update for a pop BEFORE transition events, so `transitionStarted` /
 * `transitionFinished` may arrive for a route key that is already gone —
 * the registry keeps tombstoned route→navNode mappings alive for that case.
 * Events for keys that cannot be resolved at all are buffered and replayed
 * on the next `setNavigationState`; after ~2s they are dropped with a
 * `dropped-event` warning.
 */

import { createDefaultTimerHost } from '../core/Hosts';
import {
  APP_SCOPE_ID,
  routeKeyFromScope,
  routeScopeId as toRouteScopeId,
  type ScopeId,
  type TimerHost,
} from '../core/types';
import type { DiagnosticLevel, DiagnosticsSink } from '../diagnostics/types';
import { BarrierRegistry } from './BarrierRegistry';
import { RouteRegistry } from './RouteRegistry';
import type {
  NavigationCoordinator,
  NavigationCoordinatorDeps,
  NavigationTreeState,
  NavigatorRegistration,
  RouteStatus,
} from './types';

const DEFAULT_STALL_WARNING_MS = 4000;
const BUFFERED_EVENT_TTL_MS = 2000;

/**
 * How long the coordinator waits for any sign of navigation wiring (a
 * navigator registration, a state delivery, a listener event) before
 * treating the app as having no navigation adapter: `ready === false &&
 * navigatorCount === 0` persisting for this long means no adapter exists.
 * What happens next depends on `missingAdapterPolicy` — see below.
 *
 * The delay is deliberate: listener hooks register in the first commit —
 * AFTER their screen children — so an instant check would briefly flag
 * every correctly wired app during mount.
 */
const STANDALONE_DETECTION_DELAY_MS = 2000;

/** Sink that drops everything (avoids depending on a sibling impl file). */
const NOOP_SINK: DiagnosticsSink = { emit: () => undefined };

type TransitionEventKind = 'transition-started' | 'transition-finished' | 'gesture-cancelled';

interface BufferedEvent {
  readonly kind: TransitionEventKind;
  readonly routeKey: string;
  readonly expiryHandle: unknown;
}

/** Focus/blur listener hints — diagnostics only, never authoritative. */
interface FocusHint {
  readonly event: 'focus' | 'blur';
  readonly at: number;
}

export function createNavigationCoordinator(
  deps: NavigationCoordinatorDeps = {}
): NavigationCoordinator {
  const timers: TimerHost = deps.timers ?? createDefaultTimerHost();
  const sink = deps.diagnostics ?? NOOP_SINK;
  /**
   * 'strict' (default): missing wiring fails closed — route scopes stay
   * gated forever rather than running ungated mid-transition.
   * 'degraded': opt-in — after the delay, all scopes become eligible.
   */
  const missingAdapterPolicy = deps.missingAdapterPolicy ?? 'strict';

  const emit = (
    level: DiagnosticLevel,
    code: string,
    message: string,
    extra?: { routeKey?: string; scopeId?: string; details?: Record<string, unknown> }
  ): void => {
    try {
      sink.emit({ level, code, message, timestamp: timers.now(), ...(extra ?? {}) });
    } catch {
      // A misbehaving sink must never break the coordinator.
    }
  };

  const registry = new RouteRegistry();
  const barriers = new BarrierRegistry({
    timers,
    stallWarningMs: deps.stallWarningMs ?? DEFAULT_STALL_WARNING_MS,
    emit: (diagnostic) => {
      const { level, code, message, routeKey, details } = diagnostic;
      emit(level, code, message, {
        ...(routeKey !== undefined ? { routeKey } : {}),
        ...(details !== undefined ? { details } : {}),
      });
    },
  });

  let ready = false;
  let appActive = true;
  let disposed = false;

  const navigators = new Map<string, NavigatorRegistration>();
  const listeners = new Set<() => void>();
  /** `${kind}:${routeKey}` → buffered event awaiting a resolvable navNode. */
  const bufferedEvents = new Map<string, BufferedEvent>();
  const focusHints = new Map<string, FocusHint>();
  const warnedUntrackedRoutes = new Set<string>();
  const warnedUnknownScopePrefixes = new Set<string>();

  // Missing-adapter detection (see STANDALONE_DETECTION_DELAY_MS above).
  let standaloneDeclared = false;
  let standaloneCheckHandle: unknown = null;
  let missingAdapterWarned = false;

  function notify(): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // A listener must never break the coordinator.
      }
    }
  }

  /**
   * Any evidence that navigation exists (state delivery, adapter
   * registration, listener event) cancels the detection timer and clears a
   * previous degraded declaration — the coordinator then gates normally
   * again.
   */
  function noteNavigationSignal(): void {
    if (standaloneCheckHandle !== null) {
      timers.clearTimeout(standaloneCheckHandle);
      standaloneCheckHandle = null;
    }
    standaloneDeclared = false;
    // Wiring appeared — if it disappears again the app deserves a fresh
    // missing-adapter warning rather than silence.
    missingAdapterWarned = false;
  }

  function isStandaloneDegraded(): boolean {
    return standaloneDeclared && navigators.size === 0 && !ready;
  }

  /**
   * Arm the missing-adapter detection timer when the unwired condition
   * (`!ready && navigatorCount === 0`) currently holds. On expiry the
   * condition is re-checked — wiring that arrived meanwhile keeps normal
   * gating.
   */
  function maybeArmStandaloneCheck(): void {
    if (disposed || standaloneDeclared || standaloneCheckHandle !== null) return;
    if (ready || navigators.size !== 0) return;
    // Strict mode only needs the one-shot warning; once fired, arming again
    // would just notify() every 2s with nothing new to report. If wiring
    // ever arrives, the signal paths clear this flag via
    // missingAdapterWarned reset in noteNavigationSignal.
    if (missingAdapterPolicy === 'strict' && missingAdapterWarned) return;
    standaloneCheckHandle = timers.setTimeout(() => {
      standaloneCheckHandle = null;
      if (disposed || ready || navigators.size !== 0) return;
      if (missingAdapterPolicy === 'degraded') standaloneDeclared = true;
      if (!missingAdapterWarned) {
        missingAdapterWarned = true;
        emit(
          'warn',
          'missing-adapter',
          missingAdapterPolicy === 'degraded'
            ? 'react-native-smooth-task: no navigation state or navigator adapter ' +
                'detected — running in degraded standalone mode; all scopes are eligible. ' +
                'Wire useSmoothNavigationContainer / useSmoothStackListeners for ' +
                'transition-aware gating.'
            : 'react-native-smooth-task: no navigation state or navigator adapter ' +
                'detected — route-scoped tasks stay gated (missingAdapterPolicy: ' +
                "'strict'). Wire useSmoothNavigationContainer plus listener hooks, " +
                "or pass missingAdapterPolicy='degraded' to opt into ungated execution.",
          {}
        );
      }
      notify();
    }, STANDALONE_DETECTION_DELAY_MS);
  }

  // --- transition events ---------------------------------------------------

  function bufferEvent(kind: TransitionEventKind, routeKey: string): void {
    const key = `${kind}:${routeKey}`;
    const previous = bufferedEvents.get(key);
    if (previous !== undefined) timers.clearTimeout(previous.expiryHandle);
    const expiryHandle = timers.setTimeout(() => {
      if (!bufferedEvents.delete(key)) return;
      emit(
        'warn',
        'dropped-event',
        `dropped buffered ${kind} for route '${routeKey}' — the route never resolved to a navigator`,
        {
          routeKey,
          details: {
            kind,
            bufferedForMs: BUFFERED_EVENT_TTL_MS,
            focusHint: focusHints.get(routeKey)?.event,
          },
        }
      );
    }, BUFFERED_EVENT_TTL_MS);
    bufferedEvents.set(key, { kind, routeKey, expiryHandle });
    emit('debug', 'event-buffered', `buffered ${kind} for unresolved route '${routeKey}'`, {
      routeKey,
      details: { kind },
    });
  }

  /** Apply a resolved transition event; returns whether eligibility changed. */
  function applyTransitionEvent(
    kind: TransitionEventKind,
    routeKey: string,
    navNodeId: string
  ): boolean {
    switch (kind) {
      case 'transition-started': {
        const opened = barriers.open(navNodeId, 'transition', routeKey);
        if (opened === null) {
          emit(
            'debug',
            'barrier-already-open',
            `transitionStarted for '${routeKey}' ignored — navigator '${navNodeId}' already has an open barrier`,
            { routeKey, details: { navNodeId } }
          );
          return false;
        }
        return true;
      }
      case 'transition-finished': {
        // NavNode-scoped close: also releases a barrier opened by a sibling
        // route (pop case — the closing screen's transitionEnd may never fire).
        if (!barriers.close(navNodeId, 'transition-finished', routeKey)) {
          emit(
            'debug',
            'no-open-barrier',
            `transitionFinished for '${routeKey}' — navigator '${navNodeId}' has no open barrier`,
            { routeKey, details: { navNodeId } }
          );
          return false;
        }
        return true;
      }
      case 'gesture-cancelled': {
        return barriers.markGestureRecovery(navNodeId, routeKey) === 'opened';
      }
    }
  }

  function handleTransitionEvent(kind: TransitionEventKind, routeKey: string): void {
    if (disposed) return;
    noteNavigationSignal();
    const navNodeId = registry.resolveNavNodeId(routeKey);
    if (navNodeId === undefined) {
      // Route key not resolvable right now (e.g. the event preceded the
      // state delivery) — buffer and replay on the next setNavigationState.
      bufferEvent(kind, routeKey);
      return;
    }
    if (applyTransitionEvent(kind, routeKey, navNodeId)) notify();
  }

  /** Re-resolve buffered events after a rebuild; unresolved ones keep waiting. */
  function replayBufferedEvents(): void {
    for (const [key, event] of [...bufferedEvents]) {
      const navNodeId = registry.resolveNavNodeId(event.routeKey);
      if (navNodeId === undefined) continue;
      timers.clearTimeout(event.expiryHandle);
      bufferedEvents.delete(key);
      applyTransitionEvent(event.kind, event.routeKey, navNodeId);
    }
  }

  // --- public API ----------------------------------------------------------

  function setNavigationState(state: NavigationTreeState | null | undefined): void {
    if (disposed || state == null) return;
    const firstDelivery = !ready;
    ready = true;
    noteNavigationSignal();

    const result = registry.rebuild(state, barriers.openNavNodeIds());
    // Purge dead navNodes: auto-close their barriers, drop their tombstones.
    for (const navNodeId of result.deadNavNodeIds) {
      barriers.close(navNodeId, 'navnode-purged');
      registry.purgeNavNode(navNodeId);
    }
    replayBufferedEvents();

    if (firstDelivery) {
      emit('info', 'navigation-ready', 'navigation state received — coordinator is ready', {});
    }
    notify();
  }

  function setAppActive(active: boolean): void {
    if (disposed || appActive === active) return;
    appActive = active;
    emit('debug', 'app-state', `app ${active ? 'became active' : 'went inactive'}`, {
      details: { active },
    });
    notify();
  }

  function registerNavigator(registration: NavigatorRegistration): void {
    if (disposed) return;
    navigators.set(registration.instanceId, registration);
    noteNavigationSignal();
    emit('info', 'navigator-registered', `navigator '${registration.instanceId}' registered`, {
      details: {
        instanceId: registration.instanceId,
        kind: registration.kind,
        ...(registration.label !== undefined ? { label: registration.label } : {}),
      },
    });
    notify();
  }

  function unregisterNavigator(instanceId: string): void {
    if (disposed) return;
    if (!navigators.delete(instanceId)) return;
    emit('info', 'navigator-unregistered', `navigator '${instanceId}' unregistered`, {
      details: { instanceId },
    });
    notify();
  }

  function transitionStarted(routeKey: string): void {
    handleTransitionEvent('transition-started', routeKey);
  }

  function transitionFinished(routeKey: string): void {
    handleTransitionEvent('transition-finished', routeKey);
  }

  function gestureCancelled(routeKey: string): void {
    handleTransitionEvent('gesture-cancelled', routeKey);
  }

  function routeFocused(routeKey: string): void {
    if (disposed) return;
    // Hint for diagnostics only — authoritative focus comes from the state
    // tree, so this does not broadcast.
    focusHints.set(routeKey, { event: 'focus', at: timers.now() });
    noteNavigationSignal();
  }

  function routeBlurred(routeKey: string): void {
    if (disposed) return;
    focusHints.set(routeKey, { event: 'blur', at: timers.now() });
    noteNavigationSignal();
  }

  function getRouteStatus(routeKey: string): RouteStatus {
    const record = registry.getRoute(routeKey);
    const exists = record !== undefined;
    const focusedOnPath = record?.focusedOnPath ?? false;
    const hasPendingTransition =
      record !== undefined &&
      record.navNodeIdsOnPath.some((navNodeId) => barriers.hasOpenBarrier(navNodeId));
    const settled = exists && focusedOnPath && !hasPendingTransition && ready && appActive;
    return {
      exists,
      focusedOnPath,
      hasPendingTransition,
      settled,
      focusEpoch: registry.focusEpochOf(routeKey),
    };
  }

  function isEligible(scopeId: ScopeId): boolean {
    maybeArmStandaloneCheck();
    // Degraded standalone mode: no adapter ever wired — nothing should block.
    if (isStandaloneDegraded()) return true;

    const routeKey = routeKeyFromScope(scopeId);
    if (routeKey !== null) {
      if (ready && !registry.hasSeenRoute(routeKey) && !warnedUntrackedRoutes.has(routeKey)) {
        warnedUntrackedRoutes.add(routeKey);
        emit(
          'warn',
          'untracked-route',
          `route scope '${scopeId}' queried for a route never observed in the navigation state`,
          {
            routeKey,
            scopeId,
            details: { focusHint: focusHints.get(routeKey)?.event },
          }
        );
      }
      return getRouteStatus(routeKey).settled;
    }
    if (scopeId === APP_SCOPE_ID || scopeId.startsWith('app:')) return true;

    // Unknown prefixes are never blocked — surface once for visibility.
    const separator = scopeId.indexOf(':');
    const prefix = separator === -1 ? scopeId : scopeId.slice(0, separator);
    if (!warnedUnknownScopePrefixes.has(prefix)) {
      warnedUnknownScopePrefixes.add(prefix);
      emit(
        'debug',
        'unknown-scope',
        `scope '${scopeId}' has an unknown prefix — treated as always eligible`,
        { scopeId, details: { prefix } }
      );
    }
    return true;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (standaloneCheckHandle !== null) {
      timers.clearTimeout(standaloneCheckHandle);
      standaloneCheckHandle = null;
    }
    for (const event of bufferedEvents.values()) {
      timers.clearTimeout(event.expiryHandle);
    }
    bufferedEvents.clear();
    barriers.dispose();
    listeners.clear();
    navigators.clear();
    focusHints.clear();
  }

  return {
    get ready() {
      return ready;
    },
    get navigatorCount() {
      return navigators.size;
    },
    setNavigationState,
    setAppActive,
    registerNavigator,
    unregisterNavigator,
    transitionStarted,
    transitionFinished,
    gestureCancelled,
    routeFocused,
    routeBlurred,
    getRouteStatus,
    routeScopeId: toRouteScopeId,
    isEligible,
    subscribe,
    dispose,
  };
}
