// src/screens/HistoryListScreen.js
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';
import Icon from '@react-native-vector-icons/material-design-icons';

export default function HistoryListScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useContext(AuthContext);
  const { s } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user && !user.is_guest) {
      client.get('/api/v1/dashboard/recent-sessions') 
        .then(res => setHistoryList(Array.isArray(res.data) ? res.data : []))
        .catch(err => console.error('無法載入歷史紀錄', err))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [user]);

  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
      <TouchableOpacity onPress={() => navigation.navigate('Consult')} style={styles.backButton}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>歷史問診紀錄</Text>
      <View style={styles.placeholder} />
    </View>
  );

  if (!user || user.is_guest) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centerContainer}>
          <Icon name="lock-outline" size={52} color={t.muted} style={{ marginBottom: 12 }} />
          <Text style={styles.guestTitle}>訪客無法檢視歷史紀錄</Text>
          <Text style={styles.guestSub}>請先登入會員，解鎖您的個人歷史問診資料。</Text>
          <TouchableOpacity style={styles.loginBtn} onPress={() => navigation.navigate('Login')}>
            <Text style={styles.loginBtnText}>前往登入</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.card} 
      onPress={() => {
        // ponytail: 不再假等 600ms，直接跳；真正的載入提示由 ConsultScreen 顯示
        navigation.navigate('Main', { screen: 'Consult', params: { sessionId: item.id } });
      }}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.deptBadge}>{item.suggested_department || '一般科'}</Text>
        <Text style={styles.dateText}>{item.created_at ? item.created_at.substring(0, 16).replace('T', ' ') : ''}</Text>
      </View>
      <Text style={styles.symptomText} numberOfLines={2}>
        {item.title || item.symptom || '未命名問診'}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {renderHeader()}
      
      {loading ? (
        <ActivityIndicator size="large" color={t.userBubble} style={{ marginTop: 40 }} />
      ) : (
        <FlatList 
          data={historyList}
          renderItem={renderItem}
          keyExtractor={(item, index) => item.id ? item.id.toString() : index.toString()}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={<Text style={styles.emptyText}>尚無歷史問診紀錄</Text>}
        />
      )}

    </View>
  );
}

// 樣式改為級距的函式：高齡模式切換時整組跟著變，不需個別加條件式
const makeStyles = (s) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.page },
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
  listContent: { padding: s.pad, paddingBottom: 40 },
  card: { backgroundColor: t.panel, padding: s.pad, borderRadius: s.radius, marginBottom: s.gapLg, borderWidth: s.border, borderColor: t.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: s.gap, alignItems: 'center' },
  deptBadge: { fontSize: s.caption, backgroundColor: t.subtle, paddingHorizontal: s.gap, paddingVertical: 4, borderRadius: 6, color: t.text, fontWeight: '600' },
  dateText: { fontSize: s.caption, color: t.muted },
  symptomText: { fontSize: s.body, color: t.text, lineHeight: s.lineBody },
  emptyText: { textAlign: 'center', color: t.muted, marginTop: 40, fontSize: s.body },
});