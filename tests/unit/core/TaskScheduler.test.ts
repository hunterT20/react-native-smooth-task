import { createTaskScheduler } from '../../../src/core/TaskScheduler';
import type { TaskScheduler, TaskSchedulerDeps } from '../../../src/core/types';
import { createDiagnosticsCollector } from '../../../src/diagnostics/Diagnostics';
import type { DiagnosticsCollector } from '../../../src/diagnostics/types';
import { ManualGate, ManualIdleHost, ManualTimerHost, flushAsync } from './fakes';

const SCOPE_A = 'route:a';
const SCOPE_B = 'route:b';

interface Harness {
  gate: ManualGate;
  idleHost: ManualIdleHost;
  timerHost: ManualTimerHost;
  diagnostics: DiagnosticsCollector;
  scheduler: TaskScheduler;
}

function setup(deps?: Partial<TaskSchedulerDeps>): Harness {
  const gate = new ManualGate(false);
  const idleHost = new ManualIdleHost();
  const timerHost = new ManualTimerHost();
  const diagnostics = createDiagnosticsCollector();
  const scheduler = createTaskScheduler({
    gate,
    idleHost,
    timerHost,
    diagnostics,
    ...deps,
  });
  return { gate, idleHost, timerHost, diagnostics, scheduler };
}

describe('eligibility (Invariant A)', () => {
  it('runs an eligible transition task synchronously on schedule', () => {
    const { gate, scheduler } = setup();
    gate.set(SCOPE_A, true);

    let signal: AbortSignal | undefined;
    const cb = jest.fn((s: AbortSignal) => {
      signal = s;
    });
    scheduler.schedule(SCOPE_A, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    expect(scheduler.getPendingCount()).toBe(0);
  });

  it('keeps an ineligible task pending and never calls it mid-transition', () => {
    const { gate, scheduler } = setup();
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb);

    expect(cb).not.toHaveBeenCalled();
    expect(scheduler.getPendingCount(SCOPE_A)).toBe(1);

    // Broadcast while still closed — must not start.
    gate.notify();
    expect(cb).not.toHaveBeenCalled();
  });

  it('starts a pending task when the gate opens and broadcasts', () => {
    const { gate, scheduler } = setup();
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb);
    expect(cb).not.toHaveBeenCalled();

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('revalidates eligibility mid-drain when a callback closes a scope', () => {
    const { gate, scheduler } = setup();
    const order: string[] = [];

    // Both start pending while gates are closed.
    scheduler.schedule(SCOPE_A, () => {
      order.push('A');
      gate.set(SCOPE_B, false); // slam the gate on B mid-drain
    });
    scheduler.schedule(SCOPE_B, () => {
      order.push('B');
    });

    gate.set(SCOPE_A, true);
    gate.set(SCOPE_B, true);
    gate.notify();

    expect(order).toEqual(['A']);
    expect(scheduler.getPendingCount(SCOPE_B)).toBe(1);

    gate.set(SCOPE_B, true);
    gate.notify();
    expect(order).toEqual(['A', 'B']);
  });
});

describe('cancellation (Invariant B)', () => {
  it('never runs a task cancelled before start, even after the gate opens', () => {
    const { gate, scheduler } = setup();
    const cb = jest.fn();
    const handle = scheduler.schedule(SCOPE_A, cb);

    handle.cancel();
    expect(scheduler.getPendingCount(SCOPE_A)).toBe(0);

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(cb).not.toHaveBeenCalled();
  });

  it('handle.cancel() aborts a running async task and swallows its late settle', async () => {
    const { gate, scheduler, diagnostics } = setup();
    gate.set(SCOPE_A, true);

    let signal: AbortSignal | undefined;
    let resolveTask: (() => void) | undefined;
    const taskHandle = scheduler.schedule(SCOPE_A, (s) => {
      signal = s;
      return new Promise<void>((resolve) => {
        resolveTask = resolve;
      });
    });

    taskHandle.cancel();
    expect(signal?.aborted).toBe(true);

    resolveTask?.();
    await flushAsync();

    const codes = diagnostics.events.map((e) => e.code);
    expect(codes).toContain('task-cancelled');
    expect(codes).not.toContain('task-completed');
  });

  it('cancelScope aborts pending + running tasks of that scope only', async () => {
    const { gate, scheduler } = setup();
    gate.set(SCOPE_A, true); // A eligible, B not

    let signalA: AbortSignal | undefined;
    scheduler.schedule(SCOPE_A, (s) => {
      signalA = s;
      return new Promise<void>(() => undefined); // stays running
    });
    const pendingB = jest.fn();
    scheduler.schedule(SCOPE_B, pendingB);

    scheduler.cancelScope(SCOPE_A);
    expect(signalA?.aborted).toBe(true);
    // B's pending task belongs to another scope — untouched.
    expect(scheduler.getPendingCount(SCOPE_B)).toBe(1);

    scheduler.cancelScope(SCOPE_B);
    expect(scheduler.getPendingCount()).toBe(0);

    gate.set(SCOPE_B, true);
    gate.notify();
    expect(pendingB).not.toHaveBeenCalled();
  });

  it('releaseScope cancels everything pending in the scope', () => {
    const { gate, scheduler } = setup();
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb);
    scheduler.releaseScope(SCOPE_A);
    expect(scheduler.getPendingCount(SCOPE_A)).toBe(0);

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(cb).not.toHaveBeenCalled();
  });

  it('dispose() cancels everything, unsubscribes the gate, and ignores later work', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const transitionCb = jest.fn();
    const idleCb = jest.fn();
    scheduler.schedule(SCOPE_B, transitionCb); // pending (B closed)
    scheduler.schedule(SCOPE_B, idleCb, { scheduling: 'idle' }); // pending
    scheduler.schedule(SCOPE_A, jest.fn()); // runs immediately

    scheduler.dispose();
    expect(gate.listenerCount).toBe(0);
    expect(idleHost.pendingCount).toBe(0);
    expect(scheduler.getPendingCount()).toBe(0);

    gate.set(SCOPE_B, true);
    gate.notify();
    idleHost.flush();
    expect(transitionCb).not.toHaveBeenCalled();
    expect(idleCb).not.toHaveBeenCalled();

    // Scheduling after dispose produces a cancelled task that never runs.
    const late = jest.fn();
    scheduler.schedule(SCOPE_A, late);
    gate.notify();
    expect(late).not.toHaveBeenCalled();
  });
});

