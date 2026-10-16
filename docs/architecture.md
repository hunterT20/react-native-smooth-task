# Architecture

`react-native-smooth-task` is organized as three strictly layered modules plus
a React integration layer that wires them together. The layering is enforced
by import rules (see `AGENTS.md`): `src/core/` and `src/navigation/` are pure
TypeScript — no react, react-native or @react-navigation imports — so the
scheduling and eligibility logic is fully unit-testable without a RN runtime.

```
┌──────────────────────────────────────────────────────────────┐
│ Public React APIs (src/react/)                               │
│  SmoothTaskProvider · useDeferredMount · useAfterTransition  │
│  useIdleTask · DeferredView · useSmoothNavigationContainer   │
│  + route-scoped variants bound via useRoute().key            │
│    (exported from both /stack and /native-stack)             │
├──────────────────────────────────────────────────────────────┤
│ Navigation Coordinator (src/navigation/)                     │
│  NavigationCoordinator · RouteRegistry · BarrierRegistry     │
│  - consumes NavigationContainer onReady/onStateChange        │
│  - consumes stack screenListeners events                     │
│  - exposes EligibilityGate (isEligible + broadcast subscribe)│
├──────────────────────────────────────────────────────────────┤
│ Task Scheduler (src/core/)                                   │
│  TaskScheduler · IdleHost/TimerHost adapters                 │
│  - pending queue, priority, dedupe, AbortSignal              │
│  - asks the gate before every task start                     │
└──────────────────────────────────────────────────────────────┘
```

The only navigation-adapter code that touches `@react-navigation` lives in
`src/navigation/stack/useSmoothStackListeners.ts` and
`src/navigation/native-stack/useSmoothNativeStackListeners.ts` (plus the
route-scoped hooks under `src/react/routeScoped/`, which only call
`useRoute()`). Both adapters share one implementation —
`src/navigation/listeners.ts` builds the plain listener map and
`src/react/useNavigatorRegistration.ts` handles register/unregister — so
each adapter is a thin typed wrapper that labels the registration
(`stack:` vs `native-stack:`). The coordinator itself speaks structural
types (`NavigationTreeState` = `{ index?, routes: { key, name, state? }[] }`),
so real `NavigationState` objects flow through without a hard dependency,
and other navigator kinds can be adapted later.

## Runtime coordination

Two input streams feed the coordinator:

1. **State deliveries** — `useSmoothNavigationContainer` spreads `onReady`
   (resolving the initial tree via `getRootState()` /
   `navigationRef.current.getRootState()`) and `onStateChange` onto
   `NavigationContainer`. Each delivery rebuilds the route table.
2. **Transition events** — `useSmoothStackListeners` /
   `useSmoothNativeStackListeners` plug into each stack navigator's
   `screenListeners` and forward `transitionStart`, `transitionEnd`,
   `gestureCancel`, `focus` and `blur` (keyed by `e.target`, the route key
   that fired the event). On native-stack these events are native-driven
   (`gestureCancel` is iOS-only); the coordinator treats both adapters
   identically.

The scheduler subscribes to the coordinator's broadcast channel. Every state
delivery, barrier change, navigator registration and AppState change triggers
a broadcast; on each broadcast the scheduler revalidates all pending tasks
against `gate.isEligible(scopeId)`.

## The scope model

Every task is scheduled into a `ScopeId`:

- **`route:<key>`** — one per navigation route, keyed by React Navigation's
  stable `route.key` (not the name — same-named screens in different
  subtrees never collide). Eligible only while `getRouteStatus(key).settled`.
- **`app`** (and `app:*`) — never gated: eligible immediately and unaffected
  by transitions, focus or AppState. This is what the root-entry hooks use.
- Unknown prefixes are treated as always-eligible with a one-time
  `unknown-scope` debug diagnostic — future adapters can introduce scope
  families without breaking the gate.

`RouteStatus` per route key:

```
settled = exists && focusedOnPath && !hasPendingTransition && ready && appActive
```

- `focusedOnPath`: the route is selected by `index` at _every_ level of the
  state tree from the root down to it. A level with no `index` selects its
  last route (stack semantics). Deep links and state restoration "just work"
  because focus is computed from the tree, not from events.
- `hasPendingTransition`: an open barrier exists on **any** navNode along the
  route's ancestor path — so a modal opening on the root stack also blocks
  work scheduled deep inside a nested tab's stack — **or** an ancestor
  navNode is _settling_ (see below).
