// src/screens/LongitudinalHealthPanel.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native';
import client from '../api/client';
import { t } from '../theme';

function formatDate(value) {
  if (!value) return '日期未記錄';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  } catch (e) {
    return value;
  }
}

function formatShortDate(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString('zh-TW', {
      month: '2-digit', day: '2-digit'
    });
  } catch (e) {
    return value;
  }
}

function getOverallPresentation(status) {
  switch (status) {
    case 'watch':
      return { icon: '⚠️', background: '#fff7ed', color: '#9a3412', border: '#fed7aa' };
    case 'stable':
      return { icon: '✓', background: '#f0fdf4', color: '#166534', border: '#bbf7d0' };
    case 'insufficient_data':
      return { icon: 'ℹ️', background: '#f8fafc', color: '#475569', border: '#e2e8f0' };
    default:
      return { icon: 'ℹ️', background: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' };
  }
}

function getTrendPresentation(trend) {
  switch (trend) {
    case 'increasing':
      return { label: '上升', background: '#fff7ed', color: '#c2410c' };
    case 'decreasing':
      return { label: '下降', background: '#f0fdf4', color: '#15803d' };
    case 'variable':
      return { label: '波動', background: '#fefce8', color: '#a16207' };
    case 'stable':
      return { label: '穩定', background: '#eff6ff', color: '#1d4ed8' };
    case 'mixed':
      return { label: '不同趨勢', background: '#f8fafc', color: '#475569' };
    default:
      return { label: '資料不足', background: '#f8fafc', color: '#64748b' };
  }
}

function getInsightColor(level) {
  return level === 'attention' ? '#f97316' : '#3b82f6';
}

export default function LongitudinalHealthPanel({ windowDays = 90, refreshKey = 0 }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [guestBlocked, setGuestBlocked] = useState(false);
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadLongitudinalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setGuestBlocked(false);

    try {
      const response = await client.get('/api/v1/longitudinal', {
        params: { window_days: windowDays },
      });
      if (response.data?.status !== 'success') {
        throw new Error('縱向健康分析回傳格式異常');
      }
      setData(response.data);
    } catch (err) {
      console.error('Longitudinal Health 載入失敗:', err);
      const statusCode = err?.response?.status;
      if (statusCode === 403) {
        setGuestBlocked(true);
        setData(null);
        return;
      }
      if (statusCode === 401) {
        setError('登入狀態已失效，請重新登入後查看健康趨勢。');
      } else {
        setError(err?.response?.data?.detail || '目前無法取得縱向健康分析資料，請稍後再試。');
      }
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [windowDays]);

  useEffect(() => {
    loadLongitudinalData();
  }, [loadLongitudinalData, refreshKey]);

  const onRefresh = () => {
    setRefreshing(true);
    loadLongitudinalData();
  };

  const analysis = data?.analysis || null;
  const overall = analysis?.overall || null;
  const overallPresentation = useMemo(() => getOverallPresentation(overall?.status), [overall?.status]);
  const symptomPainTrends = analysis?.symptom_pain_trends || [];
  const recurringSymptoms = analysis?.recurring_symptoms || [];
  const departmentPatterns = analysis?.department_patterns || [];
  const recurringCauses = analysis?.recurring_possible_causes || [];
  const insights = analysis?.insights || [];
  const timeline = analysis?.timeline || [];
  const visitFrequency = analysis?.visit_frequency || {};

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color={t.userBubble} />
        <Text style={styles.loadingText}>正在分析個人歷史健康趨勢...</Text>
      </View>
    );
  }

  if (guestBlocked) {
    return (
      <View style={styles.guestBox}>
        <Text style={{ fontSize: 24, textAlign: 'center' }}>👤</Text>
        <Text style={styles.guestTitle}>登入會員即可查看健康趨勢</Text>
        <Text style={styles.guestSub}>
          縱向健康分析需要比較多次歷史問診。訪客資料不會作為長期會員健康紀錄使用。
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={{ fontSize: 20 }}>⚠️</Text>
        <Text style={styles.errorTitle}>健康趨勢暫時無法載入</Text>
        <Text style={styles.errorDesc}>{error}</Text>
        <TouchableOpacity style={styles.actionButton} onPress={loadLongitudinalData}>
          <Text style={styles.actionButtonText}>重新載入</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!analysis) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>目前沒有可顯示的縱向健康分析資料。</Text>
      </View>
    );
  }

  return (
    <ScrollView
      nestedScrollEnabled
      style={styles.panel}
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Hero Header */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIcon}><Text style={{ fontSize: 18 }}>📈</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>我的健康趨勢</Text>
              <Text style={styles.subtitle}>比較歷史 AI 問診，協助理解症狀變化與規律。</Text>
            </View>
          </View>
          <View style={styles.periodBadge}>
            <Text style={styles.periodBadgeText}>過去 {analysis.analysis_window_days || windowDays} 天</Text>
          </View>
        </View>

        {overall && (
          <View style={[styles.overallBox, {
            backgroundColor: overallPresentation.background,
            borderColor: overallPresentation.border,
            borderWidth: 1
          }]}>
            <Text style={styles.overallIcon}>{overallPresentation.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.overallTitle, { color: overallPresentation.color }]}>{overall.label}</Text>
              <Text style={[styles.overallDescription, { color: overallPresentation.color }]}>{overall.description}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Statistics Cards */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>歷史問診</Text>
          <Text style={styles.statValue}>{analysis.total_sessions ?? 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>最近 30 天</Text>
          <Text style={styles.statValue}>{visitFrequency.last_30_days ?? 0}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>可比較症狀</Text>
          <Text style={styles.statValue}>{analysis?.pain_trend?.comparable_symptom_count ?? 0}</Text>
        </View>
      </View>

      {/* Pain Trend */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>同症狀不適程度變化</Text>
          <Text style={styles.sectionMeta}>相同症狀比較</Text>
        </View>

        {symptomPainTrends.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyCardText}>
              目前沒有足夠同症狀資料建立不適程度趨勢。系統僅會比較同症狀的歷史程度，不交叉比較無關症狀。
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {symptomPainTrends.map((item, index) => {
              const presentation = getTrendPresentation(item.trend);
              return (
                <View key={index} style={styles.trendCard}>
                  <View style={styles.trendHeader}>
                    <View>
                      <Text style={styles.trendSymptom}>{item.symptom}</Text>
                      <Text style={styles.trendSub}>共 {item.session_count} 次相關問診</Text>
                    </View>
                    <View style={[styles.trendBadge, { backgroundColor: presentation.background }]}>
                      <Text style={[styles.trendBadgeText, { color: presentation.color }]}>
                        {presentation.label}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.trendNumbers}>
                    <View style={styles.trendNumberBox}>
                      <Text style={styles.trendNumberLabel}>最近</Text>
                      <Text style={styles.trendNumberValue}>{item.latest ?? '—'}</Text>
                    </View>
                    <View style={styles.trendNumberBox}>
                      <Text style={styles.trendNumberLabel}>平均</Text>
                      <Text style={styles.trendNumberValue}>{item.average ?? '—'}</Text>
                    </View>
                    <View style={styles.trendNumberBox}>
                      <Text style={styles.trendNumberLabel}>最高</Text>
                      <Text style={styles.trendNumberValue}>{item.maximum ?? '—'}</Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>

      {/* Recurring Symptoms */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>反覆出現的症狀</Text></View>
        {recurringSymptoms.length === 0 ? (
          <Text style={styles.emptyText}>目前無同一症狀在兩次以上問診中重複出現。</Text>
        ) : (
          <View style={styles.chipWrap}>
            {recurringSymptoms.map((item, index) => (
              <View key={index} style={styles.chip}>
                <Text style={styles.chipText}>
                  {item.symptom} <Text style={styles.chipCount}>× {item.session_count}</Text>
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* AI Health Insights */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>歷史健康洞察</Text>
          <Text style={styles.sectionMeta}>AI Analysis</Text>
        </View>

        {insights.length === 0 ? (
          <Text style={styles.emptyText}>目前尚未發現顯著歷史規律以產生個人洞察。</Text>
        ) : (
          <View style={styles.list}>
            {insights.map((insight, index) => (
              <View key={index} style={styles.insightCard}>
                <View style={styles.insightTop}>
                  <View style={[styles.insightDot, { backgroundColor: getInsightColor(insight.level) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.insightTitle}>{insight.title}</Text>
                    <Text style={styles.insightDesc}>{insight.description}</Text>
                    {insight.recommendation && (
                      <View style={styles.recommendationBox}>
                        <Text style={styles.recommendationText}>💡 建議：{insight.recommendation}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Health Timeline */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>健康時間軸</Text>
          <Text style={styles.sectionMeta}>最近 {timeline.length} 筆</Text>
        </View>

        {timeline.length === 0 ? (
          <Text style={styles.emptyText}>尚無任何歷史問診記錄。</Text>
        ) : (
          <View style={styles.timeline}>
            {[...timeline].reverse().map((item, index, arr) => (
              <View key={index} style={styles.timelineItem}>
                <View style={styles.timelineRail}>
                  <View style={styles.timelineDot} />
                  {index < arr.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineDate}>{formatDate(item.created_at)}</Text>
                  <Text style={styles.timelineSymptom}>{item.symptom_text || '未記錄症狀描述'}</Text>
                  <View style={styles.timelineMeta}>
                    {item.pain_level != null && (
                      <View style={styles.metaTag}><Text style={styles.metaTagText}>不適 {item.pain_level}/5</Text></View>
                    )}
                    {item.suggested_department && (
                      <View style={styles.metaTag}><Text style={styles.metaTagText}>{item.suggested_department}</Text></View>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Disclaimer */}
      <View style={styles.disclaimerContainer}>
        <Text style={styles.disclaimer}>
          {analysis.disclaimer || '此功能僅整理歷史問診變化，並非醫學診斷或急診分流。'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: t.page },
  hero: { padding: 18, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 14, marginTop: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  heroIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(37, 99, 235, 0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: t.text },
  subtitle: { fontSize: 11, color: t.muted, marginTop: 3 },
  periodBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: '#eff6ff' },
  periodBadgeText: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  overallBox: { marginTop: 14, padding: 12, borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  overallIcon: { fontSize: 16, marginTop: 1 },
  overallTitle: { fontSize: 13, fontWeight: '800' },
  overallDescription: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  statsGrid: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginTop: 12 },
  statCard: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  statLabel: { fontSize: 11, color: t.muted, fontWeight: '600' },
  statValue: { fontSize: 18, fontWeight: '800', color: t.text, marginTop: 4 },
  section: { padding: 16, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 14, marginTop: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: t.text },
  sectionMeta: { fontSize: 10, color: '#94a3b8' },
  emptyCard: { padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', alignItems: 'center' },
  emptyCardText: { fontSize: 12, color: t.muted, lineHeight: 17, textAlign: 'center' },
  list: { gap: 8 },
  trendCard: { padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  trendHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trendSymptom: { fontSize: 14, fontWeight: '800', color: t.text },
  trendSub: { fontSize: 11, color: t.muted, marginTop: 2 },
  trendBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  trendBadgeText: { fontSize: 11, fontWeight: '800' },
  trendNumbers: { flexDirection: 'row', gap: 8, marginTop: 12 },
  trendNumberBox: { flex: 1, padding: 8, borderRadius: 8, backgroundColor: '#ffffff' },
  trendNumberLabel: { fontSize: 10, color: '#94a3b8', fontWeight: '700' },
  trendNumberValue: { fontSize: 14, fontWeight: '800', color: t.text, marginTop: 2 },
  emptyText: { fontSize: 12, color: t.muted, textAlign: 'center', paddingVertical: 8 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '700' },
  chipCount: { color: '#2563eb' },
  insightCard: { padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  insightTop: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  insightDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  insightTitle: { fontSize: 13, fontWeight: '800', color: t.text },
  insightDesc: { fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 17 },
  recommendationBox: { marginTop: 8, padding: 8, borderRadius: 6, backgroundColor: '#ffffff' },
  recommendationText: { fontSize: 11, color: '#475569', lineHeight: 16 },
  timeline: {},
  timelineItem: { flexDirection: 'row', gap: 10 },
  timelineRail: { alignItems: 'center', width: 14 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3b82f6', marginTop: 5 },
  timelineLine: { width: 2, flex: 1, backgroundColor: '#e2e8f0', minHeight: 40 },
  timelineContent: { flex: 1, paddingBottom: 16 },
  timelineDate: { fontSize: 10, color: '#94a3b8', fontWeight: '700' },
  timelineSymptom: { fontSize: 13, fontWeight: '800', color: t.text, marginTop: 4 },
  timelineMeta: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  metaTag: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, backgroundColor: '#f1f5f9' },
  metaTagText: { fontSize: 10, color: '#64748b', fontWeight: '700' },
  disclaimerContainer: { paddingHorizontal: 20, marginVertical: 14 },
  disclaimer: { fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 15 },
  loadingBox: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 8, fontSize: 12, color: t.muted },
  guestBox: { padding: 24, borderRadius: 16, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', margin: 14 },
  guestTitle: { fontSize: 16, fontWeight: 'bold', color: t.text, textAlign: 'center', marginTop: 8 },
  guestSub: { fontSize: 12, color: t.muted, textAlign: 'center', marginTop: 6, lineHeight: 17 },
  errorBox: { padding: 16, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', margin: 14, alignItems: 'center' },
  errorTitle: { fontSize: 13, fontWeight: '800', color: '#9a3412', marginTop: 6 },
  errorDesc: { fontSize: 11, color: '#9a3412', marginTop: 4, lineHeight: 16, textAlign: 'center' },
  actionButton: { marginTop: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#2563eb' },
  actionButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  emptyBox: { padding: 18, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', margin: 14 },
  emptyText: { fontSize: 12, color: t.muted, textAlign: 'center' }
});