describe('dedupe (latest wins)', () => {
  it('same scope+key: the pending task is cancelled by the newer one', () => {
    const { gate, scheduler, diagnostics } = setup();
    const first = jest.fn();
    const second = jest.fn();

    scheduler.schedule(SCOPE_A, first, { key: 'k' });
    scheduler.schedule(SCOPE_A, second, { key: 'k' });

    expect(diagnostics.events.some((e) => e.code === 'task-cancelled')).toBe(true);

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('same key in different scopes does not dedupe', () => {
    const { gate, scheduler } = setup();
    gate.set(SCOPE_A, true);
    gate.set(SCOPE_B, true);

    const a = jest.fn();
    const b = jest.fn();
    scheduler.schedule(SCOPE_A, a, { key: 'k' });
    scheduler.schedule(SCOPE_B, b, { key: 'k' });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a running task is never deduped by a later same-key task', async () => {
    const { gate, scheduler } = setup();
    gate.set(SCOPE_A, true);

    let runningSignal: AbortSignal | undefined;
    let resolveRunning: (() => void) | undefined;
    scheduler.schedule(
      SCOPE_A,
      (s) => {
        runningSignal = s;
        return new Promise<void>((resolve) => {
          resolveRunning = resolve;
        });
      },
      { key: 'k' }
    );

    const next = jest.fn();
    scheduler.schedule(SCOPE_A, next, { key: 'k' });

    // The running task was not cancelled; the new one runs too.
    expect(runningSignal?.aborted).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);

    resolveRunning?.();
    await flushAsync();
  });
});

describe('priority and ordering', () => {
  it('starts user-visible tasks before background ones, across scopes', () => {
    const { gate, scheduler } = setup();
    const order: string[] = [];

    scheduler.schedule(
      SCOPE_A,
      () => {
        order.push('bg-A');
      },
      { priority: 'background' }
    );
    scheduler.schedule(
      SCOPE_B,
      () => {
        order.push('uv-B');
      },
      { priority: 'user-visible' }
    );
    scheduler.schedule(
      SCOPE_A,
      () => {
        order.push('uv-A');
      },
      { priority: 'user-visible' }
    );
    scheduler.schedule(
      SCOPE_B,
      () => {
        order.push('bg-B');
      },
      { priority: 'background' }
    );

    gate.set(SCOPE_A, true);
    gate.set(SCOPE_B, true);
    gate.notify();

    expect(order).toEqual(['uv-B', 'uv-A', 'bg-A', 'bg-B']);
  });

  it('is FIFO within a priority class', () => {
    const { gate, scheduler } = setup();
    const order: string[] = [];
    scheduler.schedule(SCOPE_A, () => {
      order.push('1');
    });
    scheduler.schedule(SCOPE_B, () => {
      order.push('2');
    });
    scheduler.schedule(SCOPE_A, () => {
      order.push('3');
    });

    gate.set(SCOPE_A, true);
    gate.set(SCOPE_B, true);
    gate.notify();

    expect(order).toEqual(['1', '2', '3']);
  });

  it('orders idle tasks by priority too', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const order: string[] = [];

    scheduler.schedule(
      SCOPE_A,
      () => {
        order.push('bg');
      },
      {
        scheduling: 'idle',
        priority: 'background',
      }
    );
    scheduler.schedule(
      SCOPE_A,
      () => {
        order.push('uv');
      },
      {
        scheduling: 'idle',
        priority: 'user-visible',
      }
    );

    idleHost.flush();
    expect(order).toEqual(['uv']);
    idleHost.flush();
    expect(order).toEqual(['uv', 'bg']);
  });
});