- `focusEpoch`: see below.

## Settling — the state→event ordering gap

React Navigation can publish a focus-changing state **before** the matching
`transitionStart` arrives (pop especially; the gap is wider on native-stack
where events cross the bridge asynchronously). A drain in that window would
release the newly focused route's tasks mid-transition — exactly what the
library exists to prevent.

When a rebuild reports a navNode whose `index`-selected member changed, the
coordinator marks that navNode **settling**; routes on its path count as
having a pending transition until lifecycle evidence resolves it:

- a `transitionStart`/`transitionEnd`/`gestureCancel` event — the real
  barrier then takes over,
- a `focus` event on the navNode — the change demonstrably completed
  without transition events (covers non-animated changes on otherwise
  animated navigators, e.g. per-screen `animationEnabled: false`),
- a silence timeout whose length depends on classification (below),
- the navNode's death (`navnode-purged`).

Classification is a three-tier machine, driven by observed evidence:

- **unobserved** — no lifecycle events ever. Never marked: unwired
  subtrees (e.g. a tab bar with no listener hooks) keep plain focus-only
  gating and cannot deadlock. The first state delivery is the baseline and
  never marks anything either.
- **observed, never-animated** — focus/blur seen, no transition events.
  ~300ms of silence classifies the navNode **non-animated** (skipped
  thereafter); a `focus` event does the same immediately.
- **animated** — at least one transition-family event seen. The gate holds
  for `stallWarningMs` (default 4s): a real transition's events arrive
  promptly, so silence that long means events were *lost* — the gate
  releases with a `settling-unresolved` warning and the navNode **stays
  animated** (one silent change never downgrades the classification, so a
  late `transitionStart` can never find the gate already open).
  A transition event heals `non-animated` back to `animated` at any time.

Settling is not a barrier — it exists to cover the event-ordering hole —
but it shares the same philosophy: release on evidence, warn on silence,
never let a timer silently decide a transition is over.

## navNode-scoped barriers

The unit that owns a transition barrier is a **navigator node** (`navNodeId`),
not a route:

- `navNodeId` = the **parent route's key**, or `'<root>'` for top-level
  routes. Parent keys are unique in the tree, so same-named navigators under
  different parents can never share a barrier.
- A navNode has **at most one open barrier**. `transitionStart` opens it;
  `transitionEnd` on the _same navNode_ closes it — including an event fired
  by a sibling route, which is what releases the barrier on a pop (the
  closing screen's own `transitionEnd` may never fire because the screen
  unmounts mid-gesture).
- An open barrier on an ancestor navNode makes every descendant route's
  `hasPendingTransition` true.

## Tombstone route resolution

React Navigation dispatches the **state update for a pop before the
transition events** — when `transitionStart` arrives for the closing screen,
its route key may already be absent from the latest state. The route registry
therefore keeps a **tombstone**: the last-known `routeKey → navNodeId`
mapping for disappeared keys, retained while their navNode still has members
in the latest state or holds an open barrier. This lets a popped route's
`transitionStart` still resolve to (and open) the correct barrier.

A navNode with zero members in the latest state is dead: the coordinator
auto-closes its barriers (close reason `navnode-purged`) and purges its
tombstones and focus bookkeeping — so `reset()`/logout flows can never leak a
barrier that would block forever. Note the retention rule is applied inside
`rebuild` before the purge pass, so an open barrier alone does _not_ keep a
tombstone alive across a delivery that empties the navNode — it only keeps
the mapping resolvable during the rebuild itself.

Tombstones are additionally bounded to the 64 most recently removed routes
(FIFO): they exist only to resolve a late `transitionStart`, and events
older than that never arrive — while a long-lived navNode like `<root>`
would otherwise accumulate one dead key per pop for the app's lifetime.
`seenRouteKeys` (which backs the `untracked-route` warning) is pruned to
live + retained keys on every rebuild for the same reason.

## Gesture recovery

On `gestureCancel` the coordinator ensures the barrier stays open (or opens
one) with reason `gesture-recovery`. The recovery animation produces its own
`transitionEnd`, which closes the barrier normally.

**Barriers are never released by timers.** A barrier open longer than
`stallWarningMs` (default 4000ms) emits a single `stalled-transition` warning
— detection only. This trades "occasionally stuck + observable" for "never
silently runs heavy work mid-animation".

