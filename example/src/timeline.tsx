/**
 * Event timeline — an in-app recorder for verifying event ordering on a real
 * device. Every observed event is appended with a ms timestamp relative to
 * app start so sequences like
 *
 *   [  412ms] state-change → Orders › OrderDetail
 *   [  415ms] orders transitionStart OrderDetail…
 *   [  416ms] settling tab:Orders
 *   [  918ms] orders transitionEnd OrderDetail…
 *   [  919ms] barrier-closed
 *   [  921ms] task-started
 *
 * are inspectable without attaching a debugger. The same events also go to
 * the console for `adb logcat` / device logs capture.
 */

import React, { useRef, useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface TimelineEntry {
  id: number;
  /** ms since module load (≈ app start). */
  at: number;
  label: string;
}

const MAX_ENTRIES = 300;
const startedAt = performance.now();

let entries: TimelineEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

export function timelineLog(label: string): void {
  const entry = { id: seq++, at: performance.now() - startedAt, label };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  for (const l of listeners) l();
  console.log(`[smooth-task trace] [${Math.round(entry.at)}ms] ${label}`);
}

export function clearTimeline(): void {
  entries = [];
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly TimelineEntry[] {
  return entries;
}

export function useTimelineEntries(): readonly TimelineEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Route keys look like `Feed-AbC1xYz` — the name prefix is the readable part. */
export function shortRouteKey(key: string | undefined): string {
  return key?.split('-')[0] ?? '';
}

/**
 * Wrap a screenListeners map so every forwarded event (focus, blur,
 * transitionStart/End, gestureCancel…) is appended to the timeline before it
 * reaches the coordinator. The wrapped map keeps the same shape so it can be
 * passed straight to <X.Navigator screenListeners={…}>.
 */
export function wrapScreenListeners<L>(label: string, listeners: L): L {
  const wrapped: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(listeners as Record<string, unknown>)) {
    wrapped[name] =
      typeof fn === 'function'
        ? (event?: { target?: string }) => {
            const key = shortRouteKey(event?.target);
            timelineLog(`${label} ${name}${key ? ` ${key}` : ''}`);
            (fn as (e?: { target?: string }) => void)(event);
          }
        : fn;
  }
  return wrapped as L;
}

export function TimelineOverlay(): React.JSX.Element {
  const items = useTimelineEntries();
  const listRef = useRef<ScrollView>(null);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>event timeline</Text>
          <Pressable onPress={clearTimeline} hitSlop={8}>
            <Text style={styles.clear}>clear</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={listRef}
          style={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        >
          {items.slice(-60).map((e) => (
            <Text key={e.id} style={styles.line} numberOfLines={1}>
              <Text style={styles.stamp}>[{String(Math.round(e.at)).padStart(5, ' ')}ms]</Text>{' '}
              {e.label}
            </Text>
          ))}
          {items.length === 0 && <Text style={styles.empty}>no events yet</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined });

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  panel: {
    height: 200,
    backgroundColor: 'rgba(10, 12, 16, 0.92)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#3a3f4a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#3a3f4a',
  },
  title: { color: '#9aa4b2', fontSize: 11, fontFamily: mono },
  clear: { color: '#6ea8fe', fontSize: 11, fontFamily: mono },
  list: { flex: 1, paddingHorizontal: 10, paddingVertical: 4 },
  line: { color: '#d6dde6', fontSize: 10, fontFamily: mono, lineHeight: 14 },
  stamp: { color: '#7f8a99' },
  empty: { color: '#5c6675', fontSize: 10, fontFamily: mono, paddingTop: 6 },
});