describe('drain turns and maxTasksPerTurn', () => {
  it('starts at most maxTasksPerTurn per turn and continues on ticks', () => {
    const { gate, scheduler, timerHost } = setup({ maxTasksPerTurn: 2 });
    const ran: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      scheduler.schedule(SCOPE_A, () => {
        ran.push(i);
      });
    }

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(ran).toEqual([0, 1]);
    expect(timerHost.pendingCount).toBe(1); // continuation queued

    timerHost.tick();
    expect(ran).toEqual([0, 1, 2, 3]);

    timerHost.tick();
    expect(ran).toEqual([0, 1, 2, 3, 4]);
    expect(timerHost.pendingCount).toBe(0);
  });

  it('defaults to 8 tasks per turn', () => {
    const { gate, scheduler, timerHost } = setup();
    let ran = 0;
    for (let i = 0; i < 10; i += 1) {
      scheduler.schedule(SCOPE_A, () => {
        ran += 1;
      });
    }
    gate.set(SCOPE_A, true);
    gate.notify();
    expect(ran).toBe(8);
    timerHost.tick();
    expect(ran).toBe(10);
  });

  it('does not recurse the drain when a callback schedules more work', () => {
    const { gate, scheduler } = setup({ maxTasksPerTurn: 2 });
    gate.set(SCOPE_A, true);
    const order: string[] = [];

    scheduler.schedule(SCOPE_A, () => {
      order.push('outer:start');
      scheduler.schedule(SCOPE_A, () => {
        order.push('inner-1');
      });
      scheduler.schedule(SCOPE_A, () => {
        order.push('inner-2');
      });
      order.push('outer:end');
    });

    // inner-1 fits the same turn (cap 2); inner-2 needs a dirty loop turn —
    // still synchronous, but strictly after the outer callback finished.
    expect(order).toEqual(['outer:start', 'outer:end', 'inner-1', 'inner-2']);
  });

  it('a queued continuation drains newly eligible tasks later', () => {
    const { gate, scheduler, timerHost } = setup({ maxTasksPerTurn: 1 });
    const ran: string[] = [];
    scheduler.schedule(SCOPE_A, () => {
      ran.push('a1');
    });
    scheduler.schedule(SCOPE_B, () => {
      ran.push('b1');
    });

    gate.set(SCOPE_A, true);
    gate.set(SCOPE_B, true);
    gate.notify();
    expect(ran).toEqual(['a1']);

    // B closes before its continuation, then reopens — must still run.
    gate.set(SCOPE_B, false);
    timerHost.tick();
    expect(ran).toEqual(['a1']);

    gate.set(SCOPE_B, true);
    gate.notify();
    timerHost.tick();
    expect(ran).toEqual(['a1', 'b1']);
  });
});

