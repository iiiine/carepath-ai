import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ElderModeProvider } from './ElderModeContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ElderModeProvider>
      <App />
    </ElderModeProvider>
  </StrictMode>,
)
