import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Linking
} from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';
import RNFS from 'react-native-fs';

// const PROOF_SERVER = "https://aequitas-proof-server-production.up.railway.app";
const WEBAPP        = "https://aequitas-production-9fba.up.railway.app";
const METAMASK_DAPP = "https://metamask.app.link/dapp/aequitas-production-9fba.up.railway.app";
const FIELD_SIZE    = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const rnBiometrics  = new ReactNativeBiometrics();
const DEVICE_KEY_PATH = RNFS.DocumentDirectoryPath + '/aequitas_device_pubkey.txt';

// ─── WHY THIS APPROACH ──────────────────────────────────────────────────────
// react-native-biometrics NEVER exposes raw biometric data — that's a
// deliberate OS-level privacy restriction. Instead, createKeys() generates a
// key pair ONCE inside the device's secure hardware and returns a publicKey
// that stays stable for the lifetime of that key pair. THAT public key is
// what we use as the stable input to the bio-hash.
//
// HONEST LIMITATION: this binds registration to one device. The planned
// MAX30102 PPG hardware sensor is intended to close that gap later with a
// real physiological signal that isn't tied to one phone's secure element.

function deriveBioHash(publicKey: string): bigint {
  let hashNum = BigInt(0);
  for (let i = 0; i < Math.min(publicKey.length, 128); i++) {
    hashNum = (hashNum * BigInt(256) + BigInt(publicKey.charCodeAt(i))) % FIELD_SIZE;
  }
  return hashNum;
}

