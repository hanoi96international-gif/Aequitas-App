import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '@/constants/aequitas-theme';
import { useLanguage } from '@/contexts/LanguageContext';
import type { PricePoint } from '@/lib/api';

const W = 320;
const H = 160;
const PAD = 8;

export default function PriceChart({ points }: { points: PricePoint[] }) {
  const { t, lang } = useLanguage();

  function fmtTime(ts: number) {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  }

  if (points.length < 2) {
    return (
      <View style={S.empty}>
        <Text style={S.emptyText}>{t('trade.notEnoughChartData')}</Text>
      </View>
    );
  }

  const prices = points.map((p) => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (p.p - min) / range) * (H - PAD * 2);
    return { x, y };
  });

  const lineStr = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaStr = `${PAD},${H - PAD} ${lineStr} ${W - PAD},${H - PAD}`;

  const first = points[0].p;
  const last = points[points.length - 1].p;
  const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
  const up = changePct >= 0;
  const lineColor = up ? theme.neon : theme.red;

  return (
    <View>
      <View style={S.headerRow}>
        <Text style={S.priceNow}>{last.toFixed(4)} tUSD</Text>
        <Text style={[S.changeText, { color: lineColor }]}>{up ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%</Text>
      </View>

      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="fillGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity={0.25} />
            <Stop offset="1" stopColor={lineColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2} stroke={theme.border} strokeWidth={1} strokeDasharray="4,4" />
        <Polygon points={areaStr} fill="url(#fillGrad)" />
        <Polyline points={lineStr} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      </Svg>

      <View style={S.axisRow}>
        <Text style={S.axisText}>{fmtTime(points[0].t)}</Text>
        <Text style={S.axisText}>{fmtTime(points[points.length - 1].t)}</Text>
      </View>

      <View style={S.minMaxRow}>
        <Text style={S.minMaxText}>{t('trade.low')}: <Text style={{ color: theme.red }}>{min.toFixed(4)}</Text></Text>
        <Text style={S.minMaxText}>{t('trade.high')}: <Text style={{ color: theme.neon }}>{max.toFixed(4)}</Text></Text>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { color: theme.muted, fontSize: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  priceNow: { color: theme.text, fontSize: 20, fontWeight: '800' },
  changeText: { fontSize: 13, fontWeight: '700' },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { color: theme.muted, fontSize: 10 },
  minMaxRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  minMaxText: { color: theme.muted, fontSize: 11, fontWeight: '600' },
});
