import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useWallet } from '@/contexts/WalletContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getCanonicalBlocks, type CanonicalBlock } from '@/lib/api';
import { fmtAEQ, formatBalance } from '@/lib/format';
import { theme, purpleTint, purpleTintBorder, tealTint, tealTintBorder, neonTint, neonTintBorder } from '@/constants/aequitas-theme';
import LanguagePicker from '@/components/LanguagePicker';

function formatCountdown(totalSecs: number): string {
  const s = Math.max(0, Math.floor(totalSecs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

function blockAge(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm';
  return Math.floor(diff / 3600) + 'h';
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + '…' + a.slice(-4);
}

export default function Home() {
  const { status, refreshBalance } = useWallet();
  const { t } = useLanguage();
  const [refreshing, setRefreshing] = useState(false);
  const [ubiLeft, setUbiLeft] = useState(0);
  const [blocks, setBlocks] = useState<CanonicalBlock[]>([]);

  const PHASES = [
    { label: t('home.phaseBootstrap'), desc: t('home.phaseBootstrapDesc') },
    { label: t('home.phaseGrowth'), desc: t('home.phaseGrowthDesc') },
    { label: t('home.phaseStability'), desc: t('home.phaseStabilityDesc') },
    { label: t('home.phaseMaturity'), desc: t('home.phaseMaturityDesc') },
  ];

  const POOLS = [
    { key: 'pool_validators', name: t('home.poolValidatorsName'), pct: '40%', color: theme.purple, desc: t('home.poolValidatorsDesc') },
    { key: 'pool_lp', name: t('home.poolLiquidityName'), pct: '30%', color: theme.teal, desc: t('home.poolLiquidityDesc') },
    { key: 'pool_ubi', name: t('home.poolUbiName'), pct: '20%', color: theme.gold, desc: t('home.poolUbiDesc') },
    { key: 'pool_treasury', name: t('home.poolTreasuryName'), pct: '10%', color: theme.blue, desc: t('home.poolTreasuryDesc') },
  ] as const;

  const loadBlocks = useCallback(async () => {
    try {
      setBlocks(await getCanonicalBlocks(10));
    } catch {
      // next poll retries
    }
  }, []);

  useEffect(() => {
    loadBlocks();
    const t = setInterval(loadBlocks, 10_000);
    return () => clearInterval(t);
  }, [loadBlocks]);

  useEffect(() => {
    if (status?.ubi_next_payout_secs != null) setUbiLeft(status.ubi_next_payout_secs);
  }, [status?.ubi_next_payout_secs]);

  useEffect(() => {
    const t = setInterval(() => setUbiLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([refreshBalance(), loadBlocks()]);
    setRefreshing(false);
  }

  const phase = status?.phase ?? 0;
  const ubiPct = Math.min(100, Math.max(0, ((86400 - ubiLeft) / 86400) * 100));
  const validators = new Set(blocks.map((b) => b.proposer.toLowerCase())).size;
  const gini = typeof status?.gini === 'number' ? status.gini : null;
  // Website's equality framing: Gini 0 = perfect equality. Grade like explorer.
  const equalityGrade = gini == null ? '—' : gini < 0.2 ? 'A+' : gini < 0.3 ? 'A' : gini < 0.4 ? 'B' : gini < 0.5 ? 'C' : 'D';

  // Replaces the old velocity/growth boxes (server hardcodes velocity to 50
  // and derives growth as just humans*10 capped at 100 — neither is a real
  // computed metric). These two ARE genuinely derived from live data and
  // stay on the equality/economy theme: average AEQ per human shows whether
  // per-capita wealth is holding near the 1,000 registration baseline, and
  // community pools shows how much value is actively circulating back.
  const totalSupplyNum = status?.total_supply ? parseFloat(status.total_supply) : 0;
  const avgPerHuman = status?.total_humans ? totalSupplyNum / status.total_humans : 0;
  const communityPools =
    parseFloat(status?.pool_ubi || '0') +
    parseFloat(status?.pool_treasury || '0') +
    parseFloat(status?.pool_validators || '0') +
    parseFloat(status?.pool_lp || '0');

  return (
    <SafeAreaView style={S.safe} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={theme.bg} />
      <ScrollView
        contentContainerStyle={S.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.purple} />}>
        {/* Header — like website: logo icon + wordmark + LIVE/GHOSTDAG badges */}
        <View style={S.header}>
          <View style={S.logoRow}>
            <LinearGradient colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.logoIcon}>
              <Text style={S.logoIconText}>⚖</Text>
            </LinearGradient>
            <View>
              <Text style={S.logo}>AEQUITAS</Text>
              <Text style={S.logoSub}>{t('home.logoSub')}</Text>
            </View>
          </View>
          <View style={S.badgeRow}>
            <LanguagePicker />
            <View style={S.badgeLive}>
              <View style={S.pulseDot} />
              <Text style={S.badgeLiveText}>{t('home.badgeLive')}</Text>
            </View>
            <View style={S.badgeDag}>
              <Text style={S.badgeDagText}>● GHOSTDAG</Text>
            </View>
          </View>
        </View>

        {/* Stats grid — mirror of the website's exp-stats row */}
        <View style={S.statsGrid}>
          <Stat label={t('home.statLatestBlock')} value={status?.height ? status.height.toLocaleString() : '—'} sub={t('home.statLatestBlockSub')} accent={theme.neon} />
          <Stat label={t('home.statHumans')} value={status?.total_humans != null ? String(status.total_humans) : '—'} sub={t('home.statHumansSub')} accent={theme.teal} />
          <Stat label={t('home.statTotalSupply')} value={status?.total_supply || '—'} sub={t('home.statTotalSupplySub')} accent={theme.gold} />
          <Stat label={t('home.statValidators')} value={validators > 0 ? String(validators) : '—'} sub={t('home.statValidatorsSub')} accent={theme.purple} />
        </View>

        {/* UBI hero — gold, like the website's ubi-hero-section */}
        <View style={S.ubiHero}>
          <Text style={S.ubiHeroLabel}>{t('home.ubiNextPayout')}</Text>
          <Text style={S.ubiTime}>{formatCountdown(ubiLeft)}</Text>
          <Text style={S.ubiPoolBalLbl}>{t('home.ubiPoolBalance')}</Text>
          <Text style={S.ubiPoolBal}>{status?.pool_ubi != null ? `${status.pool_ubi} AEQ` : '—'}</Text>
          <View style={S.progressTrack}>
            <LinearGradient
              colors={[theme.gold, theme.neon]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[S.progressFill, { width: `${ubiPct.toFixed(1)}%` as `${number}%` }]}
            />
          </View>
          <Text style={S.ubiTimeBarLbl}>{t('home.ubiTimeBarLbl')}</Text>
          <Text style={S.ubiHeroSub}>{t('home.ubiSub')}</Text>
        </View>

        {/* Equality card — index + gini + metric boxes, like the Equality tab */}
        <View style={S.card}>
          <View style={S.cardTitleRow}>
            <View style={S.cardTitleBar} />
            <Text style={S.cardTitle}>{t('home.equalityIndex')}</Text>
          </View>
          <View style={S.eqRow}>
            <View style={S.eqBig}>
              <Text style={S.eqGrade}>{equalityGrade}</Text>
              <Text style={S.eqGradeLbl}>{t('home.grade')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={S.eqMetricRow}>
                <Text style={S.eqMetricKey}>{t('home.giniCoefficient')}</Text>
                <Text style={[S.eqMetricVal, { color: theme.neon }]}>{gini != null ? gini.toFixed(4) : '—'}</Text>
              </View>
              <View style={S.barBg}>
                <View style={[S.barFill, { width: `${Math.min(100, (gini ?? 0) * 100).toFixed(1)}%` as `${number}%` }]} />
              </View>
              <View style={S.barLbls}>
                <Text style={S.barLblText}>{t('home.giniPerfect')}</Text>
                <Text style={S.barLblText}>{t('home.giniMax')}</Text>
              </View>
            </View>
          </View>
          <View style={S.mrow}>
            <MetricBox label={t('home.metricIndex')} value={status?.index != null ? status.index.toFixed(1) : '—'} />
            <MetricBox label={t('home.metricAvgPerHuman')} value={status?.total_humans ? formatBalance(avgPerHuman) : '—'} />
            <MetricBox label={t('home.metricCommunityPools')} value={status ? fmtAEQ(communityPools) : '—'} />
          </View>
        </View>

        {/* Latest blocks — mini explorer table like the website */}
        <View style={S.card}>
          <View style={S.cardTitleRow}>
            <View style={S.secDot} />
            <Text style={S.cardTitle}>{t('home.latestBlocks')}</Text>
            <View style={{ flex: 1 }} />
            <Text style={S.cardCount}>{status?.height ? status.height.toLocaleString() + ' ' + t('home.blocksSuffix') : ''}</Text>
          </View>
          {blocks.length === 0 ? (
            <Text style={S.emptyText}>{t('home.loadingBlocks')}</Text>
          ) : (
            blocks.map((b) => {
              const isMerge = (b.blues?.length ?? 0) > 0 || (b.parent_hashes?.length ?? 0) > 1;
              return (
                <View key={b.hash} style={S.blockRow}>
                  <Text style={S.blockNum}>#{b.height.toLocaleString()}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={S.blockProposer}>{shortAddr(b.proposer)}</Text>
                    <Text style={S.blockScore}>★ {b.blue_score.toLocaleString()}</Text>
                  </View>
                  <View style={isMerge ? S.badgeMerge : S.badgeStd}>
                    <Text style={isMerge ? S.badgeMergeText : S.badgeStdText}>{isMerge ? t('home.badgeMerge') : t('home.badgeStd')}</Text>
                  </View>
                  <Text style={S.blockAge}>{blockAge(b.timestamp)}</Text>
                </View>
              );
            })
          )}
        </View>

        {/* Tokenomics pools — the website's pools4-grid */}
        <View style={S.card}>
          <View style={S.cardTitleRow}>
            <View style={S.cardTitleBar} />
            <Text style={S.cardTitle}>{t('home.tokenomicsPools')}</Text>
          </View>
          <View style={S.poolsGrid}>
            {POOLS.map((p) => {
              const raw = (status as any)?.[p.key];
              return (
                <View key={p.key} style={[S.poolCard, { borderColor: p.color + '33' }]}>
                  <View style={S.poolHead}>
                    <Text style={[S.poolName, { color: p.color }]}>{p.name}</Text>
                    <View style={S.poolBadge}>
                      <Text style={S.poolBadgeText}>{p.pct}</Text>
                    </View>
                  </View>
                  <Text style={S.poolAmount}>{raw != null ? raw + ' AEQ' : '—'}</Text>
                  <Text style={S.poolDesc}>{p.desc}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Phase */}
        <View style={S.card}>
          <View style={S.cardTitleRow}>
            <View style={S.cardTitleBar} />
            <Text style={S.cardTitle}>{t('home.networkPhase')}</Text>
          </View>
          <View style={S.phaseGrid}>
            {PHASES.map((p, i) =>
              i === phase ? (
                <LinearGradient key={i} colors={theme.gradient} start={theme.gradientAngle.start} end={theme.gradientAngle.end} style={S.phaseChipActive}>
                  <Text style={S.phaseLabelActive}>{p.label}</Text>
                </LinearGradient>
              ) : (
                <View key={i} style={S.phaseChip}>
                  <Text style={S.phaseLabel}>{p.label}</Text>
                </View>
              )
            )}
          </View>
          <Text style={S.phaseDesc}>{PHASES[phase]?.desc ?? ''}</Text>
        </View>

        <View style={S.footer}>
          <Text style={S.footerQuote}>{t('home.footerQuote')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <View style={S.statBox}>
      <View style={[S.statAccent, { backgroundColor: accent }]} />
      <Text style={S.statLabel}>{label}</Text>
      <Text style={[S.statValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={S.statSub}>{sub}</Text>
    </View>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={S.mbox}>
      <Text style={S.mval}>{value}</Text>
      <Text style={S.mlbl}>{label}</Text>
    </View>
  );
}

const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 32 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, paddingBottom: 18, paddingHorizontal: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  logoIconText: { color: '#fff', fontSize: 17 },
  logo: { fontSize: 17, fontWeight: '900', color: theme.text, letterSpacing: 3 },
  logoSub: { color: theme.muted, fontSize: 7.5, letterSpacing: 2.2, marginTop: 1 },
  badgeRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  badgeLive: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: neonTint, borderWidth: 1, borderColor: neonTintBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  pulseDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.neon },
  badgeLiveText: { color: theme.neon, fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  badgeDag: { backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  badgeDagText: { color: theme.purple, fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 10, marginBottom: 14 },
  statBox: { flexBasis: '47%', flexGrow: 1, backgroundColor: theme.card, borderRadius: theme.radius, borderWidth: 1, borderColor: theme.border, padding: 14, overflow: 'hidden' },
  statAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  statLabel: { color: theme.muted, fontSize: 9, letterSpacing: 1.5, fontWeight: '600' },
  statValue: { fontSize: 21, fontWeight: '900', marginTop: 6 },
  statSub: { color: theme.muted, fontSize: 9, marginTop: 4, lineHeight: 13 },

  ubiHero: { marginHorizontal: 20, backgroundColor: 'rgba(240,180,41,0.07)', borderWidth: 1, borderColor: 'rgba(240,180,41,0.3)', borderRadius: theme.radius, padding: 20, marginBottom: 14, alignItems: 'center', overflow: 'hidden' },
  ubiHeroLabel: { color: theme.muted, fontSize: 10, letterSpacing: 2, fontWeight: '600' },
  ubiTime: { color: theme.gold, fontSize: 34, fontWeight: '900', letterSpacing: 3, marginVertical: 8, fontFamily: theme.fontMono },
  progressTrack: { height: 7, backgroundColor: 'rgba(240,180,41,0.1)', borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(240,180,41,0.18)', width: '100%' },
  progressFill: { height: 7, borderRadius: 4 },
  ubiHeroSub: { color: theme.muted, fontSize: 10, marginTop: 8 },
  ubiPoolBalLbl: { color: theme.muted, fontSize: 10, marginTop: 4, letterSpacing: 0.5 },
  ubiPoolBal: { color: theme.neon, fontSize: 18, fontWeight: '700', fontFamily: theme.fontMono, marginBottom: 6 },
  ubiTimeBarLbl: { color: theme.muted, fontSize: 10, marginTop: 6, textAlign: 'center' },

  card: { marginHorizontal: 20, backgroundColor: theme.card, borderRadius: theme.radius, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: theme.border },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  cardTitleBar: { width: 3, height: 12, borderRadius: 2, backgroundColor: theme.purple },
  secDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.neon },
  cardTitle: { fontSize: 10.5, color: theme.muted, letterSpacing: 2, fontWeight: '700' },
  cardCount: { fontSize: 9, color: theme.muted, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },

  eqRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  eqBig: { alignItems: 'center', paddingHorizontal: 6 },
  eqGrade: { fontSize: 40, fontWeight: '900', color: theme.neon },
  eqGradeLbl: { fontSize: 9, color: theme.muted, letterSpacing: 1 },
  eqMetricRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  eqMetricKey: { color: theme.muted, fontSize: 12 },
  eqMetricVal: { fontSize: 12, fontWeight: '700' },
  barBg: { height: 8, backgroundColor: purpleTint, borderRadius: 6, overflow: 'hidden', borderWidth: 1, borderColor: purpleTintBorder },
  barFill: { height: '100%', backgroundColor: theme.neon, borderRadius: 6 },
  barLbls: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  barLblText: { fontSize: 8.5, color: theme.muted },
  mrow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  mbox: { flex: 1, backgroundColor: theme.card2, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 12, alignItems: 'center' },
  mval: { fontSize: 17, fontWeight: '700', color: theme.teal },
  mlbl: { fontSize: 9.5, color: theme.muted, marginTop: 3 },

  emptyText: { color: theme.muted, fontSize: 12, textAlign: 'center', paddingVertical: 16 },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.border },
  blockNum: { color: theme.purple, fontSize: 12.5, fontWeight: '700', fontFamily: theme.fontMono, minWidth: 76 },
  blockProposer: { color: theme.teal, fontSize: 11, fontFamily: theme.fontMono },
  blockScore: { color: theme.muted, fontSize: 9.5, marginTop: 1 },
  badgeMerge: { backgroundColor: purpleTint, borderWidth: 1, borderColor: purpleTintBorder, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  badgeMergeText: { color: theme.purple, fontSize: 9, fontWeight: '700' },
  badgeStd: { backgroundColor: tealTint, borderWidth: 1, borderColor: tealTintBorder, borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  badgeStdText: { color: theme.teal, fontSize: 9, fontWeight: '700' },
  blockAge: { color: theme.neon, fontSize: 10, minWidth: 28, textAlign: 'right' },

  poolsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  poolCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: theme.card2, borderWidth: 1, borderRadius: theme.radiusSm, padding: 13 },
  poolHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  poolName: { fontSize: 12, fontWeight: '700' },
  poolBadge: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  poolBadgeText: { fontSize: 9, color: theme.muted },
  poolAmount: { fontSize: 15, fontWeight: '700', color: theme.text, marginBottom: 5 },
  poolDesc: { fontSize: 9.5, color: theme.muted, lineHeight: 14 },

  phaseGrid: { flexDirection: 'row', gap: 8 },
  phaseChip: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, paddingVertical: 8, alignItems: 'center' },
  phaseChipActive: { flex: 1, borderRadius: theme.radiusSm, paddingVertical: 8, alignItems: 'center' },
  phaseLabel: { color: theme.muted, fontSize: 10 },
  phaseLabelActive: { color: '#fff', fontWeight: '700', fontSize: 10 },
  phaseDesc: { color: theme.muted, fontSize: 12, marginTop: 12, textAlign: 'center' },

  footer: { alignItems: 'center', padding: 24 },
  footerQuote: { color: theme.muted, fontSize: 11, textAlign: 'center', fontStyle: 'italic', lineHeight: 18 },
});