describe('idle scheduling', () => {
  it('runs idle tasks only when the idle host fires', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);

    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb, { scheduling: 'idle' });
    expect(cb).not.toHaveBeenCalled();
    expect(idleHost.pendingCount).toBe(1);

    idleHost.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not start idle tasks on gate broadcasts alone', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb, { scheduling: 'idle' });

    gate.notify();
    expect(cb).not.toHaveBeenCalled();
    idleHost.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one outstanding idle request and runs one task per callback', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const ran: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      scheduler.schedule(
        SCOPE_A,
        () => {
          ran.push(i);
        },
        { scheduling: 'idle' }
      );
    }
    expect(idleHost.pendingCount).toBe(1);
    expect(ran).toEqual([]);

    idleHost.flush();
    expect(ran).toEqual([0]);
    expect(idleHost.pendingCount).toBe(1); // re-requested

    idleHost.flush();
    idleHost.flush();
    expect(ran).toEqual([0, 1, 2]);
    expect(idleHost.pendingCount).toBe(0);
  });

  it('makes no idle request while the gate is closed, requests on open', () => {
    const { gate, scheduler, idleHost } = setup();
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb, { scheduling: 'idle' });
    expect(idleHost.pendingCount).toBe(0);

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(idleHost.pendingCount).toBe(1);

    idleHost.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('revalidates eligibility at idle-fire time when the gate closed silently', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb, { scheduling: 'idle' });
    expect(idleHost.pendingCount).toBe(1);

    gate.set(SCOPE_A, false); // no broadcast — revalidation must catch it
    idleHost.flush();
    expect(cb).not.toHaveBeenCalled();
    expect(idleHost.pendingCount).toBe(0); // nothing eligible → no re-request

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(idleHost.pendingCount).toBe(1);
    idleHost.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancels the outstanding idle request when eligibility is lost', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const cb = jest.fn();
    scheduler.schedule(SCOPE_A, cb, { scheduling: 'idle' });
    expect(idleHost.pendingCount).toBe(1);

    gate.set(SCOPE_A, false);
    gate.notify();
    expect(idleHost.pendingCount).toBe(0);

    gate.set(SCOPE_A, true);
    gate.notify();
    expect(idleHost.pendingCount).toBe(1);
    idleHost.flush();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('cancels the idle request when the pending idle task is cancelled', () => {
    const { gate, scheduler, idleHost } = setup();
    gate.set(SCOPE_A, true);
    const handle = scheduler.schedule(SCOPE_A, jest.fn(), { scheduling: 'idle' });
    expect(idleHost.pendingCount).toBe(1);

    handle.cancel();
    expect(idleHost.pendingCount).toBe(0);
  });
});

