/**
 * DetailScreen — "fetch early, render late".
 *
 * Two clocks run independently:
 *   1. The fetch starts on mount — it runs DURING the push animation because
 *      network work costs no frames. By the time the transition settles the
 *      data is often already here.
 *   2. The heavy detail body is deferred until the route settles via
 *      <DeferredView> — so its mount never competes with the animation.
 *
 * `useAfterTransition` with `mode: 'every-focus'` logs a screen view each
 * time this route refocuses (push AND pop-back), but not on barrier churn.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { DeferredView, useAfterTransition } from 'react-native-smooth-task/stack';

interface PostData {
  title: string;
  paragraphs: string[];
  fetchedInMs: number;
}

/** Fake fetch — resolves after ~350ms with deterministic content. */
function fetchPost(seed: string, signal: AbortSignal): Promise<PostData> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({
        title: `Detail for ${seed}`,
        paragraphs: Array.from(
          { length: 12 },
          (_, i) =>
            `Paragraph ${i + 1} of ${seed}. This stands in for an expensive ` +
            `content body — rich text, images, embedded media.`
        ),
        fetchedInMs: Date.now() - started,
      });
    }, 350);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    });
  });
}

function DetailSkeleton() {
  return (
    <View style={styles.container}>
      <View style={styles.skeletonTitle} />
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={styles.skeletonLine} />
      ))}
    </View>
  );
}

export function DetailScreen({ title, seed }: { title: string; seed: string }) {
  const [data, setData] = useState<PostData | null>(null);

  // 1) Fetch starts IMMEDIATELY on mount — not gated on the transition.
  useEffect(() => {
    const controller = new AbortController();
    fetchPost(seed, controller.signal)
      .then(setData)
      .catch(() => {
        /* aborted on unmount / cancelled */
      });
    return () => controller.abort();
  }, [seed]);

  // 2) Post-transition work — runs once per focus epoch of this route.
  useAfterTransition(
    (signal) => {
      if (signal.aborted) return;
      console.log(`[analytics] screen_view: ${title}`);
    },
    { mode: 'every-focus' }
  );

  // 3) Only the heavy subtree waits for settle; the header renders instantly.
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>{data ? `fetched in ${data.fetchedInMs}ms` : 'fetching…'}</Text>
      <DeferredView fallback={<DetailSkeleton />}>
        {data?.paragraphs.map((p, i) => (
          <Text key={i} style={styles.paragraph}>
            {p}
          </Text>
        ))}
        {data === null && <DetailSkeleton />}
      </DeferredView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  meta: { color: '#888', marginBottom: 16 },
  paragraph: { fontSize: 15, lineHeight: 22, marginBottom: 12, color: '#222' },
  skeletonTitle: {
    height: 24,
    width: '70%',
    borderRadius: 6,
    backgroundColor: '#e3e5e9',
    marginBottom: 16,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    backgroundColor: '#eceef1',
    marginBottom: 10,
  },
});
