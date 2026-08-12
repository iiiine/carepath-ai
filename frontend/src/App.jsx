// src/App.jsx
import { useState, useEffect } from 'react'
import './App.css'
import SymptomChecker from './SymptomChecker'
import AuthPage from './AuthPage'
import api from './api/axios'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [statusText, setStatusText] = useState('連線中...')
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  useEffect(() => {
    api.get('/api/test')
      .then((response) => {
        setIsConnected(true)
        setStatusText(response.data.message || '後端連線成功')
      })
      .catch((error) => {
        console.error('連線失敗:', error)
        setIsConnected(false)
        setStatusText('後端連線失敗')
      })
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')

    if (!token) {
      setAuthLoading(false)
      return
    }

    api.get('/api/v1/auth/me')
      .then((response) => {
        setUser(response.data)
      })
      .catch(() => {
        localStorage.removeItem('access_token')
        setUser(null)
      })
      .finally(() => {
        setAuthLoading(false)
      })
  }, [])

  useEffect(() => {
    const handleExpired = () => {
      setUser(null)
    }

    window.addEventListener('auth-expired', handleExpired)
    return () => window.removeEventListener('auth-expired', handleExpired)
  }, [])

  const handleAuthSuccess = (userData, token) => {
    localStorage.setItem('access_token', token)
    setUser(userData)
  }

  const handleLogout = () => {
    localStorage.removeItem('access_token')
    setUser(null)
  }

  if (authLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#fafafa',
          color: '#71717a',
          fontSize: '0.9rem',
        }}
      >
        驗證登入狀態中...
      </div>
    )
  }

  if (!user) {
    return (
      <AuthPage
        onAuthSuccess={handleAuthSuccess}
        isConnected={isConnected}
        statusText={statusText}
      />
    )
  }

  return (
    <div
      style={{
        padding: '16px 24px',
        minHeight: '100vh',
        boxSizing: 'border-box',
        backgroundColor: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}
    >
      {/* 🔝 頂部使用者資訊欄 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          width: '100%',
          maxWidth: '1700px',
          margin: '0 auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '5px 6px 5px 14px',
            backgroundColor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid #e4e4e7',
            fontSize: '0.82rem',
          }}
        >
          <span style={{ color: '#0a0a0a', fontWeight: 500 }}>
            {user.is_guest ? `訪客 · ${user.username}` : user.username}
          </span>
          <button
            onClick={handleLogout}
            style={{
              border: 'none',
              backgroundColor: '#18181b',
              color: '#fff',
              borderRadius: '6px',
              padding: '4px 12px',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: '0.78rem'
            }}
          >
            登出
          </button>
        </div>
      </div>

      {/* 主介面，傳入當前使用者 */}
      <SymptomChecker
        user={user}
        isConnected={isConnected}
        statusText={statusText}
      />
    </div>
  )
}

export default App