describe('error handling', () => {
  it('a sync throw marks the task failed, calls onError, and does not stop the queue', () => {
    const { gate, scheduler, diagnostics } = setup();
    gate.set(SCOPE_A, true);
    const boom = new Error('boom');
    const onError = jest.fn();

    scheduler.schedule(
      SCOPE_A,
      () => {
        throw boom;
      },
      { onError }
    );
    const after = jest.fn();
    scheduler.schedule(SCOPE_A, after);

    expect(onError).toHaveBeenCalledWith(boom);
    expect(after).toHaveBeenCalledTimes(1);

    const failed = diagnostics.events.find((e) => e.code === 'task-failed');
    expect(failed).toBeDefined();
    expect(failed?.level).toBe('error');
    expect(failed?.scopeId).toBe(SCOPE_A);
    expect(failed?.details?.error).toBe(boom);
  });

  it('an async rejection fails the task without breaking later tasks', async () => {
    const { gate, scheduler, diagnostics } = setup();
    gate.set(SCOPE_A, true);
    const boom = new Error('async boom');
    const onError = jest.fn();

    let rejectTask: ((e: unknown) => void) | undefined;
    scheduler.schedule(
      SCOPE_A,
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectTask = reject;
        }),
      { onError }
    );
    const after = jest.fn();
    scheduler.schedule(SCOPE_A, after);

    expect(after).toHaveBeenCalledTimes(1); // async task did not block

    rejectTask?.(boom);
    await flushAsync();

    expect(onError).toHaveBeenCalledWith(boom);
    expect(diagnostics.events.some((e) => e.code === 'task-failed')).toBe(true);
  });

  it('a throwing onError does not break the queue', () => {
    const { gate, scheduler } = setup();
    gate.set(SCOPE_A, true);

    scheduler.schedule(
      SCOPE_A,
      () => {
        throw new Error('task');
      },
      {
        onError: () => {
          throw new Error('onError');
        },
      }
    );
    const after = jest.fn();
    scheduler.schedule(SCOPE_A, after);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('diagnostics', () => {
  it('emits task-scheduled/started/completed with scope and details', () => {
    const { gate, scheduler, diagnostics } = setup();
    gate.set(SCOPE_A, true);

    scheduler.schedule(SCOPE_A, jest.fn(), { key: 'k', priority: 'user-visible' });

    const codes = diagnostics.events.map((e) => e.code);
    expect(codes).toEqual(['task-scheduled', 'task-started', 'task-completed']);
    for (const event of diagnostics.events) {
      expect(event.scopeId).toBe(SCOPE_A);
      expect(event.details?.priority).toBe('user-visible');
      expect(event.details?.scheduling).toBe('transition');
      expect(event.details?.key).toBe('k');
      expect(typeof event.details?.taskId).toBe('number');
    }
  });

  it('emits task-cancelled with details on cancelScope', () => {
    const { scheduler, diagnostics } = setup();
    scheduler.schedule(SCOPE_A, jest.fn(), { key: 'k' });
    scheduler.cancelScope(SCOPE_A);

    const cancelled = diagnostics.events.find((e) => e.code === 'task-cancelled');
    expect(cancelled).toBeDefined();
    expect(cancelled?.scopeId).toBe(SCOPE_A);
    expect(cancelled?.details?.key).toBe('k');
  });
});

describe('getPendingCount', () => {
  it('counts pending tasks globally and per scope', () => {
    const { gate, scheduler, idleHost } = setup();
    scheduler.schedule(SCOPE_A, jest.fn());
    scheduler.schedule(SCOPE_A, jest.fn());
    scheduler.schedule(SCOPE_B, jest.fn());
    scheduler.schedule(SCOPE_B, jest.fn(), { scheduling: 'idle' });

    expect(scheduler.getPendingCount()).toBe(4);
    expect(scheduler.getPendingCount(SCOPE_A)).toBe(2);
    expect(scheduler.getPendingCount(SCOPE_B)).toBe(2);

    // Opening B + a fresh schedule() drains its transition tasks; the idle
    // task stays pending until the idle host fires.
    gate.set(SCOPE_B, true);
    scheduler.schedule(SCOPE_B, jest.fn());

    expect(scheduler.getPendingCount(SCOPE_B)).toBe(1);
    expect(scheduler.getPendingCount()).toBe(3);

    idleHost.flush();
    expect(scheduler.getPendingCount()).toBe(2);
    expect(scheduler.getPendingCount(SCOPE_B)).toBe(0);
  });
});
