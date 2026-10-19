/**
 * LabScreen — navigation control panel (initial route of HomeStack).
 *
 * Every button logs `dispatch …` to the event timeline BEFORE issuing the
 * action, so the resulting trace reads like:
 *
 *   [  120ms] dispatch push Feed
 *   [  122ms] state-change → MainTabs › Home › Feed
 *   [  125ms] home transitionStart Feed…
 *   [  126ms] settling tab:Home
 *   [  640ms] home transitionEnd Feed…
 *   [  641ms] barrier-closed
 *   [  643ms] task-started
 *
 * Scenarios covered: JS-stack push/pop, nested native-stack push (animated
 * and animation:'none'), tab switches, a root-stack modal, and a rapid
 * push/pop burst that stresses the settling state machine.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  StackActions,
  useNavigation,
  type NavigationProp,
} from '@react-navigation/native';
import { timelineLog } from '../timeline';

// Lab dispatches cross-navigator actions (nested tabs, root modal) whose
// typed param lists live in App.tsx — a loose record keeps the lab honest
// without duplicating the tree here.
type LabNav = NavigationProp<Record<string, object | undefined>>;

function LabButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.button} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

export function LabScreen() {
  const navigation = useNavigation<LabNav>();

  const run = (label: string, action: () => void) => () => {
    timelineLog(`dispatch ${label}`);
    action();
  };

  // MainTabs lives one level above HomeStack; nested params let the tabs
  // navigator focus the tab AND the stack inside it push the screen in a
  // single dispatch.
  const navigateNested = (path: {
    tab: 'Home' | 'Orders';
    screen: string;
    params?: Record<string, unknown>;
  }) =>
    navigation.navigate('MainTabs', {
      screen: path.tab,
      params: { screen: path.screen, params: path.params },
    });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Navigation Lab</Text>
      <Text style={styles.hint}>
        Clear the timeline (tap the pill above), run one scenario, then expand it to read the event
        ordering.
      </Text>

      <Section title="JS stack (home)">
        <LabButton
          label="Push Feed"
          onPress={run('push Feed', () => navigation.navigate('Feed'))}
        />
        <LabButton
          label="Push Post"
          onPress={run('push Post', () =>
            navigation.navigate('Post', { postId: `lab-${Date.now() % 1000}` })
          )}
        />
        <LabButton label="Go back" onPress={run('goBack', () => navigation.goBack())} />
        <LabButton
          label="Pop to top"
          onPress={run('popToTop', () => navigation.dispatch(StackActions.popToTop()))}
        />
      </Section>

      <Section title="Native stack (orders)">
        <LabButton
          label="Push OrderDetail"
          onPress={run('push OrderDetail', () =>
            navigateNested({ tab: 'Orders', screen: 'OrderDetail', params: { orderId: 'lab-1' } })
          )}
        />
        <LabButton
          label="Push (no animation)"
          onPress={run('push OrderDetailStatic', () =>
            navigateNested({ tab: 'Orders', screen: 'OrderDetailStatic', params: { orderId: 'x' } })
          )}
        />
        <LabButton
          label="Orders tab"
          onPress={run('navigate Orders tab', () =>
            navigateNested({ tab: 'Orders', screen: 'OrdersList' })
          )}
        />
      </Section>

      <Section title="Root stack">
        <LabButton
          label="Open Settings modal"
          onPress={run('push Settings modal', () => navigation.navigate('Settings'))}
        />
      </Section>

      <Section title="Stress">
        <LabButton
          label="Rapid push/pop ×4"
          onPress={run('rapid push/pop ×4', () => {
            for (let i = 0; i < 4; i += 1) {
              setTimeout(() => {
                timelineLog(`dispatch rapid push ${i}`);
                navigation.navigate('Post', { postId: `rapid-${i}` });
                setTimeout(() => {
                  timelineLog(`dispatch rapid pop ${i}`);
                  navigation.goBack();
                }, 200);
              }, i * 450);
            }
          })}
        />
      </Section>

      <Section title="Benchmark (push → heavy content)">
        {(['A', 'B', 'C', 'D'] as const).map((mode) => (
          <LabButton
            key={mode}
            label={`Mode ${mode}`}
            onPress={run(`push Benchmark ${mode}`, () =>
              navigation.navigate('Benchmark', { mode })
            )}
          />
        ))}
      </Section>

      <Text style={styles.legend}>
        A = immediate · B = setTimeout(350) · C = InteractionManager.runAfterInteractions · D =
        smooth-task useDeferredMount
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f7f9' },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  hint: { color: '#666', fontSize: 13, marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#444', marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    backgroundColor: '#1f3a8a',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  legend: { color: '#777', fontSize: 12, marginTop: 8 },
});
