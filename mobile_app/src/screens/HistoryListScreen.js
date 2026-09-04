// src/screens/HistoryListScreen.js
import React, { useState, useEffect, useContext } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import { t } from '../theme';

export default function HistoryListScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user } = useContext(AuthContext);
  const [historyList, setHistoryList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isNavigating, setIsNavigating] = useState(false);

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
          <Text style={styles.mascot}>🔒</Text>
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
        setIsNavigating(true);
        navigation.navigate('Main', { screen: 'Consult', params: { sessionId: item.id } });
        setIsNavigating(false);
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
  listContent: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: t.panel, padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: t.border },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' },
  deptBadge: { fontSize: 12, backgroundColor: t.subtle, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, color: t.text, fontWeight: '600' },
  dateText: { fontSize: 12, color: t.muted },
  symptomText: { fontSize: 14, color: t.text, lineHeight: 20 },
  emptyText: { textAlign: 'center', color: t.muted, marginTop: 40, fontSize: 14 },
  
  // 🌟 將 backgroundColor 改為 transparent
  navigatingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 1000, justifyContent: 'center', alignItems: 'center' },
  navigatingBox: { backgroundColor: '#1A1A1A', paddingHorizontal: 30, paddingVertical: 20, borderRadius: 16, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  navigatingText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', marginTop: 12 },
});