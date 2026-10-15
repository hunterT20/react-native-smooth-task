/**
 * NavigationCoordinator unit tests — hand-built NavigationTreeState
 * fixtures, injected FakeTimerHost. No real navigators are mounted.
 */

import { createNavigationCoordinator } from '../../../src/navigation/NavigationCoordinator';
import type { MissingAdapterPolicy } from '../../../src/navigation/types';
import { FakeTimerHost, appTree, createRecordingSink, nav, route } from './helpers';

function setup(deps?: { stallWarningMs?: number; missingAdapterPolicy?: MissingAdapterPolicy }) {
  const timers = new FakeTimerHost();
  const sink = createRecordingSink();
  const coordinator = createNavigationCoordinator({
    diagnostics: sink,
    timers,
    ...(deps?.stallWarningMs !== undefined ? { stallWarningMs: deps.stallWarningMs } : {}),
    ...(deps?.missingAdapterPolicy !== undefined
      ? { missingAdapterPolicy: deps.missingAdapterPolicy }
      : {}),
  });
  return { coordinator, timers, sink };
}

describe('initial state & readiness', () => {
  it('starts not-ready, ignores null/undefined, flips ready on first state', () => {
    const { coordinator } = setup();
    expect(coordinator.ready).toBe(false);
    expect(coordinator.navigatorCount).toBe(0);
    expect(coordinator.getRouteStatus('home-feed')).toEqual({
      exists: false,
      focusedOnPath: false,
      hasPendingTransition: false,
      settled: false,
      focusEpoch: 0,
    });

    coordinator.setNavigationState(null);
    coordinator.setNavigationState(undefined);
    expect(coordinator.ready).toBe(false);

    coordinator.setNavigationState(appTree());
    expect(coordinator.ready).toBe(true);
  });

  it('treats {routes: []} as a real delivery (ready, nothing exists)', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState({ routes: [] });
    expect(coordinator.ready).toBe(true);
    expect(coordinator.getRouteStatus('anything').exists).toBe(false);
    expect(coordinator.isEligible('route:anything')).toBe(false);
    expect(coordinator.isEligible('app')).toBe(true);
  });

  it('leaf route on the focused path is settled; unfocused siblings are not', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(appTree());

    // focused chain: <root> → tabs → tab-home → home-feed
    for (const key of ['tabs', 'tab-home', 'home-feed']) {
      const status = coordinator.getRouteStatus(key);
      expect(status.settled).toBe(true);
      expect(status.focusedOnPath).toBe(true);
      expect(status.exists).toBe(true);
    }
    // off-path routes exist but are not focused/settled
    for (const key of ['settings', 'tab-orders', 'home-post', 'orders-list', 'orders-detail']) {
      const status = coordinator.getRouteStatus(key);
      expect(status.exists).toBe(true);
      expect(status.focusedOnPath).toBe(false);
      expect(status.settled).toBe(false);
    }
    expect(coordinator.isEligible('route:home-feed')).toBe(true);
    expect(coordinator.isEligible('route:orders-list')).toBe(false);
  });
});

describe('push transitions', () => {
  it('transitionStarted opens a barrier; transitionFinished on the destination closes it', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);

    // Push 'home-post' inside HomeStack: barrier on navNode 'tab-home'.
    coordinator.transitionStarted('home-feed');
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(false);
    // Sibling route on the same navNode is also blocked.
    expect(coordinator.getRouteStatus('home-post').hasPendingTransition).toBe(true);
    // A route on a different navigator is NOT blocked by this barrier
    // (orders-list is unfocused anyway — check hasPendingTransition directly).
    expect(coordinator.getRouteStatus('orders-list').hasPendingTransition).toBe(false);

    // transitionFinished fires on the destination route key, not the origin.
    coordinator.transitionFinished('home-post');
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(false);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);

    expect(sink.byCode('barrier-opened')).toHaveLength(1);
    expect(sink.byCode('barrier-opened')[0]?.details?.['navNodeId']).toBe('tab-home');
    expect(sink.byCode('barrier-closed')).toHaveLength(1);
  });
});

