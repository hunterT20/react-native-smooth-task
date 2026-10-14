/**
 * react-native-smooth-task/stack — route-scoped APIs.
 *
 * This entry point requires @react-navigation/native and
 * @react-navigation/stack to be installed. Hooks exported here bind to the
 * current route's scope via useRoute().key; identical hook names from the
 * root entry run in the app scope instead.
 */

export { useSmoothStackListeners } from './navigation/stack/useSmoothStackListeners';
export type {
  SmoothStackListeners,
  StackListenerEvent,
  StackLifecycleEvent,
} from './navigation/stack/useSmoothStackListeners';

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
