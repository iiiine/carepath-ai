// src/screens/ConsultScreen.js
import React, { useState, useContext, useRef, useEffect } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  KeyboardAvoidingView, Platform, ScrollView, Alert, Linking, Image,
  Modal, Animated, TouchableWithoutFeedback, PanResponder
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { AuthContext } from '../context/AuthContext';
import { t } from '../theme';
import client from '../api/client';

const FALLBACK_LOCATION = { latitude: 23.0, longitude: 120.2 };

// 🌟 新增：仿 Gemini 的起伏點點動畫元件
const TypingIndicator = () => {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = () => {
      Animated.loop(
        Animated.stagger(150, [
          Animated.sequence([
            Animated.timing(dot1, { toValue: 1, duration: 250, useNativeDriver: true }),
            Animated.timing(dot1, { toValue: 0, duration: 250, useNativeDriver: true })
          ]),
          Animated.sequence([
            Animated.timing(dot2, { toValue: 1, duration: 250, useNativeDriver: true }),
            Animated.timing(dot2, { toValue: 0, duration: 250, useNativeDriver: true })
          ]),
          Animated.sequence([
            Animated.timing(dot3, { toValue: 1, duration: 250, useNativeDriver: true }),
            Animated.timing(dot3, { toValue: 0, duration: 250, useNativeDriver: true })
          ])
        ])
      ).start();
    };
    animate();
  }, []);

  const getStyle = (dot) => ({
    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }],
    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })
  });

  return (
    <View style={styles.typingContainer}>
      <Animated.View style={[styles.typingDot, getStyle(dot1)]} />
      <Animated.View style={[styles.typingDot, getStyle(dot2)]} />
      <Animated.View style={[styles.typingDot, getStyle(dot3)]} />
    </View>
  );
};

const CollapsibleBox = ({ title, icon, children, defaultExpanded = true, maxHeight = 350 }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <View style={styles.modernCard}>
      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded(!expanded)} style={styles.cardHeaderRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.cardIcon}>{icon}</Text>
          <Text style={styles.resultTitle}>{title}</Text>
        </View>
        <View style={styles.expandBox}>
          <Text style={styles.expandBoxText}>{expanded ? '退出全螢幕' : '全螢幕'}</Text>
        </View>
      </TouchableOpacity>
      {expanded && (
        <>
          <View style={styles.divider} />
          <View style={{ maxHeight: maxHeight }}>
            <ScrollView nestedScrollEnabled={true} contentContainerStyle={{ paddingRight: 4 }}>
              {children}
            </ScrollView>
          </View>
        </>
      )}
    </View>
  );
};