describe('pop transitions (tombstone resolution)', () => {
  it('resolves a popped route via tombstone; destination transitionFinished closes', () => {
    const { coordinator, sink } = setup();
    // Root stack: [tabs, modal] — modal pushed on top.
    coordinator.setNavigationState(
      nav(
        [route('tabs', 'MainTabs', nav([route('tab-home', 'Home')], 0)), route('modal', 'Modal')],
        1
      )
    );
    expect(coordinator.getRouteStatus('modal').settled).toBe(true);

    // Pop dispatches the state update BEFORE the transition events.
    coordinator.setNavigationState(
      nav([route('tabs', 'MainTabs', nav([route('tab-home', 'Home')], 0))], 0)
    );
    expect(coordinator.getRouteStatus('modal').exists).toBe(false);
    expect(coordinator.getRouteStatus('modal').settled).toBe(false);

    // transitionStarted for the now-gone route resolves via the tombstone.
    coordinator.transitionStarted('modal');
    expect(coordinator.getRouteStatus('tabs').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('tabs').settled).toBe(false);

    // transitionFinished arrives on the DESTINATION ('tabs'), a sibling of
    // the closing route on navNode '<root>' — must close the same barrier.
    coordinator.transitionFinished('tabs');
    expect(coordinator.getRouteStatus('tabs').hasPendingTransition).toBe(false);
    expect(coordinator.getRouteStatus('tabs').settled).toBe(true);
    expect(sink.byCode('dropped-event')).toHaveLength(0);
  });
});

describe('gesture cancellation', () => {
  it('keeps the barrier open until the recovery transitionFinished — never auto-releases', () => {
    const { coordinator, timers } = setup({ stallWarningMs: 4000 });
    coordinator.setNavigationState(appTree());

    coordinator.transitionStarted('home-feed');
    coordinator.gestureCancelled('home-feed'); // mark for recovery
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(true);

    // Even far past the stall window the barrier stays open (warn only).
    timers.advance(60_000);
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(false);

    coordinator.transitionFinished('home-feed'); // recovery animation ends
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);
  });

  it('opens a gesture-recovery barrier when none is open yet', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    coordinator.gestureCancelled('home-feed');
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(true);
    expect(sink.byCode('barrier-opened')[0]?.details?.['reason']).toBe('gesture-recovery');
    coordinator.transitionFinished('home-feed');
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);
  });
});

describe('nested navigators', () => {
  it('a barrier on the parent stack blocks the child route', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(
      nav([route('parent', 'Parent', nav([route('child', 'Child')], 0))], 0)
    );
    expect(coordinator.getRouteStatus('child').settled).toBe(true);

    coordinator.transitionStarted('parent'); // barrier on '<root>' — ancestor of child
    expect(coordinator.getRouteStatus('child').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('child').settled).toBe(false);

    coordinator.transitionFinished('parent');
    expect(coordinator.getRouteStatus('child').settled).toBe(true);
  });

  it('a barrier in a sibling stack does NOT block the route', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(appTree({ tabIndex: 0 }));
    // Orders stack transition — navNode 'tab-orders', not on home-feed's path.
    coordinator.transitionStarted('orders-list');
    expect(coordinator.getRouteStatus('orders-list').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(false);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);
  });
});

