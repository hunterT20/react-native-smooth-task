---
'react-native-smooth-task': minor
---

Fail closed on missing navigation wiring: new `missingAdapterPolicy`
provider prop — `'strict'` (new default) keeps route scopes gated and emits
`missing-adapter` after ~2s instead of silently running tasks ungated;
`'degraded'` restores the previous opt-in ungated fallback. Also adds
`animationEnabled: false` to `useSmoothStackListeners` /
`useSmoothNativeStackListeners` for navigators whose screens disable
animation, so a lost `transitionEnd` can never pin a barrier open.
Dedupe and `mode: 'once'` semantics clarified in docs (running tasks are
never deduped; once means started-once, never retried).
