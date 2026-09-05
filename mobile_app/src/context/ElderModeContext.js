// src/context/ElderModeContext.js
//
// 高齡友善模式的開關與對應的尺寸級距。
//
// 原本這個狀態只存在於 ConsultScreen，其餘 6 個畫面完全不理它——
// 長輩開啟後只有聊天頁變大，儀表板、健康資料、歷史紀錄仍是小字。
// 抽成 context 讓所有畫面共用同一個開關。
//
// ponytail: 只管 elderMode 一件事，不做成通用 theme provider。
//   顏色仍是 theme.js 的常數物件，不需要 context。

import React, {
    createContext,
    useState,
    useEffect,
    useContext,
    useMemo,
} from 'react';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { scale } from '../theme';


// 沿用原本 ConsultScreen 使用的鍵，既有使用者的設定不會遺失
const ELDER_MODE_KEY = 'carepath_elder_friendly_mode_mobile';


export const ElderModeContext = createContext({
    elderMode: false,
    s: scale.normal,
    toggleElderMode: () => {},
});


export const ElderModeProvider = ({ children }) => {
    const [elderMode, setElderMode] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const val = await AsyncStorage.getItem(ELDER_MODE_KEY);
                if (val === 'true') setElderMode(true);
            } catch (e) {
                console.error('無法讀取高齡友善設定:', e);
            }
        })();
    }, []);

    const toggleElderMode = async () => {
        const nextState = !elderMode;
        setElderMode(nextState);
        try {
            await AsyncStorage.setItem(
                ELDER_MODE_KEY,
                nextState ? 'true' : 'false',
            );
        } catch (e) {
            console.error('無法儲存高齡友善設定:', e);
        }
    };

    const value = useMemo(
        () => ({
            elderMode,
            s: elderMode ? scale.elder : scale.normal,
            toggleElderMode,
        }),
        [elderMode],
    );

    return (
        <ElderModeContext.Provider value={value}>
            {children}
        </ElderModeContext.Provider>
    );
};


// 畫面一律用這個取得目前級距：const { s, elderMode } = useElderMode();
export const useElderMode = () => useContext(ElderModeContext);
