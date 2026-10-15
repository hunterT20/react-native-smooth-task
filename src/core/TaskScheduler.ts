/**
 * Transition-aware task scheduler.
 *
 * Two execution paths share one pending queue:
 *
 * - 'transition' tasks are started by drain turns: a synchronous pass on
 *   every schedule() and every gate broadcast, starting at most
 *   `maxTasksPerTurn` tasks per turn; leftover eligible work continues in
 *   the next macrotask via `timerHost.setTimeout(cb, 0)`.
 * - 'idle' tasks only run inside `idleHost` callbacks. While eligible idle
 *   work exists the scheduler keeps exactly one outstanding idle request;
 *   each idle callback starts at most one task, then re-requests.
 *
 * Invariants:
 *  A) A task only starts while `gate.isEligible(scopeId)` — re-checked
 *     immediately before the callback is invoked.
 *  B) A task cancelled before start never runs — `signal.aborted` is
 *     re-checked at the last moment.
 *
 * Errors never break the queue: sync throws / async rejections mark the
 * task 'failed', fire `onError` and emit a `task-failed` diagnostic.
 */

import type {
  ScopeId,
  ScheduleTaskOptions,
  SchedulingMode,
  TaskCallback,
  TaskHandle,
  TaskPriority,
  TaskScheduler,
  TaskSchedulerDeps,
  TaskStatus,
  TimerHost,
} from './types';
import { createDefaultTimerHost } from './Hosts';

const DEFAULT_MAX_TASKS_PER_TURN = 8;

/** Global pick order — user-visible tasks (both modes) before background. */
const PRIORITY_ORDER: readonly TaskPriority[] = ['user-visible', 'background'];

interface ScheduledTask {
  readonly id: number;
  readonly scopeId: ScopeId;
  readonly key: string | undefined;
  readonly priority: TaskPriority;
  readonly scheduling: SchedulingMode;
  readonly callback: TaskCallback;
  readonly onError: ((error: unknown) => void) | undefined;
  readonly controller: AbortController;
  status: TaskStatus;
}

