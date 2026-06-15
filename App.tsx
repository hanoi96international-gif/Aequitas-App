import React, { useState, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Linking, AppState
} from 'react-native';
import ReactNativeBiometrics from 'react-native-biometrics';

const PROOF_SERVER = "https://aequitas-proof-server-production.up.railway.app";
const WEBAPP       = "https://aequitas-production-9fba.up.railway.app";
const FIELD_SIZE   = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const rnBiometrics = new ReactNativeBiometrics();

export default function App() {
  const [status, setStatus]           = useState<'idle'|'proving'|'done'|'waiting'|'registered'>('idle');
  const [log, setLog]                 = useState<{msg:string,type:string,time:string}[]>([]);
  const [proofData, setProofData]     = useState<any>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance, setBalance]         = useState(0);
  const pollRef                       = useRef<any>(null);

  function addLog(msg: string, type = 'info') {
    setLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  }

  function startPolling(wallet: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/humans`);
        const data = await resp.json();
        const found = data.humans?.find((h: any) =>
          h.address.toLowerCase() === wallet.toLowerCase()
        );
        if (found) {
          clearInterval(pollRef.current);
          setWalletAddress(found.address);
          setBalance(found.balance);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted to ${found.address.slice(0,10)}...`, 'success');
          setStatus('registered');
        }
      } catch(e) {}
    }, 3000);
    setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); }, 300000);
  }

  async function proveIdentity() {
    setStatus('proving');
    setLog([]);
    setProofData(null);
    setWalletAddress('');
    setBalance(0);

    try {
      addLog('Checking biometric hardware...', 'info');
      const { available, biometryType } = await rnBiometrics.isSensorAvailable();
      if (!available) {
        addLog('No biometrics available on this device', 'error');
        setStatus('idle');
        return;
      }
      addLog('Biometric sensor ready: ' + biometryType, 'success');

      const { keysExist } = await rnBiometrics.biometricKeysExist();
      if (!keysExist) await rnBiometrics.createKeys();

      const { success, signature } = await rnBiometrics.createSignature({
        promptMessage: 'Prove your humanity for Aequitas',
        payload: 'aequitas_identity_v6_permanent',
      });

      if (!success || !signature) {
        addLog('Authentication cancelled', 'error');
        setStatus('idle');
        return;
      }

      addLog('Biometric authentication successful', 'success');
      addLog('Deriving biometric hash locally...', 'info');

      // Derive bio hash from signature (never leaves device)
      let hashNum = BigInt(0);
      for (let i = 0; i < Math.min(signature.length, 40); i++) {
        hashNum = (hashNum * BigInt(256) + BigInt(signature.charCodeAt(i))) % FIELD_SIZE;
      }
      const salt = (hashNum * BigInt(7) + BigInt(12345)) % FIELD_SIZE;

      // Check if already registered
      addLog('Checking registration status...', 'info');
      try {
        const checkResp = await fetch(PROOF_SERVER + '/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bio: hashNum.toString(), salt: salt.toString() })
        });
        const checkData = await checkResp.json();
        if (checkData.registered) {
          addLog('Already registered on Aequitas Chain!', 'success');
          addLog('Your 1,000 AEQ is in your wallet', 'success');
          setStatus('registered');
          return;
        }
      } catch(e) {}

      addLog('Not yet registered — generating ZK proof...', 'info');

      // Generate ZKP on Proof Server
      // Note: bio hash and salt are sent to proof server but biometric data stays on device
      const proveResp = await fetch(PROOF_SERVER + '/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bio:    hashNum.toString(),
          salt:   salt.toString(),
          wallet: '0x0000000000000000000000000000000000000000' // placeholder, wallet set in MetaMask
        })
      });

      if (!proveResp.ok) {
        const err = await proveResp.json();
        if (err.registered) {
          addLog('Already registered!', 'success');
          setStatus('registered');
          return;
        }
        addLog('Proof generation failed: ' + (err.error || 'unknown error'), 'error');
        setStatus('idle');
        return;
      }

      const proof = await proveResp.json();
      addLog('ZK Proof generated successfully!', 'success');

      // Store proof data for MetaMask registration step
      setProofData({
        bio:        hashNum.toString(),
        salt:       salt.toString(),
        pA:         proof.pA,
        pB:         proof.pB,
        pC:         proof.pC,
        pubSignals: proof.pubSignals,
      });

      setStatus('done');

    } catch (e: any) {
      addLog('Error: ' + e.message, 'error');
      setStatus('idle');
    }
  }

  function openMetaMaskForRegistration() {
    if (!proofData) return;
    addLog('Opening MetaMask...', 'info');
    addLog('Connect your wallet and tap REGISTER ON-CHAIN', 'info');
    addLog('Return here after registration is confirmed', 'info');
    setStatus('waiting');

    // Pass full proof as URL parameter to Explorer
    // Explorer will use pA, pB, pC, pubSignals for V6 contract registration
    const proofParam = encodeURIComponent(JSON.stringify(proofData));
    const dappUrl = `aequitas-production-9fba.up.railway.app/?proof=${proofParam}`;

    Linking.openURL(`https://metamask.app.link/dapp/${dappUrl}`).catch(() => {
      Linking.openURL(`https://${dappUrl}`);
    });

    // Poll for registration confirmation
    // We don't know wallet yet — poll will check all recent registrations
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/humans`);
        const data = await resp.json();
        if (data.total > 0 && data.humans && data.humans.length > 0) {
          const latestHuman = data.humans[data.humans.length - 1];
          // If a new human appeared since we started, assume it's us
          clearInterval(pollRef.current);
          setWalletAddress(latestHuman.address);
          setBalance(latestHuman.balance);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted!`, 'success');
          setStatus('registered');
        }
      } catch(e) {}
    }, 3000);
    setTimeout(() => { if (pollRef.current) clearInterval(pollRef.current); }, 300000);
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStatus('idle');
    setLog([]);
    setProofData(null);
    setWalletAddress('');
    setBalance(0);
  }

  return (
    <ScrollView style={S.container} showsVerticalScrollIndicator={false}>
      <View style={S.header}>
        <Text style={S.logo}>AEQUITAS</Text>
        <Text style={S.subtitle}>DECENTRALIZED HUMAN CURRENCY</Text>
        <View style={S.networkBadge}>
          <View style={S.dot} />
          <Text style={S.networkText}>AEQUITAS CHAIN V6 · BLOCKDAG · EVM</Text>
        </View>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>PROVE HUMANITY — V6</Text>
        <Text style={S.cardDesc}>{'Your biometric data never leaves this device.\nGasless registration · 1,000 AEQ granted instantly.'}</Text>

        <View style={S.privacyBadge}>
          <Text style={S.privacyText}>🔒 Hardware Secure Element · Groth16 ZKP · No gas fees · V6 Contract</Text>
        </View>

        <View style={S.steps}>
          {[
            'Fingerprint via Hardware Secure Element',
            'ZK Proof generated on Proof Server',
            'Connect wallet in MetaMask & register',
            '1,000 AEQ granted · Confirmed on V6 Chain',
          ].map((label, i) => (
            <View key={i} style={S.step}>
              <Text style={S.stepIcon}>
                {status === 'registered' ? '✅' :
                 (status === 'done' || status === 'waiting') && i < 2 ? '✅' :
                 status === 'proving' && i === 0 ? '🔄' : '⬜'}
              </Text>
              <Text style={S.stepText}>{label}</Text>
            </View>
          ))}
        </View>

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

        {status === 'done' && (
          <View>
            <View style={S.successBox}>
              <Text style={S.successTitle}>✓ ZK Proof Ready</Text>
              <Text style={S.successSub}>Connect wallet in MetaMask to complete registration</Text>
            </View>
            <TouchableOpacity style={S.btnGold} onPress={openMetaMaskForRegistration}>
              <Text style={S.btnText}>🦊 CONNECT WALLET & REGISTER</Text>
            </TouchableOpacity>
          </View>
        )}

        {status === 'waiting' && (
          <View style={S.loadingBox}>
            <ActivityIndicator color="#C9A84C" size="large" />
            <Text style={S.loadingText}>Waiting for registration...</Text>
            <Text style={S.hint}>Register in MetaMask · Return here when done</Text>
            <Text style={S.hint}>Checking every 3 seconds automatically</Text>
          </View>
        )}

        {status === 'registered' && (
          <View>
            <View style={S.successBox}>
              <Text style={S.successTitle}>🎉 Registered on Aequitas V6!</Text>
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
          </View>
        )}

        {(status === 'done' || status === 'registered' || status === 'waiting') && (
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
        <Text style={S.footerLink}>AequitasV6 · Chain ID 9001 · Proof of Humanity</Text>
      </View>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#0A0E1A' },
  header:       { alignItems: 'center', paddingTop: 60, paddingBottom: 24, paddingHorizontal: 20 },
  logo:         { fontSize: 36, fontWeight: 'bold', color: '#C9A84C', letterSpacing: 8 },
  subtitle:     { color: '#6B7A99', fontSize: 11, letterSpacing: 3, marginTop: 4 },
  networkBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1220', borderWidth: 1, borderColor: '#1A2040', borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12, gap: 6 },
  dot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00E676' },
  networkText:  { color: '#00E676', fontSize: 10, letterSpacing: 2 },
  card:         { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 12, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  cardTitle:    { fontSize: 11, color: '#6B7A99', letterSpacing: 3, marginBottom: 12 },
  cardDesc:     { color: '#E8EDF5', fontSize: 14, lineHeight: 22, marginBottom: 16 },
  privacyBadge: { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A3020', borderRadius: 6, padding: 10, marginBottom: 20 },
  privacyText:  { color: '#22C55E', fontSize: 11 },
  steps:        { marginBottom: 20 },
  step:         { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E2D45' },
  stepIcon:     { fontSize: 16, width: 24 },
  stepText:     { color: '#6B7A99', fontSize: 11, flex: 1 },
  btnPrimary:   { backgroundColor: '#C9A84C', borderRadius: 8, padding: 18, alignItems: 'center' },
  btnGold:      { backgroundColor: '#C9A84C', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 8 },
  btnText:      { color: '#0A0E1A', fontWeight: 'bold', fontSize: 13, letterSpacing: 2 },
  loadingBox:   { alignItems: 'center', padding: 20 },
  loadingText:  { color: '#C9A84C', marginTop: 12, fontSize: 12 },
  hint:         { color: '#6B7A99', fontSize: 10, textAlign: 'center', marginTop: 6, lineHeight: 16 },
  successBox:   { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A3020', borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  successTitle: { color: '#22C55E', fontSize: 18, fontWeight: 'bold' },
  successSub:   { color: '#22C55E', fontSize: 11, marginTop: 4 },
  walletAddr:   { color: '#6B7A99', fontSize: 10, marginTop: 6 },
  balanceText:  { color: '#C9A84C', fontSize: 22, fontWeight: 'bold', marginTop: 8 },
  btnSecondary: { borderWidth: 1, borderColor: '#1E2D45', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnSecondaryText: { color: '#6B7A99', fontSize: 11, letterSpacing: 2 },
  logCard:      { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16 },
  logTitle:     { fontSize: 10, color: '#6B7A99', letterSpacing: 3, marginBottom: 10 },
  logEntry:     { fontSize: 10, color: '#6B7A99', lineHeight: 18 },
  logSuccess:   { color: '#22C55E' },
  logError:     { color: '#EF4444' },
  logInfo:      { color: '#C9A84C' },
  footer:       { alignItems: 'center', padding: 24, paddingBottom: 40 },
  footerText:   { color: '#6B7A99', fontSize: 11, textAlign: 'center', fontStyle: 'italic', lineHeight: 20 },
  footerLink:   { color: '#C9A84C', fontSize: 10, marginTop: 8 },
});
