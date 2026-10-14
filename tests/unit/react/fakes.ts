/**
 * Test doubles for the core/navigation/diagnostics contract modules.
 *
 * The factory functions in src/core/types.ts, src/navigation/types.ts and
 * src/diagnostics/types.ts are `export declare`d — they have no runtime
 * implementation until the core/navigation agents land their sibling files
 * (e.g. src/core/TaskScheduler.ts). Test files register jest.mock() on the
 * contract module specifiers; the factories below prefer a real sibling
 * implementation when one exists and otherwise fall back to these fakes.
 *
 * IMPORTANT: this file must only use `import type` from the contract modules —
 * they are mocked in tests, so runtime imports would hit the mock (or recurse
 * while a mock factory is still evaluating). The few contract consts we need
 * are re-implemented locally (their definitions are locked and trivial).
 */

import type {
  IdleCallback,
  IdleHost,
  ScheduleTaskOptions,
  ScopeId,
  SchedulingMode,
  TaskCallback,
  TaskHandle,
  TaskPriority,
  TaskScheduler,
  TaskSchedulerDeps,
  TimerHost,
} from '../../../src/core/types';
import type {
  NavigationCoordinator,
  NavigationCoordinatorDeps,
  NavigationRouteState,
  NavigationTreeState,
  NavigatorRegistration,
  RouteStatus,
} from '../../../src/navigation/types';
import type {
  DiagnosticEvent,
  DiagnosticListener,
  DiagnosticsCollector,
  DiagnosticsSink,
} from '../../../src/diagnostics/types';

// ---------------------------------------------------------------------------
// Local copies of locked const helpers (avoid importing the mocked modules).

const ROOT_NAV_NODE_ID = '<root>';
const isRouteScope = (scopeId: string): boolean => scopeId.startsWith('route:');
const routeKeyFromScope = (scopeId: string): string | null =>
  isRouteScope(scopeId) ? scopeId.slice('route:'.length) : null;
const routeScopeId = (routeKey: string): string => `route:${routeKey}`;

// ---------------------------------------------------------------------------
// Diagnostics helpers (faithful, trivial implementations of the contract).

export function createFakeCollector(): DiagnosticsCollector {
  const events: DiagnosticEvent[] = [];
  const listeners = new Set<DiagnosticListener>();
  return {
    events,
    emit(event) {
      events.push(event);
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          // a diagnostics listener must never break the emitter
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    clear() {
      events.length = 0;
    },
  };
}

export const NOOP_SINK: DiagnosticsSink = {
  emit() {
    // drops everything
  },
};

export function createFakeConsoleSink(): DiagnosticsSink {
  return {
    emit(event) {
      const line = `[react-native-smooth-task:${event.level}] ${event.code} — ${event.message}`;
      if (event.level === 'error') console.error(line);
      else if (event.level === 'warn') console.warn(line);
      else console.log(line);
    },
  };
}

// ---------------------------------------------------------------------------
// Fake IdleHost — setTimeout(0)-backed so `await tick()` flushes it, while
// `cancel` reliably prevents the callback (mirrors requestIdleCallback).

export interface FakeIdleHost extends IdleHost {
  /** Number of idle callbacks still queued. */
  pendingCount(): number;
}

export function createFakeIdleHost(): FakeIdleHost {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    request(callback: IdleCallback): number {
      const handle = next++;
      const timer = setTimeout(() => {
        pending.delete(handle);
        callback({ didTimeout: false, timeRemaining: () => 50 });
      }, 0);
      pending.set(handle, () => clearTimeout(timer));
      return handle;
    },
    cancel(handle: number) {
      pending.get(handle)?.();
      pending.delete(handle);
    },
    pendingCount: () => pending.size,
  };
}

