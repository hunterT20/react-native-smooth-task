---
'react-native-smooth-task': minor
---

Add `@react-navigation/native-stack` support via a new
`react-native-smooth-task/native-stack` entry point exporting
`useSmoothNativeStackListeners` plus the same route-scoped hooks. Both stack
adapters share one listener/registration implementation; native-stack event
fidelity differences (native-driven transitions, iOS-only `gestureCancel`)
are documented in docs/api.md and docs/compatibility.md.
