/**
 * BarrierRegistry — transition barriers keyed by navNodeId.
 *
 * A navigator node has at most one open barrier at a time. Barriers are
 * opened by `transitionStarted` / `gestureCancelled` and closed by
 * `transitionFinished` on the SAME navNode (a sibling's transitionEnd closes
 * the barrier too — the pop case where the closing screen's event never
 * fires) or by the coordinator when the navNode dies.
 *
 * A barrier open longer than `stallWarningMs` emits a one-time
 * `stalled-transition` warning. Timeouts NEVER auto-release a barrier —
 * detection only.
 */

import type { TimerHost } from '../core/types';
import type { DiagnosticLevel } from '../diagnostics/types';

/** Why a barrier is open. */
export type BarrierReason = 'transition' | 'gesture-recovery';

/** Why a barrier was closed. */
export type BarrierCloseReason = 'transition-finished' | 'navnode-purged';

export interface TransitionBarrier {
  readonly navNodeId: string;
  /** Monotonically increasing id — one per successful open. */
  readonly generation: number;
  /** `timers.now()` at open time. */
  readonly openedAt: number;
  reason: BarrierReason;
  /** Stall warning already emitted for this barrier. */
  stallWarned: boolean;
}

/** Diagnostic payload minus `timestamp` (the coordinator stamps it). */
export interface BarrierDiagnostic {
  level: DiagnosticLevel;
  code: string;
  message: string;
  routeKey?: string;
  details?: Record<string, unknown>;
}

export interface BarrierRegistryDeps {
  timers: TimerHost;
  /** Warn once per barrier open longer than this. Detection only. */
  stallWarningMs: number;
  emit(diagnostic: BarrierDiagnostic): void;
}

export class BarrierRegistry {
  private readonly timers: TimerHost;
  private readonly stallWarningMs: number;
  private readonly emitDiagnostic: (diagnostic: BarrierDiagnostic) => void;
  private readonly barriers = new Map<string, TransitionBarrier>();
  private readonly stallHandles = new Map<string, unknown>();
  private nextGeneration = 0;

  constructor(deps: BarrierRegistryDeps) {
    this.timers = deps.timers;
    this.stallWarningMs = deps.stallWarningMs;
    this.emitDiagnostic = deps.emit;
  }

  /**
   * Open a barrier on `navNodeId`. Returns null when one is already open —
   * the existing barrier is left untouched (barriers are only ever released
   * by `transitionFinished` or navNode purge, never superseded).
   */
  open(navNodeId: string, reason: BarrierReason, routeKey?: string): TransitionBarrier | null {
    if (this.barriers.has(navNodeId)) return null;
    const barrier: TransitionBarrier = {
      navNodeId,
      generation: ++this.nextGeneration,
      openedAt: this.timers.now(),
      reason,
      stallWarned: false,
    };
    this.barriers.set(navNodeId, barrier);
    this.armStallWarning(barrier, routeKey);
    this.emitDiagnostic({
      level: 'debug',
      code: 'barrier-opened',
      message: `transition barrier opened on navigator '${navNodeId}' (reason: ${reason})`,
      ...(routeKey !== undefined ? { routeKey } : {}),
      details: { navNodeId, generation: barrier.generation, reason },
    });
    return barrier;
  }

  /**
   * Gesture cancellation semantics: keep / ensure the barrier stays open
   * with reason 'gesture-recovery'. The recovery animation's own
   * `transitionFinished` will close it — never released on a timer.
   */
  markGestureRecovery(navNodeId: string, routeKey?: string): 'marked' | 'opened' {
    const barrier = this.barriers.get(navNodeId);
    if (barrier !== undefined) {
      if (barrier.reason !== 'gesture-recovery') {
        barrier.reason = 'gesture-recovery';
        this.emitDiagnostic({
          level: 'debug',
          code: 'gesture-recovery',
          message:
            `gesture cancelled — barrier on navigator '${navNodeId}' held open ` +
            'for the recovery transition',
          ...(routeKey !== undefined ? { routeKey } : {}),
          details: { navNodeId, generation: barrier.generation },
        });
      }
      return 'marked';
    }
    this.open(navNodeId, 'gesture-recovery', routeKey);
    return 'opened';
  }

  /**
   * Close the open barrier on `navNodeId`. Returns false when none is open.
   * Closing is navNode-scoped, so a `transitionFinished` from any sibling
   * route of the same navigator releases the barrier.
   */
  close(navNodeId: string, closeReason: BarrierCloseReason, routeKey?: string): boolean {
    const barrier = this.barriers.get(navNodeId);
    if (barrier === undefined) return false;
    this.barriers.delete(navNodeId);
    this.cancelStallWarning(navNodeId);
    this.emitDiagnostic({
      level: 'debug',
      code: 'barrier-closed',
      message: `transition barrier closed on navigator '${navNodeId}' (closeReason: ${closeReason})`,
      ...(routeKey !== undefined ? { routeKey } : {}),
      details: {
        navNodeId,
        generation: barrier.generation,
        barrierReason: barrier.reason,
        closeReason,
        openForMs: this.timers.now() - barrier.openedAt,
      },
    });
    return true;
  }

  hasOpenBarrier(navNodeId: string): boolean {
    return this.barriers.has(navNodeId);
  }

  /** Snapshot of navNodeIds with an open barrier. */
  openNavNodeIds(): ReadonlySet<string> {
    return new Set(this.barriers.keys());
  }

  /** Open barrier record for a navNode, if any. */
  getBarrier(navNodeId: string): TransitionBarrier | undefined {
    return this.barriers.get(navNodeId);
  }

  /** Cancel every pending stall timer and drop all barriers. */
  dispose(): void {
    for (const handle of this.stallHandles.values()) {
      this.timers.clearTimeout(handle);
    }
    this.stallHandles.clear();
    this.barriers.clear();
  }

  private armStallWarning(barrier: TransitionBarrier, routeKey: string | undefined): void {
    const handle = this.timers.setTimeout(() => {
      this.stallHandles.delete(barrier.navNodeId);
      if (!this.barriers.has(barrier.navNodeId)) return;
      barrier.stallWarned = true;
      this.emitDiagnostic({
        level: 'warn',
        code: 'stalled-transition',
        message:
          `transition barrier on navigator '${barrier.navNodeId}' still open after ` +
          `${this.stallWarningMs}ms — a transitionFinished may never have fired`,
        ...(routeKey !== undefined ? { routeKey } : {}),
        details: {
          navNodeId: barrier.navNodeId,
          generation: barrier.generation,
          reason: barrier.reason,
          stallWarningMs: this.stallWarningMs,
        },
      });
    }, this.stallWarningMs);
    this.stallHandles.set(barrier.navNodeId, handle);
  }

  private cancelStallWarning(navNodeId: string): void {
    const handle = this.stallHandles.get(navNodeId);
    if (handle !== undefined) {
      this.timers.clearTimeout(handle);
      this.stallHandles.delete(navNodeId);
    }
  }
}
