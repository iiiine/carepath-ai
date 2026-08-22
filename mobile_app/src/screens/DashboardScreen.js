// src/screens/DashboardScreen.js
import React, { useState, useEffect, useContext } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import { t } from '../theme';
import client from '../api/client';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useContext(AuthContext);
  const [summary, setSummary] = useState(null);
  const [recentSessions, setRecentSessions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

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
      <TouchableOpacity onPress={() => navigation.navigate('Consult')} style={styles.backButton}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>健康儀表板</Text>
      <View style={styles.placeholder} />
    </View>
  );

  if (!user || user.is_guest) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centerContainer}>
          <Text style={styles.mascot}>🔒</Text>
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
                    setIsNavigating(true);
                    setTimeout(() => {
                      setIsNavigating(false);
                      navigation.navigate('Main', { screen: 'Consult', params: { sessionId: session.id } });
                    }, 600);
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
        </ScrollView>
      )}

      {/* 🌟 改良版跳轉 Loading (透明背景，只留黑框) */}
      {isNavigating && (
        <View style={styles.navigatingOverlay}>
          <View style={styles.navigatingBox}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.navigatingText}>載入紀錄中...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.page },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: t.panel, borderBottomWidth: 1, borderBottomColor: t.border, zIndex: 100 },
  backButton: { paddingRight: 16, paddingVertical: 4 },
  backIcon: { fontSize: 24, color: t.text, fontWeight: 'bold' },
  headerTitle: { fontSize: 18, fontWeight: '900', color: t.text },
  placeholder: { width: 32 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  mascot: { fontSize: 60, marginBottom: 12 },
  guestTitle: { fontSize: 18, fontWeight: 'bold', color: t.text, marginBottom: 6 },
  guestSub: { fontSize: 14, color: t.muted, textAlign: 'center', marginBottom: 20 },
  loginBtn: { backgroundColor: t.userBubble, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  loginBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  heroCard: { backgroundColor: t.panel, borderRadius: 14, padding: 20, borderWidth: 1, borderColor: t.border, marginBottom: 16 },
  heroEyebrow: { fontSize: 12, fontWeight: '700', color: t.muted, marginBottom: 6 },
  heroTitle: { fontSize: 20, fontWeight: '700', color: t.text, marginBottom: 8 },
  heroText: { fontSize: 14, color: t.muted, lineHeight: 20 },
  tileRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  tile: { flex: 1, backgroundColor: t.panel, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: t.border, justifyContent: 'space-between' },
  tileLabel: { fontSize: 11, color: t.muted, marginBottom: 6 },
  tileValue: { fontSize: 18, fontWeight: '700', color: t.text },
  tileUnit: { fontSize: 12, fontWeight: '500', color: t.muted },
  panel: { backgroundColor: t.panel, borderRadius: 14, padding: 18, borderWidth: 1, borderColor: t.border, marginBottom: 16 },
  panelTitle: { fontSize: 16, fontWeight: '700', color: t.text, marginBottom: 14 },
  emptyText: { fontSize: 13, color: t.muted, textAlign: 'center', paddingVertical: 10 },
  recentRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.subtle, gap: 12 },
  recentDate: { fontSize: 12, color: t.muted, width: 36, paddingTop: 2 },
  recentBody: { flex: 1 },
  recentSymptom: { fontSize: 14, color: t.text, marginBottom: 4 },
  recentMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deptChip: { fontSize: 11, color: t.text, backgroundColor: t.subtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  painText: { fontSize: 11, fontWeight: '600', color: t.muted },
  barItem: { marginBottom: 12 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 },
  barName: { color: t.text },
  barCount: { color: t.muted },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: t.subtle, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: t.userBubble, borderRadius: 3 },
  
  // 🌟 將 backgroundColor 改為 transparent
  navigatingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  navigatingBox: { backgroundColor: '#1A1A1A', paddingHorizontal: 30, paddingVertical: 20, borderRadius: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  navigatingText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', marginTop: 12 },
});