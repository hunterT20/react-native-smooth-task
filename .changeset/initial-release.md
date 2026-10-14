---
"react-native-smooth-task": minor
---

Initial release: transition-aware task scheduling for React Native.

- `useDeferredMount` — sticky deferred render gated on route settle (or app scope)
- `useAfterTransition` — once / every-focus post-transition work
- `useIdleTask` — cancelable idle-scheduled background work
- `DeferredView` — component form of deferred mount
- `SmoothTaskProvider`, `useSmoothNavigationContainer`, `useSmoothStackListeners`
- navNode-scoped transition barriers with tombstone route resolution,
  gesture-recovery handling, focus epochs, and degraded standalone detection

No InteractionManager, no native code, no required navigation dependency
(root entry runs app-scoped without React Navigation installed).
