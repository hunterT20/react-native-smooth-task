/**
 * SettingsScreen — lightweight modal on the RootStack.
 *
 * While this modal animates in, a barrier is open on the '<root>' navNode,
 * which blocks route-scoped tasks on EVERY descendant (including screens
 * deep inside HomeStack/OrdersStack). Nothing to wire here — the point is
 * the demo: open Settings and watch pending route tasks stay pending until
 * the modal's transitionEnd closes the barrier.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.body}>
        While this modal animated in, route-scoped work across the whole app was paused. It resumes
        once the transition settles.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, color: '#444' },
});
