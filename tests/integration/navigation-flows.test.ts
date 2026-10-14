/**
 * Integration suite — real NavigationCoordinator + real TaskScheduler wired
 * together, driven by hand-built navigation state trees and transition
 * events (the same signals useSmoothNavigationContainer /
 * useSmoothStackListeners deliver in production).
 *
 * Maps to the plan's release test matrix (T01–T24). Device-level scenarios
 * (real gesture animations, frame drops, Detox E2E) are documented in
 * docs/testing.md — they cannot run under jest.
 *
 * Determinism: FakeTimerHost drives scheduler continuations AND coordinator
 * stall checks; ManualIdleHost drives idle tasks. Nothing here uses real
 * timers, so `timers.advance(0)` runs one macrotask turn and `advance(ms)`
 * moves the clock.
 */

import { createTaskScheduler } from '../../src/core/TaskScheduler';
import { APP_SCOPE_ID, routeScopeId } from '../../src/core/types';
import type { TaskScheduler } from '../../src/core/types';
import { createNavigationCoordinator } from '../../src/navigation/NavigationCoordinator';
import type { NavigationCoordinator } from '../../src/navigation/types';
import { ManualIdleHost, flushAsync } from '../unit/core/fakes';
import {
  FakeTimerHost,
  appTree,
  createRecordingSink,
  nav,
  route,
} from '../unit/navigation/helpers';

interface Harness {
  timers: FakeTimerHost;
  idle: ManualIdleHost;
  sink: ReturnType<typeof createRecordingSink>;
  coordinator: NavigationCoordinator;
  scheduler: TaskScheduler;
  /** Run pending macrotask turns until nothing is scheduled. */
  drain(): void;
}

function setup(options?: { maxTasksPerTurn?: number; stallWarningMs?: number }): Harness {
  const timers = new FakeTimerHost();
  const idle = new ManualIdleHost();
  const sink = createRecordingSink();
  const coordinator = createNavigationCoordinator({
    timers,
    diagnostics: sink,
    stallWarningMs: options?.stallWarningMs ?? 4000,
  });
  const scheduler = createTaskScheduler({
    gate: coordinator,
    idleHost: idle,
    timerHost: timers,
    diagnostics: sink,
    ...(options?.maxTasksPerTurn !== undefined ? { maxTasksPerTurn: options.maxTasksPerTurn } : {}),
  });
  return {
    timers,
    idle,
    sink,
    coordinator,
    scheduler,
    drain() {
      for (let i = 0; i < 20; i++) {
        if (timers.pendingCount === 0) return;
        timers.advance(0);
      }
    },
  };
}

const calls = () => {
  const order: string[] = [];
  const spy = (name: string) => () => {
    order.push(name);
  };
  return { order, spy };
};

describe('T01/T10 — initial state and deep link', () => {
  it('T01: focused route of the initial state runs tasks after settle', () => {
    const h = setup();
    const { order, spy } = calls();
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.scheduler.schedule(routeScopeId('orders-list'), spy('orders'));
    h.coordinator.setNavigationState(appTree()); // feed focused, orders tab not
    h.drain();
    expect(order).toEqual(['feed']);
    expect(order).not.toContain('orders');
  });

  it('T10: deep link delivered in a single state — no deadlock, correct route eligible', () => {
    const h = setup();
    const { order, spy } = calls();
    // Deep link lands 3 levels deep, on the focused chain only.
    h.scheduler.schedule(routeScopeId('orders-detail'), spy('detail'));
    h.scheduler.schedule(routeScopeId('orders-list'), spy('list'));
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.coordinator.setNavigationState(appTree({ tabIndex: 1, ordersIndex: 1 }));
    h.drain();
    expect(order).toEqual(['detail']);
  });
});

