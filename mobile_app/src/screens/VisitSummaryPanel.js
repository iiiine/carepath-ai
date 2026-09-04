// src/screens/VisitSummaryPanel.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Clipboard, Alert
} from 'react-native';
import client from '../api/client';
import { t } from '../theme';

function getRiskPresentation(riskLevel) {
  switch (riskLevel) {
    case 'emergency':
      return {
        label: '緊急',
        icon: '⚠️',
        color: '#991b1b',
        background: '#fef2f2',
        border: '#fecaca',
        badgeBackground: '#dc2626',
        badgeColor: '#ffffff',
      };
    case 'urgent':
      return {
        label: '建議儘快就醫',
        icon: '🚨',
        color: '#9a3412',
        background: '#fff7ed',
        border: '#fed7aa',
        badgeBackground: '#f97316',
        badgeColor: '#ffffff',
      };
    case 'standard':
      return {
        label: '一般',
        icon: '✓',
        color: '#166534',
        background: '#f0fdf4',
        border: '#bbf7d0',
        badgeBackground: '#dcfce7',
        badgeColor: '#166534',
      };
    default:
      return {
        label: '安全評估未完成',
        icon: 'ℹ️',
        color: '#475569',
        background: '#f8fafc',
        border: '#e2e8f0',
        badgeBackground: '#e2e8f0',
        badgeColor: '#475569',
      };
  }
}

function formatDateTime(value) {
  if (!value) return '未記錄';
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
  } catch (e) {
    return String(value);
  }
}

function formatArrayText(values) {
  if (!Array.isArray(values) || values.length === 0) return '未提供';
  return values.join('、');
}

