# API reference

`react-native-smooth-task` ships three entry points:

| Entry point                             | Scope                                                                                                     | Navigation required?                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `react-native-smooth-task`              | `app` scope — always eligible while the app runs; never gated by navigation state or AppState             | No                                                                  |
| `react-native-smooth-task/stack`        | `route:<key>` scope of the current route (`useRoute().key`) — tasks run only while the route is _settled_ | Yes — `@react-navigation/native` + `@react-navigation/stack`        |
| `react-native-smooth-task/native-stack` | Same as `/stack`                                                                                          | Yes — `@react-navigation/native` + `@react-navigation/native-stack` |

A route is **settled** when all of the following hold:

- the route key exists in the latest delivered navigation state,
- the route is on the focused path (`index` selects it at every ancestor level),
- no transition barrier is open on any navigator along its ancestor path,
- at least one navigation state has been delivered (`ready`),
- the app is in `active` AppState (unless `pauseInBackground={false}`).

All hooks throw
`react-native-smooth-task: <hook> must be used within <SmoothTaskProvider>`
when no provider is present.

---

## `react-native-smooth-task` (root entry)

### `SmoothTaskProvider`

```tsx
function SmoothTaskProvider(props: SmoothTaskProviderProps): ReactElement;

interface SmoothTaskProviderProps {
  children?: ReactNode;
  diagnostics?: boolean | { emit(event: DiagnosticEvent): void };
  pauseInBackground?: boolean; // default: true
  missingAdapterPolicy?: 'strict' | 'degraded'; // default: 'strict'
}
```

Owns the `NavigationCoordinator` + `TaskScheduler` pair for the tree below it.
Both are created exactly once and disposed on unmount.

- **`diagnostics`** — `true` enables the console sink
  (`[smooth-task] <code> — <message>`); an object with `emit` is used as a
  custom sink; `undefined` (default) is a noop. A throwing sink is isolated and
  can never break scheduling. Events also fan out to
  `context.diagnostics.subscribe` listeners (see `useSmoothTask`).
- **`pauseInBackground`** (default `true`) — forwards `AppState` changes to
  the coordinator; while the app is not `active`, **route** scopes are
  ineligible. App-scoped tasks are never affected. When `false`, no AppState
  subscription is created at all.