export function createRealTimerHost(): TimerHost {
  return {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as Parameters<typeof clearTimeout>[0]),
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Fake TaskScheduler — flush-driven: tasks stay 'pending' until flush() and
// the scope is eligible at that moment. Deterministic; mirrors the contract
// (dedupe latest-wins, AbortSignal, onError, cancel-before-start).

interface FakeTask {
  id: number;
  scopeId: ScopeId;
  callback: TaskCallback;
  key: string | undefined;
  priority: TaskPriority;
  scheduling: SchedulingMode;
  onError: ((error: unknown) => void) | undefined;
  controller: AbortController;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
}

export class FakeTaskScheduler implements TaskScheduler {
  private seq = 0;
  private readonly tasks = new Set<FakeTask>();
  private readonly unsubscribeGate: () => void;
  private disposed = false;

  constructor(private readonly deps: TaskSchedulerDeps) {
    // The real scheduler revalidates on gate notifications; the fake only
    // revalidates on flush(), but keep the subscription for fidelity.
    this.unsubscribeGate = deps.gate.subscribe(() => undefined);
    liveSchedulers.add(this);
  }

  schedule(
    scopeId: ScopeId,
    callback: TaskCallback,
    options: ScheduleTaskOptions = {}
  ): TaskHandle {
    if (options.key !== undefined) {
      // latest-wins dedupe: cancel the pending task with same scope+key
      for (const task of [...this.tasks]) {
        if (task.status === 'pending' && task.scopeId === scopeId && task.key === options.key) {
          this.cancelTask(task);
        }
      }
    }
    const task: FakeTask = {
      id: ++this.seq,
      scopeId,
      callback,
      key: options.key,
      priority: options.priority ?? 'background',
      scheduling: options.scheduling ?? 'transition',
      onError: options.onError,
      controller: new AbortController(),
      status: 'pending',
    };
    this.tasks.add(task);
    this.deps.diagnostics?.emit({
      level: 'debug',
      code: 'task-scheduled',
      message: `task #${task.id} scheduled in scope '${scopeId}'`,
      scopeId,
      timestamp: Date.now(),
    });
    return { cancel: () => this.cancelTask(task) };
  }

  cancelScope(scopeId: ScopeId): void {
    for (const task of this.tasks) {
      if (task.scopeId === scopeId) this.cancelTask(task);
    }
  }

  releaseScope(scopeId: ScopeId): void {
    for (const task of [...this.tasks]) {
      if (task.scopeId === scopeId) {
        this.cancelTask(task);
        this.tasks.delete(task);
      }
    }
  }

  getPendingCount(scopeId?: ScopeId): number {
    let count = 0;
    for (const task of this.tasks) {
      if (task.status === 'pending' && (scopeId === undefined || task.scopeId === scopeId)) count++;
    }
    return count;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeGate();
    for (const task of this.tasks) this.cancelTask(task);
    this.tasks.clear();
    liveSchedulers.delete(this);
  }

  /** Test-only: run every pending task whose scope is currently eligible. */
  flush(): void {
    for (const task of [...this.tasks]) {
      if (task.status !== 'pending') continue;
      if (!this.deps.gate.isEligible(task.scopeId)) continue;
      this.runTask(task);
    }
  }

  /** Test-only: number of tasks with a given status (all scopes). */
  countByStatus(status: FakeTask['status']): number {
    let count = 0;
    for (const task of this.tasks) if (task.status === status) count++;
    return count;
  }

  private cancelTask(task: FakeTask): void {
    if (task.status === 'pending' || task.status === 'running') {
      task.status = 'cancelled';
      if (!task.controller.signal.aborted) task.controller.abort();
    }
  }

  private runTask(task: FakeTask): void {
    task.status = 'running';
    try {
      const result = task.callback(task.controller.signal);
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>).then(
          () => {
            if (task.status === 'running') task.status = 'completed';
          },
          (error) => this.failTask(task, error)
        );
      } else {
        task.status = 'completed';
      }
    } catch (error) {
      this.failTask(task, error);
    }
  }

  private failTask(task: FakeTask, error: unknown): void {
    task.status = 'failed';
    this.deps.diagnostics?.emit({
      level: 'error',
      code: 'task-failed',
      message: `task #${task.id} in scope '${task.scopeId}' failed: ${String(error)}`,
      scopeId: task.scopeId,
      timestamp: Date.now(),
    });
    try {
      task.onError?.(error);
    } catch {
      // onError handlers must never break the queue
    }
  }
}