## focusEpoch edges

`focusEpoch` is a per-route counter that increments **only** on a
`focusedOnPath` false→true edge observed during a state rebuild:

- Push/pop refocus, tab switches that restore focus — each is one epoch.
- Barrier churn while the route stays focused does **not** bump it (barriers
  don't change `focusedOnPath`), so `mode: 'every-focus'` cannot double-fire
  on transition start/end pairs.
- The epoch survives tombstoning and is purged only when the navNode dies.
- `useAfterTransition('every-focus')` arms one dedupe-keyed task per epoch; a
  still-pending arm from a previous epoch is cancelled (latest-wins), so the
  callback runs at most once per epoch.

## Missing-adapter policy

If, ~2s after the first eligibility query, no navigation signal has ever
arrived (no state delivery, no navigator registration, no listener event —
i.e. `ready === false && navigatorCount === 0` persistently), the coordinator
emits a `missing-adapter` warning once. What happens to route scopes is a
policy decision (`missingAdapterPolicy`, default `'strict'`):

- **`'strict'` (fail closed, default)** — route scopes stay gated. A
  miswired app's tasks remain pending with a loud diagnostic rather than
  running heavy work ungated — possibly mid-transition, which would
  violate the library's core guarantee.
- **`'degraded'` (fail open, opt-in)** — all scopes become eligible after
  the detection window. Intended for deliberate standalone use (e.g.
  screens rendered outside a wired container in storybooks/tests).
  App-scoped tasks are unaffected by either policy.

The 2s delay is deliberate in both modes: navigator listener hooks register
in the first commit, _after_ their screen children render, so an instant
check would wrongly flag every correctly wired app during mount. Detection
is re-evaluated live — any later navigation signal cancels the check,
clears a degraded declaration, and resets the warning so a second unwired
window warns again.

## Event buffering

A transition event for a route key that cannot be resolved to a navNode at
all (e.g. it raced ahead of the state delivery) is **buffered** and replayed
on the next `setNavigationState`. Buffered events carry a ~2s TTL; expiry
drops the event with a `dropped-event` warning (including the last focus/blur
hint for that key, if any).

## The two invariants

**A — No route task starts while an ancestor barrier is open.**
Eligibility is re-read via `gate.isEligible(scopeId)` immediately before the
callback is invoked — not just at schedule time — so a scope that closed
between drain turns (e.g. a callback that opens a new transition) blocks the
remaining queue.

**B — Cancelled-before-start never runs.**
`status === 'pending'` and `!signal.aborted` are re-checked at the last
moment. Hook cleanups cancel on unmount, so deferred work can never fire into
a dead component.

## Scheduling policies

Two execution paths share one pending queue:

- **Transition tasks** (`scheduling: 'transition'`, the default for
  `useDeferredMount`/`useAfterTransition`) run in _drain turns_: a synchronous
  pass on every `schedule()` and every gate broadcast. A turn starts at most
  **`maxTasksPerTurn` (default 8)** tasks; leftover eligible work continues in
  the next macrotask via `setTimeout(0)`. This caps the JS work done in a
  single frame right after a transition ends. Scheduling inside a running
  callback marks the drain dirty instead of recursing.
- **Idle tasks** (`scheduling: 'idle'`, all `useIdleTask` work) run only
  inside `IdleHost` callbacks. The scheduler keeps **exactly one outstanding
  idle request** while eligible idle work exists; each callback runs at most
  one task and then re-requests. The outstanding request is cancelled the
  moment eligibility or the work disappears.

Global pick order is `user-visible` before `background`, FIFO within a
priority class — applied independently per scheduling mode.

**Idle revalidation**: the idle callback re-runs the full eligibility check at
fire time, so a task that became ineligible while waiting for the host (e.g.
focus flipped away mid-idle-window) is skipped rather than run stale.

The default `IdleHost` delegates to `globalThis.requestIdleCallback` /
`cancelIdleCallback` when both exist (they do on modern RN Hermes), otherwise
it synthesizes a `setTimeout(0)`-driven deadline whose `timeRemaining()`
reports the remainder of a 50ms budget (`didTimeout` is never forced).
`TimerHost`/`IdleHost` are injectable throughout, which is how the test suite
drives everything deterministically.
