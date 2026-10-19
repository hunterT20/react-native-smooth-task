# Example app — runnable (Expo SDK 55)

A real React Native app for verifying react-native-smooth-task against
**real React Navigation event ordering** on a device or emulator.

Navigation tree deliberately mixes adapters:

```
RootStack  '<root>'      → [ MainTabs, Settings(modal) ]   — JS stack (@react-navigation/stack)
MainTabs                 → [ Home, Orders ]                — bottom tabs, no adapter
HomeStack  'tab:Home'    → [ Lab, Feed, Post, Benchmark ]  — JS stack
OrdersStack 'tab:Orders' → [ OrdersList, OrderDetail,      — native stack
                             OrderDetailStatic ]             (@react-navigation/native-stack)
```

## Run it

```bash
cd example
pnpm install
pnpm start               # scan QR with Expo Go (SDK 55), or press i / a
```

Dependencies are pinned to Expo SDK 55's bundled module versions
(`bundledNativeModules.json`) — if you change them, re-check with
`npx expo install --check` (audit) or `npx expo install --fix` (auto-fix).

The library is consumed via `link:../`; Metro maps its entry points straight
to `../src` — **no `pnpm build` needed** and library edits hot-reload. A
custom `resolveRequest` pins `react`/`react-native`/`@react-navigation/*` to
this app's copies so the repo's devDependencies can never create duplicate
singletons.

Expo Go runs RN 0.83 (SDK 55), inside the library's peer range
(`>=0.82 <1`). For FPS benchmarking use a **release** dev build — dev-mode
numbers are not meaningful:

```bash
pnpm add expo-dev-client
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

CI runs `pnpm typecheck` + `npx expo export --platform android` on this app
(`.github/workflows/ci.yml` → `example-check`).

## Event timeline

A collapsible overlay records every observed event with ms timestamps:

- **collapsed** (default): a small pill near the top edge — never covers the
  tab bar. Tap to expand.
- **expanded**: a scrollable log anchored to the top; tabs stay tappable.
  Actions: `rec:live/rec:only` toggle, `export`, `clear`, `close`.

`rec:only` mode keeps recording events but performs **zero re-renders and
zero console writes** — use it during benchmarks so the recorder doesn't
perturb the JS thread. `export` dumps the captured events as JSON to the
console (`adb logcat | grep "smooth-task trace"` captures live lines in
`rec:live`).

Sources captured:

- **container observers** — `ready` / `state-change → <focused route path>`
- **screen listeners** — `focus` / `blur` / `transitionStart` /
  `transitionEnd` / `gestureCancel` per navigator (`root` / `home` / `orders`)
- **coordinator diagnostics** — `settling`, `barrier-opened`/`closed`,
  `task-started`/`completed`, `stalled-transition`, `settling-unresolved`, …
- **dispatch markers** — every Lab button logs `dispatch …` first

## Navigation Lab

`Lab` is the initial screen of `HomeStack`. Each button logs a `dispatch`
line then performs the action — giving a complete before/after trace:

- **JS stack**: push `Feed`, push `Post`, goBack, popToTop
- **Native stack**: push `OrderDetail` (animated), push `OrderDetailStatic`
  (`animation:'none'` — exercises the never-animated settling tier inside an
  otherwise-animated native stack), switch to Orders tab
- **Root stack**: open `Settings` modal — while it animates in, a `<root>`
  barrier pauses route-scoped work across the whole tree
- **Stress**: rapid push/pop ×4

## Benchmark screen

Four gating strategies for heavy content during a push, selected from the
Lab:

| Mode | Strategy                                   |
| ---- | ------------------------------------------ |
| A    | immediate mount (baseline)                 |
| B    | `setTimeout(350)` — guess the animation    |
| C    | `InteractionManager.runAfterInteractions`  |
| D    | `useDeferredMount` (smooth-task)           |

The screen reports mount→content-ready latency and rAF frames observed in
that window (`latency/16.7 − frames ≈ missed frame slots` — a JS-side
approximation, compare across modes only, in release builds).

## What to verify on device

- **Event ordering**: does `onStateChange` land before `transitionStart`?
  Does `focus` ever arrive before `transitionStart`? Either way route tasks
  must not start until `transitionEnd` / `barrier-closed`.
- **JS stack vs native stack**: compare ordering on `home` vs `orders`;
  Android native-stack never emits `gestureCancel`.
- **Tab switches** (`MainTabs`, no adapter): routes must still settle; the
  first switch may hold the gate for the ~300ms silence window (documented
  global-registration imprecision), subsequent switches release instantly.
- **Cancelled swipe-back** (iOS): `gestureCancel` must keep work blocked
  until the recovery `transitionEnd`.
- **`animation:'none'` push**: gate should release via silence/focus-only
  classification rather than waiting for a `transitionEnd` that never comes.

## Screens

| Screen          | Route                    | Demonstrates                                          |
| --------------- | ------------------------ | ----------------------------------------------------- |
| LabScreen       | `Lab`                    | all dispatch scenarios                                |
| HeavyScreen     | `Feed`                   | `useDeferredMount` — skeleton until settled           |
| DetailScreen    | `Post`, `OrderDetail*`   | fetch-early-render-late (`useAfterTransition` + `<DeferredView>`) |
| OrdersScreen    | `OrdersList`             | `useIdleTask` chunked background batch + abort cleanup |
| BenchmarkScreen | `Benchmark`              | A/B/C/D latency + rAF comparison                      |
| SettingsScreen  | `Settings`               | root-stack modal → global barrier                     |
