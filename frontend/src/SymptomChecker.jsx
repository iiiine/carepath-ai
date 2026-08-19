// src/SymptomChecker.jsx

import { useState, useRef, useEffect } from 'react';
import api from './api/axios';

import HospitalMap from './HospitalMap';
import HistorySidebar from './HistorySidebar';
import UserProfileModal from './UserProfileModal';

// ★ 第 22-4B：醫師門診時段
import DoctorScheduleInfo from './DoctorScheduleInfo';

import { t } from './theme';
import { BaymaxAvatar } from './Baymax';


// ==========================================
// 定位失敗時使用的備援位置
// ==========================================
const FALLBACK_LOCATION = {
  latitude: 23.0,
  longitude: 120.2
};


function SymptomChecker({
  user,
  isConnected,
  statusText,
  selectedSessionId,
  onSessionLoaded
}) {

  // ==========================================
  // AI 對話
  // ==========================================
  const [messages, setMessages] = useState([
    {
      role: 'model',
      content:
        '您好！我是您的 AI 健康助理。請先在右上角選擇不舒服的程度，並跟我描述您的症狀。'
    }
  ]);


  const [inputText, setInputText] =
    useState('');


  const [painLevel, setPainLevel] =
    useState(3);


  const [loading, setLoading] =
    useState(false);


  const [history, setHistory] =
    useState([]);


  const [
    diagnosisResult,
    setDiagnosisResult
  ] = useState(null);


  // ==========================================
  // 介面模式
  //
  // chat-only
  // split-screen
  // ==========================================
  const [
    viewMode,
    setViewMode
  ] = useState('chat-only');


  // ==========================================
  // 側邊欄
  // ==========================================
  const [
    isSidebarCollapsed,
    setIsSidebarCollapsed
  ] = useState(false);


  // ==========================================
  // 問診完成倒數
  // ==========================================
  const [
    countdownStep,
    setCountdownStep
  ] = useState(0);


  const [
    showCompleteModal,
    setShowCompleteModal
  ] = useState(false);


  // ==========================================
  // 全螢幕
  // ==========================================
  const [
    fullscreenSection,
    setFullscreenSection
  ] = useState(null);


  // ==========================================
  // 個人健康資料
  // ==========================================
  const [
    isProfileOpen,
    setIsProfileOpen
  ] = useState(false);


  // ==========================================
  // 使用者真實位置
  // ==========================================
  const [
    userLocation,
    setUserLocation
  ] = useState(null);


  // ==========================================
  // 定位狀態
  //
  // loading
  // success
  // fallback
  // ==========================================
  const [
    locationStatus,
    setLocationStatus
  ] = useState('loading');


  // ==========================================
  // 自動捲動
  // ==========================================
  const messagesEndRef =
    useRef(null);


  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
  }, [messages, loading]);


  // ==========================================
  // 第 20 步：
  // 取得使用者目前位置
  // ==========================================
  useEffect(() => {

    if (!navigator.geolocation) {

      console.warn(
        '此瀏覽器不支援定位功能，將使用備援位置。'
      );


      setUserLocation(
        FALLBACK_LOCATION
      );


      setLocationStatus(
        'fallback'
      );


      return;
    }


    setLocationStatus(
      'loading'
    );


    navigator.geolocation.getCurrentPosition(

      // ======================================
      // 成功
      // ======================================
      (position) => {

        const location = {
          latitude:
            position.coords.latitude,

          longitude:
            position.coords.longitude
        };


        console.log(
          '取得使用者位置成功：',
          location
        );


        setUserLocation(
          location
        );


        setLocationStatus(
          'success'
        );
      },


      // ======================================
      // 失敗
      // ======================================
      (error) => {

        console.warn(
          '無法取得使用者位置，改用備援座標：',
          error
        );


        setUserLocation(
          FALLBACK_LOCATION
        );


        setLocationStatus(
          'fallback'
        );
      },


      // ======================================
      // 定位設定
      // ======================================
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 300000
      }
    );

  }, []);


  // ==========================================
  // 個人健康資料
  // ==========================================
  const handleOpenProfile = () => {

    if (user?.is_guest) {

      alert(
        '🔒 訪客模式無法儲存健康資料，請先註冊/登入會員！'
      );

      return;
    }


    setIsProfileOpen(
      true
    );
  };


  // ==========================================
  // 發送 AI 問診
  // ==========================================
  const handleSendMessage = async (e) => {

    e.preventDefault();


    if (
      !inputText.trim() ||
      loading
    ) {
      return;
    }


    const userText =
      inputText;


    setInputText(
      ''
    );


    const newMessages = [
      ...messages,

      {
        role: 'user',
        content: userText
      }
    ];


    setMessages(
      newMessages
    );


    setLoading(
      true
    );


    try {

      // ======================================
      // 使用真實位置
      // ======================================
      const latitude =
        userLocation?.latitude ??
        FALLBACK_LOCATION.latitude;


      const longitude =
        userLocation?.longitude ??
        FALLBACK_LOCATION.longitude;


      console.log(
        '本次問診使用座標：',
        {
          latitude,
          longitude,
          locationStatus
        }
      );


      // ======================================
      // 呼叫 AI 問診 API
      // ======================================
      const response =
        await api.post(
          '/api/v1/diagnose',
          {
            pain_level:
              Number(painLevel),

            symptom_text:
              userText,

            user_latitude:
              latitude,

            user_longitude:
              longitude,

            history:
              history
          }
        );


      const data =
        response.data;


      // ======================================
      // AI 還需要追問
      // ======================================
      if (!data.is_complete) {

        setMessages([
          ...newMessages,

          {
            role: 'model',
            content:
              data.message
          }
        ]);


        setHistory(
          data.history || []
        );
      }


      // ======================================
      // 問診完成
      // ======================================
      else {

        setMessages([
          ...newMessages,

          {
            role: 'model',
            content:
              data.message
          }
        ]);


        setDiagnosisResult(
          data
        );


        // 更新歷史紀錄
        window.dispatchEvent(
          new Event(
            'refresh-history'
          )
        );


        // ====================================
        // 三燈倒數
        // ====================================
        setShowCompleteModal(
          true
        );


        setCountdownStep(
          1
        );


        setTimeout(
          () =>
            setCountdownStep(2),
          1000
        );


        setTimeout(
          () =>
            setCountdownStep(3),
          2000
        );


        setTimeout(() => {

          setShowCompleteModal(
            false
          );


          setCountdownStep(
            0
          );


          setViewMode(
            'split-screen'
          );

        }, 3000);
      }

    } catch (error) {

      console.error(
        '問診請求失敗:',
        error
      );


      setMessages([
        ...newMessages,

        {
          role: 'model',
          content:
            '⚠️ 抱歉，目前系統連線有些問題，請確認後端服務是否正常啟動。'
        }
      ]);

    } finally {

      setLoading(
        false
      );
    }
  };


  // ==========================================
  // 載入歷史問診
  // ==========================================
  const handleSelectSession = (
    session
  ) => {

    const savedHistory =
      Array.isArray(
        session.history
      )
        ? session.history
        : [];


    const savedCauses =
      Array.isArray(
        session.possible_causes
      )
        ? session.possible_causes
        : [];


    const savedResources =
      Array.isArray(
        session.nearby_medical_resources
      )
        ? session.nearby_medical_resources
        : [];


    setMessages(
      savedHistory
    );


    setHistory(
      savedHistory
    );


    setPainLevel(
      session.pain_level ?? 3
    );


    setDiagnosisResult({
      status:
        'completed',

      is_complete:
        true,

      symptom:
        session.original_symptom ||
        session.symptom_text ||
        '',

      suggested_department:
        session.suggested_department ||
        '家醫科',

      possible_causes:
        savedCauses,

      nearby_medical_resources:
        savedResources,

      message:
        ''
    });


    setViewMode(
      'split-screen'
    );
  };


  // ==========================================
  // Dashboard 指定歷史問診
  // ==========================================
  useEffect(() => {

    if (
      selectedSessionId == null
    ) {
      return;
    }


    let cancelled =
      false;


    const loadSelectedSession =
      async () => {

        try {

          console.log(
            '準備載入 Dashboard 指定問診 ID:',
            selectedSessionId
          );


          const response =
            await api.get(
              '/api/v1/history'
            );


          const sessionList =
            Array.isArray(
              response.data
            )
              ? response.data
              : [];


          const targetSession =
            sessionList.find(
              (session) =>
                String(
                  session.id
                ) ===
                String(
                  selectedSessionId
                )
            );


          if (cancelled) {
            return;
          }


          if (!targetSession) {

            console.warn(
              '找不到 Dashboard 指定的歷史問診：',
              selectedSessionId
            );

            return;
          }


          console.log(
            '成功找到 Dashboard 歷史問診:',
            targetSession
          );


          handleSelectSession(
            targetSession
          );

        } catch (error) {

          if (!cancelled) {

            console.error(
              '載入 Dashboard 指定歷史問診失敗：',
              error
            );
          }

        } finally {

          if (
            !cancelled &&
            typeof onSessionLoaded ===
              'function'
          ) {

            onSessionLoaded();
          }
        }
      };


    loadSelectedSession();


    return () => {

      cancelled =
        true;
    };

  }, [selectedSessionId]);


  // ==========================================
  // 新問診
  // ==========================================
  const handleNewChat = () => {

    setDiagnosisResult(
      null
    );


    setMessages([
      {
        role: 'model',
        content:
          '您好！我是您的 AI 健康助理。請問您今天哪裡不舒服呢？'
      }
    ]);


    setHistory(
      []
    );


    setPainLevel(
      3
    );


    setInputText(
      ''
    );


    setViewMode(
      'chat-only'
    );
  };


  // ==========================================
  // 全螢幕
  // ==========================================
  const toggleFullscreen = (
    section
  ) => {

    setFullscreenSection(
      fullscreenSection ===
        section
        ? null
        : section
    );
  };


  // ==========================================
  // 區塊樣式
  // ==========================================
  const getSectionStyle = (
    section
  ) => {

    if (
      fullscreenSection ===
      section
    ) {

      return {

        position:
          'fixed',

        top:
          0,

        left:
          0,

        width:
          '100vw',

        height:
          '100vh',

        zIndex:
          9999,

        backgroundColor:
          '#fff',

        padding:
          '24px',

        boxSizing:
          'border-box',

        overflowY:
          'auto',

        display:
          'flex',

        flexDirection:
          'column'
      };
    }


    return {

      backgroundColor:
        t.panel,

      borderRadius:
        '12px',

      padding:
        '16px',

      display:
        'flex',

      flexDirection:
        'column',

      boxSizing:
        'border-box',

      border:
        `1px solid ${t.border}`,

      overflow:
        'hidden',

      minHeight:
        0
    };
  };


  // ==========================================
  // UI
  // ==========================================
  return (

    <div
      style={{
        display:
          'flex',

        gap:
          '16px',

        maxWidth:
          '1700px',

        height:
          'calc(100vh - 85px)',

        margin:
          '0 auto',

        width:
          '100%',

        position:
          'relative'
      }}
    >

      {/* ==================================== */}
      {/* 左側歷史紀錄 */}
      {/* ==================================== */}

      <div
        style={{
          width:
            isSidebarCollapsed
              ? '60px'
              : '260px',

          transition:
            'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',

          flexShrink:
            0,

          height:
            '100%'
        }}
      >

        <HistorySidebar
          user={
            user
          }

          onSelectSession={
            handleSelectSession
          }

          onNewChat={
            handleNewChat
          }
        />

      </div>


      {/* ==================================== */}
      {/* 主畫面 */}
      {/* ==================================== */}

      <div
        style={{
          flex:
            1,

          height:
            '100%',

          minWidth:
            0,

          position:
            'relative'
        }}
      >

        {/* ================================== */}
        {/* AI 對話模式 */}
        {/* ================================== */}

        {viewMode ===
        'chat-only' ? (

          <div
            style={{
              maxWidth:
                '780px',

              height:
                '100%',

              margin:
                '0 auto',

              backgroundColor:
                t.panel,

              borderRadius:
                '12px',

              border:
                `1px solid ${t.border}`,

              padding:
                '24px',

              boxSizing:
                'border-box',

              display:
                'flex',

              flexDirection:
                'column'
            }}
          >

            {/* ============================== */}
            {/* Header */}
            {/* ============================== */}

            <div
              style={{
                display:
                  'flex',

                justifyContent:
                  'space-between',

                alignItems:
                  'flex-start',

                marginBottom:
                  '8px',

                paddingBottom:
                  '16px',

                borderBottom:
                  `1px solid ${t.border}`
              }}
            >

              <div
                style={{
                  display:
                    'flex',

                  alignItems:
                    'center',

                  gap:
                    '12px'
                }}
              >

                <BaymaxAvatar
                  size={62}
                />


                <div>

                  <h2
                    style={{
                      margin:
                        0,

                      color:
                        t.text,

                      fontSize:
                        '1.05rem',

                      fontWeight:
                        600,

                      letterSpacing:
                        '-0.01em'
                    }}
                  >
                    AI 問診助理
                  </h2>


                  <p
                    style={{
                      margin:
                        '3px 0 0',

                      color:
                        t.muted,

                      fontSize:
                        '0.85rem'
                    }}
                  >
                    描述您的症狀，我會協助判斷科別並推薦附近院所
                  </p>

                </div>

              </div>


              <div
                style={{
                  display:
                    'flex',

                  alignItems:
                    'center',

                  gap:
                    '8px'
                }}
              >

                {/* 個人健康資料 */}

                <button
                  type="button"

                  onClick={
                    handleOpenProfile
                  }

                  style={{
                    backgroundColor:
                      t.panel,

                    color:
                      user?.is_guest
                        ? t.muted
                        : t.text,

                    border:
                      `1px solid ${t.border}`,

                    borderRadius:
                      '8px',

                    padding:
                      '6px 12px',

                    fontSize:
                      '0.8rem',

                    fontWeight:
                      500,

                    cursor:
                      'pointer'
                  }}
                >
                  個人健康資料
                </button>


                {/* 定位狀態 */}

                <div
                  title={
                    locationStatus ===
                    'success'
                      ? '已取得目前位置'
                      : locationStatus ===
                        'loading'
                        ? '正在取得位置'
                        : '目前使用備援位置'
                  }

                  style={{
                    display:
                      'inline-flex',

                    alignItems:
                      'center',

                    gap:
                      '5px',

                    border:
                      `1px solid ${t.border}`,

                    padding:
                      '5px 9px',

                    borderRadius:
                      '8px',

                    fontSize:
                      '0.75rem',

                    color:
                      locationStatus ===
                      'success'
                        ? t.text
                        : t.muted,

                    backgroundColor:
                      t.panel
                  }}
                >

                  {locationStatus ===
                  'success'
                    ? '📍 已定位'
                    : locationStatus ===
                      'loading'
                      ? '📍 定位中'
                      : '📍 備援位置'}

                </div>


                {/* 不適程度 */}

                <div
                  style={{
                    display:
                      'inline-flex',

                    alignItems:
                      'center',

                    gap:
                      '8px',

                    border:
                      `1px solid ${t.border}`,

                    padding:
                      '5px 12px',

                    borderRadius:
                      '8px',

                    fontSize:
                      '0.8rem',

                    color:
                      t.muted
                  }}
                >

                  <span>
                    不適度{' '}

                    <strong
                      style={{
                        color:
                          painLevel >= 4
                            ? t.danger
                            : t.text,

                        fontWeight:
                          600
                      }}
                    >
                      {painLevel}
                    </strong>
                  </span>


                  <input
                    type="range"

                    min="1"

                    max="5"

                    step="1"

                    value={
                      painLevel
                    }

                    onChange={(
                      e
                    ) =>
                      setPainLevel(
                        e.target.value
                      )
                    }

                    style={{
                      width:
                        '72px',

                      accentColor:
                        painLevel >= 4
                          ? t.danger
                          : t.userBubble,

                      cursor:
                        'pointer'
                    }}
                  />

                </div>

              </div>

            </div>


            {/* ============================== */}
            {/* 對話 */}
            {/* ============================== */}

            <div
              style={{
                flex:
                  1,

                overflowY:
                  'auto',

                padding:
                  '20px 4px',

                marginBottom:
                  '12px'
              }}
            >

              {messages.map(
                (
                  msg,
                  index
                ) => (

                  <div
                    key={
                      index
                    }

                    style={{
                      display:
                        'flex',

                      gap:
                        '12px',

                      justifyContent:
                        msg.role ===
                        'user'
                          ? 'flex-end'
                          : 'flex-start',

                      marginBottom:
                        '20px'
                    }}
                  >

                    {msg.role ===
                      'model' && (

                      <BaymaxAvatar
                        size={40}
                      />

                    )}


                    <div
                      style={
                        msg.role ===
                        'user'
                          ? {
                              maxWidth:
                                '75%',

                              padding:
                                '10px 16px',

                              borderRadius:
                                '18px',

                              backgroundColor:
                                t.userBubble,

                              color:
                                '#ffffff',

                              whiteSpace:
                                'pre-wrap',

                              fontSize:
                                '0.9rem',

                              lineHeight:
                                1.6
                            }
                          : {
                              flex:
                                1,

                              paddingTop:
                                '3px',

                              color:
                                t.text,

                              whiteSpace:
                                'pre-wrap',

                              fontSize:
                                '0.9rem',

                              lineHeight:
                                1.75
                            }
                      }
                    >
                      {
                        msg.content
                      }
                    </div>

                  </div>

                )
              )}


              {/* AI Loading */}

              {loading && (

                <div
                  style={{
                    display:
                      'flex',

                    gap:
                      '12px',

                    alignItems:
                      'center',

                    marginBottom:
                      '20px'
                  }}
                >

                  <BaymaxAvatar
                    size={40}
                  />


                  <div
                    style={{
                      display:
                        'flex',

                      gap:
                        '4px',

                      paddingTop:
                        '2px'
                    }}
                  >

                    {[0, 1, 2].map(
                      (i) => (

                        <span
                          key={
                            i
                          }

                          style={{
                            width:
                              '6px',

                            height:
                              '6px',

                            borderRadius:
                              '50%',

                            backgroundColor:
                              t.muted,

                            animation:
                              `baymax-blink 1.2s ease-in-out ${
                                i * 0.16
                              }s infinite`
                          }}
                        />

                      )
                    )}

                  </div>

                </div>

              )}


              <div
                ref={
                  messagesEndRef
                }
              />

            </div>


            {/* ============================== */}
            {/* 快捷症狀 */}
            {/* ============================== */}

            {messages.length ===
              1 &&
              !loading && (

              <div
                style={{
                  display:
                    'flex',

                  flexWrap:
                    'wrap',

                  gap:
                    '8px',

                  marginBottom:
                    '12px'
                }}
              >

                {[
                  '頭痛',
                  '發燒',
                  '喉嚨痛',
                  '肚子痛',
                  '皮膚起疹',
                  '牙齒痛'
                ].map(
                  (
                    symptom
                  ) => (

                    <button
                      key={
                        symptom
                      }

                      type="button"

                      onClick={() =>
                        setInputText(
                          symptom
                        )
                      }

                      style={{
                        border:
                          `1px solid ${t.border}`,

                        backgroundColor:
                          t.panel,

                        color:
                          t.muted,

                        borderRadius:
                          '16px',

                        padding:
                          '5px 14px',

                        fontSize:
                          '0.8rem',

                        cursor:
                          'pointer'
                      }}
                    >
                      {
                        symptom
                      }
                    </button>

                  )
                )}

              </div>

            )}


            {/* ============================== */}
            {/* 輸入框 */}
            {/* ============================== */}

            <form
              onSubmit={
                handleSendMessage
              }

              style={{
                display:
                  'flex',

                alignItems:
                  'center',

                gap:
                  '8px',

                border:
                  `1px solid ${t.border}`,

                borderRadius:
                  '24px',

                padding:
                  '6px 6px 6px 18px',

                backgroundColor:
                  t.panel
              }}
            >

              <input
                type="text"

                value={
                  inputText
                }

                onChange={(
                  e
                ) =>
                  setInputText(
                    e.target.value
                  )
                }

                placeholder="傳訊息給助理..."

                disabled={
                  loading
                }

                style={{
                  flex:
                    1,

                  border:
                    'none',

                  outline:
                    'none',

                  fontSize:
                    '0.9rem',

                  color:
                    t.text,

                  backgroundColor:
                    'transparent',

                  padding:
                    '8px 0'
                }}
              />


              <button
                type="submit"

                disabled={
                  loading ||
                  !inputText.trim()
                }

                aria-label="發送"

                style={{
                  width:
                    '34px',

                  height:
                    '34px',

                  flexShrink:
                    0,

                  display:
                    'flex',

                  alignItems:
                    'center',

                  justifyContent:
                    'center',

                  backgroundColor:
                    !inputText.trim() ||
                    loading
                      ? t.subtle
                      : t.userBubble,

                  color:
                    !inputText.trim() ||
                    loading
                      ? t.muted
                      : '#ffffff',

                  border:
                    'none',

                  borderRadius:
                    '50%',

                  cursor:
                    !inputText.trim() ||
                    loading
                      ? 'default'
                      : 'pointer',

                  fontSize:
                    '1rem',

                  lineHeight:
                    1
                }}
              >
                ↑
              </button>

            </form>

          </div>

        ) : (

          // ==================================
          // 完整結果模式
          // ==================================

          <div
            style={{
              display:
                'grid',

              gridTemplateColumns:
                '1fr 1fr',

              gap:
                '20px',

              height:
                '100%'
            }}
          >

            {/* ============================== */}
            {/* 左側地圖 */}
            {/* ============================== */}

            <div
              style={{
                ...getSectionStyle(
                  'map'
                ),

                height:
                  '100%'
              }}
            >

              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  alignItems:
                    'center',

                  marginBottom:
                    '8px'
                }}
              >

                <h3
                  style={{
                    margin:
                      0,

                    color:
                      t.text,

                    fontSize:
                      '0.9rem',

                    fontWeight:
                      600
                  }}
                >
                  附近醫療院所地圖
                </h3>


                <button
                  type="button"

                  onClick={() =>
                    toggleFullscreen(
                      'map'
                    )
                  }

                  style={{
                    border:
                      `1px solid ${t.border}`,

                    background:
                      t.panel,

                    color:
                      t.muted,

                    padding:
                      '4px 10px',

                    borderRadius:
                      '6px',

                    cursor:
                      'pointer',

                    fontSize:
                      '0.75rem'
                  }}
                >
                  {fullscreenSection ===
                  'map'
                    ? '退出全螢幕'
                    : '全螢幕'}
                </button>

              </div>


              <div
                style={{
                  flex:
                    1,

                  width:
                    '100%',

                  minHeight:
                    0,

                  position:
                    'relative'
                }}
              >

                <HospitalMap
                  isFullscreen={
                    fullscreenSection ===
                    'map'
                  }

                  hospitalsProp={
                    diagnosisResult
                      ? diagnosisResult.nearby_medical_resources
                      : null
                  }
                />

              </div>

            </div>


            {/* ============================== */}
            {/* 右側 */}
            {/* ============================== */}

            <div
              style={{
                display:
                  'flex',

                flexDirection:
                  'column',

                gap:
                  '16px',

                height:
                  '100%',

                minHeight:
                  0
              }}
            >

              {/* ============================ */}
              {/* 問診歷程 */}
              {/* ============================ */}

              <div
                style={{
                  ...getSectionStyle(
                    'chat'
                  ),

                  flex:
                    1
                }}
              >

                <div
                  style={{
                    display:
                      'flex',

                    justifyContent:
                      'space-between',

                    alignItems:
                      'center',

                    marginBottom:
                      '8px'
                  }}
                >

                  <h3
                    style={{
                      margin:
                        0,

                      color:
                        t.text,

                      fontSize:
                        '0.9rem',

                      fontWeight:
                        600
                    }}
                  >
                    問診對話歷程
                  </h3>


                  <div
                    style={{
                      display:
                        'flex',

                      alignItems:
                        'center',

                      gap:
                        '8px'
                    }}
                  >

                    <button
                      type="button"

                      onClick={
                        handleOpenProfile
                      }

                      style={{
                        backgroundColor:
                          t.panel,

                        color:
                          user?.is_guest
                            ? t.muted
                            : t.text,

                        border:
                          `1px solid ${t.border}`,

                        borderRadius:
                          '6px',

                        padding:
                          '3px 8px',

                        fontSize:
                          '0.75rem',

                        fontWeight:
                          500,

                        cursor:
                          'pointer'
                      }}
                    >
                      個人資料
                    </button>


                    <button
                      type="button"

                      onClick={() =>
                        toggleFullscreen(
                          'chat'
                        )
                      }

                      style={{
                        border:
                          `1px solid ${t.border}`,

                        background:
                          t.panel,

                        color:
                          t.muted,

                        padding:
                          '3px 8px',

                        borderRadius:
                          '6px',

                        cursor:
                          'pointer',

                        fontSize:
                          '0.75rem'
                      }}
                    >
                      {fullscreenSection ===
                      'chat'
                        ? '退出全螢幕'
                        : '全螢幕'}
                    </button>

                  </div>

                </div>


                <div
                  style={{
                    flex:
                      1,

                    overflowY:
                      'auto',

                    minHeight:
                      0,

                    padding:
                      '8px 4px'
                  }}
                >

                  {messages.map(
                    (
                      msg,
                      index
                    ) => (

                      <div
                        key={
                          index
                        }

                        style={{
                          display:
                            'flex',

                          gap:
                            '8px',

                          justifyContent:
                            msg.role ===
                            'user'
                              ? 'flex-end'
                              : 'flex-start',

                          marginBottom:
                            '12px'
                        }}
                      >

                        {msg.role ===
                          'model' && (

                          <BaymaxAvatar
                            size={30}
                          />

                        )}


                        <div
                          style={
                            msg.role ===
                            'user'
                              ? {
                                  maxWidth:
                                    '85%',

                                  padding:
                                    '6px 12px',

                                  borderRadius:
                                    '14px',

                                  backgroundColor:
                                    t.userBubble,

                                  color:
                                    '#ffffff',

                                  fontSize:
                                    '0.85rem',

                                  lineHeight:
                                    1.6,

                                  whiteSpace:
                                    'pre-wrap'
                                }
                              : {
                                  flex:
                                    1,

                                  color:
                                    t.text,

                                  fontSize:
                                    '0.85rem',

                                  lineHeight:
                                    1.7,

                                  whiteSpace:
                                    'pre-wrap'
                                }
                          }
                        >
                          {
                            msg.content
                          }
                        </div>

                      </div>

                    )
                  )}


                  <div
                    ref={
                      messagesEndRef
                    }
                  />

                </div>

              </div>


              {/* ============================ */}
              {/* 推薦診所與醫師 */}
              {/* ============================ */}

              <div
                style={{
                  ...getSectionStyle(
                    'doctors'
                  ),

                  flex:
                    1.2
                }}
              >

                <div
                  style={{
                    display:
                      'flex',

                    justifyContent:
                      'space-between',

                    alignItems:
                      'center',

                    marginBottom:
                      '8px'
                  }}
                >

                  <h3
                    style={{
                      margin:
                        0,

                      color:
                        t.text,

                      fontSize:
                        '0.9rem',

                      fontWeight:
                        600
                    }}
                  >
                    推薦診所與門診醫師
                  </h3>


                  <button
                    type="button"

                    onClick={() =>
                      toggleFullscreen(
                        'doctors'
                      )
                    }

                    style={{
                      border:
                        `1px solid ${t.border}`,

                      background:
                        t.panel,

                      color:
                        t.muted,

                      padding:
                        '3px 8px',

                      borderRadius:
                        '6px',

                      cursor:
                        'pointer',

                      fontSize:
                        '0.75rem'
                    }}
                  >
                    {fullscreenSection ===
                    'doctors'
                      ? '退出全螢幕'
                      : '全螢幕'}
                  </button>

                </div>


                <div
                  style={{
                    flex:
                      1,

                    overflowY:
                      'auto',

                    minHeight:
                      0
                  }}
                >

                  {diagnosisResult ? (

                    <div>

                      {/* ====================== */}
                      {/* 科別與可能原因 */}
                      {/* ====================== */}

                      <div
                        style={{
                          padding:
                            '10px 12px',

                          backgroundColor:
                            t.subtle,

                          borderRadius:
                            '8px',

                          marginBottom:
                            '10px',

                          fontSize:
                            '0.85rem',

                          color:
                            t.text
                        }}
                      >

                        <p
                          style={{
                            margin:
                              0
                          }}
                        >

                          <strong
                            style={{
                              fontWeight:
                                600
                            }}
                          >
                            推薦科別：
                          </strong>{' '}


                          <span
                            style={{
                              backgroundColor:
                                t.userBubble,

                              color:
                                '#fff',

                              padding:
                                '2px 8px',

                              borderRadius:
                                '6px',

                              fontSize:
                                '0.8rem'
                            }}
                          >
                            {
                              diagnosisResult
                                .suggested_department
                            }
                          </span>

                        </p>


                        <p
                          style={{
                            margin:
                              '6px 0 0',

                            color:
                              t.muted
                          }}
                        >

                          <strong
                            style={{
                              fontWeight:
                                600,

                              color:
                                t.text
                            }}
                          >
                            可能原因：
                          </strong>{' '}


                          {Array.isArray(
                            diagnosisResult
                              .possible_causes
                          )
                            ? diagnosisResult
                                .possible_causes
                                .join('、')
                            : ''}

                        </p>

                      </div>


                      {/* ====================== */}
                      {/* 醫療院所 */}
                      {/* ====================== */}

                      {Array.isArray(
                        diagnosisResult
                          .nearby_medical_resources
                      ) &&
                      diagnosisResult
                        .nearby_medical_resources
                        .length > 0 ? (

                        diagnosisResult
                          .nearby_medical_resources
                          .map(
                            (
                              hospital,
                              idx
                            ) => {

                              const isUrl =
                                hospital.booking_url &&
                                /^https?:\/\//i.test(
                                  hospital.booking_url.trim()
                                );


                              return (

                                <div
                                  key={
                                    hospital.hospital_code ||
                                    hospital.id ||
                                    idx
                                  }

                                  style={{
                                    backgroundColor:
                                      t.panel,

                                    padding:
                                      '12px',

                                    borderRadius:
                                      '8px',

                                    marginBottom:
                                      '8px',

                                    border:
                                      `1px solid ${t.border}`,

                                    fontSize:
                                      '0.82rem'
                                  }}
                                >

                                  {/* ================== */}
                                  {/* 醫院標題 */}
                                  {/* ================== */}

                                  <div
                                    style={{
                                      display:
                                        'flex',

                                      justifyContent:
                                        'space-between',

                                      alignItems:
                                        'center',

                                      gap:
                                        '10px'
                                    }}
                                  >

                                    <div
                                      style={{
                                        fontWeight:
                                          600,

                                        color:
                                          t.text
                                      }}
                                    >
                                      {
                                        hospital.name
                                      }
                                    </div>


                                    {isUrl ? (

                                      <a
                                        href={
                                          hospital.booking_url
                                        }

                                        target="_blank"

                                        rel="noopener noreferrer"

                                        style={{
                                          backgroundColor:
                                            t.userBubble,

                                          color:
                                            '#ffffff',

                                          padding:
                                            '4px 10px',

                                          borderRadius:
                                            '6px',

                                          textDecoration:
                                            'none',

                                          fontWeight:
                                            500,

                                          fontSize:
                                            '0.75rem'
                                        }}
                                      >
                                        線上掛號
                                      </a>

                                    ) : (

                                      <span
                                        style={{
                                          fontSize:
                                            '0.72rem',

                                          color:
                                            t.muted,

                                          backgroundColor:
                                            t.subtle,

                                          padding:
                                            '3px 8px',

                                          borderRadius:
                                            '6px'
                                        }}
                                      >
                                        {
                                          hospital.booking_url ||
                                          '現場掛號'
                                        }
                                      </span>

                                    )}

                                  </div>


                                  {/* ================== */}
                                  {/* 地址 */}
                                  {/* ================== */}

                                  <div
                                    style={{
                                      color:
                                        t.muted,

                                      margin:
                                        '6px 0 2px'
                                    }}
                                  >

                                    {
                                      hospital.address ||
                                      '院方未提供地址'
                                    }


                                    {hospital.distance_meters !=
                                      null &&
                                      ` · 約 ${hospital.distance_meters} 公尺`}

                                  </div>


                                  {/* ================== */}
                                  {/* 電話 */}
                                  {/* ================== */}

                                  <div
                                    style={{
                                      color:
                                        t.muted
                                    }}
                                  >

                                    {hospital.phone ? (

                                      <a
                                        href={`tel:${hospital.phone}`}

                                        style={{
                                          color:
                                            t.text,

                                          textDecoration:
                                            'none'
                                        }}
                                      >
                                        {
                                          hospital.phone
                                        }
                                      </a>

                                    ) : (

                                      '院方未提供電話'

                                    )}

                                  </div>


                                  {/* ================== */}
                                  {/* 推薦醫師 */}
                                  {/* ================== */}

                                  <div
                                    style={{
                                      marginTop:
                                        '10px',

                                      paddingTop:
                                        '10px',

                                      borderTop:
                                        `1px solid ${t.border}`
                                    }}
                                  >

                                    <div
                                      style={{
                                        color:
                                          t.muted,

                                        fontWeight:
                                          500,

                                        marginBottom:
                                          '6px',

                                        fontSize:
                                          '0.78rem'
                                      }}
                                    >
                                      推薦醫師
                                    </div>


                                    {Array.isArray(
                                      hospital.available_doctors
                                    ) &&
                                    hospital
                                      .available_doctors
                                      .length >
                                      0 ? (

                                      hospital.available_doctors.map(
                                        (
                                          doctor,
                                          doctorIndex
                                        ) => (

                                          <div
                                            key={`${hospital.hospital_code || idx}-${doctor.name}-${doctorIndex}`}

                                            style={{
                                              padding:
                                                '8px 10px',

                                              marginBottom:
                                                '8px',

                                              backgroundColor:
                                                t.subtle,

                                              borderRadius:
                                                '6px'
                                            }}
                                          >

                                            {/* ====================== */}
                                            {/* 醫師姓名 */}
                                            {/* ====================== */}

                                            <div
                                              style={{
                                                color:
                                                  t.text,

                                                fontWeight:
                                                  600
                                              }}
                                            >
                                              {
                                                doctor.name
                                              }
                                            </div>


                                            {/* ====================== */}
                                            {/* 科別 */}
                                            {/* ====================== */}

                                            <div
                                              style={{
                                                color:
                                                  t.muted,

                                                marginTop:
                                                  '3px'
                                              }}
                                            >
                                              科別：
                                              {
                                                doctor.department ||
                                                '院方未提供'
                                              }
                                            </div>


                                            {/* ====================== */}
                                            {/* 專長 */}
                                            {/* ====================== */}

                                            <div
                                              style={{
                                                color:
                                                  t.muted,

                                                marginTop:
                                                  '3px',

                                                lineHeight:
                                                  1.5
                                              }}
                                            >
                                              專長：
                                              {
                                                doctor.specialty ||
                                                '院方未提供'
                                              }
                                            </div>


                                            {/* ====================== */}
                                            {/* ★ 第 22-4B */}
                                            {/* 醫師近期門診時段 */}
                                            {/* ====================== */}

                                            <DoctorScheduleInfo
                                              hospitalCode={
                                                hospital.hospital_code
                                              }

                                              doctorName={
                                                doctor.name
                                              }
                                            />

                                          </div>

                                        )
                                      )

                                    ) : (

                                      <div
                                        style={{
                                          color:
                                            t.muted,

                                          fontSize:
                                            '0.78rem'
                                        }}
                                      >
                                        目前沒有符合科別的醫師資料
                                      </div>

                                    )}

                                  </div>

                                </div>

                              );
                            }
                          )

                      ) : (

                        <div
                          style={{
                            color:
                              t.muted,

                            padding:
                              '16px 4px',

                            textAlign:
                              'center',

                            fontSize:
                              '0.8rem'
                          }}
                        >
                          此筆問診沒有儲存醫療院所資料
                        </div>

                      )}

                    </div>

                  ) : (

                    <div
                      style={{
                        textAlign:
                          'center',

                        color:
                          '#888',

                        paddingTop:
                          '30px',

                        fontSize:
                          '0.85rem'
                      }}
                    >
                      問診完成後在此顯示推薦醫師資訊。
                    </div>

                  )}

                </div>

              </div>

            </div>

          </div>

        )}


        {/* ================================== */}
        {/* 問診完成倒數 */}
        {/* ================================== */}

        {showCompleteModal && (

          <div
            style={{
              position:
                'fixed',

              top:
                0,

              left:
                0,

              width:
                '100vw',

              height:
                '100vh',

              backgroundColor:
                'rgba(0,0,0,0.45)',

              display:
                'flex',

              justifyContent:
                'center',

              alignItems:
                'center',

              zIndex:
                99999
            }}
          >

            <div
              style={{
                backgroundColor:
                  t.panel,

                padding:
                  '32px 48px',

                borderRadius:
                  '16px',

                boxShadow:
                  '0 12px 40px rgba(0,0,0,0.12)',

                textAlign:
                  'center',

                border:
                  `1px solid ${t.border}`,

                display:
                  'flex',

                flexDirection:
                  'column',

                alignItems:
                  'center',

                gap:
                  '14px'
              }}
            >

              <h2
                style={{
                  color:
                    t.text,

                  margin:
                    0,

                  fontSize:
                    '1.15rem',

                  fontWeight:
                    600
                }}
              >
                問診已完成
              </h2>


              <p
                style={{
                  color:
                    t.muted,

                  margin:
                    0,

                  fontSize:
                    '0.9rem'
                }}
              >
                即將為您跳轉至地圖與相關資訊
              </p>


              <div
                style={{
                  display:
                    'flex',

                  gap:
                    '14px',

                  marginTop:
                    '8px'
                }}
              >

                {[1, 2, 3].map(
                  (
                    step
                  ) => {

                    const isActive =
                      countdownStep >=
                      step;


                    return (

                      <div
                        key={
                          step
                        }

                        style={{
                          width:
                            '18px',

                          height:
                            '18px',

                          borderRadius:
                            '50%',

                          backgroundColor:
                            isActive
                              ? t.userBubble
                              : t.border,

                          transition:
                            'all 0.4s ease'
                        }}
                      />

                    );
                  }
                )}

              </div>

            </div>

          </div>

        )}


        {/* ================================== */}
        {/* 個人健康資料 Modal */}
        {/* ================================== */}

        <UserProfileModal
          isOpen={
            isProfileOpen
          }

          onClose={() =>
            setIsProfileOpen(
              false
            )
          }

          user={
            user
          }
        />

      </div>

    </div>
  );
}


export default SymptomChecker;