const liveSchedulers = new Set<FakeTaskScheduler>();

export function createFakeTaskScheduler(deps: TaskSchedulerDeps): FakeTaskScheduler {
  return new FakeTaskScheduler(deps);
}

/** Flush all live fake schedulers (no-op for real implementations). */
export function flushAllSchedulers(): void {
  for (const scheduler of [...liveSchedulers]) scheduler.flush();
}

// ---------------------------------------------------------------------------
// Fake NavigationCoordinator — implements the real contract semantics:
// barriers are navigator-scoped (navNodeId = parent route key or '<root>'),
// focus derives from the state tree (index at each level), focusEpoch bumps
// on focusedOnPath false→true, settled = exists && focusedOnPath &&
// !hasPendingTransition && ready && appActive.

function findRoutePath(
  routes: NavigationRouteState[],
  targetKey: string
): NavigationRouteState[] | null {
  for (const route of routes) {
    if (route.key === targetKey) return [route];
    if (route.state) {
      const sub = findRoutePath(route.state.routes, targetKey);
      if (sub) return [route, ...sub];
    }
  }
  return null;
}

function focusedIndex(level: NavigationTreeState): number {
  return level.index ?? level.routes.length - 1;
}

/** All navNode ids on the path to `path` — '<root>' + every ancestor key. */
function navNodesOnPath(path: NavigationRouteState[]): string[] {
  const ids = [ROOT_NAV_NODE_ID];
  for (let i = 0; i < path.length - 1; i++) ids.push(path[i]!.key);
  return ids;
}

function pathIsFocused(root: NavigationTreeState, path: NavigationRouteState[]): boolean {
  let level: NavigationTreeState | undefined = root;
  for (const route of path) {
    if (level === undefined) return false;
    if (level.routes[focusedIndex(level)]?.key !== route.key) return false;
    level = route.state;
  }
  return true;
}

export class FakeNavigationCoordinator implements NavigationCoordinator {
  private state: NavigationTreeState | null = null;
  private appActive = true;
  private readonly barriers = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly navNodeByRoute = new Map<string, string>();
  private readonly prevFocused = new Map<string, boolean>();
  private readonly epochs = new Map<string, number>();
  private readonly navigators = new Map<string, NavigatorRegistration>();
  private _ready = false;
  private disposed = false;

  constructor(private readonly deps: NavigationCoordinatorDeps = {}) {
    liveCoordinators.add(this);
  }

  get ready(): boolean {
    return this._ready;
  }

  get navigatorCount(): number {
    return this.navigators.size;
  }

  get appActiveSnapshot(): boolean {
    return this.appActive;
  }

  setNavigationState(state: NavigationTreeState | null | undefined): void {
    if (state == null) return;
    this.state = state;
    this._ready = true;
    this.indexRoutes(state);
    this.updateFocusTracking();
    this.notify();
  }

  setAppActive(active: boolean): void {
    if (this.appActive === active) return;
    this.appActive = active;
    this.notify();
  }

  registerNavigator(registration: NavigatorRegistration): void {
    this.navigators.set(registration.instanceId, registration);
    this.notify();
  }

  unregisterNavigator(instanceId: string): void {
    this.navigators.delete(instanceId);
    this.notify();
  }

  transitionStarted(routeKey: string): void {
    this.openBarrier(this.navNodeByRoute.get(routeKey) ?? ROOT_NAV_NODE_ID, routeKey);
  }

  transitionFinished(routeKey: string): void {
    this.closeBarrier(this.navNodeByRoute.get(routeKey) ?? ROOT_NAV_NODE_ID, routeKey);
  }

  gestureCancelled(routeKey: string): void {
    // barrier stays/becomes open; only transitionFinished releases it
    this.openBarrier(this.navNodeByRoute.get(routeKey) ?? ROOT_NAV_NODE_ID, routeKey);
  }

