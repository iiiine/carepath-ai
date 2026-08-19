// src/App.jsx

import { useState, useEffect } from 'react'
import './App.css'

import SymptomChecker from './SymptomChecker'
import AuthPage from './AuthPage'
import DashboardPage from './pages/DashboardPage'

import api from './api/axios'


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
  // 恢復登入
  // ==========================================
  useEffect(() => {
    const token =
      localStorage.getItem(
        'access_token'
      )


    if (!token) {
      setAuthLoading(false)
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

        setUser(null)

        setSelectedSessionId(
          null
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
            '#bee7f7',

          color:
            '#0550a0',

          fontWeight:
            'bold',
        }}
      >
        驗證登入狀態中...
      </div>
    )
  }


  // ==========================================
  // 未登入
  // ==========================================
  if (!user) {
    return (
      <AuthPage
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

        minHeight:
          '100vh',

        boxSizing:
          'border-box',

        backgroundColor:
          '#bee7f7',

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
          display:
            'flex',

          justifyContent:
            'space-between',

          alignItems:
            'center',

          width:
            '100%',

          maxWidth:
            '1700px',

          margin:
            '0 auto',

          gap:
            '16px',

          flexWrap:
            'wrap',
        }}
      >

        {/* 左側導航 */}
        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            gap:
              '8px',

            flexWrap:
              'wrap',
          }}
        >

          {/* AI 問診 */}
          <button
            type="button"

            onClick={
              goToConsultation
            }

            style={{
              border:
                'none',

              padding:
                '9px 16px',

              borderRadius:
                '10px',

              cursor:
                'pointer',

              fontWeight:
                700,

              fontSize:
                '0.9rem',

              backgroundColor:
                currentPage ===
                'consultation'
                  ? '#0550a0'
                  : 'rgba(255,255,255,0.95)',

              color:
                currentPage ===
                'consultation'
                  ? '#ffffff'
                  : '#334155',

              boxShadow:
                '0 2px 8px rgba(0,0,0,0.06)',

              transition:
                'all 0.2s ease',
            }}
          >
            🩺 AI 問診
          </button>


          {/* Dashboard */}
          {!user.is_guest && (
            <button
              type="button"

              onClick={
                goToDashboard
              }

              style={{
                border:
                  'none',

                padding:
                  '9px 16px',

                borderRadius:
                  '10px',

                cursor:
                  'pointer',

                fontWeight:
                  700,

                fontSize:
                  '0.9rem',

                backgroundColor:
                  currentPage ===
                  'dashboard'
                    ? '#0550a0'
                    : 'rgba(255,255,255,0.95)',

                color:
                  currentPage ===
                  'dashboard'
                    ? '#ffffff'
                    : '#334155',

                boxShadow:
                  '0 2px 8px rgba(0,0,0,0.06)',

                transition:
                  'all 0.2s ease',
              }}
            >
              📊 健康 Dashboard
            </button>
          )}

        </div>


        {/* ==================================== */}
        {/* 右側使用者 */}
        {/* ==================================== */}
        <div
          style={{
            display:
              'flex',

            alignItems:
              'center',

            gap:
              '10px',

            padding:
              '6px 14px',

            backgroundColor:
              'rgba(255,255,255,0.95)',

            borderRadius:
              '20px',

            boxShadow:
              '0 2px 8px rgba(0,0,0,0.08)',

            border:
              '1px solid #dbeafe',

            fontSize:
              '0.85rem',
          }}
        >

          <span
            style={{
              color:
                '#334155',

              fontWeight:
                600,
            }}
          >
            {user.is_guest
              ? `👤 訪客 (${user.username})`
              : `👤 ${user.username}`}
          </span>


          <button
            type="button"

            onClick={
              handleLogout
            }

            style={{
              border:
                'none',

              backgroundColor:
                '#0550a0',

              color:
                '#ffffff',

              borderRadius:
                '14px',

              padding:
                '4px 12px',

              cursor:
                'pointer',

              fontWeight:
                'bold',

              fontSize:
                '0.8rem',
            }}
          >
            登出
          </button>

        </div>

      </div>


      {/* ====================================== */}
      {/* 頁面內容 */}
      {/* ====================================== */}

      {currentPage === 'dashboard' &&
      !user.is_guest ? (

        <DashboardPage

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

        />

      )}

    </div>
  )
}


export default App