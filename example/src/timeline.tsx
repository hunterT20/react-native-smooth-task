/**
 * Event timeline — an in-app recorder for verifying event ordering on a real
 * device. Collapsed to a small pill by default so it never blocks the tab
 * bar or screen content; expanding opens a scrollable log panel anchored to
 * the top edge (tabs stay tappable while open).
 *
 * Every observed event is appended with a ms timestamp relative to app
 * start so sequences like
 *
 *   [  412ms] state-change → MainTabs › Orders › OrderDetail
 *   [  415ms] orders transitionStart OrderDetail…
 *   [  416ms] settling tab:Orders
 *   [  918ms] orders transitionEnd OrderDetail…
 *   [  919ms] barrier-closed
 *   [  921ms] task-started
 *
 * are inspectable without attaching a debugger. Each line is also mirrored
 * to the console for `adb logcat` capture — except in record-only mode,
 * which skips console writes and UI re-renders so the recorder does not
 * perturb JS-side performance during benchmarks. `export` dumps the
 * captured events as JSON.
 */

import React, { useRef, useState, useSyncExternalStore } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
let recordOnly = false;
const listeners = new Set<() => void>();

export function timelineLog(label: string): void {
  const entry = { id: seq++, at: performance.now() - startedAt, label };
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
  if (recordOnly) return;
  for (const l of listeners) l();
  console.log(`[smooth-task trace] [${Math.round(entry.at)}ms] ${label}`);
}

export function clearTimeline(): void {
  entries = [];
  for (const l of listeners) l();
}

/** Silent capture: events are still recorded but nothing re-renders/logs. */
export function setRecordOnly(value: boolean): void {
  recordOnly = value;
  for (const l of listeners) l();
}

export function exportTimeline(): string {
  const json = JSON.stringify(
    entries.map((e) => ({ ms: Math.round(e.at), event: e.label }))
  );
  console.log(`[smooth-task trace export] ${json}`);
  return json;
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
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const [silent, setSilent] = useState(recordOnly);
  const listRef = useRef<ScrollView>(null);

  if (!expanded) {
    return (
      <View style={[styles.pillWrap, { top: insets.top + 6 }]} pointerEvents="box-none">
        <Pressable style={styles.pill} onPress={() => setExpanded(true)} hitSlop={6}>
          <Text style={styles.pillText}>
            timeline · {items.length}
            {recordOnly ? ' · rec' : ''}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.overlay, { top: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>timeline · {items.length}</Text>
          <Pressable
            hitSlop={8}
            onPress={() => {
              const next = !silent;
              setSilent(next);
              setRecordOnly(next);
            }}
          >
            <Text style={styles.action}>{silent ? 'rec:only' : 'rec:live'}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={exportTimeline}>
            <Text style={styles.action}>export</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={clearTimeline}>
            <Text style={styles.action}>clear</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setExpanded(false)}>
            <Text style={styles.action}>close</Text>
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
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    backgroundColor: 'rgba(10, 12, 16, 0.85)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { color: '#9aa4b2', fontSize: 11, fontFamily: mono },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  panel: {
    height: 220,
    backgroundColor: 'rgba(10, 12, 16, 0.92)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#3a3f4a',
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
  action: { color: '#6ea8fe', fontSize: 11, fontFamily: mono, paddingLeft: 10 },
  list: { flex: 1, paddingHorizontal: 10, paddingVertical: 4 },
  line: { color: '#d6dde6', fontSize: 10, fontFamily: mono, lineHeight: 14 },
  stamp: { color: '#7f8a99' },
  empty: { color: '#5c6675', fontSize: 10, fontFamily: mono, paddingTop: 6 },
});
