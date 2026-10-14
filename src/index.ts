/**
 * react-native-smooth-task — root entry.
 *
 * Usable WITHOUT @react-navigation installed: hooks run in the `app` scope
 * (eligible immediately while the app is active). Route-scoped,
 * navigation-aware versions of the same APIs live in
 * `react-native-smooth-task/stack`.
 */

export type {
  SchedulingMode,
  TaskPriority,
  DeferredMountOptions,
  AfterTransitionOptions,
  IdleTaskOptions,
  TaskHandle,
  TaskCallback,
} from './types';

export type { DiagnosticEvent, DiagnosticLevel, DiagnosticsSink } from './diagnostics/types';

export type {
  SmoothTaskContextValue,
  SmoothTaskProviderProps,
  DeferredViewProps,
  NavigationContainerObservers,
  UseSmoothNavigationContainerOptions,
} from './react/types';

export { SmoothTaskProvider } from './react/SmoothTaskProvider';
export { useSmoothTask, SmoothTaskContext } from './react/SmoothTaskContext';
export { useDeferredMount } from './react/useDeferredMount';
export { useAfterTransition } from './react/useAfterTransition';
export { useIdleTask } from './react/useIdleTask';
export { DeferredView } from './react/DeferredView';
export { useSmoothNavigationContainer } from './react/useSmoothNavigationContainer';
export type { SmoothNavigationContainerOptions } from './react/useSmoothNavigationContainer';
