/**
 * react-native-smooth-task — public API types.
 *
 * LOCKED CONTRACT — orchestrator-owned. Implementation agents must not
 * change these signatures without updating every consumer.
 */

/** How a scheduled task waits before executing. */
export type SchedulingMode = 'transition' | 'idle';

/** Priority of a scheduled task. `user-visible` runs before `background`. */
export type TaskPriority = 'user-visible' | 'background';

/** Options for `useDeferredMount`. */
export interface DeferredMountOptions {
  /** Defaults to `'transition'`. */
  scheduling?: SchedulingMode;
}

/** Options for `useAfterTransition`. */
export interface AfterTransitionOptions {
  /**
   * `once`: run the first time the scope becomes eligible.
   * `every-focus`: run once per focus epoch (route-scoped usage only).
   * Defaults to `'once'`.
   */
  mode?: 'once' | 'every-focus';
  /** Defaults to `'transition'`. */
  scheduling?: SchedulingMode;
  /** Called when the callback throws or rejects. Queue is never broken. */
  onError?: (error: unknown) => void;
}

/** Options for a task scheduled via `useIdleTask`. */
export interface IdleTaskOptions {
  /**
   * Dedupe key. Scheduling a task with a key that is already pending in the
   * same scope cancels the previous pending task ("latest wins").
   */
  key?: string;
  /** Defaults to `'background'`. */
  priority?: TaskPriority;
}

/** Handle returned for a scheduled task. Cancellation is cooperative. */
export interface TaskHandle {
  /** Abort the task signal and prevent it from starting if still pending. */
  cancel(): void;
}

/**
 * Callback signature for scheduled work. Receives an AbortSignal that is
 * aborted when the task is cancelled before start or while running.
 */
export type TaskCallback = (signal: AbortSignal) => void | Promise<void>;
