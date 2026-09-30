import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Text, useTheme } from '@/src/ui';

/**
 * Die Woerter der Phrase, nummeriert in zwei Spalten. Nicht markierbar und
 * ohne Kopierknopf: die Phrase gehoert auf Papier, nicht in die
 * Zwischenablage (die alte App bot "Kopieren" an).
 */
export function PhraseGrid({ phrase }: { phrase: string }) {
  const { colors, radius, space } = useTheme();
  const words = phrase.split(' ');
  const half = Math.ceil(words.length / 2);
  const column = (from: number, to: number) => (
    <View style={[styles.column, { gap: space.sm }]}>
      {words.slice(from, to).map((w, i) => (
        <View
          key={from + i}
          style={[styles.word, { backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm }]}
          accessible
          accessibilityLabel={`${from + i + 1}: ${w}`}
        >
          <Text variant="footnote" tone="tertiary" tabular style={styles.number}>
            {from + i + 1}
          </Text>
          <Text variant="bodyStrong" selectable={false}>
            {w}
          </Text>
        </View>
      ))}
    </View>
  );
  return (
    <View style={[styles.row, { gap: space.sm }]}>
      {column(0, half)}
      {column(half, words.length)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  column: { flex: 1 },
  word: { flexDirection: 'row', alignItems: 'center' },
  number: { minWidth: 20 },
});