  routeFocused(_routeKey: string): void {
    // hint only — authoritative focus comes from the state tree
    this.notify();
  }

  routeBlurred(_routeKey: string): void {
    this.notify();
  }

  getRouteStatus(routeKey: string): RouteStatus {
    const path = this.state ? findRoutePath(this.state.routes, routeKey) : null;
    const exists = path !== null;
    const focusedOnPath = exists && pathIsFocused(this.state!, path);
    const hasPendingTransition = exists && navNodesOnPath(path).some((id) => this.barriers.has(id));
    const settled =
      exists && focusedOnPath && !hasPendingTransition && this._ready && this.appActive;
    return {
      exists,
      focusedOnPath,
      hasPendingTransition,
      settled,
      focusEpoch: this.epochs.get(routeKey) ?? 0,
    };
  }

  routeScopeId(routeKey: string): ScopeId {
    return routeScopeId(routeKey);
  }

  isEligible(scopeId: ScopeId): boolean {
    const routeKey = routeKeyFromScope(scopeId);
    if (routeKey === null) return true; // app scope: never blocked
    return this.getRouteStatus(routeKey).settled;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.navigators.clear();
    liveCoordinators.delete(this);
  }

  /** Test-only: currently open barrier navNode ids. */
  get openBarriers(): readonly string[] {
    return [...this.barriers];
  }

  /** Test-only: registered navigator instances. */
  get registrations(): NavigatorRegistration[] {
    return [...this.navigators.values()];
  }

  private openBarrier(navNodeId: string, routeKey: string): void {
    if (this.barriers.has(navNodeId)) return;
    this.barriers.add(navNodeId);
    this.deps.diagnostics?.emit({
      level: 'debug',
      code: 'barrier-opened',
      message: `transition barrier opened on navigator '${navNodeId}'`,
      routeKey,
      timestamp: Date.now(),
    });
    this.notify();
  }

  private closeBarrier(navNodeId: string, routeKey: string): void {
    if (!this.barriers.delete(navNodeId)) return;
    this.deps.diagnostics?.emit({
      level: 'debug',
      code: 'barrier-closed',
      message: `transition barrier closed on navigator '${navNodeId}'`,
      routeKey,
      timestamp: Date.now(),
    });
    this.notify();
  }

  private indexRoutes(state: NavigationTreeState): void {
    const walk = (level: NavigationTreeState, navNodeId: string) => {
      for (const route of level.routes) {
        this.navNodeByRoute.set(route.key, navNodeId);
        if (route.state) walk(route.state, route.key);
      }
    };
    walk(state, ROOT_NAV_NODE_ID);
  }

  private updateFocusTracking(): void {
    if (!this.state) return;
    const seen = new Set<string>();
    const collect = (level: NavigationTreeState) => {
      for (const route of level.routes) {
        seen.add(route.key);
        if (route.state) collect(route.state);
      }
    };
    collect(this.state);
    for (const key of seen) {
      const path = findRoutePath(this.state.routes, key)!;
      const focused = pathIsFocused(this.state, path);
      const prev = this.prevFocused.get(key) ?? false;
      if (focused && !prev) this.epochs.set(key, (this.epochs.get(key) ?? 0) + 1);
      this.prevFocused.set(key, focused);
    }
    for (const key of [...this.prevFocused.keys()]) {
      if (!seen.has(key)) this.prevFocused.set(key, false);
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // listeners must never break the coordinator
      }
    }
  }
}

const liveCoordinators = new Set<FakeNavigationCoordinator>();

export function createFakeNavigationCoordinator(
  deps: NavigationCoordinatorDeps = {}
): FakeNavigationCoordinator {
  return new FakeNavigationCoordinator(deps);
}

/**
 * Type guards — assertions that depend on the fake's flush-driven timing
 * (e.g. "still pending before pump") must be guarded with these, because a
 * real implementation legitimately starts eligible tasks inside the same
 * awaited act() turn.
 */