describe('focus & focusEpoch', () => {
  it('focuses through tabs; switching index moves focus', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(appTree({ tabIndex: 0 }));
    expect(coordinator.getRouteStatus('orders-list').focusedOnPath).toBe(false);

    coordinator.setNavigationState(appTree({ tabIndex: 1 }));
    expect(coordinator.getRouteStatus('orders-list').focusedOnPath).toBe(true);
    expect(coordinator.getRouteStatus('orders-list').settled).toBe(true);
    expect(coordinator.getRouteStatus('home-feed').focusedOnPath).toBe(false);
  });

  it('focusEpoch increments on refocus edges but not on barrier churn', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(appTree({ tabIndex: 0 }));
    expect(coordinator.getRouteStatus('home-feed').focusEpoch).toBe(1);

    // barrier churn while focused — no epoch bump
    coordinator.transitionStarted('home-feed');
    coordinator.transitionFinished('home-feed');
    expect(coordinator.getRouteStatus('home-feed').focusEpoch).toBe(1);

    // blur → refocus bumps the epoch
    coordinator.setNavigationState(appTree({ tabIndex: 1 }));
    coordinator.setNavigationState(appTree({ tabIndex: 0 }));
    expect(coordinator.getRouteStatus('home-feed').focusEpoch).toBe(2);
  });

  it('routeFocused/routeBlurred are hints only — status comes from the tree', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(appTree());
    const listener = jest.fn();
    coordinator.subscribe(listener);
    listener.mockClear();

    coordinator.routeBlurred('home-feed');
    expect(coordinator.getRouteStatus('home-feed').focusedOnPath).toBe(true);
    coordinator.routeFocused('orders-list');
    expect(coordinator.getRouteStatus('orders-list').focusedOnPath).toBe(false);
    // hints are not eligibility-affecting — no broadcast
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('reset/replace — navNode purge', () => {
  it('purges a navNode with zero members: closes barriers, drops tombstones', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree({ tabIndex: 1 }));
    coordinator.transitionStarted('orders-list'); // open barrier on 'tab-orders'
    expect(coordinator.getRouteStatus('orders-list').hasPendingTransition).toBe(true);

    // Reset removes the Orders tab entirely — navNode 'tab-orders' dies.
    coordinator.setNavigationState(
      nav(
        [
          route(
            'tabs',
            'MainTabs',
            nav([route('tab-home', 'Home', nav([route('home-feed', 'Feed')], 0))], 0)
          ),
          route('settings', 'Settings'),
        ],
        0
      )
    );

    // Barrier auto-closed on purge; tombstones for its routes dropped.
    const closed = sink.byCode('barrier-closed');
    expect(closed.some((e) => e.details?.['closeReason'] === 'navnode-purged')).toBe(true);
    expect(coordinator.getRouteStatus('orders-list').exists).toBe(false);
    // Its focus epoch was purged too.
    expect(coordinator.getRouteStatus('orders-list').focusEpoch).toBe(0);

    // A transitionStarted for the purged route no longer resolves → buffered.
    coordinator.transitionStarted('orders-list');
    expect(sink.byCode('event-buffered').some((e) => e.routeKey === 'orders-list')).toBe(true);
    // …and nothing is blocked: the tree's focused leaf stays settled.
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);
  });

  it('emptying the root purges <root> barriers too', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(nav([route('a'), route('b')], 0));
    coordinator.transitionStarted('a');
    expect(coordinator.getRouteStatus('a').hasPendingTransition).toBe(true);

    coordinator.setNavigationState({ routes: [] });
    expect(
      sink.byCode('barrier-closed').some((e) => e.details?.['closeReason'] === 'navnode-purged')
    ).toBe(true);
    expect(coordinator.getRouteStatus('a').exists).toBe(false);
  });
});

describe('deep-link (single-shot state)', () => {
  it('settles the focused leaf directly — no deadlock', () => {
    const { coordinator } = setup();
    // One-shot tree as if restored from a link: several levels already focused.
    coordinator.setNavigationState(appTree({ tabIndex: 1, ordersIndex: 1 }));
    expect(coordinator.ready).toBe(true);
    expect(coordinator.getRouteStatus('orders-detail').settled).toBe(true);
    expect(coordinator.getRouteStatus('orders-list').focusedOnPath).toBe(false);
    expect(coordinator.isEligible('route:orders-detail')).toBe(true);
  });
});

describe('app state', () => {
  it('route scopes require appActive; app scopes never do', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    expect(coordinator.isEligible('route:home-feed')).toBe(true);

    coordinator.setAppActive(false);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(false);
    expect(coordinator.isEligible('route:home-feed')).toBe(false);
    expect(coordinator.isEligible('app')).toBe(true);
    expect(coordinator.isEligible('app:background-sync')).toBe(true);

    coordinator.setAppActive(true);
    expect(coordinator.isEligible('route:home-feed')).toBe(true);
    expect(sink.byCode('app-state')).toHaveLength(2);
  });
});

