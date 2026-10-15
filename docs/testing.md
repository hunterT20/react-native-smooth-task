# Testing

## Running the suite

```bash
pnpm test          # jest — all tests
npx jest tests/unit/core/TaskScheduler.test.ts   # single file
pnpm typecheck     # tsc --noEmit (strict)
pnpm lint          # eslint flat config
```

Stack: jest 30 + `@react-native/jest-preset` + `@testing-library/react-native`
14 (RNTL 14 is async — `await render`, `await renderHook`, `await
screen.rerender`; it uses the `test-renderer` package, not
`react-test-renderer`).

## Structure

```
tests/
├── unit/
│   ├── smoke.test.ts                     # toolchain sanity
│   ├── core/
│   │   ├── TaskScheduler.test.ts         # eligibility, dedupe, priority, drain
│   │   │                                 #   turns, idle pump, errors, dispose
│   │   ├── Hosts.test.ts                 # default TimerHost/IdleHost/open gate
│   │   ├── Diagnostics.test.ts           # collector, console sink, noop
│   │   └── fakes.ts                      # ManualGate / ManualTimerHost / ManualIdleHost
│   ├── navigation/
│   │   ├── NavigationCoordinator.test.ts # barriers, tombstones, focusEpoch,
│   │   │                                 #   buffered events, standalone mode, stalls
│   │   ├── RouteRegistry.test.ts         # navNode derivation, tombstones, epochs
│   │   └── helpers.ts                    # FakeTimerHost + appTree() fixtures
│   └── react/
│       ├── provider.test.tsx             # context, AppState wiring, diagnostics prop
│       ├── rootHooks.test.tsx            # app-scope hooks (Invariant B, sticky latch)
│       ├── routeScoped.test.tsx          # route-scope hooks through a mocked useRoute
│       ├── useSmoothNavigationContainer.test.tsx
│       ├── useSmoothStackListeners.test.tsx
│       ├── rntl-smoke.test.tsx
│       ├── fakes.ts                      # fake scheduler/coordinator contract mocks
│       └── harness.tsx                   # wrappers + pump() + state fixtures
└── integration/
    ├── navigation-flows.test.ts          # REAL coordinator + REAL scheduler,
    │                                     #   driven by hand-built state trees
    └── hooks.test.tsx                    # REAL provider + coordinator + scheduler,
                                          #   only useRoute() mocked
```

Determinism rules (per `AGENTS.md`):

- Core/navigation tests inject `TimerHost`/`IdleHost` fakes — never
  `jest.useFakeTimers` on the implementation's timers.
- Navigation tests simulate state trees by hand (`NavigationTreeState`
  fixtures via `nav()`/`route()`/`appTree()`) — no real navigators mounted.