export function isFakeScheduler(s: unknown): s is FakeTaskScheduler {
  return s instanceof FakeTaskScheduler;
}

export function isFakeCoordinator(c: unknown): c is FakeNavigationCoordinator {
  return c instanceof FakeNavigationCoordinator;
}

export function createOpenGateFake(): { isEligible(): boolean; subscribe(): () => void } {
  return {
    isEligible: () => true,
    subscribe: () => () => undefined,
  };
}

// ---------------------------------------------------------------------------
// Prefer-real resolution: when a sibling implementation file exists, use it.

function tryLoadReal<T extends object>(...candidatePaths: string[]): Partial<T> | null {
  for (const path of candidatePaths) {
    try {
      const mod = jest.requireActual<T>(path);
      if (mod != null) return mod as Partial<T>;
    } catch {
      // not implemented yet — fall through to the next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mock module factories. Register in each test file:
//   jest.mock('../../../src/core/types', () => require('./fakes').coreTypesModule());
//   jest.mock('../../../src/navigation/types', () => require('./fakes').navigationTypesModule());
//   jest.mock('../../../src/diagnostics/types', () => require('./fakes').diagnosticsTypesModule());

export function coreTypesModule(): typeof import('../../../src/core/types') {
  const actual =
    jest.requireActual<typeof import('../../../src/core/types')>('../../../src/core/types');
  const impl =
    tryLoadReal<typeof import('../../../src/core/types')>(
      '../../../src/core/TaskScheduler',
      '../../../src/core/scheduler',
      '../../../src/core/index'
    ) ?? {};
  const hosts =
    tryLoadReal<typeof import('../../../src/core/types')>(
      '../../../src/core/Hosts',
      '../../../src/core/hosts',
      '../../../src/core/defaults'
    ) ?? {};
  const idle =
    tryLoadReal<typeof import('../../../src/core/types')>(
      '../../../src/core/IdleHost',
      '../../../src/core/idleHost'
    ) ?? {};
  return {
    ...actual,
    createTaskScheduler: impl.createTaskScheduler ?? createFakeTaskScheduler,
    createDefaultIdleHost:
      idle.createDefaultIdleHost ?? hosts.createDefaultIdleHost ?? createFakeIdleHost,
    createDefaultTimerHost: hosts.createDefaultTimerHost ?? createRealTimerHost,
    createOpenGate: hosts.createOpenGate ?? impl.createOpenGate ?? createOpenGateFake,
  };
}

export function navigationTypesModule(): typeof import('../../../src/navigation/types') {
  const actual = jest.requireActual<typeof import('../../../src/navigation/types')>(
    '../../../src/navigation/types'
  );
  const impl =
    tryLoadReal<typeof import('../../../src/navigation/types')>(
      '../../../src/navigation/NavigationCoordinator',
      '../../../src/navigation/coordinator',
      '../../../src/navigation/index'
    ) ?? {};
  return {
    ...actual,
    createNavigationCoordinator:
      impl.createNavigationCoordinator ?? createFakeNavigationCoordinator,
  };
}

export function diagnosticsTypesModule(): typeof import('../../../src/diagnostics/types') {
  const actual = jest.requireActual<typeof import('../../../src/diagnostics/types')>(
    '../../../src/diagnostics/types'
  );
  const impl =
    tryLoadReal<typeof import('../../../src/diagnostics/types')>(
      '../../../src/diagnostics/Diagnostics',
      '../../../src/diagnostics/index',
      '../../../src/diagnostics/diagnostics',
      '../../../src/diagnostics/sinks',
      '../../../src/diagnostics/collector'
    ) ?? {};
  return {
    ...actual,
    createDiagnosticsCollector: impl.createDiagnosticsCollector ?? createFakeCollector,
    NOOP_DIAGNOSTICS: impl.NOOP_DIAGNOSTICS ?? NOOP_SINK,
    createConsoleDiagnosticsSink: impl.createConsoleDiagnosticsSink ?? createFakeConsoleSink,
  };
}
