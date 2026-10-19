/**
 * BenchmarkScreen — A/B/C/D comparison of heavy-content gating strategies
 * during a push transition.
 *
 *   A  immediate          — heavy body mounts with the screen (baseline)
 *   B  fixed delay        — setTimeout(350ms), the "guess the animation
 *                           length" approach
 *   C  manual settle      — navigation.addListener('transitionEnd'), the
 *                           hand-rolled equivalent of smooth-task gating
 *   D  smooth-task        — useDeferredMount (settled-evidence gating)
 *
 * Each gate is its own component so only the active strategy's hooks run —
 * e.g. A/B/C never mount useDeferredMount, so the Scheduler stays out of
 * the baseline measurements.
 *
 * Measurements (approximate, JS-side):
 *   latency    — ms from screen mount until the heavy body finishes layout.
 *                onLayout ≠ paint; use comparatively across modes.
 *   rAF frames — requestAnimationFrame callbacks observed in that window.
 *                The probe starts on first effect, so it may miss part of
 *                the initial commit. latency/16.7 − frames ≈ rAF slots the
 *                JS thread missed — NOT a UI-thread dropped-frame counter.
 *                Compare across modes only, in RELEASE builds.
 *
 * For clean traces run with the timeline in record-only mode: the recorder
 * then performs zero re-renders and zero console writes.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useDeferredMount } from 'react-native-smooth-task/stack';
import type { HomeStackParamList } from '../App';

export type BenchmarkMode = 'A' | 'B' | 'C' | 'D';

// --- Gating gates ---------------------------------------------------------------

interface GateProps {
  onReady(): void;
}

/** Mode A — release immediately on mount. */
function GateA({ onReady }: GateProps) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return null;
}

/** Mode B — fixed 350ms guess at the animation duration. */
function GateB({ onReady }: GateProps) {
  useEffect(() => {
    const timer = setTimeout(onReady, 350);
    return () => clearTimeout(timer);
  }, [onReady]);
  return null;
}

/** Mode C — wait for the navigator's own transitionEnd event. */
function GateC({ onReady }: GateProps) {
  const navigation = useNavigation<StackNavigationProp<HomeStackParamList, 'Benchmark'>>();
  useEffect(() => {
    // Screen-level listener: fires once when THIS screen's push animation
    // completes. Attached during mount, i.e. well before transitionEnd —
    // so there is no race where the event was missed. Note this only knows
    // about THIS navigator's event; nested/ancestor barriers are invisible
    // to it (exactly the gap smooth-task's coordinator exists to close).
    return navigation.addListener('transitionEnd', () => onReady());
  }, [navigation, onReady]);
  return null;
}

/** Mode D — smooth-task settled evidence. */
function GateD({ onReady }: GateProps) {
  const deferredReady = useDeferredMount();
  useEffect(() => {
    if (deferredReady) onReady();
  }, [deferredReady, onReady]);
  return null;
}

const GATES: Record<BenchmarkMode, React.ComponentType<GateProps>> = {
  A: GateA,
  B: GateB,
  C: GateC,
  D: GateD,
};

const MODE_LABELS: Record<BenchmarkMode, string> = {
  A: 'immediate',
  B: 'setTimeout(350)',
  C: "addListener('transitionEnd')",
  D: 'useDeferredMount',
};

// --- Heavy workload ---------------------------------------------------------------

/** Deliberately visible work: prime sieve ≈ tens of ms of pure JS. */
function busyWork(limit: number): number {
  let primes = 0;
  for (let n = 2; n < limit; n += 1) {
    let isPrime = true;
    for (let d = 2; d * d <= n; d += 1) {
      if (n % d === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) primes += 1;
  }
  return primes;
}

const CARD_COUNT = 350;
const PRIME_LIMIT = 50_000;

function HeavyBody({ onLaidOut }: { onLaidOut: () => void }) {
  // Synchronous CPU + a large non-virtualized view tree: real work the JS
  // thread must finish before the content is laid out.
  const checksum = useMemo(() => busyWork(PRIME_LIMIT), []);
  const cards = useMemo(
    () =>
      Array.from({ length: CARD_COUNT }, (_, i) => ({
        id: `card-${i}`,
        title: `Benchmark card ${i}`,
        detail: `checksum ${checksum} · row ${i}`,
      })),
    [checksum]
  );

  return (
    <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
      {cards.map((card) => (
        <View key={card.id} style={styles.card}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardDetail}>{card.detail}</Text>
        </View>
      ))}
      <View onLayout={onLaidOut} />
    </ScrollView>
  );
}

// --- Screen -----------------------------------------------------------------------

export function BenchmarkScreen({ route }: { route: { params: { mode: BenchmarkMode } } }) {
  const mode = route.params.mode;
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<{ latency: number; frames: number } | null>(null);
  const startedAt = useRef(performance.now());
  const frames = useRef(0);

  const onReady = useCallback(() => setReady(true), []);
  const Gate = GATES[mode];

  // rAF probe — counts JS frame callbacks until the result is captured.
  useEffect(() => {
    if (result !== null) return undefined;
    let raf = 0;
    const loop = () => {
      frames.current += 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [result]);

  const onLaidOut = () =>
    setResult((prev) =>
      prev ?? { latency: Math.round(performance.now() - startedAt.current), frames: frames.current }
    );

  const missed = result
    ? Math.max(0, Math.round(result.latency / 16.7) - result.frames)
    : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          mode {mode} — {MODE_LABELS[mode]}
        </Text>
        {result ? (
          <Text style={styles.headerMeta}>
            content ready at +{result.latency}ms · {result.frames} rAF frames · ~{missed} rAF
            slots missed (approx.)
          </Text>
        ) : (
          <Text style={styles.headerMeta}>measuring…</Text>
        )}
      </View>
      {!ready && <Gate onReady={onReady} />}
      {ready ? (
        <HeavyBody onLaidOut={onLaidOut} />
      ) : (
        <View style={styles.waiting}>
          <Text style={styles.waitingText}>waiting for gate ({MODE_LABELS[mode]})…</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#101418',
  },
  headerTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  headerMeta: { color: '#9aa4b2', fontSize: 12, marginTop: 2 },
  waiting: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  waitingText: { color: '#666' },
  body: { flex: 1 },
  bodyContent: { padding: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardDetail: { fontSize: 12, color: '#666', marginTop: 2 },
});
