/**
 * OrdersScreen — `useIdleTask` background analytics batch.
 *
 * Pulling to refresh (or first settle) schedules a chunked analytics/sync
 * pass through `scheduleIdle` (scheduling: 'idle', priority 'background' by
 * default). The task:
 *   - runs inside idle callbacks only while this route is settled,
 *   - is deduped by key — a second refresh while pending replaces the first,
 *   - checks `signal.aborted` between batches so cancellation is cheap,
 *   - is cancelled automatically if the screen unmounts.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useIdleTask } from 'react-native-smooth-task/stack';
import type { TaskHandle } from 'react-native-smooth-task/stack';

const ORDERS = Array.from({ length: 40 }, (_, i) => ({
  id: `order-${i}`,
  total: (19.99 + i * 3.5).toFixed(2),
}));

/** Simulated analytics flush of one batch — ~30ms of "work". */
function flushAnalyticsBatch(batch: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.log(`[analytics] flushed ${batch.length} events`);
      resolve();
    }, 30);
    signal.addEventListener('abort', () => clearTimeout(timer));
  });
}

export function OrdersScreen({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const scheduleIdle = useIdleTask();
  const [refreshing, setRefreshing] = useState(false);
  const pendingRef = useRef<TaskHandle | null>(null);

  const scheduleAnalytics = useCallback(() => {
    // Latest-wins dedupe: a previous still-pending 'orders-analytics' task in
    // this route's scope is cancelled and replaced.
    const handle = scheduleIdle(
      async (signal) => {
        for (let i = 0; i < ORDERS.length && !signal.aborted; i += 10) {
          const batch = ORDERS.slice(i, i + 10).map((o) => o.id);
          await flushAnalyticsBatch(batch, signal);
        }
      },
      { key: 'orders-analytics' } // priority defaults to 'background'
    );
    pendingRef.current = handle;
  }, [scheduleIdle]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    scheduleAnalytics();
    setTimeout(() => setRefreshing(false), 600);
  }, [scheduleAnalytics]);

  // Kick off the batch once on mount — it waits for settle + idle.
  useEffect(() => {
    scheduleAnalytics();
    return () => pendingRef.current?.cancel();
  }, [scheduleAnalytics]);

  return (
    <View style={styles.container}>
      <FlatList
        data={ORDERS}
        keyExtractor={(o) => o.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onOpenOrder(item.id)}>
            <Text style={styles.rowTitle}>{item.id}</Text>
            <Text style={styles.rowTotal}>${item.total}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e3e5e9',
  },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowTotal: { fontSize: 15, color: '#555' },
});
