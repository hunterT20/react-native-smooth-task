/**
 * Injected host fakes for core scheduler tests — fully manual, no real
 * timers involved.
 */

import type {
  EligibilityGate,
  IdleCallback,
  IdleDeadline,
  IdleHost,
  TimerHost,
} from '../../../src/core/types';

/**
 * Manual eligibility gate. Tests flip scopes with `set()` and broadcast
 * with `notify()` — like a nav-state/barrier/app-state change would.
 */
export class ManualGate implements EligibilityGate {
  private readonly eligible = new Map<string, boolean>();
  private readonly listeners = new Set<() => void>();
  private readonly defaultValue: boolean;

  /** `defaultEligible` applies to scopes never passed to `set()`. */
  constructor(defaultEligible = false) {
    this.defaultValue = defaultEligible;
  }

  set(scopeId: string, value: boolean): void {
    this.eligible.set(scopeId, value);
  }

  isEligible = (scopeId: string): boolean => this.eligible.get(scopeId) ?? this.defaultValue;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Fire every subscriber — the contract's broadcast channel. */
  notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}

/** Manual TimerHost — `tick()` runs everything queued so far. */
export class ManualTimerHost implements TimerHost {
  private readonly queue = new Map<number, () => void>();
  private nextHandle = 1;
  private currentTime = 1000;

  setTimeout = (callback: () => void, _ms: number): unknown => {
    const handle = this.nextHandle++;
    this.queue.set(handle, callback);
    return handle;
  };

  clearTimeout = (handle: unknown): void => {
    this.queue.delete(handle as number);
  };

  now = (): number => this.currentTime;

  advance(ms: number): void {
    this.currentTime += ms;
  }

  /**
   * Run all callbacks queued so far, in request order. Callbacks queued
   * during a tick wait for the next one — like real macrotasks.
   */
  tick(): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const callback of callbacks) {
      callback();
    }
  }

  get pendingCount(): number {
    return this.queue.size;
  }
}

export function makeDeadline(overrides?: Partial<IdleDeadline>): IdleDeadline {
  return { didTimeout: false, timeRemaining: () => 50, ...overrides };
}

/**
 * Manual IdleHost — `flush()` fires every outstanding request once.
 * Requests made during a flush wait for the next flush.
 */
export class ManualIdleHost implements IdleHost {
  private readonly queue = new Map<number, IdleCallback>();
  private nextHandle = 1;

  request = (callback: IdleCallback): number => {
    const handle = this.nextHandle++;
    this.queue.set(handle, callback);
    return handle;
  };

  cancel = (handle: number): void => {
    this.queue.delete(handle);
  };

  get pendingCount(): number {
    return this.queue.size;
  }

  flush(deadline: IdleDeadline = makeDeadline()): void {
    const callbacks = [...this.queue.values()];
    this.queue.clear();
    for (const callback of callbacks) {
      callback(deadline);
    }
  }
}

/** Flush pending promise continuations. */
export const flushAsync = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
