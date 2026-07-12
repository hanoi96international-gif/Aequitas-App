import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { fmtAEQ, formatBalance } from '@/lib/format';
import {
  getLPPosition,
  getNonce,
  getPool,
  getPriceHistory,
  postAddLiquidity,
  postFaucet,
  postRemoveLiquidity,
  postSwap,
  type LPPosition,
  type PoolResponse,
  type PricePoint,
} from '@/lib/api';
import { withTimeout } from '@/lib/signer';
import { theme, purpleTint, purpleTintBorder, tealTint, tealTintBorder, neonTint, neonTintBorder, goldTint, goldTintBorder } from '@/constants/aequitas-theme';
import PriceChart from '@/components/PriceChart';

type Direction = 'aeq_to_tusd' | 'tusd_to_aeq';
type TradeTab = 'swap' | 'liquidity' | 'chart';

const PCTS = [0.25, 0.5, 0.75, 1];
const REMOVE_PCTS = [0.25, 0.5, 0.75, 1];
const SIGN_TIMEOUT_MS = 60_000;

export default function Trade() {
  const { address, balance, signer, refreshBalance } = useWallet();
  const { t } = useLanguage();
  const [tab, setTab] = useState<TradeTab>('swap');
  const [pool, setPool] = useState<PoolResponse | null>(null);
  const [direction, setDirection] = useState<Direction>('aeq_to_tusd');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetStatus, setFaucetStatus] = useState('');

  const [lpPosition, setLpPosition] = useState<LPPosition | null>(null);
  const [addAeq, setAddAeq] = useState('');
  const [addTusd, setAddTusd] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const [removePct, setRemovePct] = useState(1);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeStatus, setRemoveStatus] = useState('');

  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);

  const loadPool = useCallback(async () => {
    try {
      setPool(await getPool());
    } catch {
      // next poll tick retries
    }
  }, []);

  const loadPriceHistory = useCallback(async () => {
    try {
      setPriceHistory(await getPriceHistory());
    } catch {
      // next poll tick retries
    }
  }, []);

  const loadLPPosition = useCallback(async () => {
    if (!address) {
      setLpPosition(null);
      return;
    }
    try {
      setLpPosition(await getLPPosition(address));
    } catch {
      // next poll tick retries
    }
  }, [address]);

  useEffect(() => {
    loadPool();
    const t = setInterval(loadPool, 15_000);
    return () => clearInterval(t);
  }, [loadPool]);

  useEffect(() => {
    loadLPPosition();
    const t = setInterval(loadLPPosition, 15_000);
    return () => clearInterval(t);
  }, [loadLPPosition]);

  useEffect(() => {
    loadPriceHistory();
    const t = setInterval(loadPriceHistory, 30_000);
    return () => clearInterval(t);
  }, [loadPriceHistory]);

  const aeqReserve = parseFloat(pool?.reserve_aeq || '0');
  const tusdReserve = parseFloat(pool?.reserve_tusd || '0');
  const hasLiquidity = aeqReserve > 0;

  const amt = parseFloat(amount) || 0;
  const fromSymbol = direction === 'aeq_to_tusd' ? 'AEQ' : 'tUSD';
  const toSymbol = direction === 'aeq_to_tusd' ? 'tUSD' : 'AEQ';
  const fromBalance = direction === 'aeq_to_tusd' ? balance?.balance ?? 0 : balance?.tusd_balance ?? 0;
  const inputReserve = direction === 'aeq_to_tusd' ? aeqReserve : tusdReserve;
  const outputReserve = direction === 'aeq_to_tusd' ? tusdReserve : aeqReserve;

  let preview = 0;
  let priceImpactPct = 0;
  if (amt > 0 && hasLiquidity) {
    const inF = amt * 0.999;
    preview = (outputReserve * inF) / (inputReserve + inF);
    const spotPrice = outputReserve / inputReserve;
    const effectivePrice = preview / amt;
    priceImpactPct = spotPrice > 0 ? Math.max(0, (1 - effectivePrice / spotPrice) * 100) : 0;
  }
  const impactColor = priceImpactPct < 1 ? theme.neon : priceImpactPct < 5 ? theme.gold : theme.red;
  const exchangeRate = inputReserve > 0 ? outputReserve / inputReserve : 0;

  function flipDirection() {
    setDirection((d) => (d === 'aeq_to_tusd' ? 'tusd_to_aeq' : 'aeq_to_tusd'));
    setAmount('');
    setStatus('');
  }

  function setPct(pct: number) {
    const v = fromBalance * pct;
    setAmount(v > 0 ? v.toFixed(6) : '');
  }

  async function doSwap() {
    if (!signer || !address) return;
    if (!amt || amt <= 0) {
      setStatus(t('trade.enterAmount'));
      return;
    }
    setBusy(true);
    setStatus(t('trade.fetchingNonce'));
    try {
      const nonce = await getNonce(address);
      const ts = Math.floor(Date.now() / 1000);
      const msg = 'Aequitas Swap: ' + direction + ' ' + amt.toFixed(8) + ' nonce:' + nonce + ' ts:' + ts;
      setStatus(t('trade.requestingSignature'));
      const sig = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setStatus(t('trade.submittingSwap'));
      const minOut = preview * 0.99;
      const d = await postSwap({
        wallet: address,
        direction,
        amount: amt,
        nonce,
        timestamp: ts,
        signature: sig,
        min_amount_out: minOut,
      });
      if (!d.success) throw new Error(d.message || t('trade.swapFailed'));
      setStatus(t('trade.swapSuccess'));
      setAmount('');
      setTimeout(() => {
        refreshBalance();
        loadPool();
      }, 2000);
    } catch (e: any) {
      setStatus('✗ ' + (e?.message ?? t('trade.swapError')));
    } finally {
      setBusy(false);
    }
  }

  async function doFaucet() {
    if (!signer || !address) return;
    setFaucetBusy(true);
    setFaucetStatus(t('wallet.faucetRequesting'));
    try {
      const ts = Math.floor(Date.now() / 1000);
      const msg = 'Aequitas tUSD Faucet Claim: ' + address.toLowerCase() + ' ts:' + ts;
      const sig = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      const d = await postFaucet({ wallet: address, timestamp: ts, signature: sig });
      if (!d.success) throw new Error(d.message || t('wallet.faucetFailed'));
      setFaucetStatus(t('wallet.faucetSent'));
      setTimeout(refreshBalance, 2000);
    } catch (e: any) {
      setFaucetStatus('✗ ' + (e?.message ?? t('wallet.faucetError')));
    } finally {
      setFaucetBusy(false);
    }
  }

  // When the pool already has liquidity, typing one side auto-fills the
  // other at the pool's current ratio — matches what the backend requires
  // (within tolerance) so users don't get rejected for a slightly-off ratio.
  function updateLiquidityRatio(changed: 'aeq' | 'tusd', value: string) {
    if (changed === 'aeq') {
      setAddAeq(value);
      if (hasLiquidity) {
        const v = parseFloat(value) || 0;
        setAddTusd(v > 0 ? (Math.floor(v * (tusdReserve / aeqReserve) * 1e6) / 1e6).toString() : '');
      }
    } else {
      setAddTusd(value);
      if (hasLiquidity) {
        const v = parseFloat(value) || 0;
        setAddAeq(v > 0 ? (Math.floor(v * (aeqReserve / tusdReserve) * 1e6) / 1e6).toString() : '');
      }
    }
  }

  function setAddPct(pct: number, which: 'aeq' | 'tusd') {
    const bal = which === 'aeq' ? balance?.balance ?? 0 : balance?.tusd_balance ?? 0;
    const v = bal * pct;
    updateLiquidityRatio(which, v > 0 ? v.toFixed(6) : '');
  }

  async function doAddLiquidity() {
    if (!signer || !address) return;
    const amountAEQ = parseFloat(addAeq) || 0;
    const amountTUSD = parseFloat(addTusd) || 0;
    if (amountAEQ <= 0 || amountTUSD <= 0) {
      setAddStatus(t('trade.enterBothAmounts'));
      return;
    }
    setAddBusy(true);
    setAddStatus(t('trade.fetchingNonce'));
    try {
      const nonce = await getNonce(address);
      const ts = Math.floor(Date.now() / 1000);
      const msg = 'Aequitas Add Liquidity: ' + amountAEQ.toFixed(8) + ' AEQ + ' + amountTUSD.toFixed(8) + ' tUSD nonce:' + nonce + ' ts:' + ts;
      setAddStatus(t('trade.requestingSignature'));
      const sig = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setAddStatus(t('trade.submitting'));
      const d = await postAddLiquidity({ wallet: address, amount_aeq: amountAEQ, amount_tusd: amountTUSD, nonce, timestamp: ts, signature: sig });
      if (!d.success) throw new Error(d.message || t('trade.addFailed'));
      setAddStatus(t('trade.addSuccess'));
      setAddAeq('');
      setAddTusd('');
      setTimeout(() => {
        refreshBalance();
        loadPool();
        loadLPPosition();
      }, 2000);
    } catch (e: any) {
      setAddStatus('✗ ' + (e?.message ?? t('trade.addError')));
    } finally {
      setAddBusy(false);
    }
  }

  async function doRemoveLiquidity() {
    if (!signer || !address || !lpPosition || lpPosition.shares <= 0) return;
    const sharesToBurn = lpPosition.shares * removePct;
    setRemoveBusy(true);
    setRemoveStatus(t('trade.fetchingNonce'));
    try {
      const nonce = await getNonce(address);
      const ts = Math.floor(Date.now() / 1000);
      const msg = 'Aequitas Remove Liquidity: ' + sharesToBurn.toFixed(8) + ' shares nonce:' + nonce + ' ts:' + ts;
      setRemoveStatus(t('trade.requestingSignature'));
      const sig = await withTimeout(signer.signMessage(msg), SIGN_TIMEOUT_MS, t('trade.signTimeout'));
      setRemoveStatus(t('trade.submitting'));
      const d = await postRemoveLiquidity({ wallet: address, shares: sharesToBurn, nonce, timestamp: ts, signature: sig });
      if (!d.success) throw new Error(d.message || t('trade.removeFailed'));
      setRemoveStatus(t('trade.receivedPrefix') + `${(d.amount_aeq ?? 0).toFixed(4)} AEQ + ${(d.amount_tusd ?? 0).toFixed(4)} tUSD`);
      setTimeout(() => {
        refreshBalance();
        loadPool();
        loadLPPosition();
      }, 2000);
    } catch (e: any) {
      setRemoveStatus('✗ ' + (e?.message ?? t('trade.removeError')));
    } finally {
      setRemoveBusy(false);
    }
  }

  const aeqPct = hasLiquidity ? (aeqReserve / (aeqReserve + tusdReserve)) * 100 : 50;

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView contentContainerStyle={S.content} showsVerticalScrollIndicator={false}>
        <View style={S.hero}>
          <Text style={S.heroTitle}>{t('trade.heroTitle')}</Text>
          <Text style={S.heroSub}>{t('trade.heroSub')}</Text>
        </View>

        <View style={S.privBar}>
          <Text style={S.privBarText}>{t('trade.feeBar')}</Text>
        </View>

        <View style={S.tabRow}>
          <TouchableOpacity style={[S.tabBtn, tab === 'swap' && S.tabBtnActive]} onPress={() => setTab('swap')} activeOpacity={0.8}>
            <Text style={[S.tabBtnText, tab === 'swap' && S.tabBtnTextActive]}>{t('trade.tabSwap')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.tabBtn, tab === 'liquidity' && S.tabBtnActive]} onPress={() => setTab('liquidity')} activeOpacity={0.8}>
            <Text style={[S.tabBtnText, tab === 'liquidity' && S.tabBtnTextActive]}>{t('trade.tabLiquidity')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.tabBtn, tab === 'chart' && S.tabBtnActive]} onPress={() => setTab('chart')} activeOpacity={0.8}>
            <Text style={[S.tabBtnText, tab === 'chart' && S.tabBtnTextActive]}>{t('trade.tabChart')}</Text>
          </TouchableOpacity>
        </View>

        {tab === 'chart' && (
          <View style={S.card}>
            <Text style={S.cardTitle}>{t('trade.priceHistoryTitle')}</Text>
            <PriceChart points={priceHistory} />
          </View>
        )}

        {tab === 'swap' && (
        <>
        <View style={S.card}>
          <View style={S.balRow}>
            <Text style={S.balKey}>{t('trade.yourAeq')}</Text>
            <Text style={S.balValGold}>{formatBalance(balance?.balance)}</Text>
          </View>
          <View style={[S.balRow, { marginBottom: 14 }]}>
            <Text style={S.balKey}>{t('trade.yourTusd')}</Text>
            <Text style={S.balValGold}>{formatBalance(balance?.tusd_balance)}</Text>
          </View>

          {/* Sell panel */}
          <View style={S.dexPanel}>
            <View style={S.dexPanelHead}>
              <Text style={S.dexLabel}>{t('trade.sell')}</Text>
              <Text style={S.dexBalHint}>{t('trade.balancePrefix')}<Text style={{ color: theme.neon }}>{formatBalance(fromBalance)}</Text></Text>
            </View>
            <View style={S.dexInputRow}>
              <View style={S.tokenPillPurple}>
                <Text style={S.tokenPillText}>{fromSymbol}</Text>
              </View>
              <TextInput
                style={S.dexInput}
                placeholder="0.00"
                placeholderTextColor={theme.muted}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
              />
            </View>
            <View style={S.pctRow}>
              {PCTS.map((p) => (
                <TouchableOpacity key={p} style={S.pctBtn} onPress={() => setPct(p)} activeOpacity={0.8}>
                  <Text style={S.pctBtnText}>{p === 1 ? 'MAX' : `${p * 100}%`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Reverse button */}
          <View style={S.reverseRow}>
            <TouchableOpacity style={S.reverseBtn} onPress={flipDirection} activeOpacity={0.8}>
              <Text style={S.reverseBtnText}>⇅</Text>
            </TouchableOpacity>
          </View>

          {/* Receive panel */}
          <View style={S.dexPanel}>
            <Text style={S.dexLabel}>{t('trade.receiveEstimated')}</Text>
            <View style={[S.dexInputRow, { marginTop: 8 }]}>
              <View style={S.tokenPillTeal}>
                <Text style={S.tokenPillText}>{toSymbol}</Text>
              </View>
              <View style={S.dexOutput}>
                <Text style={S.dexOutputText}>{amt > 0 ? preview.toFixed(6) : '—'}</Text>
              </View>
            </View>
          </View>

          {amt > 0 && (
            <View style={S.detailsPanel}>
              <View style={S.detailsHeader}>
                <View style={S.detailsHeaderBar} />
                <Text style={S.detailsHeaderText}>{t('trade.swapDetails')}</Text>
              </View>
              <DetailRow label={t('trade.youReceiveApprox')} value={`${preview.toFixed(6)} ${toSymbol}`} color={theme.neon} />
              <DetailRow label={t('trade.priceImpact')} value={`${priceImpactPct.toFixed(2)}%`} color={impactColor} />
              <DetailRow label={t('trade.protocolFee')} value={`${(amt * 0.001).toFixed(6)} ${fromSymbol}`} color={theme.muted} />
              <DetailRow label={t('trade.exchangeRate')} value={`1 ${fromSymbol} ≈ ${exchangeRate.toFixed(4)} ${toSymbol}`} color={theme.purple} last />
            </View>
          )}

          {status ? <Text style={S.statusText}>{status}</Text> : null}

          <TouchableOpacity onPress={doSwap} disabled={busy || !hasLiquidity} activeOpacity={0.85}>
            <LinearGradient colors={[theme.gold, '#E67E00']} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={[S.btnSwap, (busy || !hasLiquidity) && S.btnDisabled]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnSwapText}>{t('trade.swapBtn')}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('trade.noTusd')}</Text>
          <Text style={S.faucetDesc}>{t('trade.faucetDesc')}</Text>
          {faucetStatus ? <Text style={S.statusText}>{faucetStatus}</Text> : null}
          <TouchableOpacity style={S.btnFaucet} onPress={doFaucet} disabled={faucetBusy} activeOpacity={0.85}>
            {faucetBusy ? <ActivityIndicator color={theme.text} /> : <Text style={S.btnFaucetText}>{t('trade.faucetBtn')}</Text>}
          </TouchableOpacity>
        </View>
        </>
        )}

        {tab === 'liquidity' && (
          <>
            {lpPosition && lpPosition.shares > 0 && (
              <View style={S.card}>
                <Text style={S.cardTitle}>{t('trade.yourLiquidityPosition')}</Text>
                <DetailRow label={t('trade.poolShare')} value={`${lpPosition.pool_share_pct.toFixed(4)}%`} color={theme.gold} />
                <DetailRow label={t('trade.withdrawable')} value={`${lpPosition.withdrawable_aeq.toFixed(4)} AEQ + ${lpPosition.withdrawable_tusd.toFixed(4)} tUSD`} color={theme.neon} last />

                <View style={S.pctRow}>
                  {REMOVE_PCTS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      style={[S.pctBtn, removePct === p && S.pctBtnActive]}
                      onPress={() => setRemovePct(p)}
                      activeOpacity={0.8}
                    >
                      <Text style={[S.pctBtnText, removePct === p && S.pctBtnTextActive]}>{p === 1 ? 'MAX' : `${p * 100}%`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={S.detailsPanel}>
                  <DetailRow
                    label={t('trade.youReceiveApprox')}
                    value={`${(lpPosition.withdrawable_aeq * removePct).toFixed(4)} AEQ + ${(lpPosition.withdrawable_tusd * removePct).toFixed(4)} tUSD`}
                    color={theme.neon}
                    last
                  />
                </View>

                {removeStatus ? <Text style={S.statusText}>{removeStatus}</Text> : null}

                <TouchableOpacity onPress={doRemoveLiquidity} disabled={removeBusy} activeOpacity={0.85}>
                  <LinearGradient colors={[theme.red, '#B91C1C']} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={[S.btnSwap, removeBusy && S.btnDisabled]}>
                    {removeBusy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnSwapText}>{t('trade.removeLiquidityBtn')}</Text>}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}

            <View style={S.card}>
              <Text style={S.cardTitle}>{t('trade.addLiquidityTitle')}</Text>
              <Text style={S.faucetDesc}>{t('trade.addLiquidityDesc')} {hasLiquidity ? t('trade.addLiquidityRatioHint') : t('trade.addLiquidityFirstHint')}</Text>

              <View style={S.balRow}>
                <Text style={S.balKey}>{t('trade.yourAeq')}</Text>
                <Text style={S.balValGold}>{formatBalance(balance?.balance)}</Text>
              </View>
              <View style={[S.balRow, { marginBottom: 14 }]}>
                <Text style={S.balKey}>{t('trade.yourTusd')}</Text>
                <Text style={S.balValGold}>{formatBalance(balance?.tusd_balance)}</Text>
              </View>

              <View style={S.dexPanel}>
                <View style={S.dexPanelHead}>
                  <Text style={S.dexLabel}>{t('trade.aeqAmount')}</Text>
                  <Text style={S.dexBalHint}>{t('trade.balancePrefix')}<Text style={{ color: theme.neon }}>{formatBalance(balance?.balance)}</Text></Text>
                </View>
                <View style={S.dexInputRow}>
                  <View style={S.tokenPillPurple}>
                    <Text style={S.tokenPillText}>AEQ</Text>
                  </View>
                  <TextInput
                    style={S.dexInput}
                    placeholder="0.00"
                    placeholderTextColor={theme.muted}
                    value={addAeq}
                    onChangeText={(v) => updateLiquidityRatio('aeq', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={S.pctRow}>
                  {PCTS.map((p) => (
                    <TouchableOpacity key={p} style={S.pctBtn} onPress={() => setAddPct(p, 'aeq')} activeOpacity={0.8}>
                      <Text style={S.pctBtnText}>{p === 1 ? 'MAX' : `${p * 100}%`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={[S.dexPanel, { marginTop: 10 }]}>
                <View style={S.dexPanelHead}>
                  <Text style={S.dexLabel}>{t('trade.tusdAmount')}</Text>
                  <Text style={S.dexBalHint}>{t('trade.balancePrefix')}<Text style={{ color: theme.neon }}>{formatBalance(balance?.tusd_balance)}</Text></Text>
                </View>
                <View style={S.dexInputRow}>
                  <View style={S.tokenPillTeal}>
                    <Text style={S.tokenPillText}>tUSD</Text>
                  </View>
                  <TextInput
                    style={S.dexInput}
                    placeholder="0.00"
                    placeholderTextColor={theme.muted}
                    value={addTusd}
                    onChangeText={(v) => updateLiquidityRatio('tusd', v)}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={S.pctRow}>
                  {PCTS.map((p) => (
                    <TouchableOpacity key={p} style={S.pctBtn} onPress={() => setAddPct(p, 'tusd')} activeOpacity={0.8}>
                      <Text style={S.pctBtnText}>{p === 1 ? 'MAX' : `${p * 100}%`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {addStatus ? <Text style={S.statusText}>{addStatus}</Text> : null}

              <TouchableOpacity onPress={doAddLiquidity} disabled={addBusy} activeOpacity={0.85}>
                <LinearGradient colors={[theme.gold, '#E67E00']} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={[S.btnSwap, addBusy && S.btnDisabled]}>
                  {addBusy ? <ActivityIndicator color="#fff" /> : <Text style={S.btnSwapText}>{t('trade.addLiquidityBtn')}</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={S.card}>
          <Text style={S.cardTitle}>{t('trade.poolStatus')}</Text>
          {hasLiquidity ? (
            <>
              <DetailRow label={t('trade.price')} value={`1 AEQ ≈ ${pool?.price_aeq_in_tusd?.toFixed(4)} tUSD`} color={theme.gold} />
              <DetailRow label={t('trade.aeqReserve')} value={fmtAEQ(aeqReserve)} color={theme.purple} />
              <DetailRow label={t('trade.tusdReserve')} value={fmtAEQ(tusdReserve)} color={theme.teal} last />

              <Text style={S.depthLabel}>{t('trade.poolComposition')}</Text>
              <View style={S.depthTrack}>
                <View style={[S.depthAeqFill, { width: `${aeqPct.toFixed(2)}%` as `${number}%` }]} />
                <View style={S.depthTusdFill} />
              </View>
              <View style={S.depthLbls}>
                <Text style={[S.depthLblText, { color: theme.purple }]}>AEQ {aeqPct.toFixed(0)}%</Text>
                <Text style={[S.depthLblText, { color: theme.teal }]}>{(100 - aeqPct).toFixed(0)}% tUSD</Text>
              </View>

              <View style={S.ammBox}>
                <Text style={S.ammTitle}>{t('trade.ammTitle')}</Text>
                <View style={S.ammFormulaBox}>
                  <Text style={S.ammFormula}>{t('trade.ammFormula')}</Text>
                </View>
                <Text style={S.ammText}>{t('trade.ammDesc')}</Text>
              </View>
            </>
          ) : (
            <Text style={S.poolLine}>{t('trade.noLiquidityYet')}</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value, color, last }: { label: string; value: string; color: string; last?: boolean }) {
  return (
    <View style={[S.detailRow, last && { borderBottomWidth: 0 }]}>
      <Text style={S.detailKey}>{label}</Text>
      <Text style={[S.detailVal, { color }]}>{value}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },

  hero: { marginHorizontal: 20, marginTop: 12, backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radius, padding: 22, alignItems: 'center' },
  heroTitle: { fontSize: 16, fontWeight: '700', color: theme.text, marginBottom: 8 },
  heroSub: { fontSize: 12, color: theme.muted, lineHeight: 18, textAlign: 'center' },

  privBar: { marginHorizontal: 20, marginTop: 12, backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder, borderRadius: theme.radiusSm, padding: 10 },
  privBarText: { fontSize: 11, color: theme.neon, textAlign: 'center', lineHeight: 16 },

  tabRow: { flexDirection: 'row', marginHorizontal: 20, marginTop: 16, gap: 8 },
  tabBtn: { flex: 1, paddingVertical: 11, borderRadius: theme.radiusSm, alignItems: 'center', backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border },
  tabBtnActive: { backgroundColor: goldTint, borderColor: goldTintBorder },
  tabBtnText: { color: theme.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  tabBtnTextActive: { color: theme.gold },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 20, marginTop: 16, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontSize: 11, color: theme.muted, letterSpacing: 3, marginBottom: 14, fontWeight: '600' },

  balRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  balKey: { color: theme.muted, fontSize: 12 },
  balValGold: { color: theme.gold, fontSize: 14, fontWeight: '700' },

  dexPanel: { backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 14, marginTop: 8 },
  dexPanelHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dexLabel: { fontSize: 10, color: theme.muted, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '600' },
  dexBalHint: { fontSize: 11, color: theme.muted },
  dexInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tokenPillPurple: { backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radiusSm, paddingHorizontal: 14, paddingVertical: 10, minWidth: 78, alignItems: 'center' },
  tokenPillTeal: { backgroundColor: tealTint, borderWidth: 1, borderColor: tealTintBorder, borderRadius: theme.radiusSm, paddingHorizontal: 14, paddingVertical: 10, minWidth: 78, alignItems: 'center' },
  tokenPillText: { color: theme.text, fontWeight: '700', fontSize: 13 },
  dexInput: { flex: 1, backgroundColor: '#0A0C16', borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12, color: theme.text, fontSize: 16 },
  dexOutput: { flex: 1, backgroundColor: 'rgba(0,0,0,0.15)', borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12 },
  dexOutputText: { color: theme.neon, fontSize: 16, fontFamily: theme.fontMono },
  pctRow: { flexDirection: 'row', gap: 5, marginTop: 10 },
  pctBtn: { flex: 1, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, paddingVertical: 7, alignItems: 'center' },
  pctBtnText: { color: theme.text, fontSize: 11, fontWeight: '600' },
  pctBtnActive: { backgroundColor: goldTint, borderColor: goldTintBorder },
  pctBtnTextActive: { color: theme.gold },

  reverseRow: { alignItems: 'center', marginVertical: 4 },
  reverseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  reverseBtnText: { color: theme.muted, fontSize: 16 },

  detailsPanel: { backgroundColor: theme.card2, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radiusSm, padding: 13, marginTop: 10 },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  detailsHeaderBar: { width: 3, height: 10, backgroundColor: theme.purple, borderRadius: 2 },
  detailsHeaderText: { fontSize: 10, color: theme.muted, letterSpacing: 2, fontWeight: '600' },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: theme.border },
  detailKey: { color: theme.muted, fontSize: 12 },
  detailVal: { fontSize: 12, fontWeight: '600' },

  statusText: { color: theme.muted, fontSize: 11, textAlign: 'center', marginTop: 12 },

  btnSwap: { borderRadius: theme.radiusSm, padding: 16, alignItems: 'center', marginTop: 16 },
  btnSwapText: { color: '#fff', fontWeight: '700', fontSize: 13, letterSpacing: 1.5 },
  btnDisabled: { opacity: 0.4 },

  faucetDesc: { color: theme.muted, fontSize: 12, marginBottom: 4 },
  btnFaucet: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 15, alignItems: 'center', marginTop: 10, backgroundColor: theme.card2 },
  btnFaucetText: { color: theme.text, fontWeight: '700', fontSize: 12, letterSpacing: 1 },

  poolLine: { color: theme.muted, fontSize: 13 },
  depthLabel: { fontSize: 10, color: theme.muted, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 12, marginBottom: 8 },
  depthTrack: { height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: theme.border },
  depthAeqFill: { backgroundColor: theme.purple },
  depthTusdFill: { flex: 1, backgroundColor: theme.teal },
  depthLbls: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  depthLblText: { fontSize: 11, fontWeight: '600' },

  ammBox: { backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: theme.radiusSm, padding: 14, marginTop: 14 },
  ammTitle: { fontSize: 10, color: theme.purple, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  ammFormulaBox: { backgroundColor: 'rgba(155,114,246,0.09)', borderWidth: 1, borderColor: purpleTintBorder, borderRadius: 6, padding: 10, marginBottom: 8 },
  ammFormula: { color: theme.purple, fontSize: 12, textAlign: 'center', fontFamily: theme.fontMono },
  ammText: { color: theme.muted, fontSize: 11, lineHeight: 17 },
});
