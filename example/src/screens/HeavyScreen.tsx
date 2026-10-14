/**
 * HeavyScreen — `useDeferredMount` + skeleton.
 *
 * The expensive feed (300 rows) is NOT rendered while the push animation is
 * in flight: `ready` stays false until this route is settled — focused, no
 * open transition barrier on any ancestor navigator, app active. Once ready
 * the latch is sticky: navigating away and back keeps the real list mounted
 * (the skeleton never reappears for the lifetime of this component).
 */

import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useDeferredMount } from 'react-native-smooth-task/stack';

const ROW_COUNT = 300;

/** Deliberately expensive: deriving rows costs real JS work on mount. */
function useFeedRows() {
  return useMemo(
    () =>
      Array.from({ length: ROW_COUNT }, (_, i) => ({
        id: `post-${i}`,
        title: `Post #${i}`,
        body: `Synthetic feed row ${i} — pretend this is a rich card.`,
      })),
    []
  );
}

function FeedSkeleton() {
  return (
    <View style={styles.container}>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={styles.skeletonLineWide} />
          <View style={styles.skeletonLine} />
        </View>
      ))}
    </View>
  );
}

export function HeavyScreen({ onOpenPost }: { onOpenPost: (postId: string) => void }) {
  const ready = useDeferredMount(); // scheduling: 'transition' (default)
  const rows = useFeedRows();

  if (!ready) return <FeedSkeleton />;

  return (
    <FlatList
      style={styles.container}
      data={rows}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => onOpenPost(item.id)}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardBody}>{item.body}</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardBody: { marginTop: 4, color: '#555' },
  skeletonCard: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  skeletonLineWide: {
    height: 14,
    borderRadius: 4,
    backgroundColor: '#e3e5e9',
    marginBottom: 8,
  },
  skeletonLine: {
    height: 12,
    width: '60%',
    borderRadius: 4,
    backgroundColor: '#eceef1',
  },
});
