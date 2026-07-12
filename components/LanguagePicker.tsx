import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLanguage } from '@/contexts/LanguageContext';
import { LOCALES, LANGUAGE_NAMES, type Locale } from '@/lib/i18n';
import { theme, purpleTint, purpleTintBorder } from '@/constants/aequitas-theme';

export default function LanguagePicker() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);

  function pick(l: Locale) {
    setLang(l);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity style={S.pill} onPress={() => setOpen(true)} activeOpacity={0.75}>
        <Text style={S.pillText}>🌐 {lang.toUpperCase()}</Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={S.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={S.sheet} onStartShouldSetResponder={() => true}>
            <Text style={S.sheetTitle}>LANGUAGE</Text>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {LOCALES.map((l) => (
                <TouchableOpacity key={l} style={[S.row, l === lang && S.rowActive]} onPress={() => pick(l)} activeOpacity={0.8}>
                  <Text style={[S.rowText, l === lang && S.rowTextActive]}>{LANGUAGE_NAMES[l]}</Text>
                  <Text style={S.rowCode}>{l.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const S = StyleSheet.create({
  pill: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  pillText: { color: theme.text, fontSize: 11, fontWeight: '700' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: theme.card, borderTopLeftRadius: theme.radius, borderTopRightRadius: theme.radius, padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: theme.border },
  sheetTitle: { color: theme.muted, fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 12 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: theme.border },
  rowActive: { backgroundColor: purpleTint, borderColor: purpleTintBorder, borderRadius: theme.radiusSm, paddingHorizontal: 10, borderBottomWidth: 0 },
  rowText: { color: theme.text, fontSize: 14 },
  rowTextActive: { color: theme.purple, fontWeight: '700' },
  rowCode: { color: theme.muted, fontSize: 11, fontFamily: theme.fontMono },
});
