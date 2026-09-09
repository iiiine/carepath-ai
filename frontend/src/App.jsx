// src/App.jsx

import { useState, useEffect } from 'react'
import './App.css'

import SymptomChecker from './SymptomChecker'
import AuthPage from './AuthPage'
import DashboardPage from './pages/DashboardPage'

import api from './api/axios'
import { t } from './theme'


// 頂部分頁膠囊的樣式，選到的那顆才是白底。
// ponytail: 一個函式就夠，不做 <Tab> 元件。
const tabStyle = (active) => ({
  border: 'none',
  borderRadius: '999px',
  padding: '6px 16px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '0.82rem',
  fontWeight: active ? 600 : 500,
  color: active ? t.text : t.muted,
  backgroundColor: active ? t.panel : 'transparent',
  boxShadow: active ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
})

function App() {
  // ==========================================
  // 後端連線狀態
  // ==========================================
  const [isConnected, setIsConnected] =
    useState(false)

  const [statusText, setStatusText] =
    useState('連線中...')


  // ==========================================
  // 使用者
  // ==========================================
  const [user, setUser] =
    useState(null)

  const [authLoading, setAuthLoading] =
    useState(true)


  // ==========================================
  // 是否顯示登入/註冊畫面
  //
  // 預設是訪客身分，所以登入畫面不再是進入 App 的門檻，
  // 而是訪客想升級成正式帳號時才主動打開。
  // ==========================================
  const [showAuth, setShowAuth] =
    useState(false)


  // ==========================================
  // 頁面
  //
  // consultation = AI 問診
  // dashboard    = 健康 Dashboard
  // ==========================================
  const [currentPage, setCurrentPage] =
    useState('consultation')


  // ==========================================
  // Dashboard 指定要開啟的歷史問診
  // ==========================================
  const [
    selectedSessionId,
    setSelectedSessionId
  ] = useState(null)


  // ==========================================
  // 新問診 Reset Key
  //
  // 每次增加數字，
  // React 就會重新建立 SymptomChecker。
  // ==========================================
  const [
    consultationResetKey,
    setConsultationResetKey
  ] = useState(0)


  // ==========================================
  // 完整歷史問診側欄
  // ==========================================
  const [
    openHistorySidebar,
    setOpenHistorySidebar
  ] = useState(false)


  // ==========================================
  // 檢查後端
  // ==========================================
  useEffect(() => {
    api
      .get('/api/test')
      .then((response) => {
        setIsConnected(true)

        setStatusText(
          response.data.message ||
          '後端連線成功'
        )
      })
      .catch((error) => {
        console.error(
          '後端連線失敗:',
          error
        )

        setIsConnected(false)

        setStatusText(
          '後端連線失敗'
        )
      })
  }, [])


  // ==========================================
  // 靜默訪客登入
  //
  // 與行動端 AuthContext.silentGuestLogin 對齊：沒有 token 就自動取得
  // 訪客身分，使用者不需要先按「訪客登入」才能開始問診。
  //
  // 失敗時不捏造使用者 —— 沒有 token 的假訪客會讓後續每一支 API 都 401，
  // 畫面看起來正常卻按什麼都失敗。這裡讓 user 維持 null，
  // 由下方的邏輯顯示登入畫面，使用者至少知道發生了什麼事。
  // ==========================================
  const silentGuestLogin = async () => {
    try {
      const res = await api.post(
        '/api/v1/auth/guest-login'
      )

      const token =
        res.data.access_token

      if (!token) return false

      localStorage.setItem(
        'access_token',
        token
      )

      setUser(
        res.data.user
      )

      return true

    } catch (error) {
      console.error(
        '訪客登入失敗:',
        error
      )
      return false
    }
  }


  // ==========================================
  // 恢復登入
  // ==========================================
  useEffect(() => {
    const token =
      localStorage.getItem(
        'access_token'
      )


    if (!token) {
      // 第一次進來（或剛登出）：直接以訪客身分開始
      //
      // eslint 的 set-state-in-effect 在這裡是誤報：silentGuestLogin 的
      // 第一個動作就是 await api.post()，setUser 不可能在 effect 執行期間
      // 同步發生，只是 linter 看不穿 async 函式。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      silentGuestLogin()
        .finally(() => {
          setAuthLoading(false)
        })
      return
    }


    api
      .get('/api/v1/auth/me')
      .then((response) => {
        setUser(
          response.data
        )
      })
      .catch((error) => {
        console.error(
          '恢復登入狀態失敗:',
          error
        )

        localStorage.removeItem(
          'access_token'
        )

        // token 過期或無效時退回訪客身分，不要把人擋在登入畫面外
        silentGuestLogin()

        setUser(null)

        setSelectedSessionId(
          null
        )

        setOpenHistorySidebar(
          false
        )

        setCurrentPage(
          'consultation'
        )
      })
      .finally(() => {
        setAuthLoading(false)
      })
  }, [])


  // ==========================================
  // Token 過期
  // ==========================================
  useEffect(() => {
    const handleExpired = () => {
      localStorage.removeItem(
        'access_token'
      )

      setUser(null)

      setSelectedSessionId(
        null
      )

      setOpenHistorySidebar(
        false
      )

      setCurrentPage(
        'consultation'
      )
    }


    window.addEventListener(
      'auth-expired',
      handleExpired
    )


    return () => {
      window.removeEventListener(
        'auth-expired',
        handleExpired
      )
    }
  }, [])


  // ==========================================
  // 登入成功
  // ==========================================
  const handleAuthSuccess = (
    userData,
    token
  ) => {
    setShowAuth(false)

    localStorage.setItem(
      'access_token',
      token
    )

    setUser(
      userData
    )

    setSelectedSessionId(
      null
    )

    setOpenHistorySidebar(
      false
    )

    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // 登出
  // ==========================================
  const handleLogout = () => {
    localStorage.removeItem(
      'access_token'
    )

    setUser(null)

    setSelectedSessionId(
      null
    )

    setCurrentPage(
      'consultation'
    )

    // 登出不是把人踢出 App，而是回到訪客身分 —— 問診本來就開放訪客使用
    silentGuestLogin()
  }


  // ==========================================
  // 上方 AI 問診
  //
  // 只是切換頁面，
  // 不強制清除目前問診。
  // ==========================================
  const goToConsultation = () => {
    setSelectedSessionId(
      null
    )

    setOpenHistorySidebar(
      false
    )

    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // 最近問診
  // ==========================================
  const goToHistory = () => {
    if (user?.is_guest) {
      return
    }

    setSelectedSessionId(
      null
    )

    setOpenHistorySidebar(
      true
    )

    // 從任何問診畫面進入「最近問診」時，
    // 重新建立 SymptomChecker，回到乾淨的歷史入口，
    // 避免停留在上一筆歷史問診結果頁。
    setConsultationResetKey(
      (prev) => prev + 1
    )

    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // 健康 Dashboard
  // ==========================================
  const goToDashboard = () => {
    if (user?.is_guest) {
      return
    }

    setOpenHistorySidebar(
      false
    )

    setCurrentPage(
      'dashboard'
    )
  }


  // ==========================================
  // Dashboard：
  // ＋ 開始新的 AI 問診
  //
  // ★ 第 18 步重點
  // ==========================================
  const handleStartConsultation = () => {
    // 不載入任何歷史紀錄
    setSelectedSessionId(
      null
    )

    setOpenHistorySidebar(
      false
    )


    // 強制重建 SymptomChecker
    setConsultationResetKey(
      (prev) => prev + 1
    )


    // 切到 AI 問診
    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // Dashboard：
  // 查看全部紀錄
  //
  // 不重設問診，
  // 單純回到 AI 問診 / 歷史側欄。
  // ==========================================
  const handleViewHistory = () => {
    setSelectedSessionId(
      null
    )

    setOpenHistorySidebar(
      true
    )

    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // Dashboard：
  // 最近問診卡片
  // ==========================================
  const handleSelectDashboardSession = (
    session
  ) => {
    if (!session?.id) {
      return
    }


    console.log(
      'Dashboard 選擇問診:',
      session
    )


    setOpenHistorySidebar(
      false
    )


    setSelectedSessionId(
      session.id
    )


    setCurrentPage(
      'consultation'
    )
  }


  // ==========================================
  // 指定歷史問診載入完成
  // ==========================================
  const handleSessionLoaded = () => {
    setSelectedSessionId(
      null
    )
  }


  // ==========================================
  // 驗證登入
  // ==========================================
  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',

          display: 'flex',

          alignItems: 'center',

          justifyContent: 'center',

          backgroundColor:
            t.page,

          color:
            t.text,

          fontWeight:
            'bold',
        }}
      >
        驗證登入狀態中...
      </div>
    )
  }


  // ==========================================
  // 登入 / 註冊畫面
  //
  // 兩種情況會走到這裡：
  //   1. 連訪客身分都取不到（後端連不上）—— 此時 user 為 null
  //   2. 訪客主動按「登入 / 註冊」想升級成正式帳號
  // ==========================================
  if (!user || showAuth) {
    return (
      <AuthPage
        onCancel={
          user
            ? () => setShowAuth(false)
            : null
        }
        onAuthSuccess={
          handleAuthSuccess
        }

        isConnected={
          isConnected
        }

        statusText={
          statusText
        }
      />
    )
  }


  // ==========================================
  // 主畫面
  // ==========================================
  return (
    <div
      style={{
        padding:
          '16px 24px',

        height:
          '100vh',

        overflow:
          'hidden',

        boxSizing:
          'border-box',

        backgroundColor:
          '#f2f6f7',

        display:
          'flex',

        flexDirection:
          'column',

        gap:
          '12px',
      }}
    >

      {/* ====================================== */}
      {/* 頂部導覽 */}
      {/* ====================================== */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          maxWidth: '1700px',
          margin: '0 auto',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        {/* 左側：品牌 + 分頁 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
          {/* 分頁做成一組膠囊，選到的那顆才是白底 */}
          <div
            style={{
              display: 'flex',
              gap: '3px',
              backgroundColor: 'rgba(255,255,255,0.7)',
              border: `1px solid ${t.border}`,
              borderRadius: '999px',
              padding: '3px',
            }}
          >
            <button
              type="button"
              onClick={goToConsultation}
              style={tabStyle(
                currentPage === 'consultation' &&
                !openHistorySidebar
              )}
            >
              AI 問診
            </button>

            {!user.is_guest && (
              <button
                type="button"
                onClick={goToHistory}
                style={tabStyle(
                  currentPage === 'consultation' &&
                  openHistorySidebar
                )}
              >
                最近問診
              </button>
            )}

            {!user.is_guest && (
              <button
                type="button"
                onClick={goToDashboard}
                style={tabStyle(currentPage === 'dashboard')}
              >
                健康 Dashboard
              </button>
            )}
          </div>
        </div>

        {/* 右側使用者 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: t.userBubble,
              color: t.page,
              fontSize: '0.7rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {user.is_guest ? '訪' : user.username.charAt(0)}
          </span>

          <span style={{ fontSize: '0.8rem', color: t.text }}>
            {user.is_guest ? '訪客' : user.username}
          </span>

          {/*
            訪客沒有「登出」的概念 —— 預設身分就是訪客，登出只會再拿一個訪客身分。
            所以訪客看到的是升級成正式帳號的入口，正式帳號才看得到登出。
          */}
          <button
            type="button"
            onClick={
              user.is_guest
                ? () => setShowAuth(true)
                : handleLogout
            }
            style={
              user.is_guest
                ? {
                    // 訪客：要被看見的入口，用實心膠囊
                    border: 'none',
                    borderRadius: '999px',
                    backgroundColor: t.userBubble,
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    padding: '6px 16px',
                    whiteSpace: 'nowrap',
                  }
                : {
                    // 正式帳號：登出不需要搶注意力，維持低調的外框膠囊
                    border: `1px solid ${t.border}`,
                    borderRadius: '999px',
                    backgroundColor: 'transparent',
                    color: t.muted,
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontFamily: 'inherit',
                    padding: '6px 14px',
                    whiteSpace: 'nowrap',
                  }
            }
          >
            {user.is_guest ? '登入 / 註冊' : '登出'}
          </button>
        </div>
      </div>


      {/* ====================================== */}
      {/* 頁面內容 */}
      {/* ====================================== */}

      {/* 內容自己滾。外層固定 100vh 是為了不要長出整頁捲軸（會把畫面往左擠），
          所以能滾的責任要交給這一層，不然 Dashboard 比螢幕高就卡住。 */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >

      {currentPage === 'dashboard' &&
      !user.is_guest ? (

        <DashboardPage
          user={
            user
          }


          onStartConsultation={
            handleStartConsultation
          }

          onViewHistory={
            handleViewHistory
          }

          onSelectSession={
            handleSelectDashboardSession
          }

        />

      ) : (

        <SymptomChecker

          // ★ 第 18 步核心
          // key 改變 = 整個問診元件重新建立
          key={
            consultationResetKey
          }

          user={
            user
          }

          isConnected={
            isConnected
          }

          statusText={
            statusText
          }

          selectedSessionId={
            selectedSessionId
          }

          onSessionLoaded={
            handleSessionLoaded
          }

          openHistorySidebar={
            openHistorySidebar
          }

          onOpenHistory={
            goToHistory
          }

          onCloseHistory={
            () =>
              setOpenHistorySidebar(
                false
              )
          }

        />

      )}

      </div>

    </div>
  )
}


export default App