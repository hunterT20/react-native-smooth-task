import { createDefaultIdleHost } from '../../../src/core/IdleHost';
import { createDefaultTimerHost, createOpenGate } from '../../../src/core/Hosts';
import type { IdleDeadline } from '../../../src/core/types';

describe('createOpenGate', () => {
  it('reports every scope eligible and never fires subscribers', () => {
    const gate = createOpenGate();
    expect(gate.isEligible('app')).toBe(true);
    expect(gate.isEligible('route:anything')).toBe(true);

    const listener = jest.fn();
    const unsubscribe = gate.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow(); // idempotent noop
  });
});

describe('createDefaultTimerHost', () => {
  it('schedules callbacks on the global timers', async () => {
    const host = createDefaultTimerHost();
    const cb = jest.fn();
    host.setTimeout(cb, 0);
    expect(cb).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('clears a scheduled callback', async () => {
    const host = createDefaultTimerHost();
    const cb = jest.fn();
    const handle = host.setTimeout(cb, 0);
    host.clearTimeout(handle);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cb).not.toHaveBeenCalled();
  });

  it('now() returns a finite wall-clock timestamp', () => {
    const host = createDefaultTimerHost();
    const value = host.now();
    expect(Number.isFinite(value)).toBe(true);
    expect(Math.abs(value - Date.now())).toBeLessThan(1000);
  });
});

describe('createDefaultIdleHost', () => {
  const g = globalThis as Record<string, unknown>;
  let savedRequest: unknown;
  let savedCancel: unknown;

  beforeEach(() => {
    savedRequest = g.requestIdleCallback;
    savedCancel = g.cancelIdleCallback;
  });

  afterEach(() => {
    if (savedRequest === undefined) {
      delete g.requestIdleCallback;
    } else {
      g.requestIdleCallback = savedRequest;
    }
    if (savedCancel === undefined) {
      delete g.cancelIdleCallback;
    } else {
      g.cancelIdleCallback = savedCancel;
    }
  });

  it('delegates to requestIdleCallback/cancelIdleCallback when present', () => {
    const pending = new Map<number, (deadline: IdleDeadline) => void>();
    let nextHandle = 42;
    const cancelled: number[] = [];

    g.requestIdleCallback = (cb: (deadline: IdleDeadline) => void) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    };
    g.cancelIdleCallback = (handle: number) => {
      cancelled.push(handle);
      pending.delete(handle);
    };

    const host = createDefaultIdleHost();
    const cb = jest.fn();
    const handle = host.request(cb);
    expect(handle).toBe(42);

    const fire = pending.get(42);
    fire?.({ didTimeout: true, timeRemaining: () => 7 });
    expect(cb).toHaveBeenCalledTimes(1);

    host.cancel(handle);
    expect(cancelled).toEqual([42]);
  });

  it('falls back to setTimeout with a synthetic 50ms-budget deadline', async () => {
    delete g.requestIdleCallback;
    delete g.cancelIdleCallback;

    const host = createDefaultIdleHost();
    const cb = jest.fn();
    host.request(cb);
    expect(cb).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cb).toHaveBeenCalledTimes(1);

    const deadline = cb.mock.calls[0]?.[0] as IdleDeadline;
    expect(deadline.didTimeout).toBe(false);
    const remaining = deadline.timeRemaining();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(50);
  });

  it('cancel() prevents the fallback callback from firing', async () => {
    delete g.requestIdleCallback;
    delete g.cancelIdleCallback;

    const host = createDefaultIdleHost();
    const cb = jest.fn();
    const handle = host.request(cb);
    host.cancel(handle);

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cb).not.toHaveBeenCalled();
  });

  it('treats non-function globals as absent and uses the fallback', async () => {
    g.requestIdleCallback = 'not a function';
    g.cancelIdleCallback = 123;

    const host = createDefaultIdleHost();
    const cb = jest.fn();
    host.request(cb);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