describe('T02/T03 — push and pop', () => {
  it('T02: push transition blocks the destination route until transitionFinished', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree());

    // Push 'home-post': state first, then transition events.
    h.coordinator.setNavigationState(appTree({ homeIndex: 1 }));
    h.coordinator.transitionStarted('home-post');
    h.scheduler.schedule(routeScopeId('home-post'), spy('post'));
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.drain();
    // Negative assertion: nothing ran while the barrier is open.
    expect(order).toEqual([]);

    h.coordinator.transitionFinished('home-post');
    h.drain();
    expect(order).toContain('post');
    // feed is no longer on the focused path — its task stays pending,
    // not "released by the barrier closing".
    expect(order).not.toContain('feed');

    // It runs only when the route refocuses (pop back).
    h.coordinator.setNavigationState(appTree({ homeIndex: 0 }));
    h.coordinator.transitionStarted('home-post');
    h.coordinator.transitionFinished('home-feed');
    h.drain();
    expect(order).toEqual(['post', 'feed']);
  });

  it('T03: pop — closing route gone before events; destination transitionFinished releases', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree({ homeIndex: 1 })); // post focused
    h.drain();

    // Pop: React Navigation dispatches the new state BEFORE events — the
    // closing route's key resolves via tombstone.
    h.coordinator.setNavigationState(appTree({ homeIndex: 0 }));
    h.coordinator.transitionStarted('home-post'); // tombstoned key
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.drain();
    expect(order).toEqual([]);

    // Closing screen's transitionEnd may never fire — the DESTINATION's does.
    h.coordinator.transitionFinished('home-feed');
    h.drain();
    expect(order).toEqual(['feed']);
  });
});

describe('T04/T05 — gestures', () => {
  it('T04: successful swipe-back behaves like pop — destination tasks run after animation', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree({ homeIndex: 1 }));
    // Gesture-driven pop: state pops + transition lifecycle.
    h.coordinator.setNavigationState(appTree({ homeIndex: 0 }));
    h.coordinator.transitionStarted('home-post');
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.drain();
    expect(order).toEqual([]);
    h.coordinator.transitionFinished('home-feed');
    h.drain();
    expect(order).toEqual(['feed']);
  });

  it('T05: cancelled gesture keeps the barrier until the recovery animation ends', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree({ homeIndex: 1 })); // post focused
    h.drain();

    // User starts a swipe-back then releases early — gesture cancel.
    h.coordinator.transitionStarted('home-post');
    h.coordinator.gestureCancelled('home-post');
    h.scheduler.schedule(routeScopeId('home-post'), spy('post'));
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.drain();
    // Negative: recovery animation still running — nothing may start.
    expect(order).toEqual([]);

    // The barrier must not auto-release on time alone.
    h.timers.advance(60_000);
    h.drain();
    expect(order).toEqual([]);
    expect(h.sink.byCode('stalled-transition').length).toBe(1);

    // Recovery transitionFinished on the still-focused screen releases it.
    h.coordinator.transitionFinished('home-post');
    h.drain();
    expect(order).toContain('post');
    // home-feed stays pending — it is no longer on the focused path.
    expect(order).not.toContain('feed');
  });
});