describe('same-named navigators in different subtrees', () => {
  it('navNodeIds derive from parent keys — no collision', () => {
    const { coordinator } = setup();
    coordinator.setNavigationState(
      nav(
        [
          route('branch-a', 'BranchA', nav([route('a-home', 'Home')], 0)),
          route('branch-b', 'BranchB', nav([route('b-home', 'Home')], 0)),
        ],
        0
      )
    );
    coordinator.transitionStarted('a-home'); // barrier on 'branch-a' only
    expect(coordinator.getRouteStatus('a-home').hasPendingTransition).toBe(true);
    expect(coordinator.getRouteStatus('b-home').hasPendingTransition).toBe(false);
  });
});

describe('stall detection', () => {
  it('warns once per barrier open longer than stallWarningMs', () => {
    const { coordinator, timers, sink } = setup({ stallWarningMs: 4000 });
    coordinator.setNavigationState(appTree());
    coordinator.transitionStarted('home-feed');

    timers.advance(3999);
    expect(sink.byCode('stalled-transition')).toHaveLength(0);
    timers.advance(1);
    expect(sink.byCode('stalled-transition')).toHaveLength(1);
    expect(sink.byCode('stalled-transition')[0]?.level).toBe('warn');
    expect(sink.byCode('stalled-transition')[0]?.details?.['navNodeId']).toBe('tab-home');

    // exactly once per barrier — and the barrier is STILL open (detection only)
    timers.advance(60_000);
    expect(sink.byCode('stalled-transition')).toHaveLength(1);
    expect(coordinator.getRouteStatus('home-feed').hasPendingTransition).toBe(true);
  });

  it('does not warn when the barrier closes in time', () => {
    const { coordinator, timers, sink } = setup({ stallWarningMs: 100 });
    coordinator.setNavigationState(appTree());
    coordinator.transitionStarted('home-feed');
    timers.advance(50);
    coordinator.transitionFinished('home-feed');
    timers.advance(10_000);
    expect(sink.byCode('stalled-transition')).toHaveLength(0);
  });
});

describe('buffered transition events', () => {
  it('buffers an event for an unresolvable key and replays it on next state', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(nav([route('a')], 0));

    coordinator.transitionStarted('later-route'); // not in the tree yet
    expect(sink.byCode('event-buffered')).toHaveLength(1);
    expect(coordinator.getRouteStatus('a').hasPendingTransition).toBe(false);

    coordinator.setNavigationState(nav([route('a'), route('later-route')], 1));
    // replayed → barrier opened on '<root>'
    expect(coordinator.getRouteStatus('a').hasPendingTransition).toBe(true);
    coordinator.transitionFinished('a');
    expect(coordinator.getRouteStatus('a').hasPendingTransition).toBe(false);
    // 'later-route' is the focused leaf (index 1) → settles once unblocked
    expect(coordinator.getRouteStatus('later-route').settled).toBe(true);
  });

  it('drops a buffered event after ~2s with a dropped-event warning', () => {
    const { coordinator, timers, sink } = setup();
    coordinator.setNavigationState(nav([route('a')], 0));
    coordinator.transitionStarted('ghost-route');
    timers.advance(1999);
    expect(sink.byCode('dropped-event')).toHaveLength(0);
    timers.advance(1);
    expect(sink.byCode('dropped-event')).toHaveLength(1);
    expect(sink.byCode('dropped-event')[0]?.level).toBe('warn');
    expect(sink.byCode('dropped-event')[0]?.routeKey).toBe('ghost-route');

    // A later state containing the key does NOT apply the dropped event.
    coordinator.setNavigationState(nav([route('a'), route('ghost-route')], 0));
    expect(coordinator.getRouteStatus('a').hasPendingTransition).toBe(false);
  });
});

describe('transitionFinished with no open barrier', () => {
  it('is a debug no-op', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    coordinator.transitionFinished('home-feed');
    expect(sink.byCode('no-open-barrier')).toHaveLength(1);
    expect(sink.byCode('barrier-closed')).toHaveLength(0);
    expect(coordinator.getRouteStatus('home-feed').settled).toBe(true);
  });
});

