

import { useState, useRef, useEffect, useMemo } from 'react';
import api from './api/axios';
import { useElderMode } from './useElderMode';

import HospitalMap from './HospitalMap';
import HistorySidebar from './HistorySidebar';
import UserProfileModal from './UserProfileModal';

// ★ 第 22-4B：醫師門診時段
import DoctorScheduleInfo from './DoctorScheduleInfo';

// ★ Step 2B-2：縱向健康趨勢儀表板
import DashboardPage from './pages/DashboardPage';

// ★ Step 3B-2：AI 就醫摘要
import VisitSummaryPanel from './VisitSummaryPanel';

import { t } from './theme';
import { BaymaxAvatar, CarePathWordmark } from './Baymax';
import Icon from './Icon';
import { mdiCheck, mdiMapMarker, mdiMapMarkerCheck, mdiFileDocumentOutline } from '@mdi/js';


// ==========================================
// 定位失敗時使用的備援位置
// ==========================================
const FALLBACK_LOCATION = {
  latitude: 23.0,
  longitude: 120.2
};


// ==========================================
// 快捷症狀
//
// 預設值：新會員、訪客、或縱向分析取不到資料時使用。
// 個人化：會員的「常問症狀」排在前面，
//         不足的名額用預設值補齊。
//
// 之所以是補齊而不是整組替換：
// 後端 analyze_recurring_symptoms() 要求同一症狀
// 出現兩次以上才算常問，因此新會員會有很長一段時間
// 拿到空陣列。整組替換會讓快捷列時有時無，
// 補齊制則讓新會員看到的畫面跟現在完全一樣。
//
// 這段邏輯與行動端 ConsultScreen.js 為同一份契約，
// 改動時兩端要一起改。
// ==========================================

const DEFAULT_QUICK_SYMPTOMS = [
  '頭痛',
  '發燒',
  '喉嚨痛',
  '肚子痛',
  '皮膚起疹',
  '牙齒痛'
];


const QUICK_SYMPTOM_LIMIT = 6;


// 後端的症狀概念用臨床用語，
// 預設快捷用口語，兩者指同一件事。
//
// 不做對應的話，會員問過「肚子痛」
// 會同時出現「腹痛」與「肚子痛」兩顆標籤。
// 統一換成口語說法：既能去重，
// 也符合本站的高齡友善取向。
//
// 只涵蓋預設六項會撞到的詞。對應來源是
// longitudinal_intelligence.py 的症狀概念詞庫，
// 該處若調整這兩個詞要一起改。
const QUICK_SYMPTOM_ALIASES = {
  腹痛: '肚子痛',
  牙痛: '牙齒痛'
};


// 縱向分析的時間窗。
// 快捷標籤只需要近期習慣，不必拉滿 365 天。
const QUICK_SYMPTOM_WINDOW_DAYS = 90;


// 純函式：合併常問症狀與預設值，
// 回傳含來源標記的清單。
//
// personalized 供畫面決定要不要上淡底色，
// 不影響填入輸入框的文字。
// 後端已依 session_count 由多到少排序，這裡不重排。
const mergeQuickSymptoms = (
  recurringSymptoms
) => {

  const merged = [];

  const seen = new Set();


  const push = (
    label,
    personalized
  ) => {

    const raw =
      typeof label === 'string'
        ? label.trim()
        : '';


    const text =
      QUICK_SYMPTOM_ALIASES[raw] ||
      raw;


    if (
      !text ||
      seen.has(text)
    ) {
      return;
    }


    seen.add(text);


    merged.push({
      label: text,
      personalized
    });
  };


  (
    Array.isArray(recurringSymptoms)
      ? recurringSymptoms
      : []
  ).forEach(
    (item) =>
      push(
        item?.symptom,
        true
      )
  );


  DEFAULT_QUICK_SYMPTOMS.forEach(
    (label) =>
      push(
        label,
        false
      )
  );


  return merged.slice(
    0,
    QUICK_SYMPTOM_LIMIT
  );
};


// ==========================================
// Step 4A-1：高齡友善模式
// ==========================================

// ==========================================
// 上方控制項的共用尺寸
//
// 原本五個控制項各寫一組 padding（6px 12px / 5px 9px / 5px 12px）
// 與兩種字級，排在同一列時高度不齊。這裡統一尺寸，
// 各控制項只覆寫顏色與狀態差異。
//
// 框線用長寫（borderWidth / Style / Color）而非 border 簡寫，
// 免得覆寫單一屬性時被簡寫蓋掉。
// ==========================================

const CONTROL_CHIP = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '5px',
  boxSizing: 'border-box',
  minHeight: '34px',
  padding: '0 12px',
  borderRadius: '8px',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: t.border,
  backgroundColor: t.panel,
  color: t.text,
  fontSize: '0.8rem',
  fontWeight: 500,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};


// 載入歷史對話時的假對話骨架。寬度寫死，每次長一樣，不要亂跳。
// ponytail: 一個陣列就夠，不做隨機產生器。
const SKELETON_ROWS = [
  { mine: false, bars: ['220px', '150px'] },
  { mine: true, bars: ['180px'] },
  { mine: false, bars: ['260px', '190px'] },
  { mine: true, bars: ['120px'] },
];

