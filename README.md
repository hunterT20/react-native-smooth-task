# react-native-smooth-task

**Transition-aware task scheduling for React Native.** Defer heavy rendering
and background work until navigation animations have _actually settled_ — not
until a timer guesses they have.

- Pure JS — no native code, no Reanimated, no `InteractionManager`
- Works with your existing `createStackNavigator` — no custom navigator needed
- Handles nested stacks, tabs, push/pop, swipe-back gestures (including cancelled
  ones), deep links, and app backgrounding
- TypeScript strict mode, zero `any` in the public API

---

## Contents

- [Why this exists](#why-this-exists)
- [Requirements](#requirements)
- [Installation](#installation)
- [Setup — 3 steps](#setup--3-steps)
- [Choosing the right hook](#choosing-the-right-hook)
- [Usage](#usage)
- [How it decides when to run](#how-it-decides-when-to-run)
- [Using it without navigation](#using-it-without-navigation)
- [Diagnostics](#diagnostics)
- [Troubleshooting](#troubleshooting)
- [API cheat sheet](#api-cheat-sheet)
- [Compatibility](#compatibility)
- [License](#license)

---

## Why this exists

A screen that mounts with heavy JS work — a long list, an expensive transform,
a large component tree — competes with the push/pop animation running at the
same time. The result: dropped frames mid-transition, janky gestures, and a
sluggish feel even on flagship devices.

The classic workaround is `InteractionManager.runAfterInteractions()`, but it
fits poorly today:

- **It's a global guess.** "All interactions are done" is not "this route's
  transition finished" — your work fires too early (animation still running)
  or too late (an unrelated interaction holds the queue).
- **It doesn't know focus.** A task scheduled by a screen the user already
  left still runs — wasted JS on a dead view.
- **It's legacy surface.** You shouldn't build new code on it.

`react-native-smooth-task` replaces the guesswork with a real eligibility
model. It watches the navigation **state tree** plus the stack's actual
`transitionStart` / `transitionEnd` / `gestureCancel` events, and runs your
task only while its owning route is **settled**:

> focused on the navigation path · no transition in flight on any ancestor
> navigator · app is active

---

## Requirements

| Dependency                       | Version        | Required?                                       |
| -------------------------------- | -------------- | ----------------------------------------------- |
| `react`                          | `>=19.1.1 <20` | yes                                             |
| `react-native`                   | `>=0.82 <1`    | yes                                             |
| `@react-navigation/native`       | `>=7.0.0 <8`   | only for the `/stack` · `/native-stack` entries |
| `@react-navigation/stack`        | `>=7.0.0 <8`   | only for the `/stack` entry                     |
| `@react-navigation/native-stack` | `>=7.0.0 <8`   | only for the `/native-stack` entry              |

> **Note** — the `@react-navigation/*` peers are _optional_. The root entry
> runs fully standalone (see [Using it without navigation](#using-it-without-navigation)).
> Only code imported from `react-native-smooth-task/stack` or
> `react-native-smooth-task/native-stack` touches them.

Verified on RN `0.87.1` + React Navigation `7.5.x` / Stack `7.12.x`. See
[docs/compatibility.md](docs/compatibility.md) for the full support matrix
and forward-compat status (RN 0.88, Navigation 8).

## Installation

```bash
# pick your package manager
pnpm add react-native-smooth-task
npm install react-native-smooth-task
yarn add react-native-smooth-task
```

If you use React Navigation, nothing else is needed — `@react-navigation/*`
is already in your app.

---

## Setup — 3 steps

### Step 1 · Wrap your app in `<SmoothTaskProvider>`

Put it at the root, _outside_ `NavigationContainer`:

```tsx
import { SmoothTaskProvider } from 'react-native-smooth-task';

export default function App() {
  return (
    <SmoothTaskProvider diagnostics={__DEV__}>
      <AppNavigation />
    </SmoothTaskProvider>
  );
}
```

The provider owns the scheduler + navigation coordinator for your whole tree.
`diagnostics={__DEV__}` turns on readable console logs in development
(details in [Diagnostics](#diagnostics)).

### Step 2 · Connect `NavigationContainer`

`useSmoothNavigationContainer` returns `{ onReady, onStateChange }` — spread
them onto the container. **Pass your `navigationRef`** (or `getRootState`) so
the initial state is delivered on ready:

```tsx
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { useSmoothNavigationContainer } from 'react-native-smooth-task';

const navigationRef = createNavigationContainerRef();

// IMPORTANT: this hook reads SmoothTask context, so it must live in a
// component INSIDE <SmoothTaskProvider> — not in the component that
// renders the provider.
function AppNavigation() {
  const observers = useSmoothNavigationContainer({ navigationRef });

  return (
    <NavigationContainer ref={navigationRef} {...observers}>
      <Root />
    </NavigationContainer>
  );
}
```

Already using `onReady` / `onStateChange` yourself? Pass them as options —
they're composed **after** the internal observers and never overridden:

```tsx
const observers = useSmoothNavigationContainer({
  navigationRef,
  onReady: () => splash.hide(),
  onStateChange: (state) => trackNavState(state),
});
```

### Step 3 · Attach listeners to each stack navigator

Both stack navigators are supported — pick the listener hook matching the
navigator type. For `createStackNavigator` (JS stack):

```tsx
import { createStackNavigator } from '@react-navigation/stack';
import { useSmoothStackListeners } from 'react-native-smooth-task/stack';

const HomeStack = createStackNavigator();

function HomeStackScreen() {
  const listeners = useSmoothStackListeners({ id: 'home' }); // `id` is a diagnostics label
  return (
    <HomeStack.Navigator screenListeners={listeners}>
      <HomeStack.Screen name="Feed" component={FeedScreen} />
      <HomeStack.Screen name="Post" component={PostScreen} />
    </HomeStack.Navigator>
  );
}
```

For `createNativeStackNavigator` (react-native-screens stack):

```tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSmoothNativeStackListeners } from 'react-native-smooth-task/native-stack';

const OrdersStack = createNativeStackNavigator();

function OrdersStackScreen() {
  const listeners = useSmoothNativeStackListeners({ id: 'orders' });
  return (
    <OrdersStack.Navigator screenListeners={listeners}>
      <OrdersStack.Screen name="List" component={OrderListScreen} />
      <OrdersStack.Screen name="Detail" component={OrderDetailScreen} />
    </OrdersStack.Navigator>
  );
}
```

Attach a listener to **every** stack navigator that animates screens —
**including nested ones** — and you can freely mix both navigator types in
one app (e.g. native stack for most screens, JS stack where you need custom
animations).

> **Native-stack event notes.** Its events are driven by the native side
> (react-native-screens): `gestureCancel` is iOS-only (Android never emits
> it, which is harmless), and `transitionStart`/`transitionEnd` correlate
> with the native transition rather than a JS animation clock.
>
> **Navigators with animation fully disabled** — pass
> `animationEnabled: false` to the listener hook so no barrier ever opens
> (applies to both adapters). For mixed navigators, a lost `transitionEnd`
> leaves the barrier open and `stalled-transition` warns after ~4s — the
> barrier never auto-releases on a timer by design.

> **Do I need this on tabs / drawers / custom navigators?** No. Focus for
> non-stack navigators is derived from the state tree automatically — only
> stack transitions emit events that need listening to. Missing listeners on
> a stack won't break anything, but that navigator's transitions won't block
> its tasks (they'll run as soon as the route is focused).

That's all the wiring. A complete app looks like this — check
[`example/`](example/) for the full runnable-style version:

```tsx
SmoothTaskProvider
└── AppNavigation            // useSmoothNavigationContainer({ navigationRef })
    └── NavigationContainer
        └── RootStack        // screenListeners={useSmoothStackListeners({id:'root'})}
            ├── MainTabs     // tabs — no listeners needed
            │   ├── HomeStackScreen   // useSmoothStackListeners({id:'home'})
            │   └── OrdersStackScreen // useSmoothNativeStackListeners({id:'orders'})
            └── Settings
```

---

## Choosing the right hook

| You want to…                                                           | Use                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| Show a skeleton until the transition settles, then mount heavy UI      | `useDeferredMount` or `<DeferredView>`            |
| Run work once when a screen is ready (analytics, warm caches, logging) | `useAfterTransition(cb, { mode: 'once' })`        |
| Run work every time the user focuses the screen                        | `useAfterTransition(cb, { mode: 'every-focus' })` |
| Schedule cancelable low-priority work in idle time                     | `useIdleTask()`                                   |

Two flavors of each exist — **pick the import path deliberately**:

```tsx
// App scope — never gated by navigation. No nav wiring required.
import { useDeferredMount } from 'react-native-smooth-task';

// Route scope — gated by the current route's settled status.
// Requires React Navigation + the setup steps above. Both entries export
// the same route-scoped hooks — pick the one matching your navigator.
import { useDeferredMount } from 'react-native-smooth-task/stack';
// …or: 'react-native-smooth-task/native-stack'
```

## Usage

### `useDeferredMount` — defer heavy render until the route settles

```tsx
import { useDeferredMount } from 'react-native-smooth-task/stack';

function FeedScreen() {
  const ready = useDeferredMount(); // false while the push animation runs

  if (!ready) return <FeedSkeleton />;
  return <ExpensiveFeedList />;
}
```

The latch is **sticky**: once `ready` is `true` it stays `true` for the
component's lifetime — blur, refocus, or a modal opening/closing above it
never resets it. (Unmount → remount starts fresh, which is what you want.)

Component form:

```tsx
import { DeferredView } from 'react-native-smooth-task/stack';

<DeferredView fallback={<PostSkeleton />}>
  <ExpensivePostBody />
</DeferredView>;
```

### `useAfterTransition` — run work after the transition

```tsx
import { useAfterTransition } from 'react-native-smooth-task/stack';

function FeedScreen() {
  // Runs once, when this route first settles:
  useAfterTransition(() => {
    warmImageCache();
  });

  // Runs once per focus (return visits included):
  useAfterTransition(
    () => {
      analytics.logScreenView('feed');
    },
    { mode: 'every-focus' }
  );
}
```

Options: `mode` (`'once'` | `'every-focus'`), `scheduling` (`'transition'` |
`'idle'`), `onError(error)` for thrown/rejected callbacks.

Semantics worth knowing:

- `'once'` means **started at most once** — if the task is cancelled before
  it starts (unmount, screen never settles) it simply never runs; if the
  callback throws it is reported via `onError`/`task-failed` and is **not**
  retried.
- `every-focus` arms one task per focus epoch — a still-pending arm from a
  previous epoch is cancelled (latest-wins), so the callback runs at most
  once per epoch.

> `every-focus` only makes sense on **route** scopes — app scope has no
> "focus", so it behaves like `'once'` there.

### `useIdleTask` — cancelable background work in idle time

```tsx
import { useIdleTask } from 'react-native-smooth-task/stack';
import { useEffect } from 'react';

function FeedScreen() {
  const scheduleIdle = useIdleTask();

  useEffect(() => {
    const handle = scheduleIdle(
      async (signal) => {
        await prefetchAvatars(signal);
      },
      { key: 'prefetch-avatars', priority: 'background' }
    );
    return () => handle.cancel(); // also auto-cancelled on unmount
  }, [scheduleIdle]);
}
```

- Runs inside `requestIdleCallback`-style idle time, **only while the scope
  is eligible** — a route transition pauses it; eligibility is re-checked at
  the last moment before it starts.
- `key` dedupes within the scope: scheduling again with a _pending_ key
  cancels the previous task ("latest wins"). A task that already _started_
  is never deduped — the new task simply queues behind it.
- Every callback gets an `AbortSignal` — check `signal.aborted` in long async
  work to cooperate with cancellation.

### Recipe — fetch early, render late

The highest-leverage pattern: start the network request immediately, defer
only the heavy render. The request itself is mostly off the JS thread, but
keep response parsing/normalization light — that part still runs on JS and
can compete with the transition if it is heavy.

```tsx
function DetailScreen({ id }) {
  const ready = useDeferredMount(); // render gate
  const query = useDetailQuery(id); // fetch starts NOW, not after transition

  if (!ready) return <DetailSkeleton />;
  return <HeavyDetail data={query.data} />; // likely already loaded
}
```

By the time the animation ends, the data is usually back — the skeleton shows
during the transition instead of a blank-heavy mount _and_ a fetch wait.

---

## How it decides when to run

A **route-scoped** task starts only when its route is _settled_:

- ✅ it exists in the delivered navigation state
- ✅ it's on the focused path — selected by `index` at **every** ancestor
  level (so a screen in a background tab doesn't count)
- ✅ no open transition barrier on its own navigator or any ancestor
  navigator — including push, pop, and swipe-back recovery
- ✅ navigation state has been delivered at least once
- ✅ the app is in the foreground (`pauseInBackground`, on by default)

**App-scoped** tasks (`app`) skip all of this — they're for app-level work
that should not wait on UI transitions at all.

A few behavioral guarantees worth knowing:

- **Cancelled before start ⇒ never runs.** All hook tasks are cancelled on
  unmount, and every task re-checks its `AbortSignal` + eligibility at the
  last instant.
- **Errors can't kill the queue.** A throw/rejection marks only that task
  `failed`, calls `onError`, emits a diagnostic — siblings keep flowing.
- **No timer-based guesses.** Barriers close only on real `transitionEnd`
  (or navigator teardown). A barrier stuck open emits a `stalled-transition`
  warning after ~4s — diagnostics only, never auto-released.
- **Cancelled swipe-backs are safe.** `gestureCancel` holds the barrier open
  until the recovery animation's `transitionEnd` — nothing fires early.
- **Same-name navigators are safe.** Identities are per-instance; a nested
  `OrdersStack` transition never blocks `HomeStack` routes.

## Using it without navigation

The root entry needs only the provider — hooks then run in the `app` scope
(eligible immediately, never gated):

```tsx
import { SmoothTaskProvider, useDeferredMount } from 'react-native-smooth-task';

<SmoothTaskProvider>
  <App />
</SmoothTaskProvider>;
```

If you _do_ have navigation but the wiring is missing (no container hook,
no stack listeners), the coordinator emits a `missing-adapter` warning
after ~2s and **keeps route-scoped tasks gated** (default policy:
`missingAdapterPolicy="strict"`). A miswired app fails closed — skeletons
stay visible with a loud diagnostic — instead of silently running heavy
work during transitions.

For deliberate ungated fallback (e.g. screens rendered outside a wired
container in storybooks/tests), opt in explicitly:

```tsx
<SmoothTaskProvider missingAdapterPolicy="degraded">
  <App />
</SmoothTaskProvider>
```

> Route-scoped hooks still call `useRoute()` internally — they must render
> inside a navigator regardless of policy.

## Diagnostics

Pass `diagnostics` to the provider to watch scheduling decisions:

```tsx
// Human-readable console output: [smooth-task] <code> — <message>
<SmoothTaskProvider diagnostics={true}>

// Or route events anywhere (Sentry, dev overlay, logs):
<SmoothTaskProvider diagnostics={{ emit: (event) => myLogger.log(event) }}>
```

Every event carries `code`, `level`, `scopeId`/`routeKey`, `details`,
`timestamp`. The ones you'll actually look at:

| Code                    | Level | Meaning                                                                                 |
| ----------------------- | ----- | --------------------------------------------------------------------------------------- |
| `task-failed`           | error | A callback threw — `details.error` has it                                               |
| `stalled-transition`    | warn  | Barrier open >4s — a `transitionEnd` may never have arrived                             |
| `missing-adapter`       | warn  | No nav wiring after ~2s — route tasks stay gated (strict) or ungate (`degraded` policy) |
| `missing-nav-ref`       | warn  | `onReady` couldn't resolve initial state — pass `navigationRef`                         |
| `untracked-route`       | warn  | Task queried for a route key never seen in the state tree                               |
| `barrier-opened/closed` | debug | Transition lifecycle per navigator                                                      |

Full catalog: [docs/api.md — Diagnostic codes](docs/api.md#diagnostic-codes).

## Troubleshooting

| Symptom                                            | Likely cause                                                                                              | Fix                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `useDeferredMount` never turns `true` on a screen  | That stack navigator is missing `screenListeners`, **or** route isn't focused                             | Add `useSmoothStackListeners` to every stack with animated screens; check `untracked-route` warn                                |
| Nothing runs and you see `missing-nav-ref` warning | `onReady` had no way to read initial state                                                                | Pass `navigationRef` (or `getRootState`) to `useSmoothNavigationContainer`                                                      |
| `missing-adapter` warning + route tasks never run  | No nav wiring reached the coordinator for ~2s — strict policy is failing closed as designed               | Complete setup steps 2–3, or pass `missingAdapterPolicy="degraded"` if ungated was intended                                     |
| `must be used within <SmoothTaskProvider>` throw   | Hook called above/outside the provider (incl. `useSmoothNavigationContainer` next to the provider itself) | Move container wiring into a child component                                                                                    |
| `useRoute()`-related error outside a screen        | Route-scoped (`/stack` or `/native-stack`) hooks used outside a route                                     | Render inside a screen, or use the app-scope version from the root entry                                                        |
| `every-focus` fires only once                      | Used from the root entry — `app` scope has no focus epochs                                                | Import the route-scoped version from `/stack` or `/native-stack`                                                                |
| Task "ran during the animation"                    | That screen's navigator has no listeners attached, or route was already settled                           | Attach `useSmoothStackListeners` to the owning stack                                                                            |
| Screens with `animation: 'none'`                   | Whole navigator is non-animated, or a `transitionEnd` was lost mid-stack                                  | Fully non-animated navigator → `useSmoothStackListeners({ animationEnabled: false })`; otherwise `stalled-transition` warns ~4s |

## API cheat sheet

```ts
// Root entry — app scope (no navigation needed)
SmoothTaskProvider({ diagnostics?, pauseInBackground?, missingAdapterPolicy? })
useDeferredMount({ scheduling? }): boolean
useAfterTransition(cb, { mode?, scheduling?, onError? }): void
useIdleTask(): (cb, { key?, priority? }) => TaskHandle
<DeferredView fallback? scheduling?>…</DeferredView>
useSmoothNavigationContainer({ navigationRef?, getRootState?, onReady?, onStateChange? })

// react-native-smooth-task/stack — route scope (JS stack)
useSmoothStackListeners({ id?, animationEnabled? }): ScreenListeners   // → screenListeners prop

// react-native-smooth-task/native-stack — route scope (native stack)
useSmoothNativeStackListeners({ id?, animationEnabled? }): ScreenListeners

// both adapter entries also export, route-bound:
useDeferredMount / useAfterTransition / useIdleTask / DeferredView
```

Defaults: `useDeferredMount` → `scheduling: 'transition'` (user-visible);
`useAfterTransition` → `mode: 'once'` (started once, never retried);
`useIdleTask` → `priority: 'background'`, `scheduling: 'idle'`;
`pauseInBackground` → `true`; `missingAdapterPolicy` → `'strict'`.

Full signatures and semantics: [docs/api.md](docs/api.md).

## Compatibility

Verified baseline (registry-checked 2026-10-15): **RN 0.87.1 ·
@react-navigation/native 7.5.1 · @react-navigation/stack 7.12.1 · React
19.3.1**. The peer floor (`RN 0.82` / Nav `7.0` / React `19.1.1`) is a
**declared candidate, not yet verified** — treat it as experimental until
the compatibility matrix in
[docs/compatibility.md](docs/compatibility.md) covers it with CI runs.
RN 0.88 RC and Navigation 8
are forward-compat targets under a separate test matrix — not release blockers.

Adapters exist for both `@react-navigation/stack` (JS stack) and
`@react-navigation/native-stack` ≥7. Native-stack event fidelity is driven
by react-native-screens on the native side — adapter forwarding and gating
are unit-tested, but real-device gesture/transition timing for native-stack
is pending device validation (tracked in
[docs/testing.md](docs/testing.md)).

## Docs

- [API reference](docs/api.md)
- [Architecture](docs/architecture.md)
- [Compatibility](docs/compatibility.md)
- [Testing & benchmarks](docs/testing.md)
- [Migration guide](docs/migration.md) — React Navigation 6→7 & InteractionManager recipes
- [Example app](example/)

## License

[MIT](LICENSE)