describe('missing-adapter policy', () => {
  describe('strict (default) — fail closed', () => {
    it('warns after the detection window but keeps route scopes gated', () => {
      const { coordinator, timers, sink } = setup();
      // During the grace window the coordinator still gates (navigation may
      // still be wiring).
      expect(coordinator.isEligible('route:anything')).toBe(false);

      timers.advance(2000);
      expect(sink.byCode('missing-adapter')).toHaveLength(1);
      expect(sink.byCode('missing-adapter')[0]?.level).toBe('warn');
      expect(sink.byCode('missing-adapter')[0]?.message).toContain('strict');

      // Route scopes must NEVER ungate without navigation evidence — a
      // miswired app fails closed instead of running work mid-transition.
      expect(coordinator.isEligible('route:anything')).toBe(false);
      expect(coordinator.isEligible('route:other')).toBe(false);
      // App scope is never gated by navigation either way.
      expect(coordinator.isEligible('app')).toBe(true);
      expect(coordinator.isEligible('weird:scope')).toBe(true);

      // warn is one-time even across repeated queries
      expect(sink.byCode('missing-adapter')).toHaveLength(1);
    });

    it('does not re-warn or churn timers after firing once', () => {
      const { coordinator, timers, sink } = setup();
      coordinator.isEligible('route:x'); // arm
      timers.advance(2000);
      coordinator.isEligible('route:x');
      timers.advance(10000);
      coordinator.isEligible('route:x');
      expect(sink.byCode('missing-adapter')).toHaveLength(1);
    });

    it('gates normally once navigation wires up, even after warning', () => {
      const { coordinator, timers } = setup();
      coordinator.isEligible('route:x');
      timers.advance(2000);
      expect(coordinator.isEligible('route:x')).toBe(false);

      coordinator.registerNavigator({ instanceId: 'stack:root:1', kind: 'stack' });
      expect(coordinator.isEligible('route:x')).toBe(false);
      coordinator.setNavigationState(nav([route('x')], 0));
      expect(coordinator.isEligible('route:x')).toBe(true);
    });
  });

  describe('degraded (opt-in) — fail open', () => {
    it('declares missing-adapter after the detection window, then all scopes are eligible', () => {
      const { coordinator, timers, sink } = setup({ missingAdapterPolicy: 'degraded' });
      expect(coordinator.isEligible('route:anything')).toBe(false);

      timers.advance(2000);
      expect(sink.byCode('missing-adapter')).toHaveLength(1);
      expect(sink.byCode('missing-adapter')[0]?.level).toBe('warn');

      expect(coordinator.isEligible('route:anything')).toBe(true);
      expect(coordinator.isEligible('app')).toBe(true);
      expect(coordinator.isEligible('weird:scope')).toBe(true);

      coordinator.isEligible('route:other');
      expect(sink.byCode('missing-adapter')).toHaveLength(1);
    });

    it('exits degraded mode as soon as navigation wires up', () => {
      const { coordinator, timers } = setup({ missingAdapterPolicy: 'degraded' });
      coordinator.isEligible('route:x'); // arm the standalone check
      timers.advance(2000);
      expect(coordinator.isEligible('route:x')).toBe(true); // degraded

      coordinator.registerNavigator({ instanceId: 'stack:root:1', kind: 'stack' });
      expect(coordinator.isEligible('route:x')).toBe(false); // gated again

      // …and once state arrives, normal rules apply.
      coordinator.setNavigationState(nav([route('x')], 0));
      expect(coordinator.isEligible('route:x')).toBe(true);
    });
  });

  it('a navigator registering during the window prevents any missing-adapter signal', () => {
    for (const missingAdapterPolicy of ['strict', 'degraded'] as const) {
      const { coordinator, timers, sink } = setup({ missingAdapterPolicy });
      coordinator.isEligible('route:x'); // arm check
      timers.advance(1000);
      coordinator.registerNavigator({ instanceId: 'i1', kind: 'stack' });
      timers.advance(5000);
      expect(sink.byCode('missing-adapter')).toHaveLength(0);
      expect(coordinator.isEligible('route:x')).toBe(false);
    }
  });
});