export default function ConsultScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { user, logout } = useContext(AuthContext);
  const scrollViewRef = useRef(); 
  
  const [inputText, setInputText] = useState('');
  // ponytail: 鍵盤彈出時收起快捷標籤與控制列，避免畫面被壓扁
  const [inputFocused, setInputFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [painLevel, setPainLevel] = useState(3);
  
  const [userLocation, setUserLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState('loading');
  const [history, setHistory] = useState([]);
  const [messages, setMessages] = useState([
    { role: 'model', content: '您好！我是您的 AI 健康助理。請先在下方設定不舒服的程度，並跟我描述您的症狀。' }
  ]);
  const [diagnosisResult, setDiagnosisResult] = useState(null);

  const sessionId = route.params?.sessionId;
  const quickSymptoms = ['頭痛', '發燒', '喉嚨痛', '肚子痛', '皮膚起疹', '牙齒痛'];

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const slideAnim = useRef(new Animated.Value(-300)).current; 

  const toggleDrawer = (open) => {
    if (open) {
      setIsDrawerOpen(true);
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: -300, duration: 250, useNativeDriver: true }).start(() => setIsDrawerOpen(false));
    }
  };

  const handleNavigate = (screenName) => {
    toggleDrawer(false);
    setIsNavigating(true);
    setTimeout(() => {
      setIsNavigating(false);
      navigation.navigate(screenName);
    }, 600);
  };

  const edgePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => gestureState.dx > 15 && gestureState.moveX < 40,
      onPanResponderRelease: (evt, gestureState) => { if (gestureState.dx > 30) toggleDrawer(true); }
    })
  ).current;

  const drawerPanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (evt, gestureState) => gestureState.dx < -10,
      onPanResponderRelease: (evt, gestureState) => { if (gestureState.dx < -30) toggleDrawer(false); }
    })
  ).current;

  // 🌟 修改：當 user 發生變化 (例如登出) 時，強制清空所有畫面資料，避免殘留
  useEffect(() => {
    handleResetChat();
  }, [user]);

  useEffect(() => {
    (async () => {
      setLocationStatus('loading');
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setUserLocation(FALLBACK_LOCATION);
          setLocationStatus('fallback');
          return;
        }
        let location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLocation({ latitude: location.coords.latitude, longitude: location.coords.longitude });
        setLocationStatus('success');
      } catch (error) {
        setUserLocation(FALLBACK_LOCATION);
        setLocationStatus('fallback');
      }
    })();
  }, []);

  useEffect(() => {
    if (sessionId) loadHistoricalSession(sessionId);
  }, [sessionId]);

  const loadHistoricalSession = async (id) => {
    try {
      setLoading(true);
      const res = await client.get('/api/v1/history');
      const sessionList = Array.isArray(res.data) ? res.data : [];
      const targetSession = sessionList.find(session => String(session.id) === String(id));
      
      if (!targetSession) {
        Alert.alert('提示', '找不到該筆歷史紀錄');
        return;
      }

      const savedHistory = Array.isArray(targetSession.history) ? targetSession.history : [];
      setMessages(savedHistory.length > 0 ? savedHistory : [{ role: 'model', content: '（尚無對話內容）' }]);
      setHistory(savedHistory);
      setPainLevel(targetSession.pain_level ?? 3);
      
      setDiagnosisResult({
        status: 'completed',
        is_complete: true,
        symptom: targetSession.original_symptom || targetSession.symptom_text || '',
        suggested_department: targetSession.suggested_department || '一般科',
        possible_causes: Array.isArray(targetSession.possible_causes) ? targetSession.possible_causes : [],
        nearby_medical_resources: Array.isArray(targetSession.nearby_medical_resources) ? targetSession.nearby_medical_resources : [],
        message: ''
      });
      
    } catch (error) {
      console.error('讀取歷史紀錄失敗:', error);
      Alert.alert('提示', '無法載入該筆紀錄，請確認網路連線');
    } finally {
      setLoading(false);
    }
  };

  const handleSendMessage = async (textToSubmit = inputText) => {
    if (!textToSubmit.trim() || loading) return;
    const userText = textToSubmit.trim();
    setInputText(''); 
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setLoading(true);

    try {
      const lat = userLocation?.latitude ?? FALLBACK_LOCATION.latitude;
      const lng = userLocation?.longitude ?? FALLBACK_LOCATION.longitude;
      const response = await client.post('/api/v1/diagnose', {
        pain_level: Number(painLevel), symptom_text: userText, user_latitude: lat, user_longitude: lng, history: history
      });

      const data = response.data;
      setMessages(prev => [...prev, { role: 'model', content: data.message }]);
      
      if (!data.is_complete) setHistory(data.history || []);
      else setDiagnosisResult(data);
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', content: '系統連線異常，請確認網路狀態。' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetChat = () => {
    navigation.setParams({ sessionId: undefined });
    setDiagnosisResult(null);
    setHistory([]);
    setMessages([{ role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？' }]);
  };

  const renderMessages = () => (
    messages.map((msg, index) => (
      <View key={index} style={[styles.messageRow, msg.role === 'user' ? styles.messageRowUser : styles.messageRowModel]}>
        {msg.role === 'model' && (
          <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.avatarImage} resizeMode="contain" />
        )}
        <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleModel]}>
          <Text style={msg.role === 'user' ? styles.bubbleTextUser : styles.bubbleTextModel}>{msg.content}</Text>
        </View>
      </View>
    ))
  );

  return (
    <View style={styles.container}>
      
      {!isDrawerOpen && (
        <View {...edgePanResponder.panHandlers} style={styles.edgeTouchZone} />
      )}

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
        <View style={styles.userSection}>
          <TouchableOpacity onPress={() => toggleDrawer(true)} style={styles.menuButton}>
            <Text style={styles.menuIcon}>☰</Text>
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user && !user.is_guest ? user.username.charAt(0).toUpperCase() : '訪'}</Text>
          </View>
          <Text style={styles.headerUser}>{user && !user.is_guest ? user.username : '訪客狀態'}</Text>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {diagnosisResult && (
            <TouchableOpacity onPress={handleResetChat} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>新問診</Text>
            </TouchableOpacity>
          )}
          {user && !user.is_guest ? (
            <TouchableOpacity onPress={logout} style={styles.authButton}>
              <Text style={styles.authButtonText}>登出</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.authButtonPrimary}>
              <Text style={styles.authButtonTextPrimary}>登入</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
        <ScrollView 
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContent}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 1 && !loading && !sessionId && (
            <View style={styles.welcomeSection}>
              <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.mascotImage} resizeMode="contain" />
              <Text style={styles.mainTitle}>今天哪裡不舒服？</Text>
              <Text style={styles.subTitle}>用你自己的話講就好，我會判斷該看哪一科，再幫你找附近的院所。</Text>
            </View>
          )}

          {diagnosisResult ? (
            <View style={styles.resultSection}>
              <CollapsibleBox title="對話紀錄" defaultExpanded={false} maxHeight={300}>
                {renderMessages()}
              </CollapsibleBox>
              <CollapsibleBox title="診斷結果與建議"  defaultExpanded={true}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>推薦科別</Text>
                  <View style={styles.badge}><Text style={styles.badgeText}>{diagnosisResult.suggested_department}</Text></View>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>可能原因</Text>
                  <Text style={styles.infoValue}>{Array.isArray(diagnosisResult.possible_causes) ? diagnosisResult.possible_causes.join('、') : ''}</Text>
                </View>
              </CollapsibleBox>
              <CollapsibleBox title="附近推薦醫療院所" defaultExpanded={true} maxHeight={600}>
                
                {Array.isArray(diagnosisResult.nearby_medical_resources) && diagnosisResult.nearby_medical_resources.length > 0 && (
                  (() => {
                    const topHospital = diagnosisResult.nearby_medical_resources[0];
                    return (
                      <View style={styles.topRecommendCard}>
                        <View style={styles.topRecommendHeader}>
                          <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.topRecommendMascot} resizeMode="contain" />
                          <View style={{ flex: 1 }}>
                            <View style={styles.topRecommendBadgeRow}>
                              <View style={styles.topBadge}><Text style={styles.topBadgeText}>最推薦</Text></View>
                              <Text style={styles.topBadgeSub}>專長最符合、距離最近</Text>
                            </View>
                            <Text style={styles.topHospitalName}>{topHospital.name}</Text>
                            <Text style={styles.topHospitalInfo}>
                              {topHospital.address} 
                              {topHospital.distance_meters != null ? ` · 約 ${(topHospital.distance_meters / 1000).toFixed(1)} 公里` : ''}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.topRecommendActions}>
                          <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${topHospital.latitude},${topHospital.longitude}`)} style={styles.topActionBtnPrimary}>
                            <Text style={styles.topActionBtnTextPrimary}>導航前往</Text>
                          </TouchableOpacity>
                          {topHospital.phone && (
                            <TouchableOpacity onPress={() => Linking.openURL(`tel:${topHospital.phone}`)} style={styles.topActionBtn}>
                              <Text style={styles.topActionBtnText}>撥打電話</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })()
                )}

                <View style={styles.mapCard}>
                  <MapView 
                    provider={PROVIDER_GOOGLE}
                    style={styles.map}
                    initialRegion={{
                      latitude: userLocation?.latitude ?? FALLBACK_LOCATION.latitude,
                      longitude: userLocation?.longitude ?? FALLBACK_LOCATION.longitude,
                      latitudeDelta: 0.02, longitudeDelta: 0.02,
                    }}
                  >
                    <Marker coordinate={{ latitude: userLocation?.latitude ?? FALLBACK_LOCATION.latitude, longitude: userLocation?.longitude ?? FALLBACK_LOCATION.longitude }} title="目前位置" pinColor="red" />
                    {Array.isArray(diagnosisResult.nearby_medical_resources) && diagnosisResult.nearby_medical_resources.map((hospital, idx) => {
                      const hLat = parseFloat(hospital.latitude); const hLng = parseFloat(hospital.longitude);
                      if (isNaN(hLat) || isNaN(hLng)) return null;
                      return <Marker key={idx} coordinate={{ latitude: hLat, longitude: hLng }} title={hospital.name} description={hospital.address} pinColor="blue" />;
                    })}
                  </MapView>
                </View>

                {Array.isArray(diagnosisResult.nearby_medical_resources) && diagnosisResult.nearby_medical_resources.map((hospital, idx) => {
                  const hasBookingUrl = hospital.booking_url?.trim() && /^https?:\/\//i.test(hospital.booking_url?.trim());
                  return (
                    <View key={idx} style={[styles.modernCard, { marginBottom: 12, shadowOpacity: 0.02, elevation: 1 }]}>
                      <View style={styles.hospitalHeaderRow}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text style={styles.hospitalName}>{hospital.name}</Text>
                          <Text style={styles.hospitalInfo}>{hospital.address}</Text>
                        </View>
                        {hasBookingUrl && (
                          <TouchableOpacity onPress={() => Linking.openURL(hospital.booking_url)} style={styles.bookingBtn}>
                            <Text style={styles.bookingBtnText}>線上掛號</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <View style={styles.hospitalActions}>
                        {hospital.phone && (
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${hospital.phone}`)} style={styles.actionBtn}>
                            <Text style={styles.actionBtnText}>📞 撥打電話</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${hospital.latitude},${hospital.longitude}`)} style={[styles.actionBtn, styles.actionBtnPrimary]}>
                          <Text style={styles.actionBtnTextPrimary}>🗺️ 開啟導航</Text>
                        </TouchableOpacity>
                      </View>
                      {hospital.available_doctors && hospital.available_doctors.length > 0 && (
                        <View style={styles.doctorSection}>
                          <Text style={styles.doctorSectionTitle}>推薦駐診醫師</Text>
                          {hospital.available_doctors.map((doc, dIdx) => (
                            <View key={dIdx} style={styles.doctorRow}>
                              <Text style={styles.doctorName}>{doc.name} 醫師</Text>
                              <Text style={styles.doctorSpecialty}>專長：{doc.specialty}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
              </CollapsibleBox>
            </View>
          ) : (
            <>
              {renderMessages()}
              {/* 🌟 替換：使用新寫好的 TypingIndicator 點點動畫 */}
              {loading && (
                <View style={[styles.messageRow, styles.messageRowModel]}>
                  <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.avatarImage} resizeMode="contain" />
                  <View style={[styles.bubble, styles.bubbleModel, { paddingVertical: 14 }]}>
                    <TypingIndicator />
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {!diagnosisResult && (
          <View style={styles.bottomSection}>
            {!inputFocused && (
              <View style={styles.quickTags}>
                {quickSymptoms.map((sym, i) => (
                  <TouchableOpacity key={i} style={styles.tag} onPress={() => handleSendMessage(sym)}>
                    <Text style={styles.tagText}>{sym}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.inputBox}>
              <TextInput
                style={styles.textInput}
                placeholder="傳訊息給助理..."
                placeholderTextColor={t.muted}
                value={inputText}
                onChangeText={setInputText}
                onSubmitEditing={() => handleSendMessage(inputText)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
              <TouchableOpacity 
                style={[styles.sendButton, (!inputText.trim() || loading) && { backgroundColor: t.subtle }]}
                onPress={() => handleSendMessage(inputText)}
                disabled={!inputText.trim() || loading}
              >
                <Text style={[styles.sendIcon, (!inputText.trim() || loading) && { color: t.muted }]}>↑</Text>
              </TouchableOpacity>
            </View>
            
            {!inputFocused && (
            <View style={styles.controlsRow}>
              <Text style={[styles.controlBadge, locationStatus === 'success' && { color: t.userBubble, borderColor: t.userBubble }]}>
                {locationStatus === 'loading' ? '📍 定位中...' : locationStatus === 'success' ? '📍 已定位' : '📍 備援定位'}
              </Text>
              <TouchableOpacity onPress={() => setPainLevel(p => (p >= 5 ? 1 : p + 1))}>
                <Text style={[styles.controlBadge, painLevel >= 4 && { color: t.danger, fontWeight: 'bold', borderColor: t.danger }]}>
                  不適度 {painLevel}
                </Text>
              </TouchableOpacity>
            </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={isDrawerOpen} transparent={true} animationType="none" onRequestClose={() => toggleDrawer(false)}>
        <View style={styles.drawerOverlay}>
          <TouchableWithoutFeedback onPress={() => toggleDrawer(false)}>
            <View style={styles.drawerBackdrop} />
          </TouchableWithoutFeedback>
          <Animated.View {...drawerPanResponder.panHandlers} style={[styles.drawerContent, { transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>智慧醫療選單</Text>
            </View>
            <TouchableOpacity style={styles.drawerItem} onPress={() => { toggleDrawer(false); handleResetChat(); }}>
              <Text style={styles.drawerItemText}>AI 問診</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerItem} onPress={() => handleNavigate('Dashboard')}>
              <Text style={styles.drawerItemText}>個人化健康儀表板</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerItem} onPress={() => handleNavigate('HistoryList')}>
              <Text style={styles.drawerItemText}>歷史問診紀錄</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.drawerItem} onPress={() => handleNavigate('Profile')}>
              <Text style={styles.drawerItemText}>個人化健康資料</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.page },
  edgeTouchZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 25, zIndex: 99 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: t.border, zIndex: 100 },
  userSection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuButton: { paddingRight: 4, paddingVertical: 4 },
  menuIcon: { fontSize: 24, color: t.text, fontWeight: '900' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: t.userBubble, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  headerUser: { fontSize: 16, fontWeight: '700', color: t.text },
  authButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: t.subtle, borderWidth: 1, borderColor: t.border },
  authButtonText: { fontSize: 13, color: t.text, fontWeight: 'bold' },
  authButtonPrimary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#1A1A1A' },
  authButtonTextPrimary: { fontSize: 13, color: '#ffffff', fontWeight: 'bold' },
  resetButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.border },
  resetButtonText: { fontSize: 13, color: t.text, fontWeight: 'bold' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 30, paddingTop: 20 },
  welcomeSection: { alignItems: 'center', marginTop: 40 },
  mascotImage: { width: 90, height: 90, marginBottom: 16 },
  mainTitle: { fontSize: 24, fontWeight: '900', color: t.text, marginBottom: 8 },
  subTitle: { fontSize: 14, color: t.muted, textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },
  messageRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowModel: { justifyContent: 'flex-start' },
  avatarImage: { width: 32, height: 32, marginRight: 8, borderRadius: 16, marginTop: 4 },
  bubble: { maxWidth: '82%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleUser: { backgroundColor: '#1E293B', borderBottomRightRadius: 4 },
  bubbleModel: { backgroundColor: '#ffffff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: t.border },
  bubbleTextUser: { color: '#ffffff', fontSize: 15, lineHeight: 24 },
  bubbleTextModel: { color: t.text, fontSize: 15, lineHeight: 24 },
  
  // 🌟 打字動畫樣式
  typingContainer: { flexDirection: 'row', alignItems: 'center', height: 18, paddingHorizontal: 4, gap: 6, marginTop: 2 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#94A3B8' },

  resultSection: { gap: 12 },
  modernCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardIcon: { fontSize: 20, marginRight: 8 },
  resultTitle: { fontSize: 17, fontWeight: '800', color: t.text },
  expandBox: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 6, backgroundColor: '#FAFAFA' },
  expandBoxText: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  divider: { height: 1, backgroundColor: t.border, marginVertical: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  infoLabel: { fontSize: 14, fontWeight: 'bold', color: t.muted, width: 70, marginTop: 4 },
  infoValue: { flex: 1, fontSize: 15, color: t.text, lineHeight: 24, fontWeight: '600' },
  badge: { backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

  topRecommendCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#1E293B', padding: 16, marginBottom: 16 },
  topRecommendHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  topRecommendMascot: { width: 44, height: 44, marginRight: 12 },
  topRecommendBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  topBadge: { backgroundColor: '#1E293B', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 6 },
  topBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: 'bold' },
  topBadgeSub: { fontSize: 11, color: t.muted, fontWeight: '600' },
  topHospitalName: { fontSize: 18, fontWeight: '900', color: t.text, marginBottom: 4 },
  topHospitalInfo: { fontSize: 13, color: t.muted },
  topRecommendActions: { flexDirection: 'row', gap: 12 },
  topActionBtnPrimary: { flex: 1, backgroundColor: '#1E293B', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  topActionBtnTextPrimary: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  topActionBtn: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.border, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  topActionBtnText: { color: t.text, fontSize: 14, fontWeight: 'bold' },

  mapCard: { height: 200, borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: t.border },
  map: { width: '100%', height: '100%' },
  hospitalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  hospitalName: { fontSize: 17, fontWeight: '900', color: t.text, marginBottom: 6 },
  hospitalInfo: { fontSize: 14, color: t.muted, lineHeight: 20 },
  bookingBtn: { backgroundColor: '#1A1A1A', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  bookingBtnText: { color: '#ffffff', fontSize: 13, fontWeight: 'bold' },
  hospitalActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: '#FAFAFA' },
  actionBtnText: { fontSize: 14, color: t.text, fontWeight: '700' },
  actionBtnPrimary: { backgroundColor: t.userBubble, borderColor: t.userBubble },
  actionBtnTextPrimary: { fontSize: 14, color: '#fff', fontWeight: '700' },
  doctorSection: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.subtle },
  doctorSectionTitle: { fontSize: 13, fontWeight: '800', color: t.muted, marginBottom: 10 },
  doctorRow: { backgroundColor: '#FAFAFA', padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  doctorName: { fontSize: 15, fontWeight: '800', color: t.text, marginBottom: 4 },
  doctorSpecialty: { fontSize: 14, color: t.muted, lineHeight: 20 },

  bottomSection: { padding: 16, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: t.border },
  quickTags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 16 },
  tag: { backgroundColor: '#FAFAFA', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: t.border },
  tagText: { fontSize: 14, color: t.text, fontWeight: '600' },
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 6, borderWidth: 1, borderColor: t.border, marginBottom: 12 },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 10, color: t.text },
  sendButton: { backgroundColor: '#1A1A1A', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  sendIcon: { fontSize: 18, color: '#fff', fontWeight: 'bold' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  controlBadge: { fontSize: 12, color: t.muted, backgroundColor: '#FAFAFA', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: t.border },

  drawerOverlay: { flex: 1, flexDirection: 'row' },
  drawerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  drawerContent: { width: 270, height: '100%', backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 10, padding: 24 },
  drawerHeader: { marginTop: 40, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: t.border, marginBottom: 12 },
  drawerTitle: { fontSize: 22, fontWeight: '900', color: t.text },
  drawerItem: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)' },
  drawerItemText: { fontSize: 16, fontWeight: '700', color: t.text },
});