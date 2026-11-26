import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '@/constants/aequitas-theme';
import type { AutomatikZustand } from '@/lib/useQuantenSAutomatik';

// Schalter der Automatik (Quantengeld Weg B): an/aus, Stand, Grund des Endes.
export function QuantenSAutomatik({ a, t, gesperrt }: { a: AutomatikZustand; t: (k: any) => string; gesperrt?: boolean }) {
  return (
    <View style={{ marginTop: 10 }}>
      <TouchableOpacity
        style={[S.btn, gesperrt && !a.an && { opacity: 0.6 }]}
        disabled={gesperrt && !a.an}
        onPress={a.an ? a.stop : a.start}
        activeOpacity={0.85}
        accessibilityRole="switch"
        accessibilityState={{ checked: a.an }}
      >
        <Text style={S.text}>{a.an ? t('node.qAutoAus') : t('node.qAutoAn')}</Text>
      </TouchableOpacity>
      {a.an ? <Text style={[S.muted, { marginTop: 6 }]}>{t('node.qAutoLaeuft').replace('{n}', String(a.runde))}</Text> : null}
      {a.fehler ? <Text style={[S.fehler, { marginTop: 6 }]}>{a.fehler}</Text> : null}
      {!a.an && a.ende ? (
        <Text style={[a.ende === 'fehler' ? S.fehler : S.muted, { marginTop: 6 }]}>{t(`node.qAutoEnde_${a.ende}` as any)}</Text>
      ) : null}
    </View>
  );
}

const S = StyleSheet.create({
  btn: { borderWidth: 1, borderColor: theme.neon, borderRadius: theme.radiusPill, padding: 10, alignItems: 'center' },
  text: { color: theme.neon, fontSize: 13, fontWeight: '600' },
  muted: { color: theme.muted, fontSize: 12, lineHeight: 17 },
  fehler: { color: theme.red, fontSize: 13 },
});