describe('T06–T09 — sequencing and tree changes', () => {
  it('T06: rapid A → B → C — B never settled while C animates; B runs only on refocus', () => {
    const h = setup();
    const { order, spy } = calls();
    const rootWith = (routes: string[], index: number) =>
      nav(
        routes.map((k) => route(k)),
        index
      );

    h.coordinator.setNavigationState(rootWith(['a', 'b'], 1));
    h.coordinator.transitionStarted('b');
    h.scheduler.schedule(routeScopeId('b'), spy('b'));

    // Before B's transition ends, user jumps to C.
    h.coordinator.setNavigationState(rootWith(['a', 'b', 'c'], 2));
    h.coordinator.transitionStarted('c'); // same navNode '<root>' — still open
    h.coordinator.transitionFinished('c');
    h.drain();

    expect(order).toEqual([]); // B exists but is not on the focused path.

    // Now pop back to B — it becomes focused and (barrier-free) settles.
    h.coordinator.setNavigationState(rootWith(['a', 'b'], 1));
    h.coordinator.transitionStarted('c'); // tombstoned after pop-state
    h.coordinator.transitionFinished('b');
    h.drain();
    expect(order).toEqual(['b']);
  });

  it('T07: a barrier on the parent stack blocks nested child tasks', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree()); // home-feed settled

    // Root-level transition (e.g. opening Settings over the tabs).
    h.coordinator.setNavigationState(appTree({ rootIndex: 1 }));
    h.coordinator.transitionStarted('settings');
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    h.scheduler.schedule(routeScopeId('orders-detail'), spy('detail'));
    h.scheduler.schedule(APP_SCOPE_ID, spy('app'));
    h.drain();

    // Route tasks blocked by the ancestor barrier; app scope is not.
    expect(order).toEqual(['app']);

    h.coordinator.transitionFinished('settings');
    h.drain();
    expect(order).toEqual(['app']); // children still unfocused — index moved
  });

  it('T08: tab focus ancestry — only routes on the focused tab path settle', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree({ tabIndex: 0 }));
    h.scheduler.schedule(routeScopeId('orders-list'), spy('orders'));
    h.drain();
    expect(order).toEqual([]);

    h.coordinator.setNavigationState(appTree({ tabIndex: 1 }));
    h.drain();
    expect(order).toEqual(['orders']);
  });

  it('T09: reset drops the old tree — removed-route tasks never run', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree());

    // Keep the task pending behind an open barrier, then reset the whole
    // MainTabs subtree away (e.g. logout) before it can run.
    h.coordinator.transitionStarted('settings');
    h.scheduler.schedule(routeScopeId('home-feed'), spy('pending-feed'));
    h.drain();
    expect(order).toEqual([]);

    h.coordinator.setNavigationState(nav([route('settings')], 0));
    h.drain();
    h.timers.advance(10_000);
    h.drain();
    expect(order).toEqual([]);
    expect(h.coordinator.getRouteStatus('home-feed').settled).toBe(false);
    expect(h.scheduler.getPendingCount(routeScopeId('home-feed'))).toBe(1);

    // A task scheduled AFTER removal for a gone route never runs either.
    h.scheduler.schedule(routeScopeId('home-feed'), spy('late-feed'));
    h.drain();
    expect(order).toEqual([]);
  });
});

