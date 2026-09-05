// src/screens/ProfileScreen.js
import React, { useState, useContext, useEffect, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthContext } from '../context/AuthContext';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';
import Icon from '@react-native-vector-icons/material-design-icons';
import client from '../api/client';

export default function ProfileScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, logout } = useContext(AuthContext);
  const { s } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
  
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [allergyHistory, setAllergyHistory] = useState('');
  const [pastMedicalHistory, setPastMedicalHistory] = useState('');
  const [currentMedications, setCurrentMedications] = useState('');

  useEffect(() => {
    if (user && !user.is_guest) {
      fetchProfile();
    } else {
      // 🌟 新增：登出時強制清空殘留資料
      setBirthDate('');
      setGender('');
      setHeightCm('');
      setWeightKg('');
      setAllergyHistory('');
      setPastMedicalHistory('');
      setCurrentMedications('');
    }
  }, [user]);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const res = await client.get('/api/v1/profile'); 
      const data = res.data;
      
      if (data) {
        setBirthDate(data.birth_date || '');
        setGender(data.gender || '');
        setHeightCm(data.height_cm ? String(data.height_cm) : '');
        setWeightKg(data.weight_kg ? String(data.weight_kg) : '');
        setAllergyHistory(data.allergy_history || '');
        setPastMedicalHistory(data.past_medical_history || '');
        setCurrentMedications(data.current_medications || '');
      }
    } catch (error) {
      console.error('讀取資料失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await client.post('/api/v1/profile', {
        height_cm: heightCm ? parseFloat(heightCm) : null,
        weight_kg: weightKg ? parseFloat(weightKg) : null,
        birth_date: birthDate,
        gender: gender,
        past_medical_history: pastMedicalHistory,
        allergy_history: allergyHistory,
        current_medications: currentMedications
      });
      Alert.alert('成功', '個人健康資料已更新！');
    } catch (error) {
      console.error('儲存失敗:', error);
      Alert.alert('錯誤', '儲存失敗，請稍後再試。');
    } finally {
      setSaving(false);
    }
  };

  // 🌟 通用的 Header 渲染邏輯
  const renderHeader = () => (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
      <TouchableOpacity onPress={() => navigation.navigate('Consult')} style={styles.backButton}>
        <Text style={styles.backIcon}>←</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle}>個人化健康資料表</Text>
      <TouchableOpacity onPress={logout}>
        <Text style={styles.logoutText}>登出</Text>
      </TouchableOpacity>
    </View>
  );

  if (!user || user.is_guest) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centerContainer}>
          <Icon name="lock-outline" size={52} color={t.muted} style={{ marginBottom: 12 }} />
          <Text style={styles.guestTitle}>訪客無法建立健康檔案</Text>
          <Text style={styles.guestSub}>請登入會員以管理您的專屬健康資料表。</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader()}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {loading ? (
            <ActivityIndicator size="large" color={t.userBubble} style={{ marginTop: 50 }} />
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>基本生理資訊</Text>
                
                <Text style={styles.label}>出生年月日 (YYYY-MM-DD)</Text>
                <TextInput style={styles.input} value={birthDate} onChangeText={setBirthDate} placeholder="例如：1998-05-20" placeholderTextColor={t.muted} />

                <Text style={styles.label}>性別</Text>
                <TextInput style={styles.input} value={gender} onChangeText={setGender} placeholder="例如：男 / 女" placeholderTextColor={t.muted} />

                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={styles.label}>身高 (cm)</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={heightCm} onChangeText={setHeightCm} placeholder="170" placeholderTextColor={t.muted} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.label}>體重 (kg)</Text>
                    <TextInput style={styles.input} keyboardType="numeric" value={weightKg} onChangeText={setWeightKg} placeholder="65" placeholderTextColor={t.muted} />
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>醫療紀錄</Text>
                
                <Text style={styles.label}>藥物或食物過敏史</Text>
                <TextInput style={[styles.input, styles.textArea]} multiline value={allergyHistory} onChangeText={setAllergyHistory} placeholder="無，或輸入過敏項目..." placeholderTextColor={t.muted} />

                <Text style={styles.label}>過去重大病史</Text>
                <TextInput style={[styles.input, styles.textArea]} multiline value={pastMedicalHistory} onChangeText={setPastMedicalHistory} placeholder="無，或輸入病史..." placeholderTextColor={t.muted} />

                <Text style={styles.label}>目前服用藥物</Text>
                <TextInput style={[styles.input, styles.textArea]} multiline value={currentMedications} onChangeText={setCurrentMedications} placeholder="無，或輸入目前服用的藥物..." placeholderTextColor={t.muted} />
              </View>

              <TouchableOpacity style={[styles.saveBtn, saving && { backgroundColor: t.muted }]} onPress={handleSave} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>儲存健康資料</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// 樣式改為級距的函式：高齡模式切換時整組跟著變
const makeStyles = (s) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.page },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: s.pad, paddingBottom: s.gapLg, backgroundColor: t.panel, borderBottomWidth: s.border, borderBottomColor: t.border, zIndex: 100 },
  backButton: { paddingRight: s.pad, paddingVertical: 4, minHeight: s.touch, justifyContent: 'center' },
  backIcon: { fontSize: s.title, color: t.text, fontWeight: 'bold' },
  headerTitle: { fontSize: s.subtitle, fontWeight: '900', color: t.text },
  logoutText: { fontSize: s.body, color: t.danger, fontWeight: '600' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: s.padLg },
  guestTitle: { fontSize: s.subtitle, fontWeight: 'bold', color: t.text, marginBottom: 6 },
  guestSub: { fontSize: s.body, color: t.muted, textAlign: 'center', lineHeight: s.lineBody },
  scrollContent: { padding: s.pad, paddingBottom: 40 },
  section: { backgroundColor: t.panel, padding: s.pad, borderRadius: s.radius, marginBottom: s.pad, borderWidth: s.border, borderColor: t.border },
  sectionTitle: { fontSize: s.input, fontWeight: 'bold', color: t.text, marginBottom: s.pad, borderBottomWidth: s.border, borderBottomColor: t.subtle, paddingBottom: s.gap },
  label: { fontSize: s.body, color: t.muted, marginBottom: 6 },
  // 輸入框最小高度用 touch，避免高齡模式下字大了框卻沒跟著長
  input: { backgroundColor: t.page, borderWidth: s.border, borderColor: t.border, borderRadius: s.radius, padding: s.gapLg, fontSize: s.input, color: t.text, marginBottom: s.pad, minHeight: s.touch },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  textArea: { height: s.touch * 2, textAlignVertical: 'top' },
  saveBtn: { backgroundColor: t.userBubble, padding: s.pad, borderRadius: s.radius, alignItems: 'center', marginTop: s.gap, minHeight: s.touch, justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: s.input, fontWeight: 'bold' }
});