describe('untracked routes & unknown scopes', () => {
  it('warns untracked-route once per key once ready', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    expect(coordinator.isEligible('route:ghost')).toBe(false);
    expect(coordinator.isEligible('route:ghost')).toBe(false);
    expect(sink.byCode('untracked-route')).toHaveLength(1);
    expect(sink.byCode('untracked-route')[0]?.routeKey).toBe('ghost');
    expect(coordinator.getRouteStatus('ghost').exists).toBe(false);
  });

  it('unknown scope prefixes are eligible with a one-time debug diagnostic', () => {
    const { coordinator, sink } = setup();
    coordinator.setNavigationState(appTree());
    expect(coordinator.isEligible('custom:a')).toBe(true);
    expect(coordinator.isEligible('custom:b')).toBe(true);
    expect(sink.byCode('unknown-scope')).toHaveLength(1);
  });
});

describe('subscriptions', () => {
  it('broadcasts on eligibility-affecting changes; unsubscribe stops it', () => {
    const { coordinator } = setup();
    const listener = jest.fn();
    const unsubscribe = coordinator.subscribe(listener);

    coordinator.setNavigationState(appTree()); // 1
    coordinator.transitionStarted('home-feed'); // 2 (barrier open)
    coordinator.transitionFinished('home-feed'); // 3 (barrier close)
    coordinator.setAppActive(false); // 4
    coordinator.setAppActive(false); // no change → no broadcast
    coordinator.registerNavigator({ instanceId: 'i1', kind: 'stack' }); // 5
    coordinator.unregisterNavigator('i1'); // 6
    expect(listener).toHaveBeenCalledTimes(6);

    unsubscribe();
    coordinator.setAppActive(true);
    coordinator.setNavigationState(appTree());
    expect(listener).toHaveBeenCalledTimes(6);
  });

  it('a throwing listener does not break the broadcast', () => {
    const { coordinator } = setup();
    const good = jest.fn();
    coordinator.subscribe(() => {
      throw new Error('boom');
    });
    coordinator.subscribe(good);
    expect(() => coordinator.setNavigationState(appTree())).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('navigator registration', () => {
  it('tracks live instances and emits diagnostics', () => {
    const { coordinator, sink } = setup();
    coordinator.registerNavigator({ instanceId: 'i1', kind: 'stack', label: 'root' });
    coordinator.registerNavigator({ instanceId: 'i2', kind: 'tab' });
    expect(coordinator.navigatorCount).toBe(2);
    coordinator.unregisterNavigator('i1');
    expect(coordinator.navigatorCount).toBe(1);
    coordinator.unregisterNavigator('unknown'); // no-op
    expect(coordinator.navigatorCount).toBe(1);
    expect(sink.byCode('navigator-registered')).toHaveLength(2);
    expect(sink.byCode('navigator-unregistered')).toHaveLength(1);
  });
});

describe('dispose', () => {
  it('cancels timers and clears listeners; later calls are inert', () => {
    const { coordinator, timers, sink } = setup();
    coordinator.setNavigationState(appTree());
    coordinator.transitionStarted('home-feed'); // stall timer armed
    coordinator.isEligible('route:x'); // (also arms nothing — ready)
    const listener = jest.fn();
    coordinator.subscribe(listener);

    coordinator.dispose();
    listener.mockClear();
    timers.advance(60_000);
    expect(listener).not.toHaveBeenCalled();
    expect(sink.byCode('stalled-transition')).toHaveLength(0); // timer cancelled
    expect(timers.pendingCount).toBe(0);

    coordinator.setAppActive(false);
    coordinator.transitionFinished('home-feed');
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('routeScopeId', () => {
  it('builds route:<key> scope ids', () => {
    const { coordinator } = setup();
    expect(coordinator.routeScopeId('abc')).toBe('route:abc');
  });
});