describe('T16–T18, T20, T22, T23 — scheduler behavior through the gate', () => {
  it('T16: 20 eligible tasks respect maxTasksPerTurn — no same-turn drain', () => {
    const h = setup({ maxTasksPerTurn: 5 });
    const { order, spy } = calls();
    // Keep them pending behind a barrier so all 20 are queued when the
    // gate opens — otherwise each schedule() drains its own single task.
    h.coordinator.setNavigationState(nav([route('a'), route('b')], 1));
    h.coordinator.transitionStarted('b'); // barrier on '<root>'
    for (let i = 0; i < 20; i++) {
      h.scheduler.schedule(routeScopeId('b'), spy(`t${i}`), { scheduling: 'transition' });
    }
    expect(order.length).toBe(0);
    h.coordinator.transitionFinished('b'); // gate opens → first drain turn
    expect(order.length).toBe(5); // one turn, capped
    h.drain();
    expect(order.length).toBe(20);
  });

  it('T17: a throwing task does not break the queue or later tasks', async () => {
    const h = setup();
    const { order, spy } = calls();
    const onError = jest.fn();
    h.coordinator.setNavigationState(nav([route('a')], 0));
    h.scheduler.schedule(
      routeScopeId('a'),
      () => {
        throw new Error('boom');
      },
      { onError }
    );
    h.scheduler.schedule(routeScopeId('a'), spy('after'));
    h.drain();
    await flushAsync();
    expect(order).toEqual(['after']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(h.sink.byCode('task-failed').length).toBe(1);
  });

  it('T18: duplicate pending key in one scope — latest wins', () => {
    const h = setup();
    const { order, spy } = calls();
    // Route not settled yet → both stay pending → dedupe applies.
    h.scheduler.schedule(routeScopeId('ghost'), spy('first'), { key: 'load' });
    h.scheduler.schedule(routeScopeId('ghost'), spy('second'), { key: 'load' });
    h.coordinator.setNavigationState(nav([route('ghost')], 0));
    h.drain();
    expect(order).toEqual(['second']);
  });

  it('T20: background blocks route tasks but not app tasks; foreground reconciles', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(nav([route('a')], 0));
    h.coordinator.setAppActive(false);
    h.scheduler.schedule(routeScopeId('a'), spy('route'));
    h.scheduler.schedule(APP_SCOPE_ID, spy('app'));
    h.drain();
    expect(order).toEqual(['app']);

    // Foreground: pending route work reconciles and runs.
    h.coordinator.setAppActive(true);
    h.drain();
    expect(order).toEqual(['app', 'route']);
  });

  it('T22: same-named screens in different subtrees never collide', () => {
    const h = setup();
    const { order, spy } = calls();
    // Two tabs each containing a stack with a 'Detail' screen.
    const tree = nav(
      [
        route('tab-a', 'TabA', nav([route('a-list', 'List'), route('a-detail', 'Detail')], 0)),
        route('tab-b', 'TabB', nav([route('b-list', 'List'), route('b-detail', 'Detail')], 0)),
      ],
      0
    );
    h.coordinator.setNavigationState(tree);
    // Barrier inside tab-b's stack must not block tab-a's routes.
    h.coordinator.transitionStarted('b-detail');
    h.scheduler.schedule(routeScopeId('a-list'), spy('a-list'));
    h.scheduler.schedule(routeScopeId('b-list'), spy('b-list'));
    h.drain();
    expect(order).toEqual(['a-list']);
  });

  it('T23: restored state — focused path decides eligibility immediately', () => {
    const h = setup();
    const { order, spy } = calls();
    h.scheduler.schedule(routeScopeId('orders-detail'), spy('detail'));
    h.scheduler.schedule(routeScopeId('home-feed'), spy('feed'));
    // "Restore" arrives as one delivered state with a deep focused chain.
    h.coordinator.setNavigationState(appTree({ tabIndex: 1, ordersIndex: 1 }));
    h.drain();
    expect(order).toEqual(['detail']);
  });
});

describe('invariants', () => {
  it('A: no route-bound task starts while an ancestor barrier is open', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(appTree({ tabIndex: 1, ordersIndex: 1 }));
    h.coordinator.transitionStarted('tab-orders'); // barrier on parent-of-parents chain
    h.scheduler.schedule(routeScopeId('orders-detail'), spy('detail'));
    h.drain();
    h.timers.advance(10_000);
    h.drain();
    expect(order).toEqual([]);
    // Barrier lives on navNode 'tabs' — the event must come from a sibling
    // of that navigator (any route whose parent is 'tabs').
    h.coordinator.transitionFinished('tab-orders');
    h.drain();
    expect(order).toEqual(['detail']);
  });

  it('B: a task cancelled before start never runs, even after settle', () => {
    const h = setup();
    const { order, spy } = calls();
    const handle = h.scheduler.schedule(routeScopeId('a'), spy('a'));
    handle.cancel();
    h.coordinator.setNavigationState(nav([route('a')], 0));
    h.drain();
    expect(order).toEqual([]);
    expect(h.scheduler.getPendingCount()).toBe(0);
  });

  it('idle-mode tasks wait for the idle host and revalidate eligibility there', () => {
    const h = setup();
    const { order, spy } = calls();
    h.coordinator.setNavigationState(nav([route('a'), route('b')], 0));
    h.scheduler.schedule(routeScopeId('a'), spy('a-idle'), { scheduling: 'idle' });
    h.scheduler.schedule(routeScopeId('a'), spy('a-transition'));
    h.drain();
    // Transition task ran immediately; idle task waits for the idle callback.
    expect(order).toEqual(['a-transition']);
    // Focus flips away → idle callback must revalidate, not run stale.
    h.coordinator.setNavigationState(nav([route('a'), route('b')], 1));
    h.idle.flush();
    expect(order).toEqual(['a-transition']);
    h.coordinator.setNavigationState(nav([route('a'), route('b')], 0));
    h.idle.flush();
    expect(order).toEqual(['a-transition', 'a-idle']);
  });
});