- Every negative case has a negative assertion ("callback NOT called while
  the barrier is open").

## Release matrix coverage (T01–T24)

Jest-feasible cases are implemented in `tests/integration/`; the case id is in
each test name so `npx jest -t T05` selects it.

| Case | Scenario                                                                                     | Where                              |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------------- |
| T01  | Focused route of the initial state runs tasks after settle                                   | `navigation-flows.test.ts`         |
| T02  | Push: destination blocked until `transitionFinished`                                         | `navigation-flows.test.ts`         |
| T03  | Pop: closing route gone before events; destination's `transitionFinished` releases           | `navigation-flows.test.ts`         |
| T04  | Successful swipe-back behaves like pop                                                       | `navigation-flows.test.ts`         |
| T05  | Cancelled gesture holds the barrier until the recovery animation ends — never timer-released | `navigation-flows.test.ts`         |
| T06  | Rapid A→B→C: B never settles while C animates; runs only on refocus                          | `navigation-flows.test.ts`         |
| T07  | Barrier on the parent stack blocks nested child tasks                                        | `navigation-flows.test.ts`         |
| T08  | Tab focus ancestry: only routes on the focused tab path settle                               | `navigation-flows.test.ts`         |
| T09  | `reset` drops the old tree; removed-route tasks never run                                    | `navigation-flows.test.ts`         |
| T10  | Deep link in a single state — no deadlock, correct route eligible                            | `navigation-flows.test.ts`         |
| T11  | `animation: 'none'` transition-event fidelity                                                | **not jest-coverable — see below** |
| T12  | `mode: 'once'` — exactly one run across 10 refocuses                                         | `hooks.test.tsx`                   |
| T13  | `every-focus` — one run per focus epoch, not per barrier churn                               | `hooks.test.tsx`                   |
| T14  | Unmounted while pending — callback never runs                                                | `hooks.test.tsx`                   |
| T15  | Cancelling a running async task aborts its signal                                            | `hooks.test.tsx`                   |
| T16  | 20 eligible tasks respect `maxTasksPerTurn` — no same-turn drain                             | `navigation-flows.test.ts`         |
| T17  | A throwing task does not break the queue or later tasks                                      | `navigation-flows.test.ts`         |
| T18  | Duplicate pending key in one scope — latest wins                                             | `navigation-flows.test.ts`         |
| T19  | React StrictMode double-mount — no double execution                                          | `hooks.test.tsx`                   |
| T20  | Background blocks route tasks but not app tasks; foreground reconciles                       | `navigation-flows.test.ts`         |
| T21  | Missing-provider error names the calling hook                                                | `hooks.test.tsx`                   |
| T22  | Same-named screens in different subtrees never collide                                       | `navigation-flows.test.ts`         |
| T23  | Restored state — focused path decides eligibility immediately                                | `navigation-flows.test.ts`         |
| T24  | Repeated mount/unmount — registrations and pending tasks return to zero                      | `hooks.test.tsx`                   |

## Cases jest cannot cover (pending device verification)

These require real navigation animations / frame timing and are validated so
far only via hand-simulated state trees and events:

- **T11 — `animation: 'none'` fidelity.** Whether React Navigation emits
  `transitionStart`/`transitionEnd` (and in what order/timing) for screens
  with animations disabled. If no `transitionEnd` ever fires, a barrier opened
  by `transitionStart` would stay open until the navNode purges or the 4s
  `stalled-transition` warning fires — the barrier would still not
  auto-release (by design). Needs on-device confirmation.
- **Real gesture animations.** Interactive swipe-back timing, partial
  gestures, gesture-cancel → recovery `transitionEnd` delivery — simulated in
  T04/T05 but not against real drivers.
- **Native-stack event fidelity.** `useSmoothNativeStackListeners`
  forwarding is unit-tested with fabricated events, but native-stack
  transition events are emitted by react-native-screens on the native side —
  timing/order on real devices (iOS vs Android, `gestureCancel` iOS-only)
  needs on-device confirmation.
- **Frame metrics.** Jest cannot measure dropped frames, long tasks or p95
  transition times — covered by the benchmark plan below.

### Intended Detox scenario

A Detox E2E target (pending implementation) should, on a physical device:

1. Drive a real push to a screen using `useDeferredMount` + skeleton and
   assert the skeleton does not swap to content until the push animation
   completes (screenshot/DETOX sync assertions around the transition window).
2. Drive an interactive swipe-back, cancel it mid-gesture, and assert
   deferred work on the top screen does not start until the recovery
   animation finishes.
3. Drive a modal `presentation: 'modal'` open over a tab+stack tree and assert
   nested route tasks stay blocked until the modal settles.
4. Repeat on a screen configured with `animation: 'none'` (T11).

## Benchmark plan

Goal: quantify the transition-window improvement versus common scheduling
strategies. Four variants of the same heavy screen (a list rendering ~2–4s of
JS work on mount), measured end-to-end:

| Variant | Strategy                                                            |
| ------- | ------------------------------------------------------------------- |
| A       | Immediate — heavy subtree mounts with the screen (baseline)         |
| B       | `setTimeout(cb, 0)` / fixed delay before mounting the heavy subtree |
| C       | Manual `transitionEnd` listener (`screenListeners` wired by hand)   |
| D       | This library — `useDeferredMount`/`DeferredView` route-scoped       |

**Metrics** per run:

- dropped frames / FPS during the transition window,
- JS long tasks (>50ms) overlapping the transition,
- transition duration p50/p95 (push start → visually settled),
- "content ready" p50/p95 (push start → heavy content first frame),
- time-to-interactive on the destination screen,
- scheduling overhead (ms spent inside the scheduler/coordinator per
  transition — diagnostic timestamps),
- memory delta across repeated push/pop cycles (leak check).

**Protocol**: ≥30 repetitions per variant, release builds only (dev mode
distorts everything), identical data, physical devices — one mid-range
Android and one recent iPhone at minimum. Report median and p95 per variant;
D should show transition-jank parity with C and better ready-time
distribution than B without per-screen tuning.