export default function VisitSummaryPanel({ sessionId, refreshKey = 0, tempSummaryData = null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadSummary = useCallback(async () => {
    // 🎯 核心修復：如果傳入了本地暫存資料 (例如訪客模式)，直接使用它，不再發送 API 請求！
    if (tempSummaryData) {
      setData(tempSummaryData);
      setError(null);
      setLoading(false);
      return;
    }
  if (!sessionId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
  }
    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const response = await client.get(`/api/v1/visit-summary/${sessionId}`);
      if (response.data?.status !== 'success') {
        throw new Error('就醫摘要回傳格式異常');
      }
      setData(response.data);
    } catch (err) {
      console.error('Visit Summary 載入失敗:', err);
      const statusCode = err?.response?.status;
      if (statusCode === 401) {
        setError('登入狀態已失效，請重新登入後查看就醫摘要。');
      } else if (statusCode === 403) {
        setError('目前的訪客身分無法查看此就醫摘要。');
      } else if (statusCode === 404) {
        setError('找不到此問診紀錄，或您沒有權限查看。');
      } else {
        setError(err?.response?.data?.detail || '目前無法取得就醫摘要，請稍後再試。');
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId, tempSummaryData]); // 🎯 監聽 tempSummaryData 的變化

  useEffect(() => {
    loadSummary();
  }, [loadSummary, refreshKey]);

  const summary = data?.summary || null;
  const safety = summary?.safety || {};
  const riskPresentation = useMemo(() => getRiskPresentation(safety?.risk_level), [safety?.risk_level]);
  const patientContext = summary?.patient_context || {};
  const symptomStatements = summary?.symptom_course?.patient_statements || [];
  const possibleCauses = summary?.possible_causes || [];
  const redFlags = safety?.red_flags || [];

  const handleCopy = () => {
    if (summary?.handoff_text) {
      Clipboard.setString(summary.handoff_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      Alert.alert('複製成功', '已複製醫療交班摘要至剪貼簿，可於診間直接出示或傳送給醫師。');
    }
  };

  if (!sessionId && !tempSummaryData) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>請先選擇一筆已完成的問診，即可產生就醫摘要。</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="small" color={t.userBubble} />
        <Text style={styles.loadingText}>正在整理 AI 就醫摘要...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox}>
        <Text style={styles.errorTitle}>就醫摘要暫時無法載入</Text>
        <Text style={styles.errorDesc}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadSummary}>
          <Text style={styles.retryButtonText}>重新載入</Text>
          </TouchableOpacity>
        </View>
  );
}

  if (!summary) {
    return (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyText}>此筆問診目前沒有可顯示的就醫摘要。</Text>
      </View>
    );
  }

  return (
    <ScrollView nestedScrollEnabled style={styles.panel} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* Hero Section */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroTitleWrap}>
            <View style={styles.heroIcon}><Text style={{ fontSize: 20 }}>📄</Text></View>
            <View>
              <Text style={styles.title}>AI 就醫摘要</Text>
              <Text style={styles.subtitle}>將問診整理成方便向醫護說明的重點。</Text>
            </View>
          </View>
          <View style={[styles.riskBadge, { backgroundColor: riskPresentation.badgeBackground }]}>
            <Text style={[styles.riskBadgeText, { color: riskPresentation.badgeColor }]}>
              {safety?.risk_label || riskPresentation.label}
            </Text>
          </View>
        </View>

        <View style={styles.complaintBox}>
          <Text style={styles.label}>主訴</Text>
          <Text style={styles.complaintText}>{summary.chief_complaint || '未記錄'}</Text>
        </View>
      </View>

      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.label}>自評不適程度</Text>
          <Text style={styles.statValue}>
            {summary.pain_level != null ? `${summary.pain_level} / 5` : '—'}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.label}>建議科別</Text>
          <Text style={styles.statValue}>{summary.recommended_department || '未提供'}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.label}>問診時間</Text>
          <Text style={[styles.statValue, { fontSize: 13, marginTop: 10 }]}>
            {formatDateTime(summary.session_created_at)}
          </Text>
        </View>
      </View>

      {/* Safety Section */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>醫療安全風險</Text>
          <Text style={styles.sectionMeta}>Safety Engine</Text>
        </View>

        <View style={[styles.safetyBox, {
          backgroundColor: riskPresentation.background,
          borderColor: riskPresentation.border,
          borderWidth: 1
        }]}>
          <Text style={[styles.safetyTitle, { color: riskPresentation.color }]}>
            {riskPresentation.icon} {safety?.risk_label || riskPresentation.label}
          </Text>
          {safety?.safety_action && (
            <Text style={[styles.safetyDescription, { color: riskPresentation.color }]}>
              {safety.safety_action}
            </Text>
          )}

          {redFlags.length > 0 && (
            <View style={styles.redFlagList}>
              {redFlags.map((flag, index) => (
                <View key={index} style={styles.redFlagCard}>
                  <Text style={styles.redFlagTitle}>{flag.title || flag.code}</Text>
                  {flag.reason && <Text style={styles.redFlagReason}>{flag.reason}</Text>}
                </View>
              ))}
            </View>
          )}

          {safety?.assessment_available === false && (
            <Text style={{ marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 16 }}>
              此歷史問診當時沒有保存完整的 Safety Engine 評估資料，因此不能將其解讀為一般低風險。
            </Text>
          )}
        </View>
      </View>

      {/* Symptom Course Statements */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>症狀與問診重點</Text>
          <Text style={styles.sectionMeta}>僅限病人陳述</Text>
        </View>

        {symptomStatements.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.emptyCardText}>本次沒有其他使用者陳述可整理。</Text></View>
        ) : (
          <View style={styles.list}>
            {symptomStatements.map((statement, index) => (
              <View key={index} style={styles.listItem}>
                <View style={styles.listDot} />
                <Text style={styles.listText}>{statement}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Possible Causes */}
      {possibleCauses.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>問診曾提出的可能原因</Text>
            <Text style={styles.sectionMeta}>非疾病診斷</Text>
          </View>
          <View style={styles.list}>
            {possibleCauses.map((cause, index) => (
              <View key={index} style={styles.causeCard}>
                <Text style={styles.causeCardText}>{cause}</Text>
              </View>
            ))}
          </View>
          {summary.possible_causes_disclaimer && (
            <Text style={styles.disclaimerText}>{summary.possible_causes_disclaimer}</Text>
          )}
        </View>
      )}

      {/* Health Profile Background */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>已記錄健康背景</Text>
          <Text style={styles.sectionMeta}>Health Profile</Text>
        </View>

        {patientContext.has_profile_data ? (
          <View style={styles.profileGrid}>
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>年齡</Text>
              <Text style={styles.profileValue}>{patientContext.age ?? '未提供'}</Text>
            </View>
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>生理性別</Text>
              <Text style={styles.profileValue}>{patientContext.biological_sex || '未提供'}</Text>
            </View>
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>過敏史</Text>
              <Text style={styles.profileValue}>{formatArrayText(patientContext.allergies)}</Text>
            </View>
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>目前用藥</Text>
              <Text style={styles.profileValue}>{formatArrayText(patientContext.medications)}</Text>
            </View>
            <View style={styles.profileCard}>
              <Text style={styles.profileLabel}>慢性病 / 既往病史</Text>
              <Text style={styles.profileValue}>{formatArrayText(patientContext.chronic_conditions)}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.emptyCard}><Text style={styles.emptyCardText}>此會員目前尚未提供可加入摘要的健康背景資料。</Text></View>
        )}
      </View>

      {/* Doctor Handoff Text Box */}
      <View style={styles.section}>
        <View style={[styles.sectionHeader, { marginBottom: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>給醫療人員看的摘要</Text>
            <Text style={[styles.sectionMeta, { marginTop: 2 }]}>可於就診時出示或點擊複製</Text>
          </View>
          <TouchableOpacity style={[styles.copyButton, copied && styles.copySuccessButton]} onPress={handleCopy}>
            <Text style={styles.copyButtonText}>{copied ? '已複製' : '複製摘要'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.handoffBox}>
          <Text style={styles.handoffText}>{summary.handoff_text || '目前沒有可用的交班摘要。'}</Text>
        </View>
      </View>

      {/* Final Disclaimer */}
      <View style={styles.disclaimerContainer}>
        <Text style={styles.disclaimer}>{summary.disclaimer || '此摘要僅供就醫溝通參考，不能取代醫師問診、檢查與正式診斷。'}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: t.page },
  hero: { padding: 18, borderRadius: 16, backgroundColor: '#ffffff', borderHorizontalWidth: 1, borderVerticalWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 14, marginTop: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 },
  heroTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  heroIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', color: t.text },
  subtitle: { fontSize: 11, color: t.muted, marginTop: 3 },
  riskBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  riskBadgeText: { fontSize: 11, fontWeight: '800' },
  complaintBox: { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  label: { fontSize: 10, fontWeight: '700', color: t.muted },
  complaintText: { fontSize: 15, fontWeight: '750', color: t.text, marginTop: 4, lineHeight: 22 },
  statsGrid: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginTop: 12 },
  statCard: { flex: 1, padding: 12, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', justifyContent: 'center' },
  statValue: { fontSize: 15, fontWeight: '800', color: t.text, marginTop: 4 },
  section: { padding: 16, borderRadius: 16, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', marginHorizontal: 14, marginTop: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: t.text },
  sectionMeta: { fontSize: 10, color: '#94a3b8' },
  safetyBox: { borderRadius: 12, padding: 12, borderStyle: 'solid' },
  safetyTitle: { fontSize: 14, fontWeight: '800' },
  safetyDescription: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  redFlagList: { marginTop: 12, gap: 8 },
  redFlagCard: { padding: 10, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: 'rgba(220, 38, 38, 0.15)' },
  redFlagTitle: { fontSize: 12, fontWeight: '800', color: '#991b1b' },
  redFlagReason: { fontSize: 11, color: '#7f1d1d', marginTop: 3, lineHeight: 15 },
  emptyCard: { padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', alignItems: 'center' },
  emptyCardText: { fontSize: 12, color: t.muted },
  list: { gap: 8 },
  listItem: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderRadius: 10, backgroundColor: '#f8fafc' },
  listDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#3b82f6', marginTop: 6 },
  listText: { flex: 1, fontSize: 12, color: '#334155', lineHeight: 18 },
  causeCard: { padding: 10, borderRadius: 10, backgroundColor: '#f8fafc' },
  causeCardText: { fontSize: 12, color: '#334155', fontWeight: '600' },
  disclaimerText: { marginTop: 8, fontSize: 10, color: '#94a3b8', lineHeight: 14 },
  profileGrid: { gap: 8 },
  profileCard: { padding: 10, borderRadius: 10, backgroundColor: '#f8fafc' },
  profileLabel: { fontSize: 10, color: t.muted, fontWeight: '700' },
  profileValue: { fontSize: 12, color: t.text, fontWeight: '700', marginTop: 3 },
  handoffBox: { padding: 14, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  handoffText: { fontSize: 12, color: '#334155', lineHeight: 20 },
  copyButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#2563eb' },
  copySuccessButton: { backgroundColor: '#15803d' },
  copyButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '800' },
  disclaimerContainer: { paddingHorizontal: 20, marginVertical: 14 },
  disclaimer: { fontSize: 10, color: '#94a3b8', textAlign: 'center', lineHeight: 15 },
  emptyBox: { padding: 18, borderRadius: 12, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center', margin: 14 },
  emptyText: { fontSize: 12, color: t.muted, textAlign: 'center' },
  loadingBox: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 8, fontSize: 12, color: t.muted },
  errorBox: { padding: 16, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', margin: 14 },
  errorTitle: { fontSize: 13, fontWeight: '800', color: '#9a3412' },
  errorDesc: { fontSize: 11, color: '#9a3412', marginTop: 4, lineHeight: 16 },
  retryButton: { marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#2563eb', alignSelf: 'flex-start' },
  retryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '800' }
});