function SymptomChecker({
  user,
  isConnected,
  statusText,
  selectedSessionId,
  onSessionLoaded,
  openHistorySidebar = false,
  onOpenHistory,
  onCloseHistory
}) {

  // ==========================================
  // AI 對話
  // ==========================================
  // 開場不放招呼語：開場畫面本身就有「今天哪裡不舒服？」與使用說明，
  // 再擺一則同義的 AI 訊息只是重複。而且開場狀態刻意不渲染訊息陣列，
  // 招呼語會在使用者送出第一則之後才回頭冒出來，看起來像 bug。
  //
  // 這則訊息從未進過送給後端的 history（那是另一個 state），拿掉不影響問診上下文。
  const [messages, setMessages] = useState([]);


  const [inputText, setInputText] =
    useState('');


  const [painLevel, setPainLevel] =
    useState(3);


  const [loading, setLoading] =
    useState(false);


  // ==========================================
  // 等待階段提示
  //
  // 文字依「經過時間」切換，不是後端回報的真實進度；
  // 但描述順序與後端實際流程一致（安全篩檢 → 衛教檢索 → 科別建議），
  // 秒數取自實測：安全抽取約 3.5s、RAG 約 2~3s、主問診約 1.2s，
  // 加上資料庫往返，暖機狀態總計 12~24 秒。
  // ==========================================
  const [waitStage, setWaitStage] =
    useState(0);


  useEffect(() => {

    if (!loading) return;

    const timers = [
      setTimeout(
        () => setWaitStage(1),
        5000
      ),
      setTimeout(
        () => setWaitStage(2),
        10000
      ),
      setTimeout(
        () => setWaitStage(3),
        20000
      )
    ];

    return () =>
      timers.forEach(
        clearTimeout
      );

  }, [loading]);


  const WAIT_MESSAGES = [
    '正在評估安全風險…',
    '正在查詢衛教資料…',
    '正在整理科別建議…',
    '伺服器回應較慢，請再稍候…'
  ];


  // ==========================================
  // Step 4A-1：高齡友善模式
  //
  // 使用 localStorage 記住使用者選擇，
  // 下次回到 CarePath AI 時維持同一模式。
  // ==========================================
  // 狀態改由 ElderModeContext 持有 —— 放在這裡的話，切到 Dashboard
  // 或縱向趨勢時元件卸載，使用者開的大字模式就沒了。
  const {
    elderMode: elderFriendlyMode,
    toggleElderMode: handleToggleElderFriendlyMode
  } = useElderMode();


  // 開場狀態：只有招呼語、還沒送出任何症狀。這時候不排聊天氣泡，
  // 改成置中的品牌圖 + 一句大標，讓使用者知道要打什麼。
  // 從 Dashboard 點進歷史對話時，要先去撈 /api/v1/history，這段時間畫面不能空著。
  // selectedSessionId 一開始就有值的話直接從 true 起跳，不然會先閃一下開場畫面。
  const [sessionLoading, setSessionLoading] =
    useState(selectedSessionId != null);

  const isOpening = messages.length === 0 && !loading && !sessionLoading;


  // ==========================================
  // 修復：Dashboard「查看全部紀錄」
  //
  // 一般開場畫面仍維持乾淨版面；
  // 只有 App.jsx 明確要求時，
  // 才在開場狀態強制顯示完整 HistorySidebar。
  // ==========================================
  // 只在使用者點頂部「最近問診」時顯示。原本問診中也常駐一欄，
  // 等於同一份歷史有兩個入口，而頂部分頁本來就隨時都在。
  const shouldShowHistorySidebar =
    openHistorySidebar;


  // 開場版面沒有左邊側欄，所以自己撈一小份最近問診放在最下面，
  // 不然使用者在開場畫面完全找不到歷史對話。
  const [recentSessions, setRecentSessions] = useState([]);

  // 撈這排要 1~2 秒（雲端資料庫在新加坡）。先佔位，畫面才不會突然跳出來。
  const [recentLoading, setRecentLoading] = useState(true);


  const [history, setHistory] =
    useState([]);


  // ==========================================
  // 一般問診完成結果
  // ==========================================
  const [
    diagnosisResult,
    setDiagnosisResult
  ] = useState(null);


  // ==========================================
  // Medical Safety Alert
  //
  // 專門保存後端回傳：
  // status = "safety_alert"
  // ==========================================
  const [
    safetyAlert,
    setSafetyAlert
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
  // Safety Alert：尋找附近急診
  // ==========================================
  const handleOpenNearbyEmergency = () => {

    const latitude =
      userLocation?.latitude ??
      FALLBACK_LOCATION.latitude;

    const longitude =
      userLocation?.longitude ??
      FALLBACK_LOCATION.longitude;

    const mapUrl =
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `急診 ${latitude},${longitude}`
      )}`;

    window.open(
      mapUrl,
      '_blank',
      'noopener,noreferrer'
    );
  };


  // ==========================================
  // 歷史問診 → 返回最近問診
  // ==========================================
  const handleReturnToHistory = () => {

    setIsVisitSummaryOpen(
      false
    );


    setFullscreenSection(
      null
    );


    if (
      typeof onOpenHistory ===
        'function'
    ) {

      onOpenHistory();

      return;
    }


    // Fallback：若父層沒有提供 callback，
    // 至少回到新的問診開場。
    handleNewChat();
  };


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
  // Step 2B-2：縱向健康趨勢 Modal
  // ==========================================
  const [
    isLongitudinalOpen,
    setIsLongitudinalOpen
  ] = useState(false);


  // ==========================================
  // 縱向健康資料刷新 Key
  //
  // 每次完成一筆正式問診後遞增，
  // 如果健康趨勢面板正在開啟，
  // LongitudinalHealthPanel 會重新取得最新資料。
  // ==========================================
  const [
    longitudinalRefreshKey,
    setLongitudinalRefreshKey
  ] = useState(0);


  // ==========================================
  // Step 3B-2：AI 就醫摘要
  //
  // currentSessionId：
  // - 一般新問診完成後由 /diagnose.session_id 取得
  // - 載入歷史問診時由 session.id 取得
  //
  // Emergency 即時警示目前使用背景保存，
  // Response 不等待資料庫，因此當下不會取得 session_id。
  // Emergency 歷史紀錄之後仍可從 History 開啟摘要。
  // ==========================================
  const [
    currentSessionId,
    setCurrentSessionId
  ] = useState(null);


  // ==========================================
  // 是否正在查看「歷史問診」
  //
  // fresh consultation = false
  // HistorySidebar / Dashboard history = true
  // ==========================================
  const [
    isViewingHistorySession,
    setIsViewingHistorySession
  ] = useState(false);


  const [
    isVisitSummaryOpen,
    setIsVisitSummaryOpen
  ] = useState(false);


  const [
    visitSummaryRefreshKey,
    setVisitSummaryRefreshKey
  ] = useState(0);


  // ==========================================
  // 就醫摘要 Session ID 自動恢復
  // ==========================================

  const [
    visitSummaryResolving,
    setVisitSummaryResolving
  ] = useState(false);


  const [
    visitSummaryResolveError,
    setVisitSummaryResolveError
  ] = useState('');


  // ==========================================
  // 高齡模式：院所清單展開
  // ==========================================

  const [
    showAllHospitals,
    setShowAllHospitals
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
  // 快捷症狀清單
  //
  // 只存後端回來的常問症狀原始資料，
  // 實際清單由 useMemo 推導。
  //
  // 連同 userId 一起存的理由：
  // 訪客、登出、換帳號都只要靠推導條件擋掉，
  // 不需要在 effect 裡同步 setState 清空
  // （那會造成串聯 render），
  // 也不會讓上一個帳號的常問症狀
  // 閃現在下一個帳號的畫面上。
  // ==========================================
  const [
    recurringSymptoms,
    setRecurringSymptoms
  ] = useState({
    userId: null,
    items: []
  });


  const isMember =
    !!user &&
    !user.is_guest;


  // 先渲染預設值，個人化資料回來後再換掉。
  // 刻意不擋畫面：問診是主要入口，
  // 快捷標籤不值得讓使用者等一個網路來回。
  const quickSymptoms = useMemo(
    () =>
      mergeQuickSymptoms(
        isMember &&
          recurringSymptoms.userId === user?.id
          ? recurringSymptoms.items
          : []
      ),
    [
      isMember,
      recurringSymptoms,
      user?.id
    ]
  );


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
  // 讀取會員常問症狀，填入快捷標籤
  //
  // 訪客不打這支 API——後端一定回 403，
  // 沒必要每次進畫面都製造一筆失敗請求。
  //
  // 任何失敗都靜默不處理：
  // 清單自然維持預設值，
  // 快捷標籤是輔助功能，不該干擾問診。
  // ==========================================
  useEffect(() => {

    if (!isMember) {
      return;
    }


    const userId = user?.id;

    let cancelled = false;


    (async () => {

      try {

        const response = await api.get(
          '/api/v1/longitudinal',
          {
            params: {
              window_days:
                QUICK_SYMPTOM_WINDOW_DAYS
            }
          }
        );


        if (cancelled) {
          return;
        }


        if (
          response.data?.status !== 'success'
        ) {
          return;
        }


        // recurring_symptoms 巢狀在 analysis 底下，
        // 與 LongitudinalHealthPanel 讀法一致
        const items =
          response.data.analysis
            ?.recurring_symptoms;


        // 「查無常問症狀」會回空陣列；
        // 完全沒有這個欄位代表回傳結構跟預期不符。
        // 靜默退回預設值會讓這種錯誤看不出來，
        // 因此這裡明確警告。
        if (!Array.isArray(items)) {

          console.warn(
            '⚠️ 縱向分析回傳缺少 analysis.recurring_symptoms，快捷標籤沿用預設值'
          );

          return;
        }


        setRecurringSymptoms({
          userId,
          items
        });

      } catch (error) {

        if (!cancelled) {

          console.log(
            '⚠️ 常問症狀載入失敗，快捷標籤退回預設值',
            error?.response?.status ||
              error?.message
          );
        }
      }
    })();


    return () => {
      cancelled = true;
    };

  }, [isMember, user?.id]);



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
  // Step 4A-1：切換高齡友善模式
  // ==========================================

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
  // Step 2B-2：開啟縱向健康趨勢
  //
  // Guest 也允許打開面板，
  // 由後端 403 + LongitudinalHealthPanel
  // 顯示「登入會員即可查看健康趨勢」。
  // ==========================================
  const handleOpenLongitudinal = () => {

    setLongitudinalRefreshKey(
      (current) =>
        current + 1
    );


    setIsLongitudinalOpen(
      true
    );
  };


  const handleCloseLongitudinal = () => {

    setIsLongitudinalOpen(
      false
    );
  };


  // ==========================================
  // Step 3B-2 + Fix：
  // 就醫摘要 Session ID 自動恢復
  //
  // 正常情況：
  // - 新問診：直接使用 /diagnose 回傳 session_id
  // - 歷史問診：直接使用 session.id
  //
  // 若前端暫時沒有拿到 session_id，
  // 會員可從 /api/v1/history 找回本次最近紀錄。
  // ==========================================

  const resolveVisitSummarySessionId =
    async () => {

      if (
        currentSessionId !== null
        &&
        currentSessionId !== undefined
      ) {
        return currentSessionId;
      }


      if (user?.is_guest) {
        return null;
      }


      setVisitSummaryResolving(
        true
      );


      setVisitSummaryResolveError(
        ''
      );


      try {

        const response =
          await api.get(
            '/api/v1/history'
          );


        const sessions =
          Array.isArray(
            response.data
          )
            ? [
                ...response.data
              ]
            : [];


        sessions.sort(
          (
            a,
            b
          ) =>
            (
              Number(
                b?.id
              )
              ||
              0
            )
            -
            (
              Number(
                a?.id
              )
              ||
              0
            )
        );


        const targetSymptom =
          String(
            diagnosisResult?.symptom
            ||
            ''
          ).trim();


        const targetDepartment =
          String(
            diagnosisResult
              ?.suggested_department
            ||
            ''
          ).trim();


        const match =
          sessions.find(
            (
              session
            ) => {

              const originalSymptom =
                String(
                  session
                    ?.original_symptom
                  ||
                  ''
                ).trim();


              const latestSymptom =
                String(
                  session
                    ?.symptom_text
                  ||
                  ''
                ).trim();


              return (
                targetSymptom
                &&
                (
                  originalSymptom
                  ===
                  targetSymptom
                  ||
                  latestSymptom
                  ===
                  targetSymptom
                )
              );
            }
          )
          ||
          sessions.find(
            (
              session
            ) => {

              return (
                targetDepartment
                &&
                String(
                  session
                    ?.suggested_department
                  ||
                  ''
                ).trim()
                ===
                targetDepartment
                &&
                Number(
                  session?.pain_level
                )
                ===
                Number(
                  painLevel
                )
              );
            }
          );


        if (
          match?.id !== null
          &&
          match?.id !== undefined
        ) {

          setCurrentSessionId(
            match.id
          );


          return match.id;
        }


        setVisitSummaryResolveError(
          '目前找不到對應的就醫摘要紀錄，請重新整理後再試。'
        );


        return null;

      } catch (error) {

        console.error(
          '就醫摘要 Session ID 同步失敗：',
          error
        );


        setVisitSummaryResolveError(
          '就醫摘要同步失敗，請稍後再試。'
        );


        return null;

      } finally {

        setVisitSummaryResolving(
          false
        );
      }
    };


  // ==========================================
  // 開啟 AI 就醫摘要
  // ==========================================

  const handleOpenVisitSummary =
    async () => {

      let sessionId =
        currentSessionId;


      if (
        sessionId === null
        ||
        sessionId === undefined
      ) {

        sessionId =
          await resolveVisitSummarySessionId();
      }


      if (
        sessionId === null
        ||
        sessionId === undefined
      ) {

        return;
      }


      setVisitSummaryRefreshKey(
        (current) =>
          current + 1
      );


      setIsVisitSummaryOpen(
        true
      );
    };


  const handleCloseVisitSummary = () => {

    setIsVisitSummaryOpen(
      false
    );
  };


  // ==========================================
  // 發送 AI 問診
  // ==========================================
  const handleSendMessage = async (e) => {

    e.preventDefault();


    if (
      !inputText.trim() ||
      loading ||
      safetyAlert
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

    // 階段是「這次送出」的狀態，在這裡歸零而不是在 effect 裡，
    // 才不會變成 effect 內的同步 setState。
    setWaitStage(0);


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


      console.log(
        '診斷 API 回傳：',
        data
      );


      // ======================================
      // Medical Safety Alert
      //
      // safety_alert 必須優先於 is_complete。
      // emergency 會 is_complete = true，
      // 但不可被當成一般問診完成。
      // ======================================
      if (
        data.status ===
        'safety_alert'
      ) {

        console.warn(
          '🛡️ Medical Safety Alert:',
          data.safety
        );


        const safetyHistory =
          Array.isArray(
            data.history
          ) &&
          data.history.length > 0
            ? data.history
            : [
                ...newMessages,
                {
                  role: 'model',
                  content:
                    data.message ||
                    '⚠️ 偵測到需要優先處理的醫療安全警訊。'
                }
              ];


        setMessages(
          safetyHistory
        );


        setHistory(
          safetyHistory
        );


        setSafetyAlert(
          data
        );


        setDiagnosisResult(
          null
        );


        // Emergency 即時 Response 尚未取得背景保存後的 session_id，
        // 因此清除上一筆摘要狀態，避免誤開舊摘要。
        setCurrentSessionId(
          null
        );


        setIsVisitSummaryOpen(
          false
        );


        setShowCompleteModal(
          false
        );


        setCountdownStep(
          0
        );


        setViewMode(
          'chat-only'
        );


        return;
      }


      // ======================================
      // 非 safety_alert
      // ======================================
      setSafetyAlert(
        null
      );


      // ======================================
      // AI 還需要追問
      //
      // standard / urgent 都可能走這裡。
      // ======================================
      if (!data.is_complete) {

        const nextHistory =
          Array.isArray(
            data.history
          ) &&
          data.history.length > 0
            ? data.history
            : [
                ...newMessages,
                {
                  role: 'model',
                  content:
                    data.message
                }
              ];


        setMessages(
          nextHistory
        );


        setHistory(
          nextHistory
        );


        return;
      }


      // ======================================
      // 一般問診完成
      // ======================================
      const completedHistory =
        Array.isArray(
          data.history
        ) &&
        data.history.length > 0
          ? data.history
          : [
              ...newMessages,
              {
                role: 'model',
                content:
                  data.message
              }
            ];


      setMessages(
        completedHistory
      );


      setHistory(
        completedHistory
      );


      setDiagnosisResult(
        data
      );


      setIsViewingHistorySession(
        false
      );


      setVisitSummaryResolveError(
        ''
      );


      setShowAllHospitals(
        false
      );


      // ======================================
      // Step 3B-2：保存本次新問診的 Session ID
      // ======================================
      setCurrentSessionId(
        data.session_id
        ??
        null
      );


      // 更新歷史紀錄
      window.dispatchEvent(
        new Event(
          'refresh-history'
        )
      );


      // ======================================
      // Step 2B-2：刷新縱向健康資料
      // ======================================
      setLongitudinalRefreshKey(
        (current) =>
          current + 1
      );


      // ======================================
      // 三燈倒數
      // ======================================
      setShowCompleteModal(
        true
      );


      setCountdownStep(
        1
      );


      setTimeout(
        () =>
          setCountdownStep(
            2
          ),
        1000
      );


      setTimeout(
        () =>
          setCountdownStep(
            3
          ),
        2000
      );


      setTimeout(
        () => {

          setShowCompleteModal(
            false
          );


          setCountdownStep(
            0
          );


          setViewMode(
            'split-screen'
          );

        },
        3000
      );

    } catch (error) {

      console.error(
        '問診請求失敗:',
        error
      );


      // 分辨錯誤類型再給訊息。統一講「連線有問題」會讓人往錯的方向查。
      const status =
        error.response?.status;

      let hint;

      if (!error.response) {
        // 完全沒收到回應：網路中斷、請求被瀏覽器擋下，或伺服器中途斷線
        hint =
          '⚠️ 連線中斷，沒有收到伺服器回應。請檢查網路後再送出一次。';

      } else if (status === 401) {
        hint =
          '⚠️ 登入狀態已失效，請重新整理頁面後再試一次。';

      } else if (status === 403) {
        hint =
          '⚠️ 這項功能需要正式帳號，請先登入或註冊。';

      } else if (status >= 500) {
        hint =
          '⚠️ 伺服器處理時發生錯誤，請稍候再送出一次。';

      } else {
        hint =
          `⚠️ 問診請求失敗（${status}），請稍候再試一次。`;
      }


      setMessages([
        ...newMessages,

        {
          role: 'model',
          content: hint
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

    // 問診區在清單模式下是隱藏的；選了紀錄就是要看那一次的結果，
    // 不收掉清單的話內容雖然載入了，畫面卻停在原地，看起來像沒反應。
    onCloseHistory?.();

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


    setSafetyAlert(
      null
    );


    // Step 3B-2：歷史問診直接使用資料庫 Session ID
    setCurrentSessionId(
      session.id
      ??
      null
    );


    setIsViewingHistorySession(
      true
    );


    setIsVisitSummaryOpen(
      false
    );


    setVisitSummaryResolveError(
      ''
    );


    setShowAllHospitals(
      false
    );


    setDiagnosisResult({
      status:
        'completed',

      is_complete:
        true,

      session_id:
        session.id
        ??
        null,

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
  // 開場畫面的「最近問診」
  // ==========================================
  useEffect(() => {

    if (!isOpening) {
      return;
    }

    let cancelled = false;

    setRecentLoading(true);

    api
      .get('/api/v1/history')
      .then((res) => {

        if (cancelled) {
          return;
        }

        setRecentSessions(
          Array.isArray(res.data)
            ? res.data.slice(0, 4)
            : []
        );
      })
      .catch(() => {
        // 撈不到就不顯示這排，不用擋住開場畫面
      })
      .finally(() => {

        if (!cancelled) {
          setRecentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };

  }, [isOpening]);


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

    setSessionLoading(true);


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

          if (!cancelled) {
            setSessionLoading(false);
          }

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


    setCurrentSessionId(
      null
    );


    setIsViewingHistorySession(
      false
    );


    setIsVisitSummaryOpen(
      false
    );


    setVisitSummaryResolveError(
      ''
    );


    setShowAllHospitals(
      false
    );


    setSafetyAlert(
      null
    );


    setShowCompleteModal(
      false
    );


    setCountdownStep(
      0
    );


    setMessages([]);


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
  // Step 4A-2：目前最需要回答的 AI 問題
  //
  // 高齡模式只特別突出最後一則 AI 訊息，
  // 過去 AI 訊息降低視覺權重，但不刪除內容。
  // ==========================================

  const latestModelMessageIndex =
    messages.reduce(
      (
        latestIndex,
        message,
        index
      ) =>
        message.role === 'model'
          ? index
          : latestIndex,
      -1
    );


  // ==========================================
  // UI
  // ==========================================
  // 個人健康資料 / 健康趨勢 / 定位 / 不適度。開場版面要把它們塞進輸入框裡，
  // 一般版面則留在標題列右邊，所以抽成變數只寫一次。
  const controlsRow = (
              <div
                className="elder-primary-controls"

                style={{
                  display:
                    'flex',

                  alignItems:
                    'center',

                  gap:
                    elderFriendlyMode
                      ? '10px'
                      : '8px',

                  flexWrap:
                    elderFriendlyMode
                      ? 'wrap'
                      : 'nowrap'
                }}
              >

                {/* Step 4A-1：高齡友善模式 */}

                <button
                  type="button"

                  onClick={
                    handleToggleElderFriendlyMode
                  }

                  aria-pressed={
                    elderFriendlyMode
                  }

                  title={
                    elderFriendlyMode
                      ? '關閉高齡模式'
                      : '開啟高齡模式'
                  }

                  style={{
                    ...CONTROL_CHIP,

                    // 開啟時只加深顏色與字重，尺寸不變，
                    // 免得這一顆比隔壁高一截。
                    ...(elderFriendlyMode
                      ? {
                          backgroundColor: '#0f172a',
                          color: '#ffffff',
                          borderColor: '#0f172a',
                          fontWeight: 700,
                        }
                      : {}),

                    cursor:
                      'pointer'
                  }}
                >
                  {elderFriendlyMode && (
                    <Icon path={mdiCheck} size="1em" />
                  )}
                  {elderFriendlyMode
                    ? ' 高齡模式'
                    : '高齡模式'}
                </button>


                {/* 個人健康資料 */}

                <button
                  type="button"

                  onClick={
                    handleOpenProfile
                  }

                  style={{
                    ...CONTROL_CHIP,

                    color:
                      user?.is_guest
                        ? t.muted
                        : t.text,

                    cursor:
                      'pointer'
                  }}
                >
                  個人健康資料
                </button>


                {/* 定位狀態 */}

                <div
                  className="elder-secondary-control elder-control-chip"

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
                    ...CONTROL_CHIP,

                    color:
                      locationStatus ===
                      'success'
                        ? t.text
                        : t.muted
                  }}
                >

                  <Icon
                    path={
                      locationStatus === 'success'
                        ? mdiMapMarkerCheck
                        : mdiMapMarker
                    }
                    size="1em"
                  />
                  {locationStatus ===
                  'success'
                    ? ' 已定位'
                    : locationStatus ===
                      'loading'
                      ? ' 定位中'
                      : ' 備援位置'}

                </div>


                {/* 不適程度 */}

                <div
                  className="elder-control-chip"

                  style={{
                    ...CONTROL_CHIP,

                    gap:
                      '8px',

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
  );

  return (

    <div
      style={{
        display:
          'flex',

        gap:
          '16px',

        maxWidth:
          '1700px',

        flex: 1,

        minHeight: 0,

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

      {shouldShowHistorySidebar && (
      <div
        style={{
          flex: 1,
          maxWidth: '860px',
          margin: '0 auto',
          height: '100%',
          minWidth: 0
        }}
      >

        <HistorySidebar
          asPage

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
      )}


      {/* ==================================== */}
      {/* 主畫面 */}
      {/* ==================================== */}

      <div
        style={{
          // 顯示歷史清單時整個問診區收起來 —— 一次只呈現一件事
          display:
            shouldShowHistorySidebar
              ? 'none'
              : undefined,

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
              maxWidth: isOpening
                ? '860px'
                : '780px',

              height:
                '100%',

              margin:
                '0 auto',

              backgroundColor: isOpening
                ? 'transparent'
                : t.panel,

              borderRadius:
                '12px',

              border: isOpening
                ? 'none'
                : `1px solid ${t.border}`,

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

            {!isOpening && (
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
                    CarePath AI
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


              {controlsRow}

            </div>
            )}


            {/* ============================== */}
            {/* Medical Safety Alert */}
            {/* ============================== */}

            {safetyAlert && (
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  margin: '14px 4px 8px',
                  padding: '18px',
                  borderRadius: '14px',
                  border: '1px solid #dc2626',
                  backgroundColor: '#fff7f7',
                  boxShadow: '0 6px 18px rgba(127, 29, 29, 0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '50%',
                      backgroundColor: '#dc2626',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: '1.15rem',
                      fontWeight: 700,
                    }}
                  >
                    !
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong
                        style={{
                          color: '#991b1b',
                          fontSize: '1rem',
                        }}
                      >
                        緊急醫療警示
                      </strong>

                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: '#dc2626',
                          color: '#ffffff',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                        }}
                      >
                        {safetyAlert?.safety?.risk_label || '緊急'}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: '8px',
                        color: '#7f1d1d',
                        fontSize: '0.88rem',
                        lineHeight: 1.7,
                      }}
                    >
                      {safetyAlert?.safety?.safety_action ||
                        safetyAlert?.message ||
                        '偵測到需要立即處理的高風險警訊，請儘速尋求緊急醫療協助。'}
                    </div>

                    {Array.isArray(
                      safetyAlert?.safety?.red_flags
                    ) &&
                    safetyAlert.safety.red_flags.length > 0 && (
                      <div
                        style={{
                          marginTop: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        {safetyAlert.safety.red_flags.map(
                          (flag, index) => (
                            <div
                              key={`${flag.code || 'safety'}-${index}`}
                              style={{
                                padding: '8px 10px',
                                borderRadius: '8px',
                                backgroundColor: '#ffffff',
                                border: '1px solid #fecaca',
                              }}
                            >
                              <div
                                style={{
                                  color: '#991b1b',
                                  fontWeight: 600,
                                  fontSize: '0.82rem',
                                }}
                              >
                                {flag.title || flag.code}
                              </div>

                              {flag.reason && (
                                <div
                                  style={{
                                    marginTop: '3px',
                                    color: '#7f1d1d',
                                    fontSize: '0.78rem',
                                    lineHeight: 1.55,
                                  }}
                                >
                                  {flag.reason}
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        marginTop: '14px',
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        onClick={handleOpenNearbyEmergency}
                        style={{
                          border: 'none',
                          backgroundColor: '#dc2626',
                          color: '#ffffff',
                          borderRadius: '8px',
                          padding: '9px 14px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        尋找附近急診
                      </button>

                      <a
                        href="tel:119"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          border: '1px solid #dc2626',
                          color: '#991b1b',
                          backgroundColor: '#ffffff',
                          borderRadius: '8px',
                          padding: '9px 14px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        撥打 119
                      </a>

                      <button
                        type="button"
                        onClick={handleNewChat}
                        style={{
                          border: `1px solid ${t.border}`,
                          backgroundColor: t.panel,
                          color: t.text,
                          borderRadius: '8px',
                          padding: '9px 14px',
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                        }}
                      >
                        開始新問診
                      </button>
                    </div>

                    <div
                      style={{
                        marginTop: '10px',
                        color: '#991b1b',
                        fontSize: '0.74rem',
                        lineHeight: 1.5,
                      }}
                    >
                      此警示為安全風險篩檢結果，不是疾病診斷；若症狀嚴重、快速惡化或您感到生命受到威脅，請立即尋求緊急醫療協助。
                    </div>
                  </div>
                </div>
              </div>
            )}


            {/* ============================== */}
            {/* 對話 */}
            {/* ============================== */}

            <div
              style={{
                flex: isOpening ? '0 0 auto' : 1,
                overflowY: isOpening ? 'visible' : 'auto',
                padding: isOpening ? '48px 4px 20px' : '20px 4px',
                marginBottom: '12px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                alignItems: isOpening ? 'center' : 'stretch',
              }}
            >

              {sessionLoading && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '20px',
                    width: '100%',
                    animation: 'skeleton-pulse 1.5s ease-in-out infinite',
                  }}
                >
                  {SKELETON_ROWS.map((row, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        gap: '10px',
                        alignItems: 'flex-start',
                        flexDirection: row.mine ? 'row-reverse' : 'row',
                      }}
                    >
                      <div
                        style={{
                          width: '30px',
                          height: '30px',
                          borderRadius: '50%',
                          backgroundColor: t.border,
                          flexShrink: 0,
                        }}
                      />

                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '7px',
                          alignItems: row.mine ? 'flex-end' : 'flex-start',
                        }}
                      >
                        {row.bars.map((w, j) => (
                          <div
                            key={j}
                            style={{
                              width: w,
                              height: '13px',
                              borderRadius: '7px',
                              backgroundColor: t.border,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isOpening && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '18px',
                    textAlign: 'center',
                    paddingBottom: '8px',
                  }}
                >
                  <CarePathWordmark size={180} />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div
                      style={{
                        fontSize: '1.65rem',
                        fontWeight: 700,
                        color: t.text,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      今天哪裡不舒服？
                    </div>

                    <div
                      style={{
                        fontSize: '0.9rem',
                        color: t.muted,
                        maxWidth: '460px',
                        lineHeight: 1.6,
                      }}
                    >
                      用你自己的話講就好，我會判斷該看哪一科，再幫你找附近的院所。
                    </div>
                  </div>
                </div>
              )}

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
                      className={
                        [
                          'elder-readable-text',
                          (
                            msg.role === 'model'
                            &&
                            index === latestModelMessageIndex
                          )
                            ? 'elder-focus-question'
                            : '',
                          (
                            msg.role === 'model'
                            &&
                            index !== latestModelMessageIndex
                          )
                            ? 'elder-previous-model-message'
                            : ''
                        ]
                          .filter(Boolean)
                          .join(' ')
                      }

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


                  <span
                    style={{
                      fontSize:
                        elderFriendlyMode
                          ? '1rem'
                          : '0.82rem',

                      color:
                        t.muted
                    }}
                  >
                    {
                      WAIT_MESSAGES[
                        waitStage
                      ]
                    }
                  </span>

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

            {isOpening && (

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                  justifyContent: 'center',
                  order: 2,
                }}
              >

                {quickSymptoms.map(
                  (
                    item
                  ) => (

                    <button
                      key={
                        item.label
                      }

                      type="button"

                      onClick={() =>
                        setInputText(
                          item.label
                        )
                      }

                      title={
                        item.personalized
                          ? '您常問的症狀'
                          : undefined
                      }

                      style={{
                        // 常問症狀：淡藍底 + 同色框線，
                        // 與預設標籤的白底灰框區隔。
                        border:
                          item.personalized
                            ? '1px solid #BFDBFE'
                            : `1px solid ${t.border}`,

                        backgroundColor:
                          item.personalized
                            ? '#EFF6FF'
                            : t.panel,

                        color:
                          item.personalized
                            ? t.text
                            : t.muted,

                        borderRadius:
                          '16px',

                        padding:
                          '5px 14px',

                        fontSize:
                          '0.8rem',

                        display:
                          'inline-flex',

                        alignItems:
                          'center',

                        gap:
                          '4px',

                        cursor:
                          'pointer'
                      }}
                    >
                      {
                        item.personalized &&
                          <span
                            aria-hidden="true"
                          >
                            ↺
                          </span>
                      }

                      {
                        item.label
                      }
                    </button>

                  )
                )}

              </div>

            )}


            {/* ============================== */}
            {/* 輸入框 */}
            {/* ============================== */}

            {/* 開場版面要把輸入框和三顆控制項合成一張卡。
                ponytail: 非開場時用 display:contents 讓這層消失，不用寫兩套 JSX。 */}
            {!safetyAlert && (
            <div
              style={
                isOpening
                  ? {
                      order: 1,
                      alignSelf: 'center',
                      width: '100%',
                      maxWidth: '760px',
                      boxSizing: 'border-box',
                      backgroundColor: t.panel,
                      border: `1px solid ${t.border}`,
                      borderRadius: '16px',
                      padding: '6px 8px 12px',
                      marginBottom: '18px',
                      boxShadow: '0 4px 16px rgba(15,40,50,0.06)',
                    }
                  : { display: 'contents' }
              }
            >

            {
              elderFriendlyMode
              &&
              !isOpening
              &&
              messages[
                latestModelMessageIndex
              ]?.role === 'model'
              &&
              (
                <div
                  style={{
                    margin:
                      '0 0 10px',

                    padding:
                      '10px 14px',

                    borderRadius:
                      '10px',

                    backgroundColor:
                      '#f8fafc',

                    border:
                      '1px solid #cbd5e1',

                    color:
                      '#334155',

                    fontSize:
                      '0.95rem',

                    fontWeight:
                      700,

                    lineHeight:
                      1.6
                  }}
                >
                  請先回答上方目前這一題即可。
                </div>
              )
            }


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

                border: isOpening
                  ? 'none'
                  : `1px solid ${t.border}`,

                borderRadius:
                  '24px',

                padding:
                  '6px 6px 6px 18px',

                backgroundColor: isOpening
                  ? 'transparent'
                  : t.panel
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

                placeholder="傳訊息給 CarePath AI..."

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

            {isOpening && (
              <>
                <div
                  style={{
                    height: '1px',
                    backgroundColor: t.border,
                    margin: '4px 10px 10px',
                  }}
                />

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '0 10px',
                  }}
                >
                  {controlsRow}
                </div>
              </>
            )}

            </div>

            )}

            {/* 開場版面的最近問診：側欄收起來了，這裡是唯一入口 */}
            {
              isOpening
              &&
              !openHistorySidebar
              &&
              !elderFriendlyMode
              &&
              (
                recentLoading
                ||
                recentSessions.length > 0
              )
              &&
              (
              <div
                style={{
                  order: 3,
                  marginTop: 'auto',
                  paddingTop: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: t.muted }}>
                  最近問診
                </span>

                {recentLoading
                  ? ['96px', '96px', '84px'].map((w, i) => (
                      <div
                        key={i}
                        style={{
                          width: w,
                          height: '31px',
                          borderRadius: '8px',
                          backgroundColor: t.border,
                          animation: 'skeleton-pulse 1.5s ease-in-out infinite',
                        }}
                      />
                    ))
                  : recentSessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectSession(session)}
                    style={{
                      border: `1px solid ${t.border}`,
                      backgroundColor: t.panel,
                      color: t.text,
                      borderRadius: '8px',
                      padding: '7px 13px',
                      fontSize: '0.76rem',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      maxWidth: '180px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {session.title || session.symptom_text || '未命名問診'}
                  </button>
                ))}
              </div>
            )}

          </div>

        ) : (

          // ==================================
          // 完整結果模式
          // ==================================

          <div
            style={{
              display:
                'grid',

              // 高齡模式一律單欄。原本兩欄的最小寬度合計超過 880px，
              // 字級放大後更容易擠爆，問診對話歷程會被右欄蓋掉。
              // 直線閱讀對長輩本來也比左右對照容易。
              gridTemplateColumns:
                elderFriendlyMode
                  ? '1fr'
                  : '1fr 1fr',

              gap:
                elderFriendlyMode
                  ? '16px'
                  : '20px',

              // 單欄堆疊後總高度會超過一個畫面，鎖死 100% 會讓後面的內容
              // 溢出容器、視覺上疊在一起
              height:
                elderFriendlyMode
                  ? 'auto'
                  : '100%',

              overflowY:
                'visible',

              paddingBottom:
                0
            }}
          >

            {/* ============================== */}
            {/* 結果頁模式切換 */}
            {/* ============================== */}

            <div
              style={{
                gridColumn:
                  '1 / -1',

                display:
                  'flex',

                justifyContent:
                  'space-between',

                alignItems:
                  'center',

                gap:
                  '10px',

                minHeight:
                  '38px'
              }}
            >

              <div>

                {
                  isViewingHistorySession
                  &&
                  !user?.is_guest
                  &&
                  (
                    <button
                      type="button"

                      onClick={
                        handleReturnToHistory
                      }

                      style={{
                        border:
                          `1px solid ${t.border}`,

                        backgroundColor:
                          t.panel,

                        color:
                          t.text,

                        borderRadius:
                          '8px',

                        padding:
                          '7px 12px',

                        fontSize:
                          '0.8rem',

                        fontWeight:
                          600,

                        cursor:
                          'pointer'
                      }}
                    >
                      ← 返回最近問診
                    </button>
                  )
                }

              </div>


              <button
                type="button"

                onClick={
                  handleToggleElderFriendlyMode
                }

                style={{
                  border:
                    `1px solid ${t.border}`,

                  backgroundColor:
                    t.panel,

                  color:
                    t.text,

                  borderRadius:
                    '8px',

                  padding:
                    '7px 12px',

                  fontSize:
                    '0.8rem',

                  fontWeight:
                    600,

                  cursor:
                    'pointer'
                }}
              >
                {
                  elderFriendlyMode
                    ? '切回一般模式'
                    : '切換高齡模式'
                }
              </button>

            </div>


            {/* ============================== */}
            {/* 左側地圖 */}
            {/* ============================== */}

            <div
              style={{
                ...getSectionStyle(
                  'map'
                ),

                height:
                  '100%',

                minHeight:
                  elderFriendlyMode
                    ? '520px'
                    : 0,

                order:
                  elderFriendlyMode
                    ? 2
                    : 0
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
                  0,

                order:
                  elderFriendlyMode
                    ? 1
                    : 0
              }}
            >

              {/* ============================ */}
              {/* 問診歷程 */}
              {/* ============================ */}

              {/* 高齡模式原本把這塊整個藏起來（display:none），
                  推測是想減少長輩看到的資訊量。但使用者要的是「字變大」，
                  不是「東西變少」—— 看不到自己講過什麼反而更難確認結果是
                  依據什麼給的。改為一律顯示，靠單欄堆疊維持易讀。 */}
              <div
                style={{
                  ...getSectionStyle(
                    'chat'
                  ),

                  flex:
                    1,

                  display:
                    'flex'
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

                      onClick={
                        handleOpenLongitudinal
                      }

                      style={{
                        backgroundColor:
                          t.panel,

                        color:
                          t.text,

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
                      健康 Dashboard
                    </button>


                    {currentSessionId != null && (
                      <button
                        type="button"

                        onClick={
                          handleOpenVisitSummary
                        }

                        style={{
                          backgroundColor:
                            t.panel,

                          color:
                            t.text,

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
                        就醫摘要
                      </button>
                    )}


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
                          className={
                            [
                              'elder-readable-text',
                              (
                                msg.role === 'model'
                                &&
                                index === latestModelMessageIndex
                              )
                                ? 'elder-focus-question'
                                : '',
                              (
                                msg.role === 'model'
                                &&
                                index !== latestModelMessageIndex
                              )
                                ? 'elder-previous-model-message'
                                : ''
                            ]
                              .filter(Boolean)
                              .join(' ')
                          }

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
                      {/* Step 3B-2 Fix */}
                      {/* AI 就醫摘要主要入口 */}
                      {/* ====================== */}

                      <div
                        style={{
                          marginBottom:
                            '12px'
                        }}
                      >

                        <button
                          type="button"

                          onClick={
                            handleOpenVisitSummary
                          }

                          disabled={
                            user?.is_guest
                            ||
                            visitSummaryResolving
                          }

                          style={{
                            width:
                              '100%',

                            display:
                              'flex',

                            alignItems:
                              'center',

                            justifyContent:
                              'center',

                            gap:
                              '8px',

                            padding:
                              '11px 14px',

                            borderRadius:
                              '9px',

                            border:
                              user?.is_guest
                                ? `1px solid ${t.border}`
                                : '1px solid #2563eb',

                            backgroundColor:
                              user?.is_guest
                                ? t.subtle
                                : '#2563eb',

                            color:
                              user?.is_guest
                                ? t.muted
                                : '#ffffff',

                            fontSize:
                              '0.85rem',

                            fontWeight:
                              700,

                            cursor:
                              visitSummaryResolving
                                ? 'wait'
                                : user?.is_guest
                                  ? 'not-allowed'
                                  : 'pointer',

                            opacity:
                              user?.is_guest
                                ? 0.72
                                : 1
                          }}
                        >

                          <span>
                            <Icon
                              path={mdiFileDocumentOutline}
                              size="1em"
                            />
                          </span>


                          <span>
                            {
                              user?.is_guest
                                ? '會員可使用 AI 就醫摘要'
                                : visitSummaryResolving
                                  ? '正在同步就醫摘要…'
                                  : '查看 AI 就醫摘要'
                            }
                          </span>

                        </button>


                        {
                          visitSummaryResolveError
                          &&
                          (
                            <div
                              style={{
                                marginTop:
                                  '6px',

                                color:
                                  '#b45309',

                                fontSize:
                                  '0.74rem',

                                lineHeight:
                                  1.5,

                                textAlign:
                                  'center'
                              }}
                            >
                              {
                                visitSummaryResolveError
                              }
                            </div>
                          )
                        }

                      </div>


                      {/* ====================== */}
                      {/* 醫療院所 */}
                      {/* ====================== */}

                      {
                        elderFriendlyMode
                        &&
                        !showAllHospitals
                        &&
                        Array.isArray(
                          diagnosisResult
                            .nearby_medical_resources
                        )
                        &&
                        diagnosisResult
                          .nearby_medical_resources
                          .length > 3
                        &&
                        (
                          <button
                            type="button"

                            onClick={() =>
                              setShowAllHospitals(
                                true
                              )
                            }

                            style={{
                              width:
                                '100%',

                              marginBottom:
                                '10px',

                              padding:
                                '10px 12px',

                              borderRadius:
                                '9px',

                              backgroundColor:
                                t.panel,

                              border:
                                `1px solid ${t.border}`,

                              color:
                                t.text,

                              fontSize:
                                '0.82rem',

                              fontWeight:
                                600,

                              cursor:
                                'pointer'
                            }}
                          >
                            查看全部 {
                              diagnosisResult
                                .nearby_medical_resources
                                .length
                            } 間院所
                          </button>
                        )
                      }


                      {Array.isArray(
                        diagnosisResult
                          .nearby_medical_resources
                      ) &&
                      diagnosisResult
                        .nearby_medical_resources
                        .length > 0 ? (

                        (
                          elderFriendlyMode
                          &&
                          !showAllHospitals
                            ? diagnosisResult
                                .nearby_medical_resources
                                .slice(
                                  0,
                                  3
                                )
                            : diagnosisResult
                                .nearby_medical_resources
                        )
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
                                        {/*
                                          booking_url 是三態，不能用 || 壓成布林：

                                          網址   → 上面的「線上掛號」按鈕
                                          說明文字 → 院方公告的掛號方式，原文照顯示
                                          null   → 我們沒有這家醫院的掛號資訊

                                          健保署開放資料沒有掛號網址，
                                          目前只有人工查證過的醫學中心有值。
                                          把 null 顯示成「現場掛號」等於宣稱
                                          該院沒有線上掛號，那是我們不知道的事。
                                        */}
                                        {
                                          hospital.booking_url ||
                                          '掛號方式請洽院方'
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
                                  {/* 門診時段 */}
                                  {/* */}
                                  {/* 健保署公告的一般門診時段， */}
                                  {/* 不代表當日必定開診， */}
                                  {/* 因此標題寫「院方公告」。 */}
                                  {/* ================== */}

                                  {hospital.opening_hours
                                    ?.summary && (

                                    <div
                                      style={{
                                        color:
                                          t.muted,

                                        marginTop:
                                          '4px'
                                      }}
                                    >

                                      院方公告門診時段：
                                      {
                                        hospital
                                          .opening_hours
                                          .summary
                                      }

                                    </div>

                                  )}


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

                                      (
                                        elderFriendlyMode
                                          ? hospital.available_doctors.slice(
                                              0,
                                              1
                                            )
                                          : hospital.available_doctors
                                      ).map(
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
        {/* Step 2B-2：縱向健康趨勢 Modal */}
        {/* ================================== */}

        {isLongitudinalOpen && (

          <div
            role="dialog"
            aria-modal="true"
            aria-label="我的健康趨勢"

            onClick={
              handleCloseLongitudinal
            }

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
                'rgba(15, 23, 42, 0.52)',

              display:
                'flex',

              justifyContent:
                'center',

              alignItems:
                'center',

              padding:
                '24px',

              boxSizing:
                'border-box',

              zIndex:
                100000
            }}
          >

            <div
              onClick={(e) =>
                e.stopPropagation()
              }

              style={{
                width:
                  'min(1100px, 100%)',

                height:
                  'min(880px, calc(100vh - 48px))',

                backgroundColor:
                  t.bg || '#f8fafc',

                border:
                  `1px solid ${t.border}`,

                borderRadius:
                  '20px',

                boxShadow:
                  '0 24px 70px rgba(15, 23, 42, 0.22)',

                overflow:
                  'hidden',

                display:
                  'flex',

                flexDirection:
                  'column'
              }}
            >

              {/* Modal Header */}

              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  alignItems:
                    'center',

                  gap:
                    '12px',

                  padding:
                    '16px 20px',

                  backgroundColor:
                    t.panel,

                  borderBottom:
                    `1px solid ${t.border}`
                }}
              >

                <div>

                  <div
                    style={{
                      color:
                        t.text,

                      fontSize:
                        '1rem',

                      fontWeight:
                        700
                    }}
                  >
                    健康 Dashboard
                  </div>


                  <div
                    style={{
                      marginTop:
                        '3px',

                      color:
                        t.muted,

                      fontSize:
                        '0.78rem'
                    }}
                  >
                    Longitudinal Health Intelligence
                  </div>

                </div>


                <button
                  type="button"

                  onClick={
                    handleCloseLongitudinal
                  }

                  aria-label="關閉健康 Dashboard"

                  style={{
                    width:
                      '34px',

                    height:
                      '34px',

                    borderRadius:
                      '50%',

                    border:
                      `1px solid ${t.border}`,

                    backgroundColor:
                      t.panel,

                    color:
                      t.text,

                    cursor:
                      'pointer',

                    fontSize:
                      '1.15rem',

                    lineHeight:
                      1
                  }}
                >
                  ×
                </button>

              </div>


              {/* Modal Content */}

              <div
                style={{
                  flex:
                    1,

                  minHeight:
                    0,

                  overflowY:
                    'auto',

                  padding:
                    '20px',

                  boxSizing:
                    'border-box'
                }}
              >

                <DashboardPage
                  user={
                    user
                  }

                  key={
                    longitudinalRefreshKey
                  }

                  onStartConsultation={
                    () => {
                      handleCloseLongitudinal();
                      handleNewChat();
                    }
                  }

                  onViewHistory={
                    () => {
                      handleCloseLongitudinal();
                      onOpenHistory?.();
                    }
                  }

                  onSelectSession={
                    (session) => {
                      handleCloseLongitudinal();
                      handleSelectSession(session);
                    }
                  }
                />

              </div>

            </div>

          </div>

        )}


        {/* ================================== */}
        {/* Step 3B-2：AI 就醫摘要 Modal */}
        {/* ================================== */}

        {isVisitSummaryOpen && currentSessionId != null && (

          <div
            role="dialog"
            aria-modal="true"
            aria-label="AI 就醫摘要"

            onClick={
              handleCloseVisitSummary
            }

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
                'rgba(15, 23, 42, 0.56)',

              display:
                'flex',

              justifyContent:
                'center',

              alignItems:
                'center',

              padding:
                '24px',

              boxSizing:
                'border-box',

              zIndex:
                100001
            }}
          >

            <div
              onClick={(e) =>
                e.stopPropagation()
              }

              style={{
                width:
                  'min(980px, 100%)',

                height:
                  'min(900px, calc(100vh - 48px))',

                backgroundColor:
                  t.bg || '#f8fafc',

                border:
                  `1px solid ${t.border}`,

                borderRadius:
                  '20px',

                boxShadow:
                  '0 24px 70px rgba(15, 23, 42, 0.24)',

                overflow:
                  'hidden',

                display:
                  'flex',

                flexDirection:
                  'column'
              }}
            >

              {/* Modal Header */}

              <div
                style={{
                  display:
                    'flex',

                  justifyContent:
                    'space-between',

                  alignItems:
                    'center',

                  gap:
                    '12px',

                  padding:
                    '16px 20px',

                  backgroundColor:
                    t.panel,

                  borderBottom:
                    `1px solid ${t.border}`
                }}
              >

                <div>

                  <div
                    style={{
                      color:
                        t.text,

                      fontSize:
                        '1rem',

                      fontWeight:
                        700
                    }}
                  >
                    AI 就醫摘要
                  </div>


                  <div
                    style={{
                      marginTop:
                        '3px',

                      color:
                        t.muted,

                      fontSize:
                        '0.78rem'
                    }}
                  >
                    Visit Summary · Session #{currentSessionId}
                  </div>

                </div>


                <button
                  type="button"

                  onClick={
                    handleCloseVisitSummary
                  }

                  aria-label="關閉就醫摘要"

                  style={{
                    width:
                      '34px',

                    height:
                      '34px',

                    borderRadius:
                      '50%',

                    border:
                      `1px solid ${t.border}`,

                    backgroundColor:
                      t.panel,

                    color:
                      t.text,

                    cursor:
                      'pointer',

                    fontSize:
                      '1.15rem',

                    lineHeight:
                      1
                  }}
                >
                  ×
                </button>

              </div>


              {/* Modal Content */}

              <div
                style={{
                  flex:
                    1,

                  minHeight:
                    0,

                  overflowY:
                    'auto',

                  padding:
                    '20px',

                  boxSizing:
                    'border-box'
                }}
              >

                <VisitSummaryPanel
                  sessionId={
                    currentSessionId
                  }

                  refreshKey={
                    visitSummaryRefreshKey
                  }
                />

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