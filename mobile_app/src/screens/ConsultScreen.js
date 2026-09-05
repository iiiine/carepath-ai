// src/screens/ConsultScreen.js
import React, { useState, useContext, useRef, useEffect, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  KeyboardAvoidingView, Platform, ScrollView, Alert, Linking, Image,
  Modal, Animated, TouchableWithoutFeedback, PanResponder, Pressable, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import NearbyHospitalMap from '../components/NearbyHospitalMap';

import { AuthContext } from '../context/AuthContext';
import { t } from '../theme';
import { useElderMode } from '../context/ElderModeContext';
import Icon from '@react-native-vector-icons/material-design-icons';
import client from '../api/client';
import VisitSummaryPanel from './VisitSummaryPanel';

const FALLBACK_LOCATION = { latitude: 23.0, longitude: 120.2 };

// ============================================================
// 快捷症狀
// ============================================================
//
// 預設值：新會員、訪客、或縱向分析取不到資料時使用。
// 個人化：會員的「常問症狀」排在前面，不足的名額用預設值補齊。
//
// 之所以是補齊而不是整組替換：後端 analyze_recurring_symptoms()
// 要求同一症狀出現兩次以上才算常問，因此新會員會有很長一段時間
// 拿到空陣列。整組替換會讓快捷列時有時無，補齊制則讓新會員看到的
// 畫面跟現在完全一樣。
// ============================================================

const DEFAULT_QUICK_SYMPTOMS = ['頭痛', '發燒', '喉嚨痛', '肚子痛', '皮膚起疹', '牙齒痛'];

const QUICK_SYMPTOM_LIMIT = 6;

// 縱向分析的時間窗。快捷標籤只需要近期習慣，不必拉滿 365 天。
const QUICK_SYMPTOM_WINDOW_DAYS = 90;

// 純函式：合併常問症狀與預設值，回傳含來源標記的清單。
// personalized 供畫面決定要不要上淡底色，不影響送出的文字。
// 後端已依 session_count 由多到少排序，這裡不重排。
const mergeQuickSymptoms = (recurringSymptoms) => {
  const merged = [];
  const seen = new Set();

  const push = (label, personalized) => {
    const text = typeof label === 'string' ? label.trim() : '';
    if (!text || seen.has(text)) return;
    seen.add(text);
    merged.push({ label: text, personalized });
  };

  (Array.isArray(recurringSymptoms) ? recurringSymptoms : []).forEach((item) => push(item?.symptom, true));
  DEFAULT_QUICK_SYMPTOMS.forEach((label) => push(label, false));

  return merged.slice(0, QUICK_SYMPTOM_LIMIT);
};

// 仿 Gemini 的起伏點點動畫元件
const TypingIndicator = () => {
  const { s } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
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

// 摺疊/全螢幕包裝元件
const CollapsibleBox = ({ title, icon, children, defaultExpanded = true, maxHeight = 350 }) => {
  // 級距直接取自 context，不再由外部傳 isElder 進來
  const { elderMode, s } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <View style={styles.modernCard}>
      <TouchableOpacity activeOpacity={0.7} onPress={() => setExpanded(!expanded)} style={styles.cardHeaderRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.cardIcon}>{icon}</Text>
          <Text style={styles.resultTitle}>{title}</Text>
        </View>
        <View style={styles.expandBox}>
          <Text style={styles.expandBoxText}>{expanded ? '收合' : '展開'}</Text>
        </View>
      </TouchableOpacity>
      {expanded && (
        <>
          <View style={styles.divider} />
          <View style={{ maxHeight: elderMode ? maxHeight * 1.5 : maxHeight }}>
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

  // 🎯 亮點功能狀態：高齡友善、安全阻斷、就醫摘要Modal
  // 高齡友善模式已抽到 context，所有畫面共用同一個開關
  const { elderMode, s, toggleElderMode } = useElderMode();
  const styles = useMemo(() => makeStyles(s), [s]);
  const [safetyAlert, setSafetyAlert] = useState(null);
  const [summaryModalVisible, setSummaryModalVisible] = useState(false);

  // 🎯 核心修復：如果沒有資料庫 sessionId (例如訪客問診)，就採用臨時本地快取，確保訪客也能看摘要！
  const [tempSummaryData, setTempSummaryData] = useState(null);

  const sessionId = route.params?.sessionId || diagnosisResult?.session_id;
  // 快捷標籤：只存後端回來的常問症狀原始資料，實際清單由 useMemo 推導。
  //
  // 連同 userId 一起存的理由：訪客、登出、換帳號都只要靠推導條件擋掉，
  // 不需要在 effect 裡同步 setState 清空（那會造成串聯 render），
  // 也不會讓上一個帳號的常問症狀閃現在下一個帳號的畫面上。
  const [recurringSymptoms, setRecurringSymptoms] = useState({ userId: null, items: [] });

  const isMember = !!user && !user.is_guest;

  // 先渲染預設值，個人化資料回來後再換掉。
  // 刻意不擋畫面：問診是主要入口，快捷標籤不值得讓使用者等一個網路來回。
  const quickSymptoms = useMemo(
    () => mergeQuickSymptoms(
      isMember && recurringSymptoms.userId === user?.id ? recurringSymptoms.items : []
    ),
    [isMember, recurringSymptoms, user?.id]
  );

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const slideAnim = useRef(new Animated.Value(-300)).current; 

  // onClosed 會在關閉動畫真的跑完、Modal 也卸載之後才呼叫
  const toggleDrawer = (open, onClosed) => {
    if (open) {
      setIsDrawerOpen(true);
      Animated.timing(slideAnim, { toValue: 0, duration: 250, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: -300, duration: 250, useNativeDriver: true }).start(() => {
        setIsDrawerOpen(false);
        if (onClosed) onClosed();
      });
    }
  };

  const handleNavigate = (screenName) => {
    // ponytail: 一定要等抽屜的 Modal 真的關掉再跳頁，不用 setTimeout 猜時間。
    // 側邊欄放在 Modal 裡，若 Modal 尚未卸載就導覽，它會蓋在新畫面上方，
    // 使用者看到的就是一片空白。之前的假等 600ms 只是碰巧蓋過這個競態。
    // 也不再顯示「跳轉中」浮層——目的地畫面自己會顯示載入狀態。
    toggleDrawer(false, () => navigation.navigate(screenName));
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

  useEffect(() => {
    handleResetChat();
  }, [user]);

  // 讀取會員常問症狀，填入快捷標籤。
  // 訪客不打這支 API——後端一定回 403，沒必要每次進畫面都製造一筆失敗請求。
  // 任何失敗都靜默不處理：清單自然維持預設值，快捷標籤是輔助功能，不該干擾問診。
  useEffect(() => {
    if (!isMember) return;

    const userId = user?.id;
    let cancelled = false;

    (async () => {
      try {
        const response = await client.get('/api/v1/longitudinal', {
          params: { window_days: QUICK_SYMPTOM_WINDOW_DAYS },
        });
        if (cancelled) return;
        if (response.data?.status !== 'success') return;
        setRecurringSymptoms({ userId, items: response.data.recurring_symptoms || [] });
      } catch (err) {
        if (!cancelled) {
          console.log('⚠️ 常問症狀載入失敗，快捷標籤退回預設值', err?.response?.status || err?.message);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [isMember, user?.id]);

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
    if (route.params?.sessionId) loadHistoricalSession(route.params.sessionId);
  }, [route.params?.sessionId]);

  const loadHistoricalSession = async (id) => {
    try {
      setLoading(true);
      setLoadingHistory(true);
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
      setSafetyAlert(null);
      
      setDiagnosisResult({
        session_id: id,
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
      setLoadingHistory(false);
    }
  };

  const handleSendMessage = async (textToSubmit = inputText) => {
    if (!textToSubmit.trim() || loading || safetyAlert) return;
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
      
      // 🎯 安全優先設計：緊急安全阻斷
      if (data.status === 'safety_alert') {
        setSafetyAlert(data);
        setMessages(prev => [...prev, { role: 'model', content: data.message }]);
        setHistory(data.history || []);
        setLoading(false);
        return;
      }

      setMessages(prev => [...prev, { role: 'model', content: data.message }]);
      
      if (!data.is_complete) {
        setHistory(data.history || []);
      } else {
        setDiagnosisResult(data);

        // 🎯 核心優化：新問診結束後，如果後端沒有生成 session_id (例如訪客)，
        // 則直接為 VisitSummaryPanel 組裝本次的暫存摘要資料，達到100%平權體驗！
        if (!data.session_id) {
          const user_age = user && !user.is_guest ? (user.age || '未填') : '未提供';
          const user_gender = user && !user.is_guest ? (user.gender || '未填') : '未提供';

          setTempSummaryData({
            status: "success",
            summary: {
              session_id: null,
              session_created_at: new Date().toISOString(),
              chief_complaint: data.symptom || userText,
              pain_level: Number(painLevel),
              recommended_department: data.suggested_department || '一般科',
              possible_causes: Array.isArray(data.possible_causes) ? data.possible_causes : [],
              possible_causes_disclaimer: "以上僅為 AI 初步分流評估，並非最終疾病診斷。",
              handoff_text: `【CarePath AI 臨床分流摘要】\n主訴症狀：${data.symptom || userText}\n自評不適度：${painLevel}/5\n建議就診科別：${data.suggested_department || '一般科'}\n可能原因：${(data.possible_causes || []).join('、')}\n\n* 請將此摘要出示給醫療診間護理人員或醫師參考。`,
              disclaimer: "此摘要僅供就醫溝通參考，不能取代醫師問診、檢查與正式診斷。",
              safety: {
                risk_level: "standard",
                risk_label: "一般",
                safety_action: "目前安全篩檢無即時高危險警訊，可依推薦科別就醫諮詢。",
                red_flags: []
              },
              patient_context: {
                has_profile_data: false,
                age: user_age,
                biological_sex: user_gender,
                allergies: [],
                medications: [],
                chronic_conditions: []
              },
              symptom_course: {
                patient_statements: [data.symptom || userText]
              }
            }
          });
        } else {
          setTempSummaryData(null); // 會員正常走 API 加載
        }
      }
    } catch (error) {
      setMessages(prev => [...prev, { role: 'model', content: '系統連線異常，請確認網路狀態。' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetChat = () => {
    navigation.setParams({ sessionId: undefined });
    setDiagnosisResult(null);
    setSafetyAlert(null);
    setTempSummaryData(null); // 重設暫存摘要
    setHistory([]);
    setMessages([{ role: 'model', content: '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？' }]);
  };

  const handleNearbyEmergency = () => {
    const lat = userLocation?.latitude ?? FALLBACK_LOCATION.latitude;
    const lng = userLocation?.longitude ?? FALLBACK_LOCATION.longitude;
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=急診+${lat},${lng}`);
  };

  // 渲染氣泡，如果是高齡模式，除最後一筆外淡化
  const renderMessages = () => {
    const latestModelIdx = messages.reduce((acc, msg, i) => msg.role === 'model' ? i : acc, -1);
    
    return messages.map((msg, index) => {
      const isLatestModel = msg.role === 'model' && index === latestModelIdx;
      const isUser = msg.role === 'user';
      
      return (
        <View 
          key={index} 
          style={[
            styles.messageRow, 
            isUser ? styles.messageRowUser : styles.messageRowModel,
            elderMode && !isLatestModel && { opacity: 0.4 } // 高齡模式非當前問話淡化
          ]}
        >
          {msg.role === 'model' && (
            <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.avatarImage} resizeMode="contain" />
          )}
          <View 
            style={[
              styles.bubble, 
              isUser ? styles.bubbleUser : styles.bubbleModel,
              isLatestModel && elderMode && styles.bubbleLatestModelElder // 高齡當前突顯
            ]}
          >
            <Text 
              style={[
                isUser ? styles.bubbleTextUser : styles.bubbleTextModel,
                isLatestModel && elderMode && styles.bubbleTextLatestModelElder
              ]}
            >
              {msg.content}
            </Text>
          </View>
        </View>
      );
    });
  };

  return (
    <View style={styles.container}>
      
      {!isDrawerOpen && (
        <View {...edgePanResponder.panHandlers} style={styles.edgeTouchZone} />
      )}

      {/* 頂部標題 */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
        <View style={styles.userSection}>
          <TouchableOpacity
            onPress={() => toggleDrawer(true)}
            style={styles.menuButton}
            accessibilityLabel="開啟選單"
            accessibilityRole="button"
          >
            <Icon name="menu" size={s.title} color={t.text} />
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user && !user.is_guest ? user.username.charAt(0).toUpperCase() : '訪'}</Text>
          </View>
          <Text style={styles.headerUser}>
            {user && !user.is_guest ? user.username : '訪客模式'}
          </Text>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          {/* 高齡友善快速切換按鈕 */}
          <TouchableOpacity 
            onPress={toggleElderMode} 
            style={[styles.elderToggleBtn, elderMode && styles.elderToggleBtnActive]}
            accessibilityLabel="高齡友善模式"
            accessibilityRole="switch"
            accessibilityState={{ checked: elderMode }}
          >
            <Text style={[styles.elderToggleText, elderMode && styles.elderToggleTextActive]}>
              {elderMode ? '✓ 簡易大字' : '高齡友善'}
            </Text>
          </TouchableOpacity>

          {(diagnosisResult || safetyAlert) && (
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
          contentContainerStyle={[styles.scrollContent]}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 1 && !loading && !route.params?.sessionId && (
            <View style={styles.welcomeSection}>
              <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.mascotImage} resizeMode="contain" />
              <Text style={styles.mainTitle}>今天哪裡不舒服？</Text>
              <Text style={styles.subTitle}>
                用您自己的話說就好，我會幫您判斷看哪一科，再找附近的醫院診所。
              </Text>
            </View>
          )}

          {/* 🎯 安全優先設計：緊急安全阻斷看板 */}
          {safetyAlert && (
            <View style={styles.safetyAlertContainer}>
              <View style={styles.safetyHeaderRow}>
                <View style={styles.safetyAlertIcon}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 20 }}>!</Text></View>
                <Text style={styles.safetyAlertTitle}>醫療安全風險警報</Text>
                <View style={styles.safetyBadge}><Text style={styles.safetyBadgeText}>緊急</Text></View>
              </View>

              <Text style={styles.safetyMessage}>
                {safetyAlert.safety?.safety_action || safetyAlert.message}
              </Text>

              {Array.isArray(safetyAlert.safety?.red_flags) && safetyAlert.safety.red_flags.length > 0 && (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.redFlagHeader}>偵測到的緊急症狀：</Text>
                  {safetyAlert.safety.red_flags.map((flag, idx) => (
                    <View key={idx} style={styles.redFlagItem}>
                      <Text style={styles.redFlagTitle}>• {flag.title || flag.code}</Text>
                      {flag.reason && <Text style={styles.redFlagDesc}>{flag.reason}</Text>}
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.safetyActionsRow}>
                <TouchableOpacity
                  onPress={handleNearbyEmergency}
                  style={styles.safetyActionBtnPrimary}
                  accessibilityLabel="搜尋最近急診"
                  accessibilityRole="button"
                >
                  <Icon name="map-marker-radius" size={16} color="#FFFFFF" />
                  <Text style={styles.safetyActionTextPrimary}>搜尋最近急診</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Linking.openURL('tel:119')}
                  style={styles.safetyActionBtnDanger}
                  accessibilityLabel="撥打 119 求助"
                  accessibilityRole="button"
                >
                  <Icon name="phone" size={16} color="#FFFFFF" />
                  <Text style={styles.safetyActionTextPrimary}>撥打 119 求助</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={handleResetChat} style={styles.safetyResetBtn}>
                <Text style={styles.safetyResetBtnText}>重新開始問診</Text>
              </TouchableOpacity>
            </View>
          )}

          {diagnosisResult ? (
            <View style={styles.resultSection}>
              {!elderMode && (
                <CollapsibleBox title="對話紀錄" defaultExpanded={false} maxHeight={300}>
                  {renderMessages()}
                </CollapsibleBox>
              )}

              <CollapsibleBox title="診斷結果與建議" defaultExpanded={true}>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>推薦科別</Text>
                  <View style={styles.badge}><Text style={styles.badgeText}>{diagnosisResult.suggested_department}</Text></View>
                </View>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>可能原因</Text>
                  <Text style={styles.infoValue}>{Array.isArray(diagnosisResult.possible_causes) ? diagnosisResult.possible_causes.join('、') : ''}</Text>
                </View>

                {/* 🎯 AI 就醫摘要按鈕：不論有沒有資料庫 sessionId，只要問診完成即 100% 允許點擊！ */}
                {(sessionId || tempSummaryData) && (
                  <TouchableOpacity
                    style={styles.summaryTriggerBtn}
                    onPress={() => setSummaryModalVisible(true)}
                  >
                    <Text style={styles.summaryTriggerText}>
                      📄 開啟本次 AI 就醫摘要 (出示給醫師)
                    </Text>
                  </TouchableOpacity>
                )}
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

                {/* 🎯 地圖修復與定位座標防禦 */}
                  <View style={styles.mapCard}>
                    <NearbyHospitalMap
                      style={styles.map}
                      userLocation={userLocation}
                      fallbackLocation={FALLBACK_LOCATION}
                      hospitals={diagnosisResult.nearby_medical_resources}
                    />
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
                            <Text style={styles.actionBtnText}>撥打電話</Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${hospital.latitude},${hospital.longitude}`)} style={[styles.actionBtn, styles.actionBtnPrimary]}>
                          <Text style={styles.actionBtnTextPrimary}>開啟導航</Text>
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
              {/* 載入歷史紀錄時已有全螢幕浮層，這裡不再重複顯示打字氣泡 */}
              {loading && !loadingHistory && (
                <View style={[styles.messageRow, styles.messageRowModel]}>
                  <Image source={require('../../assets/baymaxicon-nobg.png')} style={styles.avatarImage} resizeMode="contain" />
                  <View style={[styles.bubble, styles.bubbleModel]}>
                    <TypingIndicator />
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {!diagnosisResult && !safetyAlert && (
          <View style={styles.bottomSection}>
            {/* 單行橫向捲動：原本是置中換行，六個標籤會排成參差的 3+3 或 4+2，
                高齡模式字級放大後更亂。改成一行可滑，字級變動也不會重排。 */}
            {!inputFocused && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.quickTagsScroll}
                contentContainerStyle={styles.quickTags}
                keyboardShouldPersistTaps="handled"
              >
                {quickSymptoms.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[styles.tag, item.personalized && styles.tagPersonalized]}
                    onPress={() => setInputText(item.label)}
                    accessibilityRole="button"
                    accessibilityHint="填入輸入框，可再補充描述後送出"
                    accessibilityLabel={item.personalized ? `${item.label}，您常問的症狀` : item.label}
                  >
                    <View style={styles.tagInner}>
                      {item.personalized && (
                        <Icon name="history" size={s.caption + 2} color={t.userBubble} />
                      )}
                      <Text style={[styles.tagText, item.personalized && styles.tagTextPersonalized]}>
                        {item.label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
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
                style={[
                  styles.sendButton,
                  (!inputText.trim() || loading) && { backgroundColor: t.subtle }
                ]}
                onPress={() => handleSendMessage(inputText)}
                disabled={!inputText.trim() || loading}
                accessibilityLabel="送出訊息"
                accessibilityRole="button"
                accessibilityState={{ disabled: !inputText.trim() || loading }}
              >
                <Text style={[styles.sendIcon, (!inputText.trim() || loading) && { color: t.muted }]}>↑</Text>
              </TouchableOpacity>
            </View>
            
            {!inputFocused && (
              <View style={styles.controlsRow}>
                <View style={[styles.controlBadge, styles.controlBadgeRow, locationStatus === 'success' && { borderColor: t.userBubble }]}>
                  <Icon
                    name={locationStatus === 'success' ? 'map-marker-check' : 'map-marker'}
                    size={s.caption + 1}
                    color={locationStatus === 'success' ? t.userBubble : t.muted}
                  />
                  <Text style={[styles.controlBadgeText, locationStatus === 'success' && { color: t.userBubble }]}>
                    {locationStatus === 'loading' ? '定位中...' : locationStatus === 'success' ? '已定位' : '備援定位'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setPainLevel(p => (p >= 5 ? 1 : p + 1))}>
                  <Text style={[styles.controlBadge, painLevel >= 4 && { color: t.danger, fontWeight: 'bold', borderColor: t.danger }]}>
                    不適度 {painLevel} / 5
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      {/* 智慧醫療選單 Drawer */}
      <Modal visible={isDrawerOpen} transparent={true} animationType="none" onRequestClose={() => toggleDrawer(false)}>
        <View style={styles.drawerOverlay}>
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
          {/* ponytail: 側邊欄以外的區域＝一塊可點的遮罩，點了就收起來 */}
          <Pressable style={styles.drawerBackdrop} onPress={() => toggleDrawer(false)} />
        </View>
      </Modal>

      {/* 載入歷史紀錄提示
          用 Modal 而非一般 View：載入由 route.params.sessionId 的 useEffect 觸發，
          此時畫面轉場動畫還在跑，絕對定位的浮層會跟著整個畫面位移。

          padding 用 safe area insets 補償：app.json 開了 edgeToEdgeEnabled，
          Modal 容器會延伸到狀態列與底部導覽列後方，那塊高度看不見卻算進容器，
          直接 justifyContent:'center' 會讓盒子的幾何中心低於視覺中心（偏下）。
          扣掉兩端 inset 之後，置中才是使用者看到的正中央。 */}
      <Modal
        visible={loadingHistory}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View
          style={[
            styles.navigatingOverlay,
            { paddingTop: insets.top, paddingBottom: insets.bottom },
          ]}
        >
          <View style={styles.navigatingBox}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.navigatingText}>載入紀錄中...</Text>
          </View>
        </View>
      </Modal>

      {/* 🎯 AI 就醫摘要 Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={summaryModalVisible}
        onRequestClose={() => setSummaryModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: t.page, paddingTop: Platform.OS === 'ios' ? 44 : 20 }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>AI 就醫摘要</Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setSummaryModalVisible(false)}>
              <Text style={styles.modalCloseBtnText}>關閉</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{ flex: 1 }}>
            {/* 🎯 核心修復：如果 tempSummaryData 存在，優先在 VisitSummaryPanel 中直接渲染暫存資料；否則正常拉取 API */}
            <VisitSummaryPanel sessionId={sessionId} tempSummaryData={tempSummaryData} />
          </View>
        </View>
      </Modal>

    </View>
  );
}

// 樣式改為級距的函式：高齡模式切換時整組跟著變，
// 原本 23 個 *Elder 變體與散落的 inline 條件式因此不再需要。
const makeStyles = (s) => StyleSheet.create({
  container: { flex: 1, backgroundColor: s.pageBg },
  edgeTouchZone: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 25, zIndex: 99 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: s.pad, paddingBottom: s.gapLg, backgroundColor: t.panel, borderBottomWidth: s.dividerWidth, borderBottomColor: s.dividerColor, boxShadow: s.dividerShadow, zIndex: 100 },
  userSection: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // 原本只有 4px padding，實際觸控區遠小於可靠點擊所需，長輩只能靠邊緣滑動。
  // 補到 s.touch 並加淡底色，讓它是一個看得出來、按得到的目標。
  menuButton: { width: s.touch, height: s.touch, marginLeft: -6, borderRadius: s.radius, backgroundColor: t.subtle, alignItems: 'center', justifyContent: 'center' },
  menuIcon: { fontSize: s.title, color: t.text, fontWeight: '900' },
  avatar: { width: s.touch - 14, height: s.touch - 14, borderRadius: (s.touch - 14) / 2, backgroundColor: t.userBubble, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: s.caption, fontWeight: 'bold' },
  headerUser: { fontSize: s.input, fontWeight: '700', color: t.text },
  resetButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.border },
  resetButtonText: { fontSize: s.caption, color: t.text, fontWeight: 'bold' },
  
  // 🎯 恢復登入登出按鈕樣式
  authButton: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: t.subtle, borderWidth: 1, borderColor: t.border },
  authButtonText: { fontSize: s.caption, color: t.text, fontWeight: 'bold' },
  authButtonPrimary: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#1A1A1A' },
  authButtonTextPrimary: { fontSize: s.caption, color: '#ffffff', fontWeight: 'bold' },

  // 🎯 高齡友善按鈕樣式
  elderToggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE' },
  elderToggleBtnActive: { backgroundColor: '#1E293B', borderColor: '#1E293B' },
  elderToggleText: { fontSize: s.caption, color: '#2563EB', fontWeight: 'bold' },
  elderToggleTextActive: { color: '#FFFFFF' },

  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: s.pad, paddingBottom: 30, paddingTop: s.padLg },
  welcomeSection: { alignItems: 'center', marginTop: 40 },
  mascotImage: { width: s.touch * 2, height: s.touch * 2, marginBottom: s.pad },
  mainTitle: { fontSize: s.title, fontWeight: '900', color: s.textStrong, marginBottom: 8, textAlign: 'center', lineHeight: s.lineTitle },
  subTitle: { fontSize: s.body, color: t.muted, textAlign: 'center', lineHeight: s.lineBody, paddingHorizontal: s.padLg, marginTop: s.gap },
  
  messageRow: { flexDirection: 'row', marginBottom: 16, alignItems: 'flex-start' },
  messageRowUser: { justifyContent: 'flex-end' },
  messageRowModel: { justifyContent: 'flex-start' },
  // 頭像原本是固定 32px、固定 marginTop: 4，不隨級距變動，
  // 因此氣泡的 padding 與行高一放大，頭像就對不到第一行文字。
  // 改為由級距推算：
  //   頭像中心 = marginTop + 頭像高/2
  //   文字中心 = 氣泡上緣 padding + 行高/2
  // 兩者相等即對齊，一般與高齡模式都成立。
  avatarImage: {
    width: s.touch - 12,
    height: s.touch - 12,
    borderRadius: (s.touch - 12) / 2,
    marginRight: s.gap,
    marginTop: s.gapLg + s.lineSubtitle / 2 - (s.touch - 12) / 2,
  },
  bubble: { maxWidth: '82%', paddingHorizontal: s.pad, paddingVertical: s.gapLg, borderRadius: s.radiusLg },
  bubbleUser: { backgroundColor: '#1E293B', borderBottomRightRadius: 4 },
  bubbleModel: { backgroundColor: '#ffffff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: t.border },
  bubbleTextUser: { color: '#ffffff', fontSize: s.body, lineHeight: s.lineSubtitle },
  bubbleTextModel: { color: t.text, fontSize: s.body, lineHeight: s.lineSubtitle },
  
  // 高齡模式大字樣式
  bubbleLatestModelElder: { backgroundColor: '#EFF6FF', borderWidth: 2, borderColor: '#2563EB' },
  bubbleTextLatestModelElder: { fontWeight: 'bold', color: '#1E293B' },

  // 打字動畫樣式
  // 高度對齊一行文字，讓「思考中」與「已回覆」的氣泡等高，頭像不會上下跳
  typingContainer: { flexDirection: 'row', alignItems: 'center', height: s.lineSubtitle, paddingHorizontal: 4, gap: 6 },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#94A3B8' },

  resultSection: { gap: 12 },
  modernCard: { backgroundColor: t.panel, borderRadius: s.radiusLg, padding: s.pad, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardIcon: { fontSize: s.title, marginRight: 8 },
  resultTitle: { fontSize: s.subtitle, fontWeight: '800', color: t.text },
  expandBox: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 6, backgroundColor: '#FAFAFA' },
  expandBoxText: { fontSize: s.caption, fontWeight: '700', color: '#64748B' },
  divider: { height: 1, backgroundColor: t.border, marginVertical: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  infoLabel: { fontSize: s.body, fontWeight: 'bold', color: t.muted, width: s.touch + 26, marginTop: 4 },
  infoValue: { flex: 1, fontSize: s.body, color: t.text, lineHeight: s.lineSubtitle, fontWeight: '600' },
  badge: { backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#FFFFFF', fontSize: s.caption, fontWeight: '700' },

  // 🎯 AI 就醫摘要觸發按鈕
  summaryTriggerBtn: { backgroundColor: '#2563EB', borderRadius: s.radius, paddingVertical: s.gapLg, paddingHorizontal: s.pad, marginTop: 14, alignItems: 'center', minHeight: s.touch, justifyContent: 'center' },
  summaryTriggerText: { color: '#FFFFFF', fontSize: s.body, fontWeight: 'bold' },

  topRecommendCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 2, borderColor: '#1E293B', padding: 16, marginBottom: 16 },
  topRecommendHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  topRecommendMascot: { width: s.touch, height: s.touch, marginRight: s.gapLg },
  topRecommendBadgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  topBadge: { backgroundColor: '#1E293B', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginRight: 6 },
  topBadgeText: { color: '#FFFFFF', fontSize: s.micro, fontWeight: 'bold' },
  topBadgeSub: { fontSize: s.micro, color: t.muted, fontWeight: '600' },
  topHospitalName: { fontSize: s.subtitle, fontWeight: '900', color: t.text, marginBottom: 4 },
  topHospitalInfo: { fontSize: s.caption, color: t.muted },
  topRecommendActions: { flexDirection: 'row', gap: 12 },
  topActionBtnPrimary: { flex: 1, backgroundColor: '#1E293B', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  topActionBtnTextPrimary: { color: '#FFFFFF', fontSize: s.body, fontWeight: 'bold' },
  topActionBtn: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: t.border, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  topActionBtnText: { color: t.text, fontSize: s.body, fontWeight: 'bold' },

  mapCard: { height: 200, borderRadius: 16, overflow: 'hidden', marginBottom: 16, borderWidth: 1, borderColor: t.border },
  map: { width: '100%', height: '100%' },
  hospitalHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  hospitalName: { fontSize: s.subtitle, fontWeight: '900', color: t.text, marginBottom: 6 },
  hospitalInfo: { fontSize: s.body, color: t.muted, lineHeight: 20 },
  bookingBtn: { backgroundColor: '#1A1A1A', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  bookingBtnText: { color: '#ffffff', fontSize: s.caption, fontWeight: 'bold' },
  hospitalActions: { flexDirection: 'row', gap: 12 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: '#FAFAFA' },
  actionBtnText: { fontSize: s.body, color: t.text, fontWeight: '700' },
  actionBtnPrimary: { backgroundColor: t.userBubble, borderColor: t.userBubble },
  actionBtnTextPrimary: { fontSize: s.body, color: '#fff', fontWeight: '700' },
  doctorSection: { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.subtle },
  doctorSectionTitle: { fontSize: s.caption, fontWeight: '800', color: t.muted, marginBottom: 10 },
  doctorRow: { backgroundColor: '#FAFAFA', padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: t.border },
  doctorName: { fontSize: s.body, fontWeight: '800', color: t.text, marginBottom: 4 },
  doctorSpecialty: { fontSize: s.body, color: t.muted, lineHeight: 20 },

  bottomSection: { padding: s.pad, backgroundColor: t.panel, borderTopWidth: s.dividerWidth, borderTopColor: s.dividerColor, boxShadow: s.dividerShadowUp },
  // 讓標籤列滿版可滑：向外抵銷 bottomSection 的左右 padding，再由 contentContainer 補回
  quickTagsScroll: { marginHorizontal: -s.pad, marginBottom: s.pad },
  quickTags: { flexDirection: 'row', gap: s.gap, paddingHorizontal: s.pad },
  tag: { backgroundColor: t.subtle, paddingHorizontal: s.pad, paddingVertical: s.gap, borderRadius: s.radiusLg, minHeight: s.touch, justifyContent: 'center', borderWidth: s.border, borderColor: 'transparent' },
  tagInner: { flexDirection: 'row', alignItems: 'center', gap: s.gap / 2 },
  tagText: { fontSize: s.body, color: t.text, fontWeight: '600' },
  // 常問症狀：淡藍底 + 同色框線，與預設標籤的灰底區隔。
  // 高齡模式框線隨 s.border 加粗，不另外寫條件式。
  tagPersonalized: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' },
  tagTextPersonalized: { color: t.userBubble },
  
  inputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FAFAFA', borderRadius: s.radiusLg + 4, paddingHorizontal: s.pad, paddingVertical: 6, borderWidth: s.border, borderColor: s.borderStrong, marginBottom: s.gapLg },
  textInput: { flex: 1, fontSize: s.input, paddingVertical: 10, color: t.text },
  sendButton: { backgroundColor: '#1A1A1A', borderRadius: s.touch / 2, width: s.touch - 8, height: s.touch - 8, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  sendIcon: { fontSize: s.subtitle, color: '#fff', fontWeight: 'bold' },
  controlsRow: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  controlBadge: { fontSize: s.caption, color: t.muted, backgroundColor: '#FAFAFA', paddingHorizontal: s.gapLg, paddingVertical: s.gap, borderRadius: s.radius, overflow: 'hidden', borderWidth: s.border, borderColor: t.border },
  // 定位徽章改為 icon + 文字，容器要橫向排列，字體樣式獨立出來
  controlBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  controlBadgeText: { fontSize: s.caption, color: t.muted },

  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.5)' },
  drawerBackdrop: { flex: 1 },
  navigatingOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.15)' },
  navigatingBox: { backgroundColor: '#1A1A1A', paddingHorizontal: 30, paddingVertical: 20, borderRadius: 16, alignItems: 'center', elevation: 5 },
  navigatingText: { color: '#FFFFFF', fontSize: s.input, fontWeight: 'bold', marginTop: 12 },
  drawerContent: { width: s.drawerWidth, height: '100%', backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOffset: { width: 4, height: 0 }, shadowOpacity: 0.1, shadowRadius: 15, elevation: 10, padding: 24 },
  drawerHeader: { marginTop: 40, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: t.border, marginBottom: 12 },
  drawerTitle: { fontSize: s.title, fontWeight: '900', color: t.text },
  drawerItem: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.03)' },
  drawerItemText: { fontSize: s.input, fontWeight: '700', color: t.text },

  // 🎯 AI 就醫摘要 Modal 樣式
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: t.border, backgroundColor: '#FFFFFF' },
  modalHeaderTitle: { fontSize: s.subtitle, fontWeight: '900', color: t.text },
  modalCloseBtn: { padding: 8 },
  modalCloseBtnText: { fontSize: s.body, color: '#2563EB', fontWeight: 'bold' },

  // 🎯 安全優先設計：警報看板樣式
  safetyAlertContainer: { backgroundColor: '#FEF2F2', borderStyle: 'solid', borderWidth: 2, borderColor: '#EF4444', borderRadius: 20, padding: 18, marginVertical: 12, shadowColor: '#991B1B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 3 },
  safetyHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  safetyAlertIcon: { width: s.touch - 10, height: s.touch - 10, borderRadius: (s.touch - 10) / 2, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center' },
  safetyAlertTitle: { fontSize: s.subtitle, fontWeight: '950', color: '#991B1B', flex: 1 },
  safetyBadge: { backgroundColor: '#EF4444', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  safetyBadgeText: { color: '#FFFFFF', fontSize: s.micro, fontWeight: 'bold' },
  safetyMessage: { fontSize: s.body, color: '#7F1D1D', lineHeight: 22, fontWeight: '600', marginBottom: 14 },
  redFlagHeader: { fontSize: s.caption, fontWeight: 'bold', color: '#991B1B', marginBottom: 6 },
  redFlagItem: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 8 },
  redFlagTitle: { fontSize: s.caption, fontWeight: '800', color: '#B91C1C' },
  redFlagDesc: { fontSize: s.micro, color: '#7F1D1D', marginTop: 2 },
  safetyActionsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  safetyActionBtnPrimary: { flex: 1, backgroundColor: '#1E293B', paddingVertical: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  safetyActionBtnDanger: { flex: 1, backgroundColor: '#EF4444', paddingVertical: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  safetyActionTextPrimary: { color: '#FFFFFF', fontSize: s.caption, fontWeight: 'bold' },
  safetyResetBtn: { alignSelf: 'center', marginTop: 14, paddingVertical: 8, paddingHorizontal: 16 },
  safetyResetBtnText: { color: '#475569', fontSize: s.caption, fontWeight: 'bold', textDecorationLine: 'underline' },
});