export function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler {
  const gate = deps.gate;
  const idleHost = deps.idleHost;
  const timerHost: TimerHost = deps.timerHost ?? createDefaultTimerHost();
  const diagnostics = deps.diagnostics;
  const maxTasksPerTurn = deps.maxTasksPerTurn ?? DEFAULT_MAX_TASKS_PER_TURN;

  /** Live tasks (pending or running), insertion-ordered for FIFO picks. */
  const liveTasks = new Map<number, ScheduledTask>();
  /** Dedupe index for PENDING tasks only: scope+key → task id. */
  const pendingKeys = new Map<string, number>();

  let nextTaskId = 1;
  let disposed = false;

  // Transition drain state.
  let draining = false;
  let drainDirty = false;
  let continuationHandle: unknown = null;

  // Idle state: at most one outstanding idle request, or null.
  let idleHandle: number | null = null;

  function emitTaskEvent(code: string, task: ScheduledTask, error?: unknown): void {
    if (!diagnostics) return;
    const details: Record<string, unknown> = {
      taskId: task.id,
      key: task.key,
      priority: task.priority,
      scheduling: task.scheduling,
    };
    if (code === 'task-failed') details.error = error;
    try {
      diagnostics.emit({
        level: code === 'task-failed' ? 'error' : 'debug',
        code,
        message: `${code}: task ${task.id} in scope '${task.scopeId}'`,
        scopeId: task.scopeId,
        details,
        timestamp: timerHost.now(),
      });
    } catch {
      // A misbehaving sink must never break the queue.
    }
  }

  /** Dedupe index key — scope-scoped, mode-agnostic ("latest wins"). */
  function dedupeKey(scopeId: ScopeId, key: string): string {
    return JSON.stringify([scopeId, key]);
  }

  function forgetPendingKey(task: ScheduledTask): void {
    if (task.key !== undefined && pendingKeys.get(dedupeKey(task.scopeId, task.key)) === task.id) {
      pendingKeys.delete(dedupeKey(task.scopeId, task.key));
    }
  }

  /** Pending, not aborted, and currently eligible. */
  function isStartable(task: ScheduledTask): boolean {
    return (
      task.status === 'pending' && !task.controller.signal.aborted && gate.isEligible(task.scopeId)
    );
  }

  function hasEligiblePending(scheduling: SchedulingMode): boolean {
    for (const task of liveTasks.values()) {
      if (task.scheduling === scheduling && isStartable(task)) return true;
    }
    return false;
  }

  /** Highest-priority eligible pending task of a mode; FIFO within class. */
  function pickNext(scheduling: SchedulingMode): ScheduledTask | null {
    for (const priority of PRIORITY_ORDER) {
      for (const task of liveTasks.values()) {
        if (task.scheduling === scheduling && task.priority === priority && isStartable(task)) {
          return task;
        }
      }
    }
    return null;
  }

  function cancelTask(task: ScheduledTask): void {
    if (task.status !== 'pending' && task.status !== 'running') return;
    forgetPendingKey(task);
    liveTasks.delete(task.id);
    task.status = 'cancelled';
    task.controller.abort();
    emitTaskEvent('task-cancelled', task);
    syncIdleRequest();
  }

  function settleCompleted(task: ScheduledTask): void {
    if (task.status !== 'running') return; // cancelled while running
    task.status = 'completed';
    liveTasks.delete(task.id);
    emitTaskEvent('task-completed', task);
  }

  function settleFailed(task: ScheduledTask, error: unknown): void {
    if (task.status !== 'running') return; // cancelled while running — swallow
    task.status = 'failed';
    liveTasks.delete(task.id);
    emitTaskEvent('task-failed', task, error);
    if (task.onError) {
      try {
        task.onError(error);
      } catch {
        // onError must never break the queue.
      }
    }
  }

  /**
   * Last-moment revalidation, then invoke the callback. Returns true when
   * the task actually started.
   */
  function startTask(task: ScheduledTask): boolean {
    // Invariant B: cancelled at the last moment must never run.
    if (task.status !== 'pending' || task.controller.signal.aborted) return false;
    // Invariant A: eligibility re-checked immediately before execution.
    if (!gate.isEligible(task.scopeId)) return false;

    task.status = 'running';
    forgetPendingKey(task);
    emitTaskEvent('task-started', task);

    let result: void | Promise<void>;
    try {
      result = task.callback(task.controller.signal);
    } catch (error) {
      settleFailed(task, error);
      return true;
    }
    if (result != null && typeof result.then === 'function') {
      result.then(
        () => settleCompleted(task),
        (rejection: unknown) => settleFailed(task, rejection)
      );
    } else {
      settleCompleted(task);
    }
    return true;
  }

  // --- transition drain -------------------------------------------------

  /** One drain turn: start at most `budget` eligible tasks; returns count. */
  function runTurn(budget: number): number {
    let started = 0;
    while (started < budget) {
      const task = pickNext('transition');
      if (task === null || !startTask(task)) break;
      started += 1;
    }
    return started;
  }

  /** Queue a macrotask continuation while eligible transition work remains. */
  function ensureContinuation(): void {
    if (disposed || continuationHandle !== null) return;
    if (!hasEligiblePending('transition')) return;
    continuationHandle = timerHost.setTimeout(() => {
      continuationHandle = null;
      drainTransitionTasks();
    }, 0);
  }

  function drainTransitionTasks(): void {
    if (disposed) return;
    if (draining) {
      // schedule()/broadcast inside a running callback must not recurse —
      // mark dirty; the outer loop continues within the SAME budget.
      drainDirty = true;
      return;
    }
    draining = true;
    try {
      // The turn budget applies to the whole drain, reentrant turns
      // included — otherwise a callback that keeps scheduling would run
      // unbounded work in one call stack. Leftover dirty work continues
      // through the macrotask continuation below.
      let started = 0;
      do {
        drainDirty = false;
        started += runTurn(maxTasksPerTurn - started);
      } while (drainDirty && started < maxTasksPerTurn);
    } finally {
      draining = false;
    }
    ensureContinuation();
  }

  // --- idle pump ---------------------------------------------------------

  /**
   * Keep exactly one outstanding idle request while eligible idle work
   * exists; cancel it when eligibility (or the work) is gone.
   */
  function syncIdleRequest(): void {
    if (disposed) return;
    if (hasEligiblePending('idle')) {
      if (idleHandle === null) {
        idleHandle = idleHost.request(onIdleDeadline);
      }
    } else if (idleHandle !== null) {
      idleHost.cancel(idleHandle);
      idleHandle = null;
    }
  }

  /** Idle callback: revalidate, run at most one task, then re-request. */
  function onIdleDeadline(): void {
    idleHandle = null;
    if (disposed) return;
    const task = pickNext('idle');
    if (task !== null) startTask(task);
    syncIdleRequest();
  }

  // --- gate --------------------------------------------------------------

  /** Broadcast: eligibility may have changed for any scope — revalidate. */
  function onGateBroadcast(): void {
    if (disposed) return;
    drainTransitionTasks();
    syncIdleRequest();
  }

  const unsubscribeGate = gate.subscribe(onGateBroadcast);

  // --- public API ---------------------------------------------------------

  function schedule(
    scopeId: ScopeId,
    callback: TaskCallback,
    options?: ScheduleTaskOptions
  ): TaskHandle {
    const task: ScheduledTask = {
      id: nextTaskId++,
      scopeId,
      key: options?.key,
      priority: options?.priority ?? 'background',
      scheduling: options?.scheduling ?? 'transition',
      callback,
      onError: options?.onError,
      controller: new AbortController(),
      status: 'pending',
    };

    // Dedupe: a pending task with the same scope+key is cancelled —
    // latest wins. Running tasks are never deduped.
    if (task.key !== undefined) {
      const indexKey = dedupeKey(scopeId, task.key);
      const previousId = pendingKeys.get(indexKey);
      if (previousId !== undefined) {
        const previous = liveTasks.get(previousId);
        if (previous !== undefined) cancelTask(previous);
      }
      pendingKeys.set(indexKey, task.id);
    }

    liveTasks.set(task.id, task);
    emitTaskEvent('task-scheduled', task);

    if (disposed) {
      cancelTask(task);
    } else {
      drainTransitionTasks();
      syncIdleRequest();
    }

    return {
      cancel: () => cancelTask(task),
    };
  }

  function cancelScope(scopeId: ScopeId): void {
    for (const task of [...liveTasks.values()]) {
      if (task.scopeId === scopeId) cancelTask(task);
    }
  }

  function releaseScope(scopeId: ScopeId): void {
    // Cancelling drops a task from every index, so once scope tasks are
    // gone no per-scope bookkeeping remains.
    cancelScope(scopeId);
  }

  function getPendingCount(scopeId?: ScopeId): number {
    let count = 0;
    for (const task of liveTasks.values()) {
      if (task.status === 'pending' && (scopeId === undefined || task.scopeId === scopeId)) {
        count += 1;
      }
    }
    return count;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    unsubscribeGate();
    for (const task of [...liveTasks.values()]) {
      cancelTask(task);
    }
    if (continuationHandle !== null) {
      timerHost.clearTimeout(continuationHandle);
      continuationHandle = null;
    }
    if (idleHandle !== null) {
      idleHost.cancel(idleHandle);
      idleHandle = null;
    }
  }

  return { schedule, cancelScope, releaseScope, getPendingCount, dispose };
}
