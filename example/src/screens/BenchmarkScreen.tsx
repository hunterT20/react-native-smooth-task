/**
 * BenchmarkScreen — A/B/C/D comparison of heavy-content gating strategies
 * during a push transition.
 *
 *   A  immediate          — heavy body mounts with the screen (baseline)
 *   B  fixed delay        — setTimeout(350ms), the "guess the animation
 *                           length" approach
 *   C  manual settle      — InteractionManager.runAfterInteractions
 *   D  smooth-task        — useDeferredMount (settled-evidence gating)
 *
 * Measurements (approximate, JS-side):
 *   latency  — ms from screen mount until the heavy body finishes layout.
 *   frames   — requestAnimationFrame callbacks observed in that window.
 *              rAF fires once per render pass on the JS thread, so
 *              latency/16.7 − frames ≈ dropped frame slots. This is not a
 *              UI-thread FPS counter — use it comparatively across modes
 *              in a RELEASE build, never in dev mode.
 *
 * For clean traces run with the timeline in record-only mode: the recorder
 * then performs zero re-renders and zero console writes.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useDeferredMount } from 'react-native-smooth-task/stack';

export type BenchmarkMode = 'A' | 'B' | 'C' | 'D';

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

const MODE_LABELS: Record<BenchmarkMode, string> = {
  A: 'immediate',
  B: 'setTimeout(350)',
  C: 'runAfterInteractions',
  D: 'useDeferredMount',
};

export function BenchmarkScreen({ route }: { route: { params: { mode: BenchmarkMode } } }) {
  const mode = route.params.mode;
  const deferredReady = useDeferredMount();
  const [ready, setReady] = useState(mode === 'A');
  const [result, setResult] = useState<{ latency: number; frames: number } | null>(null);
  const startedAt = useRef(performance.now());
  const frames = useRef(0);

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

  // Gating strategy under test.
  useEffect(() => {
    if (mode === 'B') {
      const timer = setTimeout(() => setReady(true), 350);
      return () => clearTimeout(timer);
    }
    if (mode === 'C') {
      const handle = InteractionManager.runAfterInteractions(() => setReady(true));
      return () => handle.cancel();
    }
    return undefined;
  }, [mode]);

  useEffect(() => {
    if (mode === 'D' && deferredReady) setReady(true);
  }, [mode, deferredReady]);

  const onLaidOut = () =>
    setResult((prev) =>
      prev ?? { latency: Math.round(performance.now() - startedAt.current), frames: frames.current }
    );

  const dropped = result
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
            content ready at +{result.latency}ms · {result.frames} rAF frames · ~{dropped} frame
            slots missed
          </Text>
        ) : (
          <Text style={styles.headerMeta}>measuring…</Text>
        )}
      </View>
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
