# Compatibility

Status as of **2026-10-15**. "Verified" means: the library's jest suite
(170 tests — unit + integration) runs green against these exact devDependency
versions, and the public API surface typechecks under `strict` +
`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Verified on CI via
the matrix in `.github/workflows/ci.yml`; **real-device verification is still
pending** — see the notes at the bottom.

## Verified matrix (dev baseline)

| Package                        | Version | Role                                             |
| ------------------------------ | ------- | ------------------------------------------------ |
| react-native                   | 0.87.1  | host app                                         |
| react                          | 19.3.1  | peer                                             |
| @react-navigation/native       | 7.5.1   | optional peer (`/stack` + `/native-stack`)       |
| @react-navigation/stack        | 7.12.1  | optional peer (`/stack` only)                    |
| @react-navigation/native-stack | 7.21.0  | optional peer (`/native-stack` only)             |
| typescript                     | 5.9.3   | toolchain                                        |
| jest                           | 30.5.2  | test runner                                      |
| @react-native/jest-preset      | 0.87.1  | jest preset                                      |
| @testing-library/react-native  | 14.1.0  | React tests                                      |
| test-renderer                  | 1.3.1   | RNTL 14 renderer — **not** `react-test-renderer` |

Supporting libs present in the dev environment (needed by a real host app /
the example, not by the library itself): `react-native-screens` 4.30.0,
`react-native-safe-area-context` 5.10.1, `react-native-gesture-handler` 3.3.0.

## Peer contract

```json
"peerDependencies": {
  "@react-navigation/native": ">=7.0.0 <8",
  "@react-navigation/native-stack": ">=7.0.0 <8",
  "@react-navigation/stack": ">=7.0.0 <8",
  "react": ">=19.1.1 <20",
  "react-native": ">=0.82.0 <1"
},
"peerDependenciesMeta": {
  "@react-navigation/native": { "optional": true },
  "@react-navigation/native-stack": { "optional": true },
  "@react-navigation/stack": { "optional": true }
}
```

- The root entry (`react-native-smooth-task`) has a **hard** dependency only
  on `react` + `react-native`. It is fully usable without navigation —
  hooks run in the `app` scope.
- The `@react-navigation/*` peers are optional; they are only imported by the
  `/stack` and `/native-stack` entries. Install `native` + `stack` only if
  you import `react-native-smooth-task/stack`, and `native` + `native-stack`
  only for `react-native-smooth-task/native-stack`.
- `react-native-screens` / `safe-area-context` / `gesture-handler` are
  **not** peers of this library — they are requirements of
  React Navigation stacks themselves.

## What the library relies on

Per-layer requirement surface:

| Layer                               | Needs                                                                                                                                                                | Verified on                                                    | Candidate                   | Experimental                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| Root hooks / `app` scope            | react ≥19.1.1, RN ≥0.82 (`AppState`, `AbortController`, `setTimeout`; `requestIdleCallback` optional — falls back to `setTimeout(0)`)                                | RN 0.87.1 + react 19.3.1                                       | RN 0.88 RC                  | —                                                            |
| `/stack` route scopes               | `useRoute().key` (navigation ≥7), `screenListeners` event map with `transitionStart`/`transitionEnd`/`gestureCancel`/`focus`/`blur` and string `e.target` route keys | Navigation 7.5.1 / stack 7.12.1                                | Navigation 7.x latest minor | Navigation 8 (peer range excludes it — pending verification) |
| `/native-stack` route scopes        | Same event-map surface; events are native-driven via react-native-screens (`gestureCancel` iOS-only)                                                                 | Navigation 7.5.1 / native-stack 7.21.0 (adapter-level tests)   | Navigation 7.x latest minor | Navigation 8; real-device event fidelity pending             |
| Container wiring                    | `NavigationContainer` `onReady` + `onStateChange(state)`, `getRootState()` on the container ref                                                                      | Navigation 7.5.1                                               | —                           | Navigation 8                                                 |
| Non-stack navigators (tabs/drawers) | Nothing — focus comes from `index` in the state tree                                                                                                                 | any navigator that reports a `NavigationTreeState`-shaped tree | —                           | —                                                            |

### InteractionManager

- The library itself **never imports `InteractionManager`** — eligibility is
  derived from the navigation state tree plus real transition events.
- React Navigation 7 still references `InteractionManager` internally (e.g.
  for gesture completion), but the usage is **conditional** — audited against
  the 7.x source; the code paths this library depends on
  (`screenListeners` transition/focus events, `onStateChange`, `getRootState`)
  do not require it. If RN removes `InteractionManager` entirely, the library
  is unaffected.

## Forward-compat targets — NOT yet verified

- **React Native 0.88 RC**: expected to work (peer range `>=0.82 <1` already
  allows it), pending jest + real-device verification.
- **React Navigation 8**: peer ranges are intentionally `>=7 <8`. Navigation 8
  compatibility (event payload shapes, state tree structure, `screenListeners`
  contract) is a forward-compat target and is **not verified** — the library
  will not resolve into a Navigation 8 app without a peer-range override.

## Pending real-device verification

Jest covers scheduler/coordinator/hook semantics exhaustively (see
[testing.md](testing.md)), but the following are only validated by
hand-simulated state trees and events, and still need confirmation on
physical iOS + Android devices:

- Real gesture-driven transitions (interactive swipe-back timing, gesture
  cancel → recovery animation `transitionEnd` delivery).
- `animation: 'none'` screens — whether React Navigation still emits a
  `transitionEnd` the coordinator can close on, and with what timing.
- Frame-level behavior (actual dropped-frame improvement).
- RN 0.88 RC + Hermes `requestIdleCallback` availability on device.
