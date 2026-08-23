import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // ponytail: 鎖死 5174。Google Maps 金鑰的網址限制要放行 5174，
  // 讓 Vite 自動跳號的話地圖會被 Google 擋掉。寧可直接報「port 被佔用」。
  server: { port: 5174, strictPort: true },
})
