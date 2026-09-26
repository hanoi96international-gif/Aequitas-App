import React, { useEffect, useRef } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';

// QR-Code einer Empfaengeradresse oder Kasse scannen. Liefert den rohen
// Inhalt genau einmal; lesen tut ihn lib/zahlungslink.ts.
export function QrScanner({ visible, onScanned, onClose }: {
  visible: boolean;
  onScanned: (data: string) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [permission, requestPermission] = useCameraPermissions();
  const erledigt = useRef(false);

  useEffect(() => {
    if (!visible) return;
    erledigt.current = false;
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible, permission, requestPermission]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={S.safe}>
        <Text style={S.title}>{t('wallet.scanTitle')}</Text>
        <View style={S.frame}>
          {permission?.granted ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (erledigt.current) return;
                erledigt.current = true;
                onScanned(data);
              }}
            />
          ) : (
            <View style={S.center}>
              <Text style={S.hint}>{t('wallet.scanNoPermission')}</Text>
              {permission && !permission.canAskAgain ? null : (
                <TouchableOpacity onPress={requestPermission} style={S.btnSecondary} activeOpacity={0.8}>
                  <Text style={S.btnSecondaryText}>{t('wallet.scanAllow')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
        <Text style={S.hint}>{t('wallet.scanHint')}</Text>
        <TouchableOpacity onPress={onClose} style={S.btnSecondary} activeOpacity={0.8}>
          <Text style={S.btnSecondaryText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg, padding: 20, alignItems: 'center' },
  title: { color: theme.text, fontSize: 18, fontWeight: '800', marginTop: 12, marginBottom: 20 },
  frame: { width: '100%', aspectRatio: 1, borderRadius: theme.radius, overflow: 'hidden', borderWidth: 2, borderColor: theme.accent, backgroundColor: theme.card },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  hint: { color: theme.muted, fontSize: 14, textAlign: 'center', marginTop: 18, lineHeight: 20 },
  btnSecondary: { marginTop: 18, borderWidth: 1, borderColor: theme.border, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: theme.radiusPill, paddingVertical: 13, paddingHorizontal: 28 },
  btnSecondaryText: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
