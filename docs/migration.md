# Migration guide

Two independent migrations are covered here:

- **Part A** — moving the host app from React Navigation 6 to 7 (the version
  range this library's `/stack` entry targets: `>=7 <8`).
- **Part B** — replacing `InteractionManager` (and `setTimeout`-based) deferral
  with Smooth Task primitives.

---

## Part A — React Navigation 6 → 7 caveats

These are the v7 changes most likely to silently break an app while wiring
`useSmoothNavigationContainer` / `useSmoothStackListeners`. (See the official
[React Navigation 7 upgrade guide](https://reactnavigation.org/docs/upgrading-from-6.x)
for the full list.)

### A.1 `navigate` no longer descends into nested navigators

In v6, `navigation.navigate('Orders', { screen: 'Detail', params: {...} })`
could also _set the state_ of the nested navigator (passing `initial`,
`screen`, `params` etc. to configure it). In v7, `navigate` only navigates to
the route — it does not pass action options down into the child navigator.
To drive a nested navigator you now dispatch to it explicitly, e.g. via
`popTo`/`navigate` on the child ref, or set nested state through a deep link /
state restore.

```ts
// v6 — used to configure the nested navigator:
navigation.navigate('Orders', {
  screen: 'Detail',
  params: { orderId: '42' },
  initial: false,
});

// v7 — navigate still accepts nested params to *select* a screen inside the
// child, but it no longer mutates the child's state shape. Prefer explicit
// nested params and read them in the target screen:
navigation.navigate('Orders', {
  screen: 'Detail',
  params: { orderId: '42' },
});
```

```tsx
// The target screen reads its own params as usual — unchanged:
function OrderDetailScreen({ route }: Props) {
  const { orderId } = route.params; // { orderId: '42' }
}
```

If you relied on `initial: false` / `state:` payloads to reshape nested
navigators, move to `navigation.dispatch(CommonActions.reset(...))` or pass a
full state object at the container level.

### A.2 `navigate` no longer pops back to existing routes

In v6, `navigate('Feed')` would pop back to an existing `Feed` screen in the
stack. In v7 it always **pushes a new instance** (or navigates forward).
Use the dedicated actions:

```ts
// v7 — go back to an existing screen:
navigation.popTo('Feed'); // pop back to Feed
navigation.popTo('Feed', { q: 'abc' }); // …and update its params
navigation.popToTop(); // back to the first screen
```

This matters for Smooth Task because extra pushed copies mean extra route
keys — route scopes are keyed by `route.key`, so a duplicated screen is a
separate scope (and each gets its own deferred-mount latch).

### A.3 `animationEnabled: false` → `animation: 'none'`

The boolean `animationEnabled` screen option was removed; use the
`animation` option:

```tsx
// v6
<Stack.Screen name="Settings" options={{ animationEnabled: false }} />

// v7
<Stack.Screen name="Settings" options={{ animation: 'none' }} />
```

> **Verification caveat**: with `animation: 'none'`, whether and when
> `transitionEnd` fires for the listeners is part of the not-yet-verified
> device matrix — see `docs/compatibility.md` and `docs/testing.md` (T11).
> A barrier opened by `transitionStart` without a matching `transitionEnd`
> stays open (never timer-released); the coordinator emits a
> `stalled-transition` warning after 4s. If you use `animation: 'none'`
> heavily, verify on a real device before release.

### A.4 Other quick hits

- `useNavigation` no longer infers types from a global `RootParamList`
  augmentation — use typed navigators (`createStackNavigator<RootParamList>()`)
  and `useNavigation<NativeStackNavigationProp<...>>()`.
- Drawer/tab packages moved to new majors in lockstep — align all
  `@react-navigation/*` deps to 7.x together.

---

## Part B — `InteractionManager` → Smooth Task recipes

Each recipe shows the old pattern and the equivalent using
`react-native-smooth-task/stack` (route-scoped) — use the root entry instead
for app-scope work.

### B.1 Deferred mount — "mount the heavy part after the push animation"

```tsx
// Before
function FeedScreen() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);
  return ready ? <ExpensiveFeedList /> : <FeedSkeleton />;
}

// After
import { useDeferredMount } from 'react-native-smooth-task/stack';

function FeedScreen() {
  const ready = useDeferredMount(); // sticky — stays true on refocus
  return ready ? <ExpensiveFeedList /> : <FeedSkeleton />;
}

// Or, component form:
import { DeferredView } from 'react-native-smooth-task/stack';

<DeferredView fallback={<FeedSkeleton />}>
  <ExpensiveFeedList />
</DeferredView>;
```

The difference that matters: `runAfterInteractions` fires when the _global_
interaction queue drains — possibly mid-pop, possibly delayed by an unrelated
gesture elsewhere. `useDeferredMount` waits for _this route_ to be settled.

### B.2 Post-transition work — run once per arrival at a screen

```tsx
// Before
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => {
    analytics.logScreenView('order-detail');
    warmImageCache(order.imageUrls);
  });
  return () => task.cancel();
}, []);

// After — once per focus epoch (fires again if the user leaves and returns):
import { useAfterTransition } from 'react-native-smooth-task/stack';

useAfterTransition(
  () => {
    analytics.logScreenView('order-detail');
    warmImageCache(order.imageUrls);
  },
  { mode: 'every-focus' } // use 'once' (default) to run a single time
);
```

`onError` routes callback failures without breaking the queue:

```ts
useAfterTransition(reportScreen, {
  mode: 'every-focus',
  onError: (e) => logger.warn('after-transition failed', e),
});
```

### B.3 Background work — `useIdleTask` with cancellation

```tsx
// Before
useEffect(() => {
  const id = setTimeout(() => syncPendingOrders(), 1500);
  return () => clearTimeout(id);
}, []);

// After — runs inside an idle callback while this route is settled;
// cancelled automatically on unmount:
import { useIdleTask } from 'react-native-smooth-task/stack';

const scheduleIdle = useIdleTask();

useEffect(() => {
  const handle = scheduleIdle(
    async (signal) => {
      for (const batch of batches) {
        if (signal.aborted) return;
        await processBatch(batch);
      }
    },
    { key: 'sync-orders' } // same key re-scheduled → latest wins
  );
  return () => handle.cancel();
}, [scheduleIdle]);
```

### B.4 Fetch early, render late — start the request immediately, defer only the heavy render

The most common real-world pattern: you want the _network request_ to start
during the transition (it doesn't cost frames), but the _expensive list
render_ to wait. Split the two:

```tsx
import { DeferredView, useAfterTransition } from 'react-native-smooth-task/stack';

function OrderDetailScreen({ route }) {
  const { orderId } = route.params;
  // 1. Fetch starts on mount — runs during the animation, not after it.
  const { data } = useOrderQuery(orderId);

  // 2. Side-effect work waits for the settle.
  useAfterTransition(() => prefetchRelated(data?.relatedIds), {
    mode: 'every-focus',
  });

  // 3. Only the heavy subtree is deferred.
  return (
    <DeferredView fallback={<OrderDetailSkeleton />}>
      <HeavyOrderDetail order={data} />
    </DeferredView>
  );
}
```

`InteractionManager` couldn't express this split: everything behind
`runAfterInteractions` waits for the same global gate.

### Cheatsheet

| Old                                                           | New                                                      |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `InteractionManager.runAfterInteractions(cb)` gating a render | `useDeferredMount()` / `<DeferredView>`                  |
| `runAfterInteractions(cb)` for one post-transition effect     | `useAfterTransition(cb)` (`mode: 'once'`)                |
| `useFocusEffect` + `runAfterInteractions` to run per focus    | `useAfterTransition(cb, { mode: 'every-focus' })`        |
| `setTimeout` / hand-rolled idle queue for background sync     | `useIdleTask()` + `scheduleIdle(cb, { key })`            |
| `task.cancel()`                                               | `TaskHandle.cancel()` / unmount cleanup (automatic)      |
| `deadline.didTimeout`, `timeRemaining()` chunking             | Same idea — check `signal.aborted` between steps instead |
