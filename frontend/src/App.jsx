import { useState, useEffect } from 'react'
import './App.css'
import SymptomChecker from './SymptomChecker'

function App() {
  const [isConnected, setIsConnected] = useState(false)
  const [statusText, setStatusText] = useState('連線中...')

  useEffect(() => { 
    fetch('https://baked-gender-unseen.ngrok-free.dev/api/test', {
      headers: {
        'ngrok-skip-browser-warning': 'true'
      }
    })
      .then(response => {
        if (!response.ok) throw new Error('網路回應不成功')
        return response.json()
      })
      .then(data => {
        setIsConnected(true)
        setStatusText(data.message || '後端連線成功') 
      })
      .catch(error => {
        console.error('連線失敗:', error)
        setIsConnected(false)
        setStatusText('後端連線失敗')
      })
  }, [])

  return (
    <div style={{ padding: '20px', minHeight: '100vh', boxSizing: 'border-box', backgroundColor: '#bee7f7' }}>
      {/* 把連線狀態傳給 SymptomChecker 渲染在左上角 */}
      <SymptomChecker isConnected={isConnected} statusText={statusText} />
    </div>
  )
}

export default App