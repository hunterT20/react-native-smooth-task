/**
 * Every diagnostic code the library emits. Single source of truth for
 * `DiagnosticEvent.code` values — emitters are typed against
 * `DiagnosticCode` so a typo or rename fails type-checking.
 */
export const DIAGNOSTIC_CODES = Object.freeze([
  // core/TaskScheduler
  'task-scheduled',
  'task-started',
  'task-completed',
  'task-failed',
  'task-cancelled',
  // navigation/BarrierRegistry
  'barrier-opened',
  'barrier-closed',
  'gesture-recovery',
  'stalled-transition',
  // navigation/NavigationCoordinator
  'barrier-already-open',
  'no-open-barrier',
  'settling',
  'settling-cleared',
  'settling-elapsed',
  'settling-unresolved',
  'event-buffered',
  'dropped-event',
  'navigation-ready',
  'navigator-registered',
  'navigator-unregistered',
  'app-state',
  'untracked-route',
  'unknown-scope',
  'missing-adapter',
  // react/useSmoothNavigationContainer
  'missing-nav-ref',
] as const);

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
