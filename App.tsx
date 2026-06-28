import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity,
  ScrollView, ActivityIndicator, Linking,
  StatusBar, SafeAreaView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import ReactNativeBiometrics from 'react-native-biometrics';
import RNFS from 'react-native-fs';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const WEBAPP          = 'https://aequitas.digital';
const METAMASK_DAPP   = 'https://metamask.app.link/dapp/aequitas.digital/register';
const FIELD_SIZE      = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const DEVICE_KEY_PATH = RNFS.DocumentDirectoryPath + '/aequitas_device_pubkey.txt';
const POLL_INTERVAL   = 3_000;
const POLL_TIMEOUT    = 120_000;

const rnBiometrics = new ReactNativeBiometrics();

// ─── TYPES ───────────────────────────────────────────────────────────────────
type AppStatus = 'checking' | 'idle' | 'proving' | 'waiting' | 'registered' | 'already_registered';
type LogType   = 'info' | 'success' | 'error';
type LogEntry  = { msg: string; type: LogType; time: string };
type StepState = 'done' | 'active' | 'pending';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function deriveBioHash(publicKey: string): bigint {
  let h = BigInt(0);
  for (let i = 0; i < Math.min(publicKey.length, 512); i++) {
    h = (h * BigInt(256) + BigInt(publicKey.charCodeAt(i))) % FIELD_SIZE;
  }
  return h;
}