export default function App() {
  const [status, setStatus] = useState<'checking'|'idle'|'proving'|'waiting'|'registered'|'already_registered'>('checking');
  const [log, setLog]       = useState<{msg:string,type:string,time:string}[]>([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance]             = useState(0);
  const pollRef      = useRef<any>(null);
  const linkingSubRef = useRef<any>(null);

  function addLog(msg: string, type = 'info') {
    setLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  }

  // ─── AUTO-CHECK ON APP OPEN ─────────────────────────────────────────────
  // Silently check on every launch if this device's key is already registered.
  // No button press or biometric prompt needed — the public key file is
  // readable without authentication, so we can derive the bioHash and
  // query the chain immediately.
  useEffect(() => {
    async function checkOnStartup() {
      try {
        const keyFileExists = await RNFS.exists(DEVICE_KEY_PATH);
        if (!keyFileExists) {
          setStatus('idle');
          return;
        }
        const storedPublicKey = await RNFS.readFile(DEVICE_KEY_PATH, 'utf8');
        const hashNum = deriveBioHash(storedPublicKey);
        if (hashNum === BigInt(0)) { setStatus('idle'); return; }

        const resp = await fetch(`${WEBAPP}/api/check-registration-by-biohash?bioHash=${hashNum.toString()}`);
        const data = await resp.json();
        if (data.registered && data.is_human) {
          setWalletAddress(data.wallet || '');
          setBalance(data.balance || 0);
          setStatus('already_registered');
        } else {
          setStatus('idle');
        }
      } catch (e) {
        setStatus('idle');
      }
    }
    checkOnStartup();
  }, []);

  // ─── DEEP LINK RECEIVING ────────────────────────────────────────────────
  useEffect(() => {
    function handleDeepLink(event: { url: string }) {
      try {
        if (!event.url.includes('registered')) return;
        const queryStart = event.url.indexOf('?');
        if (queryStart === -1) return;
        const queryString = event.url.slice(queryStart + 1);
        const params = queryString.split('&').reduce((acc, pair) => {
          const [key, value] = pair.split('=');
          if (key) acc[decodeURIComponent(key)] = decodeURIComponent(value || '');
          return acc;
        }, {} as Record<string, string>);
        const wallet = params['wallet'];
        if (!wallet) return;
        addLog('Deep link received from registration page', 'info');
        if (pollRef.current) clearInterval(pollRef.current);
        setWalletAddress(wallet);
        addLog('Registration confirmed via deep link!', 'success');
        setStatus('registered');
      } catch (e) {}
    }

    linkingSubRef.current = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL().then(url => { if (url) handleDeepLink({ url }); });
    return () => { if (linkingSubRef.current) linkingSubRef.current.remove(); };
  }, []);

  function startPolling(commitment: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/check-registration?commitment=${commitment}`);
        const data = await resp.json();
        if (data.registered) {
          clearInterval(pollRef.current);
          setWalletAddress(data.wallet);
          setBalance(data.balance);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted to ${data.wallet.slice(0,10)}...`, 'success');
          setStatus('registered');
        }
      } catch(e) {}
    }, 3000);
    setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); }, 300000);
  }

  function startPollingByBioHash(bioHash: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/check-registration-by-biohash?bioHash=${bioHash}`);
        const data = await resp.json();
        if (data.registered && data.is_human) {
          clearInterval(pollRef.current);
          setWalletAddress(data.wallet);
          setBalance(data.balance);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted to ${data.wallet.slice(0,10)}...`, 'success');
          setStatus('registered');
        } else if (data.biometric_in_use) {
          clearInterval(pollRef.current);
          addLog('This fingerprint is already registered to another wallet.', 'error');
          addLog('One person, one wallet. Registration blocked.', 'error');
          setStatus('idle');
        }
      } catch(e) {}
    }, 3000);
    setTimeout(() => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        addLog('Registration timed out. If you completed registration in MetaMask, please retry.', 'error');
        setStatus('idle');
      }
    }, 120000);
  }

  async function proveIdentity() {
    setStatus('proving');
    setLog([]);
    setWalletAddress('');
    setBalance(0);

    try {
      addLog('Checking biometric hardware...', 'info');
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      if (!available) {
        addLog('No biometrics available on this device', 'error');
        addLog('Enable fingerprint or Face ID in your phone settings first', 'error');
        setStatus('idle');
        return;
      }
      addLog('Biometric sensor ready: ' + biometryType, 'success');

      const { keysExist } = await rnBiometrics.biometricKeysExist();
      const keyFileExists = await RNFS.exists(DEVICE_KEY_PATH);

      if (!keysExist && !keyFileExists) {
        addLog('First time on this device — creating secure key...', 'info');
        const created = await rnBiometrics.createKeys();
        await RNFS.writeFile(DEVICE_KEY_PATH, created.publicKey, 'utf8');
      } else if (keysExist && !keyFileExists) {
        addLog('Device key exists but its record is missing', 'error');
        addLog('This device may already be registered under a key we can no longer read.', 'error');
        addLog('Please contact support before retrying — do not reinstall.', 'error');
        setStatus('idle');
        return;
      } else if (!keysExist && keyFileExists) {
        addLog('Stored device key reference is stale', 'error');
        addLog('The secure key it points to no longer exists on this device.', 'error');
        setStatus('idle');
        return;
      }

      const { success, signature } = await rnBiometrics.createSignature({
        promptMessage: 'Prove your humanity for Aequitas',
        payload: 'aequitas_identity_v7_device_unlock',
      });

      if (!success || !signature) {
        addLog('Authentication cancelled', 'error');
        setStatus('idle');
        return;
      }

      addLog('Biometric authentication successful', 'success');
      addLog('Reading device identity key...', 'info');

      let storedPublicKey = '';
      try {
        storedPublicKey = await RNFS.readFile(DEVICE_KEY_PATH, 'utf8');
      } catch (e) {
        addLog('Could not read stored device key', 'error');
        setStatus('idle');
        return;
      }

      addLog('Deriving stable device identity hash...', 'info');
      const hashNum = deriveBioHash(storedPublicKey);

      if (hashNum === BigInt(0)) {
        addLog('Could not establish a stable device identity', 'error');
        setStatus('idle');
        return;
      }

      addLog('Identity hash ready.', 'success');
      addLog('Checking registration status...', 'info');

      // Check proof server
      try {
        const proofCheckResp = await fetch('https://aequitas-proof-server-production.up.railway.app/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bio: hashNum.toString() })
        });
        const proofCheckData = await proofCheckResp.json();
        if (proofCheckData.registered) {
          const chainResp = await fetch(`${WEBAPP}/api/check-registration-by-biohash?bioHash=${hashNum.toString()}`);
          const chainData = await chainResp.json();
          if (chainData.registered && chainData.is_human) {
            addLog('✓ Already registered on Aequitas Chain!', 'success');
            addLog(`Wallet: ${chainData.wallet.slice(0,10)}...`, 'success');
            addLog(`Balance: ${chainData.balance} AEQ`, 'success');
            setWalletAddress(chainData.wallet);
            setBalance(chainData.balance);
            setStatus('already_registered');
            return;
          }
          addLog('Proof found — opening wallet to complete registration...', 'info');
        }
      } catch(e) {}

      // Check chain directly
      try {
        const checkResp = await fetch(`${WEBAPP}/api/check-registration-by-biohash?bioHash=${hashNum.toString()}`);
        const checkData = await checkResp.json();
        if (checkData.registered && checkData.is_human) {
          addLog('✓ Already registered on Aequitas Chain!', 'success');
          setWalletAddress(checkData.wallet);
          setBalance(checkData.balance);
          setStatus('already_registered');
          return;
        }
        if (checkData.biometric_in_use) {
          addLog('⚠ This fingerprint is already registered to another wallet.', 'error');
          addLog('One person, one wallet — registration blocked.', 'error');
          setStatus('idle');
          return;
        }
      } catch(e) {}

      addLog('Opening wallet connection...', 'info');
      setStatus('waiting');
      openMetaMaskForProofAndRegistration(hashNum);

    } catch (e: any) {
      addLog('Error: ' + e.message, 'error');
      setStatus('idle');
    }
  }

  function openMetaMaskForProofAndRegistration(hashNum: bigint) {
    addLog('Connect wallet and complete registration there', 'info');
    addLog('Return here after registration', 'info');
    const dappUrl = `aequitas-production-9fba.up.railway.app/?bioHash=${hashNum.toString()}#register`;
    Linking.openURL(`https://metamask.app.link/dapp/${dappUrl}`).catch(() => {
      Linking.openURL(`https://${dappUrl}`);
    });
    startPollingByBioHash(hashNum.toString());
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('idle');
    setLog([]);
    setWalletAddress('');
    setBalance(0);
  }

  const stepIcons = (i: number) =>
    status === 'registered' || status === 'already_registered' ? '✅' :
    status === 'waiting' && i < 2 ? '✅' :
    status === 'proving' && i === 0 ? '🔄' : '⬜';

  return (
    <ScrollView style={S.container} showsVerticalScrollIndicator={false}>
      <View style={S.header}>
        <Text style={S.logo}>AEQUITAS</Text>
        <Text style={S.subtitle}>DECENTRALIZED HUMAN CURRENCY</Text>
        <View style={S.networkBadge}>
          <View style={S.dot} />
          <Text style={S.networkText}>AEQUITAS CHAIN V7 · BLOCKDAG · EVM</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>PROVE HUMANITY — V7</Text>
        <Text style={S.cardDesc}>{'Your biometric data never leaves this device.\nGasless registration · 1,000 AEQ granted instantly.'}</Text>

        <View style={S.privacyBadge}>
          <Text style={S.privacyText}>🔒 Hardware Secure Element · Groth16 ZKP · No gas fees · V7 Contract</Text>
        </View>

        <View style={S.deviceBindBadge}>
          <Text style={S.deviceBindText}>
            ℹ️ Your fingerprint or Face ID unlocks a key created on this device.
            Registration is currently tied to this device — switching phones
            will require a new registration. A hardware sensor for
            device-independent verification is planned.
          </Text>
        </View>

        <View style={S.steps}>
          {[
            'Fingerprint or Face ID via Hardware Secure Element',
            'ZK Proof generated on Proof Server',
            'Connect wallet in MetaMask & register',
            '1,000 AEQ granted · Confirmed on V7 Chain',
          ].map((label, i) => (
            <View key={i} style={S.step}>
              <Text style={S.stepIcon}>{stepIcons(i)}</Text>
              <Text style={S.stepText}>{label}</Text>
            </View>
          ))}
        </View>

        {status === 'checking' && (
          <View style={S.loadingBox}>
            <ActivityIndicator color="#C9A84C" size="small" />
            <Text style={S.loadingText}>Checking registration status...</Text>
          </View>
        )}

        {status === 'idle' && (
          <TouchableOpacity style={S.btnPrimary} onPress={proveIdentity}>
            <Text style={S.btnText}>🔐 PROVE HUMANITY</Text>
          </TouchableOpacity>
        )}

        {status === 'proving' && (
          <View style={S.loadingBox}>
            <ActivityIndicator color="#C9A84C" size="large" />
            <Text style={S.loadingText}>Scanning biometrics...</Text>
          </View>
        )}

        {status === 'waiting' && (
          <View style={S.loadingBox}>
            <ActivityIndicator color="#C9A84C" size="large" />
            <Text style={S.loadingText}>Waiting for registration...</Text>
            <Text style={S.hint}>Register in MetaMask · Return here when done</Text>
            <Text style={S.hint}>Checking automatically every 3 seconds</Text>
          </View>
        )}

        {status === 'already_registered' && (
          <View>
            <View style={S.alreadyBox}>
              <Text style={S.alreadyTitle}>✅ Fingerprint already registered</Text>
              <Text style={S.alreadySub}>This device is registered as human on Aequitas.</Text>
              {walletAddress ? (
                <Text style={S.walletAddr}>{walletAddress.slice(0,12)}...{walletAddress.slice(-6)}</Text>
              ) : null}
              {balance > 0 ? (
                <Text style={S.balanceText}>{typeof balance === 'number' ? balance.toFixed(2) : balance} AEQ</Text>
              ) : null}
            </View>
            <TouchableOpacity style={S.btnGold} onPress={() => Linking.openURL(WEBAPP)}>
              <Text style={S.btnText}>🌐 VIEW ON EXPLORER</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btnGold, {marginTop: 8, backgroundColor: '#F6851B'}]} onPress={() => Linking.openURL(METAMASK_DAPP)}>
              <Text style={S.btnText}>🦊 OPEN IN METAMASK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btnSecondary, {marginTop: 8}]} onPress={reset}>
              <Text style={S.btnSecondaryText}>RESET</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'registered' && (
          <View>
            <View style={S.successBox}>
              <Text style={S.successTitle}>🎉 Registered on Aequitas V7!</Text>
              <Text style={S.successSub}>1,000 AEQ credited · Gasless · Permanent</Text>
              {walletAddress ? (
                <Text style={S.walletAddr}>{walletAddress.slice(0,12)}...{walletAddress.slice(-6)}</Text>
              ) : null}
              {balance > 0 ? (
                <Text style={S.balanceText}>{balance} AEQ</Text>
              ) : null}
            </View>
            <TouchableOpacity style={S.btnGold} onPress={() => Linking.openURL(WEBAPP)}>
              <Text style={S.btnText}>🌐 VIEW ON EXPLORER</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btnGold, {marginTop: 8, backgroundColor: '#F6851B'}]} onPress={() => Linking.openURL(METAMASK_DAPP)}>
              <Text style={S.btnText}>🦊 OPEN IN METAMASK</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[S.btnSecondary, {marginTop: 8}]} onPress={reset}>
              <Text style={S.btnSecondaryText}>RESET</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'waiting' && (
          <TouchableOpacity style={[S.btnSecondary, {marginTop: 8}]} onPress={reset}>
            <Text style={S.btnSecondaryText}>RESET</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={S.logCard}>
        <Text style={S.logTitle}>ACTIVITY LOG</Text>
        {log.length === 0 && <Text style={S.logEntry}>// Tap button to start...</Text>}
        {log.map((e, i) => (
          <Text key={i} style={[S.logEntry, e.type==='success'?S.logSuccess:e.type==='error'?S.logError:S.logInfo]}>
            [{e.time}] {e.msg}
          </Text>
        ))}
      </View>

      <View style={S.footer}>
        <Text style={S.footerText}>{'Money exists because people exist.\nNothing more, nothing less.'}</Text>
        <Text style={S.footerLink}>AequitasV7 · Chain ID 1926 · Proof of Humanity</Text>
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#0A0E1A' },
  header:           { alignItems: 'center', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  logo:             { fontSize: 36, fontWeight: 'bold', color: '#C9A84C', letterSpacing: 8 },
  subtitle:         { color: '#6B7A99', fontSize: 11, letterSpacing: 3, marginTop: 4 },
  networkBadge:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1220', borderWidth: 1, borderColor: '#1A2040', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12, gap: 6 },
  dot:              { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00E676' },
  networkText:      { color: '#00E676', fontSize: 10, letterSpacing: 2 },
  card:             { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 12, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  cardTitle:        { fontSize: 11, color: '#6B7A99', letterSpacing: 3, marginBottom: 12 },
  cardDesc:         { color: '#E8EDF5', fontSize: 14, lineHeight: 22, marginBottom: 16 },
  privacyBadge:     { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A3020', borderRadius: 6, padding: 10, marginBottom: 20 },
  privacyText:      { color: '#22C55E', fontSize: 11 },
  deviceBindBadge:  { backgroundColor: '#1A1500', borderWidth: 1, borderColor: '#3A2D00', borderRadius: 6, padding: 10, marginBottom: 20 },
  deviceBindText:   { color: '#C9A84C', fontSize: 10.5, lineHeight: 16 },
  steps:            { marginBottom: 20 },
  step:             { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  stepIcon:         { fontSize: 16, width: 24 },
  stepText:         { color: '#6B7A99', fontSize: 11, flex: 1 },
  btnPrimary:       { backgroundColor: '#C9A84C', borderRadius: 8, padding: 18, alignItems: 'center' },
  btnGold:          { backgroundColor: '#C9A84C', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 8 },
  btnText:          { color: '#0A0E1A', fontWeight: 'bold', fontSize: 13, letterSpacing: 2 },
  loadingBox:       { alignItems: 'center', padding: 20 },
  loadingText:      { color: '#C9A84C', marginTop: 12, fontSize: 12 },
  hint:             { color: '#6B7A99', fontSize: 10, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  alreadyBox:       { backgroundColor: '#0D1220', borderWidth: 1, borderColor: '#C9A84C44', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  alreadyTitle:     { color: '#C9A84C', fontSize: 16, fontWeight: 'bold' },
  alreadySub:       { color: '#6B7A99', fontSize: 11, marginTop: 6, textAlign: 'center' },
  successBox:       { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A3020', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  successTitle:     { color: '#22C55E', fontSize: 18, fontWeight: 'bold' },
  successSub:       { color: '#22C55E', fontSize: 11, marginTop: 4 },
  walletAddr:       { color: '#6B7A99', fontSize: 10, marginTop: 6 },
  balanceText:      { color: '#C9A84C', fontSize: 22, fontWeight: 'bold', marginTop: 8 },
  btnSecondary:     { borderWidth: 1, borderColor: '#1E2D45', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnSecondaryText: { color: '#6B7A99', fontSize: 11, letterSpacing: 2 },
  logCard:          { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16 },
  logTitle:         { fontSize: 10, color: '#6B7A99', letterSpacing: 3, marginBottom: 10 },
  logEntry:         { fontSize: 10, color: '#6B7A99', lineHeight: 18 },
  logSuccess:       { color: '#22C55E' },
  logError:         { color: '#EF4444' },
  logInfo:          { color: '#C9A84C' },
  footer:           { alignItems: 'center', padding: 24, paddingBottom: 40 },
  footerText:       { color: '#6B7A99', fontSize: 11, textAlign: 'center', fontStyle: 'italic', lineHeight: 20 },
  footerLink:       { color: '#C9A84C', fontSize: 10, marginTop: 8 },
});
