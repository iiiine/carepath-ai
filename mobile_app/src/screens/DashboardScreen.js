// src/screens/DashboardScreen.js
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';
import Icon from '@react-native-vector-icons/material-design-icons';
import client from '../api/client';

import LongitudinalHealthPanel from './LongitudinalHealthPanel'; // 🎯 引入縱向健康趨勢分析面板

export default function DashboardScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useContext(AuthContext);
  const { s } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
  const [summary, setSummary] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState('dashboard'); // 'dashboard' | 'trend'

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const [summaryRes, recentRes, deptRes] = await Promise.all([
        client.get('/api/v1/dashboard/summary'),
        client.get('/api/v1/dashboard/recent-sessions'),
        client.get('/api/v1/dashboard/departments')
      ]);

      setSummary(summaryRes.data);
      setRecentSessions(Array.isArray(recentRes.data) ? recentRes.data : []);
      setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
    } catch (error) {
      console.error('載入儀表板失敗:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user && !user.is_guest) {
      fetchDashboardData();
    } else {
      // 🌟 新增：登出時強制清空殘留資料
      setSummary(null);
      setRecentSessions([]);
      setDepartments([]);
      setLoading(false);
    }
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchDashboardData();
  };

  const fmtDate = (val) => {
    if (!val) return '';
    const text = String(val);
    return `${text.slice(5, 7)}/${text.slice(8, 10)}`;
  };

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
      <TouchableOpacity
        onPress={() => navigation.navigate('Consult')}
        style={styles.backButton}
        accessibilityLabel="返回問診"
        accessibilityRole="button"
      >
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>健康儀表板</Text>
      <View style={styles.placeholder} />
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabBar}>
      <View style={styles.tabTrack}>
        {[['dashboard', '儀表板'], ['trend', '健康趨勢']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tabBtn, tab === key && styles.tabBtnActive]}
            onPress={() => setTab(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === key }}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  if (!user || user.is_guest) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centerContainer}>
          <Icon name="lock-outline" size={52} color={t.muted} style={{ marginBottom: 12 }} />
          <Text style={styles.guestTitle}>訪客模式無法檢視儀表板</Text>
          <Text style={styles.guestSub}>請先登入會員，解鎖您的個人健康趨勢與歷史問診紀錄。</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.loginBtnText}>前往登入</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}
      {renderTabs()}
      {loading && !refreshing ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={t.userBubble} />
          <Text style={{ marginTop: 12, color: t.muted }}>載入健康儀表板中...</Text>
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* 🎯 新增：個人化長期縱向健康趨勢分析面板 */}
          {tab === 'trend' && user && !user.is_guest && (
            <View style={{ marginBottom: 16 }}>
              <LongitudinalHealthPanel />
            </View>
          )}
          {tab === 'dashboard' && (<>
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>
              {summary?.latest_department ? `最近一次問診 · ${fmtDate(summary.latest_consultation_at)}` : '尚無問診紀錄'}
            </Text>
            <Text style={styles.heroTitle}>
              {summary?.latest_department ? `偏向：${summary.latest_department}` : '尚無紀錄'}
            </Text>
            <Text style={styles.heroText}>
              {summary?.latest_department
                ? `最近 30 天已問診 ${summary.consultation_count_30d} 次，最近不適程度 ${summary.latest_pain_level ?? '—'} / 5。`
                : '開始您的第一次 AI 問診，這裡將為您自動統計健康數據。'}
            </Text>
          </View>
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>30天問診</Text>
              <Text style={styles.tileValue}>{summary?.consultation_count_30d ?? 0} <Text style={styles.tileUnit}>次</Text></Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>最近不適度</Text>
              <Text style={[styles.tileValue, (summary?.latest_pain_level ?? 0) >= 4 && { color: t.danger }]}>
                {summary?.latest_pain_level ?? '—'} <Text style={styles.tileUnit}>/5</Text>
              </Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>最常看科別</Text>
              <Text style={styles.tileValue} numberOfLines={1}>{summary?.most_common_department ?? '—'}</Text>
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>最近問診紀錄</Text>
            {recentSessions.length === 0 ? (
              <Text style={styles.emptyText}>目前沒有歷史問診紀錄</Text>
            ) : (
              recentSessions.map((session, idx) => (
                <TouchableOpacity
                  key={session.id || idx}
                  style={styles.recentRow}
                  onPress={() => {
                    // ponytail: 不再假等 600ms，載入提示由 ConsultScreen 顯示
                    navigation.navigate('Main', { screen: 'Consult', params: { sessionId: session.id } });
                  }}
                >
                  <Text style={styles.recentDate}>{fmtDate(session.created_at)}</Text>
                  <View style={styles.recentBody}>
                    <Text style={styles.recentSymptom} numberOfLines={1}>
                      {session.title || session.symptom || '未命名問診'}
                    </Text>
                    <View style={styles.recentMeta}>
                      <Text style={styles.deptChip}>{session.suggested_department || '—'}</Text>
                      <Text style={[styles.painText, (session.pain_level ?? 0) >= 4 && { color: t.danger }]}>
                        不適 {session.pain_level ?? '—'}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </View>

          <View style={styles.panel}>
            <Text style={styles.panelTitle}>建議科別分布</Text>
            {departments.length === 0 ? (
              <Text style={styles.emptyText}>尚無足夠統計資料</Text>
            ) : (
              departments.map((d, index) => (
                <View key={index} style={styles.barItem}>
                  <View style={styles.barHead}>
                    <Text style={styles.barName}>{d.department}</Text>
                    <Text style={styles.barCount}>{d.consultation_count} 次</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.min(Number(d.consultation_count) * 20, 100)}%` }]} />
                  </View>
                </View>
              ))
            )}
          </View>
          </>)}
        </ScrollView>
      )}

    </View>
  );
}

// 樣式改為級距的函式：高齡模式切換時整組跟著變
const makeStyles = (s) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.page },
  // 原本是兩顆各自帶底色的按鈕，下方再加一條實線，三道邊界疊在一起太重。
  // 改成分段控制項：整組只有一層淡底軌道，選中的那段用白色浮起來。
  // 分隔線沿用級距的 divider（一般模式走淡陰影、高齡模式才畫實線）。
  tabBar: { backgroundColor: t.panel, paddingHorizontal: s.pad, paddingBottom: s.gapLg, borderBottomWidth: s.dividerWidth, borderBottomColor: s.dividerColor, boxShadow: s.dividerShadow },
  tabTrack: { flexDirection: 'row', backgroundColor: t.subtle, borderRadius: s.radius, padding: 3 },
  tabBtn: { flex: 1, paddingVertical: s.gap, borderRadius: s.radius - 3, alignItems: 'center', justifyContent: 'center', minHeight: s.touch },
  tabBtnActive: { backgroundColor: t.panel },
  tabText: { fontSize: s.body, fontWeight: '700', color: t.muted },
  tabTextActive: { color: t.text },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: s.pad, paddingBottom: s.gapLg, backgroundColor: t.panel, borderBottomWidth: s.border, borderBottomColor: t.border, zIndex: 100 },
  backButton: { paddingRight: s.pad, paddingVertical: 4, minHeight: s.touch, justifyContent: 'center' },
  backIcon: { fontSize: s.title, color: t.text, fontWeight: 'bold' },
  headerTitle: { fontSize: s.subtitle, fontWeight: '900', color: t.text },
  placeholder: { width: 32 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s.padLg },
  guestTitle: { fontSize: s.subtitle, fontWeight: 'bold', color: t.text, marginBottom: 6 },
  guestSub: { fontSize: s.body, color: t.muted, textAlign: 'center', marginBottom: 20, lineHeight: s.lineBody },
  loginBtn: { backgroundColor: t.userBubble, paddingHorizontal: s.padLg, paddingVertical: s.gapLg, borderRadius: s.radius, minHeight: s.touch, justifyContent: 'center' },
  loginBtnText: { color: '#fff', fontWeight: 'bold', fontSize: s.input },
  scrollContent: { padding: s.pad, paddingBottom: 40 },
  heroCard: { backgroundColor: t.panel, borderRadius: s.radius, padding: s.padLg, borderWidth: s.border, borderColor: t.border, marginBottom: s.pad },
  heroEyebrow: { fontSize: s.caption, fontWeight: '700', color: t.muted, marginBottom: 6 },
  heroTitle: { fontSize: s.title, fontWeight: '700', color: t.text, marginBottom: 8 },
  heroText: { fontSize: s.body, color: t.muted, lineHeight: s.lineBody },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: { flex: 1, backgroundColor: t.panel, borderRadius: s.radius, padding: s.gapLg, borderWidth: s.border, borderColor: t.border, justifyContent: 'space-between' },
  tileLabel: { fontSize: s.caption, color: t.muted, marginBottom: 6 },
  tileValue: { fontSize: s.subtitle, fontWeight: '700', color: t.text },
  tileUnit: { fontSize: s.caption, fontWeight: '500', color: t.muted },
  panel: { backgroundColor: t.panel, borderRadius: s.radius, padding: s.pad, borderWidth: s.border, borderColor: t.border, marginBottom: s.pad },
  panelTitle: { fontSize: s.input, fontWeight: '700', color: t.text, marginBottom: 14 },
  emptyText: { fontSize: s.body, color: t.muted, textAlign: 'center', paddingVertical: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.subtle, gap: 12 },
  recentDate: { fontSize: s.caption, color: t.muted, width: 36, paddingTop: 2 },
  recentBody: { flex: 1 },
  recentSymptom: { fontSize: s.body, color: t.text, marginBottom: 4, lineHeight: s.lineBody },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deptChip: { fontSize: s.caption, color: t.text, backgroundColor: t.subtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  painText: { fontSize: s.caption, fontWeight: '600', color: t.muted },
  barItem: { marginBottom: 12 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', fontSize: s.body, marginBottom: 4 },
  barName: { color: t.text },
  barCount: { color: t.muted },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: t.subtle, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: t.userBubble, borderRadius: 3 },
  
  // 🌟 將 backgroundColor 改為 transparent
});