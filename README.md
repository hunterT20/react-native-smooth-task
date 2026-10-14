# react-native-smooth-task

Transition-aware task scheduling for React Native. Defer heavy rendering and
background work until navigation animations have actually settled — not until a
timer guesses they have.

JS-only library: no native code, no Reanimated dependency, no
`InteractionManager`.

## The problem

A screen that mounts with heavy JS work — large lists, expensive transforms,
big subtrees — competes with the push/pop animation running at the same time.
The result is dropped frames mid-transition, janky gestures, and a sluggish
feel even on fast devices.

The traditional escape hatch is `InteractionManager.runAfterInteractions()`,
but it is a poor fit today:

- It is a global, heuristic gate: "all interactions done" is not the same as
  "this route's transition finished". Work either fires too early (animation
  still in flight) or too late (an unrelated interaction keeps it queued).
- It has no notion of route focus — a task scheduled by a screen the user has
  already navigated away from still runs.
- It is effectively unmaintained API surface; React Navigation 7 still uses it
  internally for some gestures, but only behind conditional paths — app code
  should not depend on it.

`react-native-smooth-task` replaces the guesswork with a real eligibility
model: it observes the navigation **state tree** and the stack's actual
`transitionStart` / `transitionEnd` / `gestureCancel` events, then only runs
your task while the owning route is _settled_ — focused on the navigation path,
no transition in flight on any ancestor navigator, and the app active.

## The primitives

Four primitives cover the common patterns. Each exists in two flavors:

- **App scope** (`react-native-smooth-task`) — never gated by navigation. Works
  with zero navigation wiring.
- **Route scope** (`react-native-smooth-task/stack`) — gated by the current
  route's settled status. Requires React Navigation wiring (below).

| Primitive                                | What it does                                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useDeferredMount(options?)`             | Returns `false` until the scope is eligible, then latches `true` permanently (sticky latch — blur/refocus never resets it). Use to swap a skeleton for the real heavy subtree. |
| `useAfterTransition(callback, options?)` | Runs `callback` once the scope is eligible. `mode: 'every-focus'` re-runs once per route focus epoch (route scopes only).                                                      |
| `useIdleTask()`                          | Returns a stable `scheduleIdle(callback, { key, priority })` function for cancelable background work that runs inside idle callbacks while the scope is eligible.              |
| `DeferredView`                           | Component form of `useDeferredMount`: renders `fallback` until ready, then `children`.                                                                                         |

All scheduled callbacks receive an `AbortSignal`; everything pending is
cancelled on unmount, and a task cancelled before it starts is guaranteed
never to run.

## Install

```bash
pnpm add react-native-smooth-task
# or
npm install react-native-smooth-task
```

Peer requirements: `react >=19.1.1 <20`, `react-native >=0.82 <1`.

The **root entry works without any navigation library**. The
`react-native-smooth-task/stack` entry additionally needs the optional peers
`@react-navigation/native` and `@react-navigation/stack` (`>=7 <8`). If your
app uses React Navigation you already have them.

## Quick start

Three pieces of wiring, then the hooks:

```tsx
// App.tsx
import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SmoothTaskProvider, useSmoothNavigationContainer } from 'react-native-smooth-task';
import { useSmoothStackListeners } from 'react-native-smooth-task/stack';

const navigationRef = createNavigationContainerRef();
const RootStack = createStackNavigator();
const Tab = createBottomTabNavigator();
const HomeStack = createStackNavigator();
const OrdersStack = createStackNavigator();

function HomeStackScreen() {
  // Every stack navigator that pushes/pops screens gets its own listeners.
  const listeners = useSmoothStackListeners({ id: 'home' });
  return (
    <HomeStack.Navigator screenListeners={listeners}>
      <HomeStack.Screen name="Feed" component={FeedScreen} />
      <HomeStack.Screen name="Post" component={PostScreen} />
    </HomeStack.Navigator>
  );
}

function OrdersStackScreen() {
  const listeners = useSmoothStackListeners({ id: 'orders' });
  return (
    <OrdersStack.Navigator screenListeners={listeners}>
      <OrdersStack.Screen name="List" component={OrdersScreen} />
      <OrdersStack.Screen name="Detail" component={OrderDetailScreen} />
    </OrdersStack.Navigator>
  );
}

