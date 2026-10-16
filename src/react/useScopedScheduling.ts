/**
 * Scoped scheduling hooks — shared implementations parameterized by ScopeId.
 *
 * The root entry binds these to APP_SCOPE_ID (never gated by navigation);
 * the /stack entry binds them to `routeScopeId(useRoute().key)`.
 *
 * Semantics (see AGENTS.md):
 *  - useScopedDeferredMount is a sticky latch: once ready it never resets for
 *    the component's lifetime; only unmount/remount resets it.
 *  - A still-pending task scheduled by a hook is cancelled on unmount —
 *    cancelled-before-start tasks must never run (Invariant B).
 *  - useScopedAfterTransition('every-focus') re-arms on each focusEpoch
 *    increase for route scopes; for non-route scopes it behaves like 'once'.
 *  - Latest callback wins via a ref, so inline callbacks never reschedule and
 *    never go stale. Errors are routed to options.onError and never break
 *    the queue.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { routeKeyFromScope, type ScopeId, type TaskHandle } from '../core/types';
import type {
  AfterTransitionOptions,
  DeferredMountOptions,
  IdleTaskOptions,
  TaskCallback,
} from '../types';
import { useSmoothTask } from './SmoothTaskContext';

// Unique dedupe keys per hook instance — the scheduler's "latest wins" dedupe
// then applies within one hook instance only (never across components).
let instanceCounter = 0;
function nextInstanceKey(prefix: string): string {
  instanceCounter += 1;
  return `react-hook:${prefix}:${instanceCounter}`;
}

/**
 * Returns true once the deferred-mount task for `scopeId` has run.
 * Sticky: stays true through blur/refocus for the component's lifetime.
 */
export function useScopedDeferredMount(
  scopeId: ScopeId,
  options?: DeferredMountOptions,
  hookName = 'useDeferredMount'
): boolean {
  const { scheduler } = useSmoothTask(hookName);
  const [ready, setReady] = useState(false);
  const scheduling = options?.scheduling ?? 'transition';

  useEffect(() => {
    if (ready) return undefined; // sticky latch — never reschedule once ready
    const handle = scheduler.schedule(scopeId, () => setReady(true), {
      scheduling,
      priority: 'user-visible',
    });
    // Invariant B: a still-pending task must never run after unmount.
    return () => handle.cancel();
  }, [scheduler, scopeId, scheduling, ready]);

  return ready;
}

/**
 * Runs `callback` when `scopeId` becomes eligible.
 *  - mode 'once' (default): a single run.
 *  - mode 'every-focus': a fresh task each time the route's focusEpoch
 *    increases (route scopes only; behaves like 'once' otherwise).
 */
export function useScopedAfterTransition(
  scopeId: ScopeId,
  callback: TaskCallback,
  options?: AfterTransitionOptions,
  hookName = 'useAfterTransition'
): void {
  const { scheduler, coordinator } = useSmoothTask(hookName);

  // Latest callback + options via refs: inline props never reschedule.
  // Written in the commit phase so external dispatches always see the latest.
  const callbackRef = useRef(callback);
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    callbackRef.current = callback;
    optionsRef.current = options;
  });

  const mode = options?.mode ?? 'once';
  const keyRef = useRef('');

  useEffect(() => {
    if (keyRef.current === '') keyRef.current = nextInstanceKey('after-transition');
    const dedupeKey = keyRef.current;
    let current: TaskHandle | null = null;
    const scheduleFresh = () => {
      current = scheduler.schedule(scopeId, (signal) => callbackRef.current(signal), {
        // same dedupe key on every re-arm: a still-pending previous task is
        // cancelled so the callback can only ever run once per focus epoch
        key: dedupeKey,
        scheduling: optionsRef.current?.scheduling ?? 'transition',
        onError: (error) => {
          try {
            optionsRef.current?.onError?.(error);
          } catch {
            // onError must never break anything
          }
        },
      });
    };

    const routeKey = routeKeyFromScope(scopeId);
    if (mode !== 'every-focus' || routeKey === null) {
      // 'once' (or every-focus on a non-route scope): a single arm.
      scheduleFresh();
      return () => current?.cancel();
    }

    // every-focus on a route scope: the focus-epoch watcher owns the arms —
    // one per epoch. Only arm immediately when the route is already inside a
    // focused epoch (epoch > 0); arming unconditionally would double-fire for
    // the epoch that arrives after mount (the mount arm plus the epoch bump).
    let lastEpoch = coordinator.getRouteStatus(routeKey).focusEpoch;
    if (lastEpoch > 0) scheduleFresh();
    const unsubscribe = coordinator.subscribe(() => {
      const epoch = coordinator.getRouteStatus(routeKey).focusEpoch;
      if (epoch > lastEpoch) {
        lastEpoch = epoch;
        scheduleFresh();
      }
    });
    return () => {
      unsubscribe();
      current?.cancel();
    };
  }, [scheduler, coordinator, scopeId, mode]);
}

