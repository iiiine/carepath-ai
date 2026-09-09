// src/useElderMode.js
//
// Context 與 hook 單獨放這裡，不含任何元件。
//
// React Fast Refresh 要求一個檔案要嘛只匯出元件、要嘛只匯出其他東西；
// 把 Provider 元件和 useElderMode hook 放在同一支會讓熱更新失效
// （eslint react-refresh/only-export-components 就是在講這件事）。

import { createContext, useContext } from 'react';

export const ElderModeContext = createContext({
  elderMode: false,
  toggleElderMode: () => {},
});

export const useElderMode = () => useContext(ElderModeContext);