function MainTabs() {
  // Tabs need no listeners: focus ancestry comes from the state tree.
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeStackScreen} />
      <Tab.Screen name="Orders" component={OrdersStackScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const listeners = useSmoothStackListeners({ id: 'root' });
  return (
    <RootStack.Navigator screenListeners={listeners}>
      <RootStack.Screen name="MainTabs" component={MainTabs} />
      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ presentation: 'modal' }}
      />
    </RootStack.Navigator>
  );
}

// useSmoothNavigationContainer reads the provider's context, so it must run
// in a child of <SmoothTaskProvider> — keep the container wiring in its own
// component.
function AppNavigation() {
  // Spread the returned observers onto NavigationContainer. Pass
  // `navigationRef` (or `getRootState`) so the initial state is delivered
  // on ready — your own onReady/onStateChange are composed after, never
  // overridden.
  const observers = useSmoothNavigationContainer({ navigationRef });
  return (
    <NavigationContainer ref={navigationRef} {...observers}>
      <Root />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SmoothTaskProvider diagnostics={__DEV__}>
      <AppNavigation />
    </SmoothTaskProvider>
  );
}
```

Then inside any screen, import the **route-scoped** variants from
`react-native-smooth-task/stack`:

```tsx
import { useDeferredMount, DeferredView } from 'react-native-smooth-task/stack';

function FeedScreen() {
  // false while the push animation is in flight; flips true once this route
  // is settled, and stays true for the component's lifetime.
  const ready = useDeferredMount();

  if (!ready) return <FeedSkeleton />;
  return <ExpensiveFeedList />;
}

// Or the component form:
function PostScreen() {
  return (
    <DeferredView fallback={<PostSkeleton />}>
      <ExpensivePostBody />
    </DeferredView>
  );
}
```

```tsx
import { useAfterTransition, useIdleTask } from 'react-native-smooth-task/stack';

function FeedScreen() {
  // Once per focus epoch of this route:
  useAfterTransition(
    () => {
      analytics.logScreenView('feed');
    },
    { mode: 'every-focus' }
  );

  // Idle background work that pauses during transitions:
  const scheduleIdle = useIdleTask();
  useEffect(() => {
    const handle = scheduleIdle(
      async (signal) => {
        await prefetchAvatars(signal);
      },
      { key: 'prefetch-avatars' }
    );
    return () => handle.cancel();
  }, [scheduleIdle]);

  // …
}
```

## Standalone usage (no navigation)

The root entry works with just the provider — hooks run in the `app` scope,
which is eligible immediately while the app is running and is never gated by
navigation or AppState:

```tsx
import { SmoothTaskProvider, useDeferredMount } from 'react-native-smooth-task';

<SmoothTaskProvider>
  <App />
</SmoothTaskProvider>;
```

If the app has navigation but never wires `useSmoothNavigationContainer` /
`useSmoothStackListeners` (so no state or navigator registration ever reaches
the coordinator), the coordinator detects the missing adapter after a ~2s
window and switches to a degraded standalone mode where all scopes become
eligible (with a `missing-adapter` warning) — work runs ungated rather than
deadlocking. Note route-scoped hooks still call `useRoute()` internally, so
they must render inside a navigator.

## Diagnostics

Pass `diagnostics` to the provider to observe scheduling decisions:

- `diagnostics={true}` — human-readable console output
  (`[smooth-task] <code> — <message>`), by level.
- `diagnostics={{ emit(event) {...} }}` — any custom sink.
- omitted — noop.

Events carry a stable `code` (`task-scheduled`, `barrier-opened`,
`stalled-transition`, `missing-adapter`, `untracked-route`, …), plus `level`,
`scopeId`/`routeKey`, `details` and `timestamp`. The full catalog is in
[docs/api.md](docs/api.md#diagnostic-codes).

## Docs

- [API reference](docs/api.md)
- [Architecture](docs/architecture.md)
- [Compatibility](docs/compatibility.md)
- [Testing & benchmarks](docs/testing.md)
- [Migration guide](docs/migration.md) (React Navigation 6→7, InteractionManager)
- [Example app](example/)

## TypeScript

Shipped with strict-mode types (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`). No `any` leaks in the public surface.

## License

MIT
