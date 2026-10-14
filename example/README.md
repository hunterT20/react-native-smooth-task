# Example app — reference implementation

This directory is **not a bootstrapped React Native project** — it is a set of
reference sources to copy into a real RN app (e.g. one created with
`npx @react-native-community/cli init` on RN 0.87). There is no
`android/`/`ios/` here and nothing is installed from this `package.json`; it
only documents the dependencies a host app needs.

## What's inside

```
src/
├── App.tsx                    # provider + NavigationContainer wiring +
│                              #   RootStack → MainTabs → HomeStack/OrdersStack
└── screens/
    ├── HeavyScreen.tsx        # useDeferredMount + skeleton (route 'Feed')
    ├── DetailScreen.tsx       # fetch-early-render-late via useAfterTransition
    │                          #   (routes 'Post' + 'OrderDetail')
    ├── OrdersScreen.tsx       # useIdleTask background analytics batch
    │                          #   (route 'OrdersList')
    └── SettingsScreen.tsx     # lightweight modal screen (root stack)
```

## Required dependencies in the host app

```bash
pnpm add react-native-smooth-task \
  @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs \
  react-native-screens react-native-safe-area-context react-native-gesture-handler
```

Verified against: `react-native` 0.87.1, `react` 19.3.1,
`@react-navigation/native` 7.5.1, `@react-navigation/stack` 7.12.1,
`react-native-screens` 4.30.0, `react-native-safe-area-context` 5.10.1,
`react-native-gesture-handler` 3.3.0. See `../docs/compatibility.md`.

## Wiring checklist

1. Wrap the app in `<SmoothTaskProvider>` (with `diagnostics={__DEV__}` while
   integrating).
2. Create a `navigationRef` and pass it to both
   `useSmoothNavigationContainer({ navigationRef })` and
   `<NavigationContainer ref={navigationRef}>`, spreading the returned
   `observers` onto the container.
3. Add `useSmoothStackListeners({ id })` → `screenListeners` on **every stack
   navigator** (`RootStack`, `HomeStack`, `OrdersStack` here). Tab navigators
   need no listeners — their focus comes from the state tree.
4. Inside screens, import route-scoped hooks from
   `react-native-smooth-task/stack`.

## What to try

- Push `Feed` → the skeleton holds until the transition ends, then the heavy
  list mounts (watch `[smooth-task] task-started` in the console).
- Push `Post` → the fetch starts *during* the animation; only the heavy body
  render waits for settle.
- Pull-to-refresh on `Orders` → the analytics batch re-runs inside idle
  callbacks and pauses if you navigate away mid-flight.
- Background/foreground the app → route-scoped tasks pause while inactive
  (`pauseInBackground` default).
