// src/screens/LoginScreen.js
import React, { useState, useContext } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  ActivityIndicator, Image, Alert, KeyboardAvoidingView, Platform, ScrollView 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AuthContext } from '../context/AuthContext';
import client from '../api/client';
import Icon from '@react-native-vector-icons/material-design-icons';

export default function LoginScreen() {
  const navigation = useNavigation();
  const { login } = useContext(AuthContext);

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loading, setLoading] = useState(false);

  // 表單欄位
  const [identifier, setIdentifier] = useState(''); 
  const [username, setUsername] = useState('');     
  const [email, setEmail] = useState('');           
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleApiError = (error, defaultTitle) => {
    if (error.response?.status === 422) {
      const details = error.response.data.detail;
      const messages = Array.isArray(details) 
        ? details.map(err => `[${err.loc[err.loc.length - 1]}] 欄位: ${err.msg}`).join('\n')
        : JSON.stringify(details);
      Alert.alert('資料格式不符 (422)', messages);
    } else {
      Alert.alert(defaultTitle, error.response?.data?.detail || '伺服器連線異常，請檢查網路');
    }
  };

  const handleSubmit = async () => {
    if (isRegisterMode) {
      // ===========================
      // 📝 處理註冊
      // ===========================
      if (!username.trim() || !email.trim() || !password || !confirmPassword) {
        Alert.alert('錯誤', '請填寫所有欄位');
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert('錯誤', '兩次密碼輸入不一致');
        return;
      }
      
      try {
        setLoading(true);
        // 1. 畫面負責呼叫註冊 API
        await client.post('/api/v1/auth/register', {
          username: username.trim(),
          email: email.trim(),
          password: password
        });
        
        // 2. 註冊成功後，直接拿剛註冊的帳密交給你的 AuthContext 登入
        await login(username.trim(), password);
        navigation.goBack(); 
      } catch (error) {
        handleApiError(error, '註冊失敗');
      } finally {
        setLoading(false);
      }

    } else {
      // ===========================
      // 🔑 處理登入
      // ===========================
      if (!identifier.trim() || !password) {
        Alert.alert('錯誤', '請填寫帳號與密碼');
        return;
      }

      try {
        setLoading(true);
        
        // 🌟 關鍵修復：直接將帳號密碼交給 AuthContext 處理！
        // 絕對不要在這裡呼叫 client.post('/login')，避免發送兩次 API 導致參數錯位
        await login(identifier.trim(), password);
        
        navigation.goBack(); 
      } catch (error) {
        // 如果你的 AuthContext 裡面的 login 有拋出錯誤，這裡會接住
        handleApiError(error, '登入失敗');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="關閉登入視窗"
            accessibilityRole="button"
          >
            <Icon name="close" size={22} color="#6B7280" />
          </TouchableOpacity>

          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>成功連線</Text>
          </View>

          <View style={styles.headerRow}>
            <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.mascot} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={styles.mainTitle}>CarePath AI</Text>
              <Text style={styles.subTitle}>登入帳號後可使用個人化健康資訊功能</Text>
            </View>
          </View>

          {isRegisterMode ? (
            <>
              <Text style={styles.inputLabel}>使用者帳號</Text>
              <TextInput style={styles.input} placeholder="例如：ziyan" value={username} onChangeText={setUsername} autoCapitalize="none" />
              
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput style={styles.input} placeholder="name@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              
              <Text style={styles.inputLabel}>密碼</Text>
              <TextInput style={styles.input} placeholder="至少 8 個字元" value={password} onChangeText={setPassword} secureTextEntry />

              <Text style={styles.inputLabel}>確認密碼</Text>
              <TextInput style={styles.input} placeholder="再輸入一次密碼" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
            </>
          ) : (
            <>
              <Text style={styles.inputLabel}>帳號或 Email</Text>
              <TextInput style={styles.input} placeholder="請輸入帳號或信箱" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" />
              
              <Text style={styles.inputLabel}>密碼</Text>
              <TextInput style={styles.input} placeholder="請輸入密碼" value={password} onChangeText={setPassword} secureTextEntry />
            </>
          )}

          <TouchableOpacity style={styles.primaryButton} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{isRegisterMode ? '建立帳號' : '登入系統'}</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>或</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.toggleModeButton} onPress={() => setIsRegisterMode(!isRegisterMode)}>
            <Text style={styles.toggleModeText}>
              {isRegisterMode ? '已經有帳號？ ' : '還沒有帳號？ '}
              <Text style={styles.toggleModeHighlight}>{isRegisterMode ? '返回登入' : '立即註冊'}</Text>
            </Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F3F4F6' },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  closeButton: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  closeIcon: { fontSize: 20, color: '#6B7280', lineHeight: 22 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 5 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E7EB', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 20 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginRight: 8 },
  statusText: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  mascot: { width: 60, height: 60, marginRight: 16 },
  mainTitle: { fontSize: 20, fontWeight: '900', color: '#111827', marginBottom: 4 },
  subTitle: { fontSize: 13, color: '#6B7280', lineHeight: 18 },
  inputLabel: { fontSize: 14, fontWeight: '700', color: '#374151', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', marginBottom: 16, backgroundColor: '#FFFFFF' },
  primaryButton: { backgroundColor: '#1A1A1A', borderRadius: 8, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E5E7EB' },
  dividerText: { marginHorizontal: 12, fontSize: 13, color: '#9CA3AF' },
  toggleModeButton: { marginTop: 12, alignItems: 'center' },
  toggleModeText: { fontSize: 14, color: '#6B7280' },
  toggleModeHighlight: { fontWeight: 'bold', color: '#111827', textDecorationLine: 'underline' }
});