/**
 * Core scheduler contracts — LOCKED.
 *
 * The core module is pure TypeScript: it must not import react, react-native
 * or @react-navigation. This keeps it testable in isolation and reusable
 * behind future navigation adapters.
 */

import type { DiagnosticsSink } from '../diagnostics/types';
import type {
  IdleTaskOptions,
  SchedulingMode,
  TaskCallback,
  TaskHandle,
  TaskPriority,
} from '../types';

export type { TaskCallback, TaskHandle, TaskPriority, SchedulingMode, IdleTaskOptions };

/** Opaque scope identifier. */
export type ScopeId = string;

/** Scope for tasks tied to a navigation route. */
export const routeScopeId = (routeKey: string): ScopeId => `route:${routeKey}`;

/** Scope for app-level tasks; never blocked by navigation transitions. */
export const APP_SCOPE_ID: ScopeId = 'app';

/** True when the scope is a route scope (`route:*`). */
export const isRouteScope = (scopeId: ScopeId): boolean => scopeId.startsWith('route:');

/** Route key extracted from a route scope id, or null for app scopes. */
export const routeKeyFromScope = (scopeId: ScopeId): string | null =>
  isRouteScope(scopeId) ? scopeId.slice('route:'.length) : null;

/** Task lifecycle states. */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Decides whether tasks in a scope may start.
 * Implemented by the navigation coordinator; the scheduler only reads it.
 */
export interface EligibilityGate {
  /** Current eligibility snapshot for a scope. */
  isEligible(scopeId: ScopeId): boolean;
  /**
   * Broadcast subscription — called whenever ANY input that may affect
   * eligibility changes (nav state, barriers, app state). The scheduler
   * revalidates pending tasks on every notification.
   */
  subscribe(listener: () => void): () => void;
}

/** Minimal deadline passed to idle callbacks. */
export interface IdleDeadline {
  didTimeout: boolean;
  timeRemaining(): number;
}

export type IdleCallback = (deadline: IdleDeadline) => void;

/** Abstraction over requestIdleCallback so tests can drive it manually. */
export interface IdleHost {
  request(callback: IdleCallback): number;
  cancel(handle: number): void;
}

/** Time/scheduling primitives, injectable for deterministic tests. */
export interface TimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface ScheduleTaskOptions {
  /** Dedupe key — latest pending task with same scope+key wins. */
  key?: string;
  /** Defaults to `'background'`. */
  priority?: TaskPriority;
  /** Defaults to `'transition'`. */
  scheduling?: SchedulingMode;
  /** Called when the callback throws or rejects. */
  onError?: (error: unknown) => void;
}

export interface TaskScheduler {
  /**
   * Enqueue a task. The task starts only while `gate.isEligible(scopeId)` is
   * true; eligibility is re-checked immediately before execution.
   */
  schedule(scopeId: ScopeId, callback: TaskCallback, options?: ScheduleTaskOptions): TaskHandle;
  /** Cancel all pending + running (abort signal) tasks of a scope. */
  cancelScope(scopeId: ScopeId): void;
  /** Cancel scope tasks and drop all bookkeeping for the scope. */
  releaseScope(scopeId: ScopeId): void;
  /** Count of pending tasks (optionally per scope). */
  getPendingCount(scopeId?: ScopeId): number;
  /** Tear down subscriptions and cancel everything. */
  dispose(): void;
}

export interface TaskSchedulerDeps {
  gate: EligibilityGate;
  idleHost: IdleHost;
  /** Defaults to a host backed by global timers. */
  timerHost?: TimerHost;
  diagnostics?: DiagnosticsSink;
  /**
   * Max tasks started in one scheduling turn before yielding to the next
   * macrotask. Prevents draining dozens of sync callbacks in a single frame.
   * Defaults to 8.
   */
  maxTasksPerTurn?: number;
}

/** Factory — implemented in TaskScheduler.ts. */
export declare function createTaskScheduler(deps: TaskSchedulerDeps): TaskScheduler;

/** Default requestIdleCallback adapter with setTimeout fallback. */
export declare function createDefaultIdleHost(): IdleHost;

/** Default TimerHost backed by globalThis timers. */
export declare function createDefaultTimerHost(): TimerHost;

/** Gate that reports every scope as eligible — standalone app-scope usage. */
export declare function createOpenGate(): EligibilityGate;