- **`missingAdapterPolicy`** (default `'strict'`) — what happens when no
  navigation wiring reaches the coordinator ~2s after the first eligibility
  query (no state delivery, no navigator registration):
  - `'strict'` — a `missing-adapter` warning fires once and route scopes
    **stay gated**: a miswired app fails closed instead of running heavy
    work ungated mid-transition.
  - `'degraded'` — opt-in fallback: all scopes become eligible after the
    window (a no-navigation app's behavior), for screens deliberately
    rendered outside a wired container (storybooks, tests).
  - Either way: wiring that appears later restores normal gating
    immediately; app-scoped tasks are never affected.

### `useDeferredMount`

```ts
function useDeferredMount(options?: DeferredMountOptions): boolean;

interface DeferredMountOptions {
  scheduling?: SchedulingMode; // 'transition' (default) | 'idle'
}
```

Returns `false` until the deferred-mount task runs, then `true`.

- **Sticky latch**: once `true` it never resets for the component's lifetime —
  blur/refocus, barrier churn and AppState changes do not un-ready it. Only an
  unmount/remount resets it.
- Scheduled with priority `'user-visible'` and `scheduling` `'transition'` by
  default; `scheduling: 'idle'` defers the flip to an idle callback.
- The pending task is cancelled on unmount — it can never fire after the
  component is gone.
- Root-entry variant uses the `app` scope: eligible immediately, never gated.

### `useAfterTransition`

```ts
function useAfterTransition(callback: TaskCallback, options?: AfterTransitionOptions): void;

interface AfterTransitionOptions {
  mode?: 'once' | 'every-focus'; // default: 'once'
  scheduling?: SchedulingMode; // default: 'transition'
  onError?: (error: unknown) => void;
}
```

Schedules `callback(signal)` to run when the scope is eligible.

- **`mode: 'once'`** (default): **started at most once**. A task cancelled
  before it starts (unmount, scope never eligible) simply never runs; a
  callback that throws is reported via `onError`/`task-failed` and is never
  retried — "once" means armed once, not "completed successfully once".
- **`mode: 'every-focus'`**: arms a fresh task each time the route's
  `focusEpoch` increments (a `focusedOnPath` false→true edge). One run per
  epoch — barrier churn while focused does not re-fire, and a still-pending
  arm from a previous epoch is cancelled via dedupe so the callback can only
  ever run once per epoch. **On non-route scopes it behaves exactly like
  `'once'`.**
- The latest `callback`/`options` are read through refs updated in the commit
  phase: passing a new inline function every render never reschedules and never
  goes stale.
- Errors (sync throw or async rejection) are routed to `onError` and emit a
  `task-failed` diagnostic; the queue is never broken. An `onError` that itself
  throws is swallowed.

### `useIdleTask`

```ts
function useIdleTask(): (callback: TaskCallback, options?: IdleTaskOptions) => TaskHandle;

interface IdleTaskOptions {
  key?: string; // dedupe key, see below
  priority?: TaskPriority; // 'user-visible' | 'background' (default)
}

interface TaskHandle {
  cancel(): void;
}
```

Returns a stable `scheduleIdle` function (referentially identical across
renders). Each call enqueues a task with `scheduling: 'idle'` and
`priority: 'background'` by default — it executes inside an idle callback
(`requestIdleCallback` when the host provides it, a `setTimeout(0)` fallback
otherwise) while the scope is eligible.

- **Dedupe — latest wins per scope+key**: scheduling with a `key` that matches
  a still-pending task in the same scope cancels the previous task. A running
  task is never deduped.
- All tasks created through the returned function are tracked and cancelled on
  unmount; `handle.cancel()` also removes the task from tracking.
- Cancellation is cooperative: pending tasks never start; a running task's
  `signal` is aborted (see the AbortSignal contract below).

### `DeferredView`

```tsx
function DeferredView(props: DeferredViewProps): ReactElement;

interface DeferredViewProps {
  fallback?: ReactNode; // rendered until ready; default: null
  scheduling?: DeferredMountOptions['scheduling'];
  children?: ReactNode;
}
```

Component form of `useDeferredMount` in the `app` scope: renders `fallback`
until the deferred-mount task runs, then renders `children` — permanently
(sticky latch).

### `useSmoothNavigationContainer`

```ts
function useSmoothNavigationContainer(
  options?: SmoothNavigationContainerOptions
): NavigationContainerObservers;

interface SmoothNavigationContainerOptions {
  getRootState?: () => NavigationTreeState | null | undefined;
  navigationRef?: {
    current?: { getRootState?: () => NavigationTreeState | null | undefined } | null;
  } | null;
  onReady?: () => void;
  onStateChange?: (state: NavigationTreeState | undefined) => void;
}

interface NavigationContainerObservers {
  onReady(): void;
  onStateChange(state: NavigationTreeState | undefined): void;
}
```

Produces the `onReady` / `onStateChange` props for `<NavigationContainer>` so
the coordinator sees the state tree:

```tsx
const navigationRef = createNavigationContainerRef();
const observers = useSmoothNavigationContainer({ navigationRef });

<NavigationContainer ref={navigationRef} {...observers}>
```

Like every hook here, it reads the provider's context — call it in a
component **inside** `<SmoothTaskProvider>` (a dedicated child that renders
the container), not in the component that renders the provider itself.

- **State resolution on ready**: `getRootState()` is consulted first, then
  `navigationRef.current.getRootState()`. If neither resolves a state, a
  one-time `missing-nav-ref` warning is emitted and the coordinator falls back
  to the first `onStateChange` delivery.
- **Composition**: internal observers always run first; your `onReady` /
  `onStateChange` are called after, from the same handler — they are composed,
  never overridden or dropped.
- The returned object is referentially stable; options are read through a ref
  so inline callbacks are always current.

### `useSmoothTask` / `SmoothTaskContext`

```ts
const SmoothTaskContext: Context<SmoothTaskContextValue | null>;
function useSmoothTask(hookName?: string): SmoothTaskContextValue;

interface SmoothTaskContextValue {
  scheduler: TaskScheduler;
  coordinator: NavigationCoordinator;
  diagnostics: Diagnostics; // emit + subscribe
}
```

Escape hatch to the internals (e.g. subscribing to diagnostics). Throws when
called outside `SmoothTaskProvider`; `hookName` is used in the error message.

### Types

```ts
type SchedulingMode = 'transition' | 'idle';
type TaskPriority = 'user-visible' | 'background';
type TaskCallback = (signal: AbortSignal) => void | Promise<void>;

interface TaskHandle {
  cancel(): void;
}

type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';
interface DiagnosticEvent {
  level: DiagnosticLevel;
  code: string;
  message: string;
  scopeId?: string;
  routeKey?: string;
  details?: Record<string, unknown>;
  timestamp: number;
}
interface DiagnosticsSink {
  emit(event: DiagnosticEvent): void;
}
```

Also re-exported: `DeferredMountOptions`, `AfterTransitionOptions`,
`IdleTaskOptions`, `SmoothTaskContextValue`, `SmoothTaskProviderProps`,
`DeferredViewProps`, `NavigationContainerObservers`,
`UseSmoothNavigationContainerOptions`, `SmoothNavigationContainerOptions`.

---

## `react-native-smooth-task/stack` (route-scoped entry)

Requires `@react-navigation/native` and `@react-navigation/stack` (optional
peers). `useDeferredMount`, `useAfterTransition`, `useIdleTask` and
`DeferredView` have **identical signatures and options** to the root entry —
the only difference is that they bind to `routeScopeId(useRoute().key)`
instead of `APP_SCOPE_ID`. They must be rendered inside a route (they call
`useRoute()`).

Route-scope specifics:

- Tasks are eligible only while the current route is settled (see the top of
  this document). A task scheduled while a transition is in flight stays
  pending; `useDeferredMount`'s latch still never resets once ready.
- `useAfterTransition` with `mode: 'every-focus'` gets real per-epoch behavior:
  one run each time the route refocuses (`focusEpoch` increment), not merely
  once.
- Leaving `pauseInBackground` at its default also gates these tasks on AppState.

### `useSmoothStackListeners`

```ts
function useSmoothStackListeners(options?: SmoothStackListenersOptions): SmoothStackListeners;

interface SmoothStackListenersOptions {
  id?: string; // diagnostics label only
  animationEnabled?: boolean; // default: true — see below
}

interface SmoothStackListeners {
  transitionStart(e?: StackListenerEvent<'transitionStart'>): void;
  transitionEnd(e?: StackListenerEvent<'transitionEnd'>): void;
  gestureCancel(e?: StackListenerEvent<'gestureCancel'>): void;
  focus(e?: StackLifecycleEvent): void;
  blur(e?: StackLifecycleEvent): void;
}
```

Call once per stack navigator and pass the result to `screenListeners`:

```tsx
function HomeStackScreen() {
  const listeners = useSmoothStackListeners({ id: 'home' });
  return <HomeStack.Navigator screenListeners={listeners}>…</HomeStack.Navigator>;
}
```

- Each hook instance registers a unique navigator instance
  (`stack:<id|anon>:<n>`) on mount and unregisters on unmount — same-`id`
  navigators never collide; `id` is a diagnostics label, not an identity.
- Handlers forward `e.target` (the route key the event fired for) to the
  coordinator as `transitionStarted` / `transitionFinished` /
  `gestureCancelled` / `routeFocused` / `routeBlurred`. Events without a string
  `target` are ignored defensively.
- `focus`/`blur` are diagnostics hints only — authoritative focus comes from
  the navigation state tree delivered via `useSmoothNavigationContainer`.
- The returned object is referentially stable for the lifetime of the hook; no
  `screenOptions` or component wrapping is needed.
- **`animationEnabled: false`** — for navigators whose screens disable
  animation entirely (JS stack `screenOptions={{ animationEnabled: false }}`,
  native-stack `animation: 'none'`). All three transition events
  (`transitionStart`/`transitionEnd`/`gestureCancel`) are then ignored, so no
  barrier ever opens and tasks settle on focus alone. This exists because a
  `transitionStart` without a matching `transitionEnd` would otherwise keep
  the barrier open forever (only a `stalled-transition` warning fires — by
  design, timers never auto-release barriers). **Per-screen** `animation:
'none'` on an otherwise animated navigator cannot be detected at the
  screenListeners level — keep the default for mixed navigators.

Non-stack navigators (tabs, drawers) need no listener wiring: their focus is
derived from `index` in the state tree on every `onStateChange`.

Also re-exported from `/stack`: `SmoothStackListeners`, `StackListenerEvent`,
`StackLifecycleEvent`, `SmoothStackListenersOptions`, `DeferredViewProps`,
`DeferredMountOptions`, `AfterTransitionOptions`, `IdleTaskOptions`,
`TaskHandle`, `TaskCallback`.

### `useSmoothNativeStackListeners` (`/native-stack` entry)

```ts
function useSmoothNativeStackListeners(
  options?: SmoothStackListenersOptions
): SmoothNativeStackListeners;

interface SmoothNativeStackListeners {
  transitionStart(e?: NativeStackListenerEvent<'transitionStart'>): void;
  transitionEnd(e?: NativeStackListenerEvent<'transitionEnd'>): void;
  gestureCancel(e?: NativeStackListenerEvent<'gestureCancel'>): void;
  focus(e?: NativeStackLifecycleEvent): void;
  blur(e?: NativeStackLifecycleEvent): void;
}
```

Same contract as `useSmoothStackListeners`, for
`createNativeStackNavigator`. Call once per navigator and pass to
`screenListeners`. Registration ids use the `native-stack:` prefix.

Native-stack differences to be aware of:

- Events are driven by the native side via react-native-screens —
  `transitionStart`/`transitionEnd` carry a `data.closing` flag and
  correlate with the real native transition rather than a JS animation.
- `gestureCancel` is emitted on iOS only (swipe-back cancel); Android
  never fires it — the mapping is harmless there.
- Screens with `animation: 'none'` may emit both events in one frame, or
  skip `transitionEnd` on some react-native-screens versions — the barrier
  then stays open and a `stalled-transition` diagnostic warns after ~4s.
  For a fully non-animated navigator use
  `useSmoothNativeStackListeners({ animationEnabled: false })` to skip
  barriers entirely (same option on `useSmoothStackListeners`).
- Real-device event fidelity for native-stack is pending device validation;
  adapter forwarding and gating are covered by unit tests.

The `/native-stack` entry also exports `useDeferredMount`,
`useAfterTransition`, `useIdleTask`, `DeferredView` (identical
implementations to `/stack`), plus `SmoothNativeStackListeners`,
`NativeStackListenerEvent`, `NativeStackLifecycleEvent`,
`SmoothStackListenersOptions`, `DeferredViewProps`, `DeferredMountOptions`,
`AfterTransitionOptions`, `IdleTaskOptions`, `TaskHandle`, `TaskCallback`.

---

## Contracts that apply everywhere

### AbortSignal

Every `TaskCallback` receives an `AbortSignal`. It is aborted when the task is
cancelled before start **or while running** (via `handle.cancel()`,
`cancelScope`, unmount cleanup, or provider disposal). Cancelling a running
task does not interrupt your code — check `signal.aborted` between steps and
pass the signal to `fetch`/`AbortController`-aware APIs. A cancelled task's
late resolution/rejection is swallowed (never marked failed, never calls
`onError`).

### Dedupe — latest wins per scope+key

`IdleTaskOptions.key` (and the internal keys used by `useAfterTransition`)
index **pending** tasks by scope+key. Scheduling a second pending task with
the same key cancels the first. Different scopes never dedupe each other, and
a task already running is never cancelled by a later same-key schedule — the
new task simply queues as pending and runs after it.

Trade-off note: repeatedly scheduling the same key while a transition keeps
the scope ineligible means the queued callback is _replaced_ each time, so a
continuously re-keyed task may wait arbitrarily long. That is the intended
semantics for "latest data wins" work (prefetch, warm caches); for work that
must eventually run, use distinct keys.

### Error handling

A synchronous throw or a promise rejection marks the task `failed`, calls its
`onError`, and emits a `task-failed` diagnostic (level `error`). Other pending
tasks and the queue itself are unaffected — errors never break the queue. A
throwing `onError` is swallowed for the same reason.

### Unmount safety (Invariant B)

Every hook cancels its outstanding tasks in its effect cleanup, and the
scheduler re-checks `signal.aborted` immediately before invoking a callback —
a task cancelled before it starts is guaranteed never to run.

---

## Diagnostic codes

Emitted through the `diagnostics` provider prop / `context.diagnostics`:

| Code                                                                    | Level | Meaning                                                                                                                             |
| ----------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `task-scheduled` / `task-started` / `task-completed` / `task-cancelled` | debug | Task lifecycle.                                                                                                                     |
| `task-failed`                                                           | error | Callback threw or rejected; `details.error` carries it.                                                                             |
| `barrier-opened` / `barrier-closed`                                     | debug | Transition barrier lifecycle per navigator node.                                                                                    |
| `barrier-already-open`                                                  | debug | `transitionStart` ignored — the navigator already has a barrier.                                                                    |
| `no-open-barrier`                                                       | debug | `transitionEnd` arrived with no open barrier on that navigator.                                                                     |
| `gesture-recovery`                                                      | debug | Gesture cancelled — barrier held open for the recovery animation.                                                                   |
| `stalled-transition`                                                    | warn  | A barrier has been open longer than `stallWarningMs` (default 4000ms). Detection only — barriers are never auto-released.           |
| `event-buffered`                                                        | debug | A transition event arrived for a route key that cannot be resolved yet; replayed on the next state delivery.                        |
| `dropped-event`                                                         | warn  | A buffered event expired (~2s TTL) without its route resolving.                                                                     |
| `navigation-ready`                                                      | info  | First navigation state delivered.                                                                                                   |
| `navigator-registered` / `navigator-unregistered`                       | info  | `useSmoothStackListeners` mount/unmount.                                                                                            |
| `app-state`                                                             | debug | Foreground/background transitions.                                                                                                  |
| `untracked-route`                                                       | warn  | A route scope was queried for a key never observed in any delivered state (once per key).                                           |
| `unknown-scope`                                                         | debug | A scope with an unrecognized prefix was treated as always eligible (once per prefix).                                               |
| `missing-adapter`                                                       | warn  | No navigation state or navigator registration for ~2s — strict (default): route scopes stay gated; `degraded`: all scopes eligible. |
| `missing-nav-ref`                                                       | warn  | `onReady` fired but no state could be resolved via `getRootState`/`navigationRef` (once per hook instance).                         |
