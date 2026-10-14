/**
 * Shared test fixtures for the navigation coordinator unit tests:
 *  - FakeTimerHost: manual-clock TimerHost (per AGENTS.md — never
 *    jest.useFakeTimers on the implementation's timers).
 *  - Recording diagnostics sink.
 *  - Hand-built NavigationTreeState fixtures:
 *      RootStack '<root>'      → [ MainTabs('tabs'), Settings('settings') ]
 *      MainTabs 'tabs'         → [ Home('tab-home'), Orders('tab-orders') ]
 *      HomeStack 'tab-home'    → [ Feed('home-feed'), Post('home-post') ]
 *      OrdersStack 'tab-orders'→ [ List('orders-list'), Detail('orders-detail') ]
 */

import type { TimerHost } from '../../../src/core/types';
import type { DiagnosticEvent, DiagnosticsSink } from '../../../src/diagnostics/types';
import type {
  NavigationRouteState,
  NavigationTreeState,
} from '../../../src/navigation/types';

// ---------------------------------------------------------------------------
// Fake TimerHost — manual clock; advance() fires all due timers in order.

export class FakeTimerHost implements TimerHost {
  private seq = 0;
  private readonly pending = new Map<number, { callback: () => void; at: number }>();
  currentTime = 0;

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, ms: number): number {
    const id = ++this.seq;
    this.pending.set(id, { callback, at: this.currentTime + ms });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number);
  }

  /** Advance the clock and fire every timer whose deadline has arrived. */
  advance(ms: number): void {
    this.currentTime += ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, timer] of this.pending) {
        if (timer.at <= this.currentTime && timer.at < nextAt) {
          nextId = id;
          nextAt = timer.at;
        }
      }
      if (nextId === null) return;
      const { callback } = this.pending.get(nextId)!;
      this.pending.delete(nextId);
      callback();
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

// ---------------------------------------------------------------------------
// Diagnostics recording

export interface RecordedSink extends DiagnosticsSink {
  readonly events: DiagnosticEvent[];
  byCode(code: string): DiagnosticEvent[];
}

export function createRecordingSink(): RecordedSink {
  const events: DiagnosticEvent[] = [];
  return {
    events,
    emit(event) {
      events.push(event);
    },
    byCode(code: string) {
      return events.filter((e) => e.code === code);
    },
  };
}

// ---------------------------------------------------------------------------
// State-tree fixture builders

export function route(
  key: string,
  name = key,
  state?: NavigationTreeState
): NavigationRouteState {
  return { key, name, ...(state !== undefined ? { state } : {}) };
}

export function nav(routes: NavigationRouteState[], index?: number): NavigationTreeState {
  return { routes, ...(index !== undefined ? { index } : {}) };
}

export interface AppTreeOptions {
  /** Root stack index — 0 → MainTabs focused, 1 → Settings focused. */
  rootIndex?: number;
  /** MainTabs index — 0 → Home tab, 1 → Orders tab. */
  tabIndex?: number;
  /** HomeStack index — 0 → feed, 1 → post. */
  homeIndex?: number;
  /** OrdersStack index — 0 → list, 1 → detail. */
  ordersIndex?: number;
}

/**
 * RootStack('<root>') with a focused MainTabs → HomeStack → Feed chain by
 * default: 'home-feed' is the settled leaf; 'orders-*' live under the
 * unfocused tab.
 */
export function appTree(options: AppTreeOptions = {}): NavigationTreeState {
  const { rootIndex = 0, tabIndex = 0, homeIndex = 0, ordersIndex = 0 } = options;
  return nav(
    [
      route(
        'tabs',
        'MainTabs',
        nav(
          [
            route(
              'tab-home',
              'Home',
              nav([route('home-feed', 'Feed'), route('home-post', 'Post')], homeIndex)
            ),
            route(
              'tab-orders',
              'Orders',
              nav([route('orders-list', 'List'), route('orders-detail', 'Detail')], ordersIndex)
            ),
          ],
          tabIndex
        )
      ),
      route('settings', 'Settings'),
    ],
    rootIndex
  );
}
