/**
 * react-native-smooth-task/native-stack — route-scoped APIs bound to
 * @react-navigation/native-stack screens.
 *
 * Requires @react-navigation/native and @react-navigation/native-stack.
 * Hooks exported here bind to the current route's scope via
 * useRoute().key; identical hook names from the root entry run in the
 * app scope instead.
 */

export { useSmoothNativeStackListeners } from './navigation/native-stack/useSmoothNativeStackListeners';
export type {
  SmoothNativeStackListeners,
  NativeStackListenerEvent,
  NativeStackLifecycleEvent,
} from './navigation/native-stack/useSmoothNativeStackListeners';

// Route-scoped hooks are navigator-agnostic — same implementations as /stack.
export { useDeferredMount } from './react/routeScoped/useDeferredMount';
export { useAfterTransition } from './react/routeScoped/useAfterTransition';
export { useIdleTask } from './react/routeScoped/useIdleTask';
export { DeferredView } from './react/routeScoped/DeferredView';

export type { SmoothStackListenersOptions, DeferredViewProps } from './react/types';
export type {
  DeferredMountOptions,
  AfterTransitionOptions,
  IdleTaskOptions,
  TaskHandle,
  TaskCallback,
} from './types';
