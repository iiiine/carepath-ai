import { useState, useEffect } from 'react'
import './App.css'
import SymptomChecker from './SymptomChecker'
function App() {
  const [message, setMessage] = useState('正在嘗試連接後端 FastAPI...')

  useEffect(() => { 
    // 呼叫同學的 FastAPI 測試接口
    fetch('https://baked-gender-unseen.ngrok-free.dev/api/test', {
  headers: {
    // 這是專門用來逼 ngrok 免費版直接放行、跳過警告頁面的特殊神奇標頭！
    'ngrok-skip-browser-warning': 'true'
  }
})
      .then(response => {
        if (!response.ok) {
          throw new Error('網路回應不成功')
        }
        return response.json()
      })
      .then(data => {
        // 把從 FastAPI 拿到的訊息存進 State 裡
        setMessage(data.message) 
      })
      .catch(error => {
        console.error('連線失敗:', error)
        setMessage('連線失敗，請檢查後端是否啟動，或是 CORS 是否有開！')
      })
  }, []) // 空陣列代表只在網頁開啟時執行一次

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column' }}>
      <h1>的專案前端平台</h1>
      <div style={{ padding: '20px', border: '2px solid #646cff', borderRadius: '8px', marginTop: '20px', backgroundColor: '#242424', color: '#fff' }}>
        <h3>後端回傳訊息：</h3>
        <p style={{ fontSize: '1.2rem', color: '#4caf50', fontWeight: 'bold' }}>{message}</p>
      </div>
      <SymptomChecker />
    </div>
  )
}

export default App