function formatBalance(b: number): string {
  return Number(b).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function shortWallet(addr: string): string {
  return addr.slice(0, 10) + '...' + addr.slice(-6);
}

// ─── STEP INDICATOR ──────────────────────────────────────────────────────────
function StepItem({ n, label, state }: { n: number; label: string; state: StepState }) {
  return (
    <View style={S.step}>
      <View style={[S.stepCircle,
        state === 'done'    ? S.stepCircleDone    :
        state === 'active'  ? S.stepCircleActive  :
                              S.stepCirclePending]}>
        {state === 'done' ? (
          <Text style={S.stepCircleCheck}>✓</Text>
        ) : state === 'active' ? (
          <ActivityIndicator size="small" color="#C9A84C" />
        ) : (
          <Text style={S.stepCircleNum}>{n}</Text>
        )}
      </View>
      <Text style={[S.stepText,
        state === 'done'   ? S.stepTextDone   :
        state === 'active' ? S.stepTextActive : {}]}>
        {label}
      </Text>
    </View>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [status,        setStatus]        = useState<AppStatus>('checking');
  const [log,           setLog]           = useState<LogEntry[]>([]);
  const [walletAddress, setWalletAddress] = useState('');
  const [balance,       setBalance]       = useState(0);
  const [copied,        setCopied]        = useState(false);

  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const linkingSubRef  = useRef<{ remove: () => void } | null>(null);

  const addLog = useCallback((msg: string, type: LogType = 'info') => {
    setLog(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }]);
  }, []);

  const clearPoll = useCallback(() => {
    if (pollRef.current)        clearInterval(pollRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    pollRef.current        = null;
    pollTimeoutRef.current = null;
  }, []);

  // ── poll cleanup on unmount ───────────────────────────────────────────────
  useEffect(() => () => clearPoll(), [clearPoll]);

  // ── startup: silent registration check ───────────────────────────────────
  // WHY THIS APPROACH: react-native-biometrics NEVER exposes raw biometric
  // data. createKeys() generates a key pair inside the device's secure
  // hardware and returns a stable publicKey for the lifetime of that pair.
  // That key drives the bio-hash — no biometric prompt needed for a read.
  useEffect(() => {
    async function checkOnStartup() {
      try {
        if (!(await RNFS.exists(DEVICE_KEY_PATH))) { setStatus('idle'); return; }
        const storedKey = await RNFS.readFile(DEVICE_KEY_PATH, 'utf8');
        const hashNum   = deriveBioHash(storedKey);
        if (hashNum === BigInt(0)) { setStatus('idle'); return; }

        const resp = await fetch(`${WEBAPP}/api/check-registration-by-biohash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bioHash: hashNum.toString() }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.registered && data.is_human) {
          setWalletAddress(data.wallet ?? '');
          setBalance(typeof data.balance === 'number' ? data.balance : 0);
          setStatus('already_registered');
        } else {
          setStatus('idle');
        }
      } catch (e: any) {
        console.error('[STARTUP] Registration check failed:', e?.message);
        setStatus('idle');
      }
    }
    checkOnStartup();
  }, []);

  // ── deep link handler ─────────────────────────────────────────────────────
  useEffect(() => {
    function handleDeepLink(event: { url: string }) {
      try {
        if (!event.url.includes('registered')) return;
        const qi = event.url.indexOf('?');
        if (qi === -1) return;
        const params = Object.fromEntries(
          event.url.slice(qi + 1).split('&').map(pair => {
            const [k, v = ''] = pair.split('=');
            return [decodeURIComponent(k), decodeURIComponent(v)];
          })
        );
        const wallet = params['wallet'];
        if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return;
        clearPoll();
        setWalletAddress(wallet);
        addLog('Registration confirmed via deep link!', 'success');
        setStatus('registered');
      } catch (e: any) {
        console.error('[DEEP_LINK] Parse error:', e?.message);
      }
    }

    linkingSubRef.current = Linking.addEventListener('url', handleDeepLink);
    Linking.getInitialURL()
      .then(url => { if (url) handleDeepLink({ url }); })
      .catch(e => console.error('[DEEP_LINK] getInitialURL error:', e?.message));
    return () => { linkingSubRef.current?.remove(); };
  }, [addLog, clearPoll]);

  // ── polling ───────────────────────────────────────────────────────────────
  function startPolling(commitment: string) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/check-registration?commitment=${commitment}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.registered) {
          clearPoll();
          setWalletAddress(data.wallet ?? '');
          setBalance(typeof data.balance === 'number' ? data.balance : 0);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted to ${shortWallet(data.wallet ?? '')}`, 'success');
          setStatus('registered');
        }
      } catch (e: any) {
        console.warn('[POLL] check-registration error:', e?.message);
      }
    }, POLL_INTERVAL);
    pollTimeoutRef.current = setTimeout(() => {
      clearPoll();
      addLog('Polling timed out. Tap the button to retry.', 'error');
      setStatus('idle');
    }, POLL_TIMEOUT);
  }

  function startPollingByBioHash(bioHash: string) {
    clearPoll();
    pollRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`${WEBAPP}/api/check-registration-by-biohash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bioHash }),
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (data.registered && data.is_human) {
          clearPoll();
          setWalletAddress(data.wallet ?? '');
          setBalance(typeof data.balance === 'number' ? data.balance : 0);
          addLog('Registration confirmed on Aequitas Chain!', 'success');
          addLog(`1,000 AEQ granted to ${shortWallet(data.wallet ?? '')}`, 'success');
          setStatus('registered');
        } else if (data.biometric_in_use) {
          clearPoll();
          addLog('This biometric is already registered to another wallet.', 'error');
          addLog('One person, one wallet — registration blocked.', 'error');
          setStatus('idle');
        }
      } catch (e: any) {
        console.warn('[POLL] check-by-biohash error:', e?.message);
      }
    }, POLL_INTERVAL);
    pollTimeoutRef.current = setTimeout(() => {
      clearPoll();
      addLog('Registration timed out. If MetaMask completed, tap Retry.', 'error');
      setStatus('idle');
    }, POLL_TIMEOUT);
  }

  // ── main registration flow ────────────────────────────────────────────────
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
      addLog(`Biometric sensor ready: ${biometryType}`, 'success');

      const { keysExist }   = await rnBiometrics.biometricKeysExist();
      const keyFileExists   = await RNFS.exists(DEVICE_KEY_PATH);

      if (!keysExist && !keyFileExists) {
        addLog('First time on this device — creating secure key...', 'info');
        const created = await rnBiometrics.createKeys();
        await RNFS.writeFile(DEVICE_KEY_PATH, created.publicKey, 'utf8');
      } else if (keysExist && !keyFileExists) {
        addLog('Device key exists but its record is missing', 'error');
        addLog('Contact support before retrying — do not reinstall.', 'error');
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

      let storedKey: string;
      try {
        storedKey = await RNFS.readFile(DEVICE_KEY_PATH, 'utf8');
      } catch (e: any) {
        addLog('Could not read stored device key', 'error');
        console.error('[PROVE] RNFS.readFile failed:', e?.message);
        setStatus('idle');
        return;
      }

      addLog('Deriving stable device identity hash...', 'info');
      const hashNum = deriveBioHash(storedKey);
      if (hashNum === BigInt(0)) {
        addLog('Could not establish a stable device identity', 'error');
        setStatus('idle');
        return;
      }
      addLog('Identity hash ready — checking registration status...', 'success');

      // Check proof server via chain proxy (avoids CORS)
      try {
        const proofResp = await fetch(`${WEBAPP}/api/proof/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bio: hashNum.toString() }),
        });
        if (!proofResp.ok) throw new Error(`HTTP ${proofResp.status}`);
        const proofData = await proofResp.json();
        if (proofData.registered) {
          const chainResp = await fetch(`${WEBAPP}/api/check-registration-by-biohash`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bioHash: hashNum.toString() }),
          });
          if (chainResp.ok) {
            const chainData = await chainResp.json();
            if (chainData.registered && chainData.is_human) {
              addLog('Already registered on Aequitas Chain!', 'success');
              setWalletAddress(chainData.wallet ?? '');
              setBalance(typeof chainData.balance === 'number' ? chainData.balance : 0);
              setStatus('already_registered');
              return;
            }
          }
          addLog('Proof found — opening wallet to complete registration...', 'info');
        }
      } catch (e: any) {
        console.warn('[PROVE] proof/check failed (non-fatal):', e?.message);
      }

      // Check chain directly
      try {
        const checkResp = await fetch(`${WEBAPP}/api/check-registration-by-biohash`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bioHash: hashNum.toString() }),
        });
        if (checkResp.ok) {
          const checkData = await checkResp.json();
          if (checkData.registered && checkData.is_human) {
            addLog('Already registered on Aequitas Chain!', 'success');
            setWalletAddress(checkData.wallet ?? '');
            setBalance(typeof checkData.balance === 'number' ? checkData.balance : 0);
            setStatus('already_registered');
            return;
          }
          if (checkData.biometric_in_use) {
            addLog('This biometric is already registered to another wallet.', 'error');
            addLog('One person, one wallet — registration blocked.', 'error');
            setStatus('idle');
            return;
          }
        }
      } catch (e: any) {
        console.warn('[PROVE] check-by-biohash failed (non-fatal):', e?.message);
      }

      addLog('Opening wallet connection...', 'info');
      setStatus('waiting');
      openMetaMaskForProofAndRegistration(hashNum);

    } catch (e: any) {
      const msg = e?.message ?? 'Unknown error';
      addLog(`Error: ${msg}`, 'error');
      console.error('[PROVE] Unexpected error:', msg);
      setStatus('idle');
    }
  }

  function openMetaMaskForProofAndRegistration(hashNum: bigint) {
    addLog('Connect your wallet and complete registration in MetaMask', 'info');
    addLog('Return here when done — we check automatically every 3 s', 'info');
    const dappPath = `aequitas.digital/register?bioHash=${hashNum.toString()}`;
    Linking.openURL(`https://metamask.app.link/dapp/${dappPath}`).catch(() =>
      Linking.openURL(`https://${dappPath}`).catch(
        e => console.error('[METAMASK] Could not open URL:', e?.message)
      )
    );
    startPollingByBioHash(hashNum.toString());
  }

  function reset() {
    clearPoll();
    setStatus('idle');
    setLog([]);
    setWalletAddress('');
    setBalance(0);
  }

  function copyWallet() {
    if (!walletAddress) return;
    Clipboard.setString(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── step state derivation ─────────────────────────────────────────────────
  function stepState(i: number): StepState {
    if (status === 'registered' || status === 'already_registered') return 'done';
    if (status === 'waiting') {
      if (i < 2) return 'done';
      if (i === 2) return 'active';
    }
    if (status === 'proving' && i === 0) return 'active';
    return 'pending';
  }

  const STEPS = [
    'Fingerprint or Face ID via Hardware Secure Element',
    'ZK Proof generated on Proof Server',
    'Connect wallet in MetaMask & register',
    '1,000 AEQ granted · Confirmed on V7 Chain',
  ];

  const isSuccess = status === 'registered' || status === 'already_registered';

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={S.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0A0E1A" />
      <ScrollView
        style={S.scroll}
        contentContainerStyle={S.content}
        showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={S.header}>
          <Text style={S.logo}>AEQUITAS</Text>
          <Text style={S.subtitle}>DECENTRALIZED HUMAN CURRENCY</Text>
          <View style={S.networkBadge}>
            <View style={S.dot} />
            <Text style={S.networkText}>AEQUITAS CHAIN V7 · BLOCKDAG · EVM</Text>
          </View>
        </View>

        {/* Main card */}
        <View style={S.card}>
          <Text style={S.cardTitle}>PROVE HUMANITY — V7</Text>
          <Text style={S.cardDesc}>
            {'Your biometric data never leaves this device.\nGasless registration · 1,000 AEQ granted instantly.'}
          </Text>

          <View style={S.privacyBadge}>
            <Text style={S.privacyText}>
              🔒  Hardware Secure Element · Groth16 ZKP · No gas fees · V7 Contract
            </Text>
          </View>

          <View style={S.deviceBindBadge}>
            <Text style={S.deviceBindText}>
              {'ℹ️  Your fingerprint or Face ID unlocks a key created on this device.\n' +
               'Registration is currently tied to this device — switching phones will require a new registration.'}
            </Text>
          </View>

          {/* Step tracker */}
          <View style={S.steps}>
            {STEPS.map((label, i) => (
              <StepItem key={i} n={i + 1} label={label} state={stepState(i)} />
            ))}
          </View>

          {/* ── state-dependent UI ── */}
          {status === 'checking' && (
            <View style={S.loadingBox}>
              <ActivityIndicator color="#C9A84C" size="small" />
              <Text style={S.loadingText}>Checking registration status...</Text>
            </View>
          )}

          {status === 'idle' && (
            <TouchableOpacity style={S.btnPrimary} onPress={proveIdentity} activeOpacity={0.85}>
              <Text style={S.btnPrimaryText}>🔐  PROVE HUMANITY</Text>
            </TouchableOpacity>
          )}

          {status === 'proving' && (
            <View style={S.loadingBox}>
              <ActivityIndicator color="#C9A84C" size="large" />
              <Text style={S.loadingText}>Scanning biometrics...</Text>
            </View>
          )}

          {status === 'waiting' && (
            <View>
              <View style={S.loadingBox}>
                <ActivityIndicator color="#C9A84C" size="large" />
                <Text style={S.loadingText}>Waiting for registration...</Text>
                <Text style={S.hint}>Complete the transaction in MetaMask</Text>
                <Text style={S.hint}>Checking automatically every 3 seconds</Text>
              </View>
              <TouchableOpacity style={S.btnSecondary} onPress={reset} activeOpacity={0.8}>
                <Text style={S.btnSecondaryText}>CANCEL</Text>
              </TouchableOpacity>
            </View>
          )}

          {isSuccess && (
            <View>
              <View style={status === 'registered' ? S.successBox : S.alreadyBox}>
                <Text style={status === 'registered' ? S.successTitle : S.alreadyTitle}>
                  {status === 'registered' ? '🎉 Registered on Aequitas V7!' : '✅ Already registered'}
                </Text>
                <Text style={status === 'registered' ? S.successSub : S.alreadySub}>
                  {status === 'registered'
                    ? '1,000 AEQ credited · Gasless · Permanent'
                    : 'This device is registered as human on Aequitas.'}
                </Text>
                {balance > 0 && (
                  <Text style={S.balanceText}>{formatBalance(balance)} AEQ</Text>
                )}
                {walletAddress ? (
                  <TouchableOpacity style={S.walletRow} onPress={copyWallet} activeOpacity={0.7}>
                    <Text style={S.walletAddr}>{shortWallet(walletAddress)}</Text>
                    <View style={S.copyBadge}>
                      <Text style={S.copyBadgeText}>{copied ? '✓ copied' : 'copy'}</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>

              <TouchableOpacity style={S.btnGold} onPress={() => Linking.openURL(WEBAPP)} activeOpacity={0.85}>
                <Text style={S.btnDarkText}>🌐  VIEW ON EXPLORER</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.btnMetaMask} onPress={() => Linking.openURL(METAMASK_DAPP)} activeOpacity={0.85}>
                <Text style={S.btnDarkText}>🦊  OPEN IN METAMASK</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.btnSecondary} onPress={reset} activeOpacity={0.8}>
                <Text style={S.btnSecondaryText}>RESET</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Activity log */}
        <View style={S.logCard}>
          <Text style={S.logTitle}>ACTIVITY LOG</Text>
          {log.length === 0
            ? <Text style={S.logPlaceholder}>// Tap button to start...</Text>
            : log.map((e, i) => (
              <Text key={i} style={[S.logEntry,
                e.type === 'success' ? S.logSuccess :
                e.type === 'error'   ? S.logError   : S.logInfo]}>
                [{e.time}]  {e.msg}
              </Text>
            ))}
        </View>

        {/* Footer */}
        <View style={S.footer}>
          <Text style={S.footerQuote}>
            {'Money exists because people exist.\nNothing more, nothing less.'}
          </Text>
          <Text style={S.footerMeta}>AequitasV7 · Chain ID 1926 · Proof of Humanity</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0A0E1A' },
  scroll:  { flex: 1 },
  content: { paddingBottom: 32 },

  // Header
  header:       { alignItems: 'center', paddingTop: 48, paddingBottom: 24, paddingHorizontal: 20 },
  logo:         { fontSize: 36, fontWeight: 'bold', color: '#C9A84C', letterSpacing: 8 },
  subtitle:     { color: '#6B7A99', fontSize: 11, letterSpacing: 3, marginTop: 4 },
  networkBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0D1220', borderWidth: 1, borderColor: '#1A2040', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12, gap: 6 },
  dot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00E676' },
  networkText:  { color: '#00E676', fontSize: 10, letterSpacing: 2 },

  // Card
  card:            { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 16, padding: 24, marginBottom: 16, borderWidth: 1, borderColor: '#1E2D45' },
  cardTitle:       { fontSize: 11, color: '#6B7A99', letterSpacing: 3, marginBottom: 12 },
  cardDesc:        { color: '#E8EDF5', fontSize: 14, lineHeight: 22, marginBottom: 16 },
  privacyBadge:    { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A3020', borderRadius: 8, padding: 12, marginBottom: 14 },
  privacyText:     { color: '#22C55E', fontSize: 11, lineHeight: 17 },
  deviceBindBadge: { backgroundColor: '#1A1500', borderWidth: 1, borderColor: '#3A2D00', borderRadius: 8, padding: 12, marginBottom: 22 },
  deviceBindText:  { color: '#C9A84C', fontSize: 11, lineHeight: 17 },

  // Steps
  steps:              { marginBottom: 24 },
  step:               { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1E2D45', gap: 12 },
  stepCircle:         { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  stepCircleDone:     { backgroundColor: '#22C55E' },
  stepCircleActive:   { borderWidth: 2, borderColor: '#C9A84C' },
  stepCirclePending:  { borderWidth: 1, borderColor: '#2A3550' },
  stepCircleCheck:    { color: '#0A0E1A', fontSize: 13, fontWeight: 'bold' },
  stepCircleNum:      { color: '#3A4560', fontSize: 11, fontWeight: '600' },
  stepText:           { color: '#6B7A99', fontSize: 12, flex: 1, lineHeight: 17 },
  stepTextDone:       { color: '#22C55E' },
  stepTextActive:     { color: '#C9A84C' },

  // Buttons
  btnPrimary:       { backgroundColor: '#C9A84C', borderRadius: 10, padding: 18, alignItems: 'center', marginTop: 4 },
  btnPrimaryText:   { color: '#0A0E1A', fontWeight: 'bold', fontSize: 14, letterSpacing: 2 },
  btnGold:          { backgroundColor: '#C9A84C', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 8 },
  btnMetaMask:      { backgroundColor: '#F6851B', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 8 },
  btnDarkText:      { color: '#0A0E1A', fontWeight: 'bold', fontSize: 13, letterSpacing: 2 },
  btnSecondary:     { borderWidth: 1, borderColor: '#1E2D45', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  btnSecondaryText: { color: '#6B7A99', fontSize: 11, letterSpacing: 2 },

  // Loading
  loadingBox:  { alignItems: 'center', paddingVertical: 28 },
  loadingText: { color: '#C9A84C', marginTop: 14, fontSize: 13, letterSpacing: 1 },
  hint:        { color: '#6B7A99', fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 17 },

  // Result boxes
  alreadyBox:   { backgroundColor: '#0D1220', borderWidth: 1, borderColor: '#C9A84C44', borderRadius: 10, padding: 20, alignItems: 'center', marginBottom: 16 },
  alreadyTitle: { color: '#C9A84C', fontSize: 16, fontWeight: 'bold' },
  alreadySub:   { color: '#6B7A99', fontSize: 12, marginTop: 6, textAlign: 'center' },
  successBox:   { backgroundColor: '#0D1A0D', borderWidth: 1, borderColor: '#1A4030', borderRadius: 10, padding: 20, alignItems: 'center', marginBottom: 16 },
  successTitle: { color: '#22C55E', fontSize: 18, fontWeight: 'bold' },
  successSub:   { color: '#22C55E', fontSize: 12, marginTop: 4 },
  balanceText:  { color: '#C9A84C', fontSize: 30, fontWeight: 'bold', marginTop: 10 },
  walletRow:    { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  walletAddr:   { color: '#6B7A99', fontSize: 11 },
  copyBadge:    { borderWidth: 1, borderColor: '#C9A84C55', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  copyBadgeText:{ color: '#C9A84C', fontSize: 10 },

  // Log
  logCard:        { marginHorizontal: 20, backgroundColor: '#111827', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#1E2D45', marginBottom: 16 },
  logTitle:       { fontSize: 10, color: '#6B7A99', letterSpacing: 3, marginBottom: 10 },
  logPlaceholder: { fontSize: 11, color: '#2A3550', fontStyle: 'italic' },
  logEntry:       { fontSize: 10, color: '#6B7A99', lineHeight: 18 },
  logSuccess:     { color: '#22C55E' },
  logError:       { color: '#EF4444' },
  logInfo:        { color: '#C9A84C' },

  // Footer
  footer:     { alignItems: 'center', padding: 24, paddingBottom: 40 },
  footerQuote:{ color: '#6B7A99', fontSize: 11, textAlign: 'center', fontStyle: 'italic', lineHeight: 20 },
  footerMeta: { color: '#C9A84C', fontSize: 10, marginTop: 8 },
});