/**
 * Returns a stable `scheduleIdle(callback, options?)` function. Tasks default
 * to priority 'background' + scheduling 'idle'. All tasks created through the
 * returned function are tracked and cancelled on unmount; calling
 * `handle.cancel()` removes a task from the tracked set.
 */
export function useScopedIdleTask(
  scopeId: ScopeId,
  hookName = 'useIdleTask'
): (callback: TaskCallback, options?: IdleTaskOptions) => TaskHandle {
  const { scheduler } = useSmoothTask(hookName);
  const handlesRef = useRef<Set<TaskHandle>>(new Set());
  // scope+key → tracked handle for PENDING keyed tasks. The scheduler's
  // dedupe cancels a superseded pending task without notifying the hook, so
  // the hook mirrors it: scheduling with an already-pending key retires the
  // previous tracked handle instead of letting it linger forever.
  const pendingByKeyRef = useRef<Map<string, TaskHandle>>(new Map());

  // Cancel everything still outstanding when the component unmounts.
  useEffect(() => {
    const handles = handlesRef.current;
    const pendingByKey = pendingByKeyRef.current;
    return () => {
      for (const handle of [...handles]) {
        try {
          handle.cancel();
        } catch {
          // cancellation must never break unmount
        }
      }
      handles.clear();
      pendingByKey.clear();
    };
  }, []);

  return useCallback(
    (callback: TaskCallback, options?: IdleTaskOptions): TaskHandle => {
      const key = options?.key;
      // Same scope+key pairing the scheduler's dedupe index uses.
      const dedupeKey = key !== undefined ? JSON.stringify([scopeId, key]) : undefined;
      if (dedupeKey !== undefined) pendingByKeyRef.current.get(dedupeKey)?.cancel();
      // Settled tasks (completed/failed/cancelled) must not linger in the
      // tracked set — on a long-lived screen it would grow with every task
      // ever scheduled. `finished` also guards the sync-settle case where
      // the callback ran before the handle could be tracked.
      let finished = false;
      const tracked: TaskHandle = {
        cancel: () => {
          inner.cancel();
          if (dedupeKey !== undefined && pendingByKeyRef.current.get(dedupeKey) === tracked) {
            pendingByKeyRef.current.delete(dedupeKey);
          }
          handlesRef.current.delete(tracked);
        },
      };
      const finish = (): void => {
        finished = true;
        if (dedupeKey !== undefined && pendingByKeyRef.current.get(dedupeKey) === tracked) {
          pendingByKeyRef.current.delete(dedupeKey);
        }
        handlesRef.current.delete(tracked);
      };
      const inner = scheduler.schedule(
        scopeId,
        (signal) => {
          // Running tasks are never deduped (scheduler semantics) — the
          // mirror index only tracks pending tasks.
          if (dedupeKey !== undefined && pendingByKeyRef.current.get(dedupeKey) === tracked) {
            pendingByKeyRef.current.delete(dedupeKey);
          }
          // Scheduler-side cancels (dedupe, scope release, dispose) abort
          // the signal without the callback settling — untrack those too.
          signal.addEventListener('abort', finish, { once: true });
          let result: void | Promise<void>;
          try {
            result = callback(signal);
          } catch (error) {
            finish();
            throw error;
          }
          if (result != null && typeof result.then === 'function') {
            result.then(finish, finish);
          } else {
            finish();
          }
          return result;
        },
        {
          scheduling: 'idle',
          priority: options?.priority ?? 'background',
          ...(options?.key !== undefined ? { key: options.key } : {}),
        }
      );
      if (!finished) {
        handlesRef.current.add(tracked);
        if (dedupeKey !== undefined) pendingByKeyRef.current.set(dedupeKey, tracked);
      }
      return tracked;
    },
    [scheduler, scopeId]
  );
}
