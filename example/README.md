# Example app — runnable (Expo SDK 55)

A real React Native app you can run on a device or emulator to verify
react-native-smooth-task against **real React Navigation event ordering** —
the reason it exists.

Navigation tree deliberately mixes adapters:

```
RootStack  '<root>'      → [ MainTabs, Settings(modal) ]   — JS stack (@react-navigation/stack)
MainTabs                 → [ Home, Orders ]                — bottom tabs, no adapter
HomeStack  'tab:Home'    → [ Feed(HeavyScreen), Post ]     — JS stack
OrdersStack 'tab:Orders' → [ OrdersList, OrderDetail ]     — native stack (@react-navigation/native-stack)
```

## Run it

```bash
cd example
pnpm install
npx expo install --check   # reconciles native-module versions for your Expo Go
pnpm start               # scan QR with Expo Go (SDK 55), or press i / a
```

The library is consumed via `link:../` and Metro resolves its `react-native`
field straight to `../src` — **no `pnpm build` needed**, and edits to the
library hot-reload in the app.

Expo Go runs RN 0.83 (SDK 55), inside the library's peer range
(`>=0.82 <1`). For FPS benchmarking use a **release** dev build instead —
dev-mode numbers are not meaningful:

```bash
pnpm add expo-dev-client
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

## Event timeline

The dark overlay at the bottom records every observed event with ms
timestamps relative to app start; each line is also mirrored to the console
(`adb logcat | grep "smooth-task trace"`):

```
[  412ms] state-change → MainTabs › Orders › OrderDetail
[  415ms] orders transitionStart OrderDetail…
[  416ms] settling tab:Orders
[  918ms] orders transitionEnd OrderDetail…
[  919ms] barrier-closed
[  921ms] task-started
```

It captures three sources:

- **container observers** — `ready` / `state-change → <focused route path>`
- **screen listeners** — `focus` / `blur` / `transitionStart` / `transitionEnd` /
  `gestureCancel` per navigator label (`root` / `home` / `orders`)
- **coordinator diagnostics** — `settling`, `barrier-opened`/`closed`,
  `task-started`/`completed`, `stalled-transition`, `settling-unresolved`, …

Tap `clear` before each navigation to get a clean trace.

## What to verify on device

- **Event ordering**: does `onStateChange` land before `transitionStart`?
  Does `focus` ever arrive before `transitionStart`? (Either way the route
  task must not start until `transitionEnd` / `barrier-closed`.)
- **JS stack vs native stack**: compare ordering on `home` vs `orders`
  navigators; on Android native-stack `gestureCancel` never fires.
- **Tab switches** (`MainTabs`, no adapter): routes must still settle —
  the navNode is gated only by registration fallback until classified
  non-animated (~300ms silence), then releases; no task should start early.
- **Cancelled swipe-back** (iOS): `gestureCancel` must keep work blocked
  until the recovery `transitionEnd`.
- **Settings modal** (root stack): while it animates in, route-scoped work
  across the whole tree pauses until the modal's `transitionEnd`.

## Screens

| Screen        | Route                    | Demonstrates                                       |
| ------------- | ------------------------ | -------------------------------------------------- |
| HeavyScreen   | `Feed`                   | `useDeferredMount` — skeleton until settled        |
| DetailScreen  | `Post`, `OrderDetail`    | fetch-early-render-late via `useAfterTransition` + `<DeferredView>` |
| OrdersScreen  | `OrdersList`             | `useIdleTask` chunked background batch             |
| SettingsScreen| `Settings`               | root-stack modal → global barrier                  |
