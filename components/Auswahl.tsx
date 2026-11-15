import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/constants/aequitas-theme';
import { flagge, passt, type Eintrag } from '@/lib/laender';

// Auswahl aus einer Liste -- Monat, Jahr, Land und Bundesstaat/Provinz der
// Altersangabe werden gewaehlt, nicht eingetippt (Wunsch des Betreibers vom
// 15.11.2026: dann ist der Text darunter immer richtig). Ein Feld, das wie die
// Eingabefelder daneben aussieht; ein Tippen oeffnet die Liste im Vollbild,
// auf den gewaehlten (oder vorgeschlagenen) Eintrag gerollt.

const ZEILE = 50;

export function Auswahl({
  wert,
  eintraege,
  onWahl,
  platzhalter,
  titel,
  suchePlatzhalter,
  mitFlagge = false,
  startCode,
  feldStil,
  kurz,
  testID,
}: {
  wert: string;
  eintraege: Eintrag[];
  onWahl: (code: string) => void;
  platzhalter: string;
  titel: string;
  /** Mit Suchfeld (Laender); ohne: keine Suche (Monate, Jahre). */
  suchePlatzhalter?: string;
  mitFlagge?: boolean;
  /** Worauf die Liste rollt, solange nichts gewaehlt ist. */
  startCode?: string;
  feldStil?: object;
  /** Text im Feld statt des Namens (z. B. "06" statt "Juni"). */
  kurz?: (e: Eintrag) => string;
  testID?: string;
}) {
  const [offen, setOffen] = useState(false);
  const [suche, setSuche] = useState('');
  const gewaehlt = eintraege.find((e) => e.code === wert.toUpperCase());
  const treffer = useMemo(
    () => (suchePlatzhalter ? eintraege.filter((e) => passt(e, suche)) : eintraege),
    [eintraege, suche, suchePlatzhalter],
  );
  const ziel = gewaehlt?.code ?? startCode;
  const startIndex = !suche && ziel ? Math.max(0, treffer.findIndex((e) => e.code === ziel) - 3) : 0;

  function waehle(code: string) {
    onWahl(code);
    setOffen(false);
    setSuche('');
  }

  const anzeige = gewaehlt
    ? kurz
      ? kurz(gewaehlt)
      : `${mitFlagge ? flagge(gewaehlt.code) + ' ' : ''}${gewaehlt.name}`
    : platzhalter;

  return (
    <>
      <TouchableOpacity
        style={[S.feld, feldStil]}
        onPress={() => setOffen(true)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={gewaehlt ? `${titel}: ${gewaehlt.name}` : titel}
        testID={testID}
      >
        <Text style={gewaehlt ? S.feldText : S.feldLeer} numberOfLines={1}>{anzeige}</Text>
        <Text style={S.pfeil}>▾</Text>
      </TouchableOpacity>

      <Modal visible={offen} animationType="slide" onRequestClose={() => setOffen(false)}>
        <SafeAreaView style={S.blatt}>
          <View style={S.kopf}>
            <Text style={S.titel}>{titel}</Text>
            <TouchableOpacity onPress={() => setOffen(false)} style={S.zu} accessibilityRole="button" accessibilityLabel="✕">
              <Text style={S.zuText}>✕</Text>
            </TouchableOpacity>
          </View>
          {suchePlatzhalter ? (
            <TextInput
              style={S.suche}
              value={suche}
              onChangeText={setSuche}
              placeholder={suchePlatzhalter}
              placeholderTextColor={theme.muted}
              autoCorrect={false}
            />
          ) : null}
          <FlatList
            data={treffer}
            keyExtractor={(e) => e.code}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={24}
            initialScrollIndex={startIndex < treffer.length ? startIndex : 0}
            getItemLayout={(_, i) => ({ length: ZEILE, offset: ZEILE * i, index: i })}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[S.zeile, item.code === gewaehlt?.code && S.zeileAktiv]}
                onPress={() => waehle(item.code)}
                activeOpacity={0.8}
              >
                <Text style={S.zeileText} numberOfLines={1}>
                  {mitFlagge ? flagge(item.code) + '  ' : ''}{item.name}
                </Text>
                {mitFlagge ? <Text style={S.code}>{item.code}</Text> : null}
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const S = StyleSheet.create({
  feld: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: theme.bg, borderRadius: 10, borderWidth: 1, borderColor: theme.border,
    paddingVertical: 11, paddingHorizontal: 12, minHeight: 46,
  },
  feldText: { color: theme.text, fontSize: 15, flexShrink: 1 },
  feldLeer: { color: theme.muted, fontSize: 15, flexShrink: 1 },
  pfeil: { color: theme.muted, fontSize: 13, marginLeft: 6 },
  blatt: { flex: 1, backgroundColor: theme.bg },
  kopf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 8, paddingBottom: 10 },
  titel: { color: theme.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  zu: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  zuText: { color: theme.text, fontSize: 20 },
  suche: {
    marginHorizontal: 16, marginBottom: 8, color: theme.text, backgroundColor: theme.card,
    borderRadius: 10, borderWidth: 1, borderColor: theme.border, paddingVertical: 10, paddingHorizontal: 12, fontSize: 15,
  },
  zeile: {
    height: ZEILE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: theme.border,
  },
  zeileAktiv: { backgroundColor: 'rgba(91,140,255,0.12)' },
  zeileText: { color: theme.text, fontSize: 15, flexShrink: 1 },
  code: { color: theme.muted, fontSize: 12, marginLeft: 10 },
});
