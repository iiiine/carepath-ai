// src/ElderModeContext.jsx
//
// 高齡友善模式的全域開關。
//
// 為什麼要提到全域：原本這個狀態只存在 SymptomChecker 裡，所以切到
// 健康 Dashboard、縱向趨勢、就醫摘要之後字就變回小的 —— 使用者的認知是
// 「我開了大字模式」，不是「我在問診頁開了大字模式」。
//
// 為什麼用根字級而不是像行動端那樣做一整套尺寸級距：
// 網頁端全部 135 個 fontSize 都是 rem，沒有一個用 px。改根元素的
// font-size 就會等比縮放全站每一段文字，包含還沒被檢查過的元件，
// 不可能漏掉。行動端沒有 rem 這種相對單位才需要自己做級距系統。
//
// context 與 hook 放在 useElderMode.js，這裡只匯出 Provider 元件。

import { useEffect, useState } from 'react';

import { ElderModeContext } from './useElderMode';

const STORAGE_KEY = 'carepath_elder_friendly_mode';

// 瀏覽器預設根字級是 16px。放大到 20px 約 1.25 倍，
// 與行動端的級距比例接近（內文 14 → 18）。
// 再大的話固定 px 的 padding 會撐不住，按鈕內文字會擠在一起。
const ELDER_ROOT_FONT_SIZE = '20px';

export function ElderModeProvider({ children }) {
  const [elderMode, setElderMode] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      // 無痕視窗或封鎖儲存時讀不到，當作沒開啟即可，不影響其他功能
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;

    // 只在開啟時覆寫；關閉時清掉行內樣式讓它回到樣式表/瀏覽器預設，
    // 而不是寫死 16px —— 使用者若在瀏覽器設定調過字級，那個設定要留著。
    if (elderMode) {
      root.style.fontSize = ELDER_ROOT_FONT_SIZE;
      // index.css 裡以 [data-elder-mode="true"] 為選擇器的規則靠這個啟動。
      // 掛在 <html> 而不是某個元件的根節點，全站才吃得到。
      root.setAttribute('data-elder-mode', 'true');
    } else {
      root.style.removeProperty('font-size');
      root.removeAttribute('data-elder-mode');
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, elderMode ? 'true' : 'false');
    } catch {
      // 存不進去不影響本次使用，只是下次進來要重開
    }
  }, [elderMode]);

  const toggleElderMode = () => setElderMode((on) => !on);

  return (
    <ElderModeContext.Provider value={{ elderMode, toggleElderMode }}>
      {children}
    </ElderModeContext.Provider>
  );
}
