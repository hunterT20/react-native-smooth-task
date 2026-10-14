# react-native-smooth-task — Agent Guide

Transition-aware task scheduling for React Native. JS-only library (no native code, no reanimated, no InteractionManager).

## Commands

```bash
pnpm test          # jest (all tests)
npx jest <path>    # single test file
pnpm typecheck     # tsc --noEmit (strict)
pnpm lint          # eslint flat config
pnpm build         # react-native-builder-bob → lib/
pnpm format        # prettier
```

## Layer purity rules — strictly enforced

| Layer | May import |
|---|---|
| `src/core/` | Only `src/types.ts`, `src/diagnostics/` — **no react, no react-native, no @react-navigation** |
| `src/navigation/` | Same as core (+ `src/core/`). Pure TS, fully unit-testable without RN. |
| `src/diagnostics/` | Nothing outside itself + `src/types.ts` |
| `src/react/` | react, react-native, and all src layers |
| `src/navigation/stack/` + `src/stack.ts` | + `@react-navigation/*` (optional peers — ONLY here) |

## Locked contracts — do not modify

`src/types.ts`, `src/core/types.ts`, `src/navigation/types.ts`, `src/react/types.ts`, `src/diagnostics/types.ts`.

Factories are `export declare`d there; implement them in sibling files (e.g. `createTaskScheduler` → `src/core/TaskScheduler.ts`).

## Semantics that must hold

- Route-scoped tasks start only while `coordinator.getRouteStatus(key).settled` — focused on path, no open barrier on any ancestor navigator, nav ready, app active.
- App-scoped tasks (`app` scope) are never blocked by navigation or AppState.
- Barriers are navigator-scoped (navNodeId = parent route key or `<root>`), never released by timers — timeouts only emit diagnostics.
- Cancelled-before-start tasks must never run. Callbacks receive AbortSignal.
- Errors never kill the queue; emit `task-failed` diagnostic + `onError`.
- `useDeferredMount` readiness is a sticky latch (blur/refocus never resets).
- Dedupe: same scope+key pending → latest wins (previous cancelled).

## Testing conventions

- Jest + `@react-native/jest-preset`. Tests live in `tests/unit/{core,navigation,react}` and `tests/integration`.
- **RNTL v14 API is async**: `await render(...)`, `await renderHook(...)`, `await screen.rerender(...)`. `screen` binds only after `await render`.
- Core/navigation tests must use injected `TimerHost`/`IdleHost` fakes (manual ticks), never `jest.useFakeTimers` on the implementation's timers directly.
- Navigation tests simulate state trees by hand (`NavigationTreeState` fixtures) — do not mount real navigators.
- Every negative case needs a negative assertion (callback NOT called while barrier open).

## Versions (verified against registry 2026-10-15)

- Dev baseline: RN 0.87.1 + @react-navigation/native 7.5.1 + stack 7.12.1 + react 19.3.1 + TS 5.9.3 + jest 30 + RNTL 14 (`test-renderer` pkg, NOT react-test-renderer).
- Peers: react >=19.1.1 <20, react-native >=0.82 <1, navigation peers optional >=7 <8.
- `transformIgnorePatterns` in jest.config.js is pnpm-aware — do not revert it.
