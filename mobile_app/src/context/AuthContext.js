// src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import client from '../api/client';

export const AuthContext = createContext();

const TOKEN_KEY = 'access_token';

// ------------------------------------------------------------
// token 一律存放在 SecureStore（加密），不再用 AsyncStorage 明文儲存。
//
// 過去 AuthContext 寫 AsyncStorage、client.js 卻讀 SecureStore，
// 兩邊不通：攔截器讀到的永遠是空的，認證全靠 client.defaults 撐著；
// 而 SecureStore 若殘留舊 token，攔截器反而會用它蓋掉正確的那個。
// 這裡統一到 SecureStore，並把殘留的 AsyncStorage token 搬過去後清掉。
// ------------------------------------------------------------
// expo-secure-store 沒有 web 實作（呼叫會丟
// ExpoSecureStore.default.getValueWithKeyAsync is not a function），
// 因此瀏覽器預覽退回 AsyncStorage（底層就是 localStorage）。
// 手機端一律走 SecureStore。
const useSecureStore = Platform.OS !== 'web';

const getToken = async () => {
  if (!useSecureStore) return AsyncStorage.getItem(TOKEN_KEY);

  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) return token;

  // 舊版本留下的明文 token：搬到 SecureStore 後刪除，只會發生一次
  const legacy = await AsyncStorage.getItem(TOKEN_KEY);
  if (legacy) {
    await SecureStore.setItemAsync(TOKEN_KEY, legacy);
    await AsyncStorage.removeItem(TOKEN_KEY);
    return legacy;
  }
  return null;
};

const saveToken = async (token) => {
  if (!useSecureStore) return AsyncStorage.setItem(TOKEN_KEY, token);

  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await AsyncStorage.removeItem(TOKEN_KEY);
};

const clearToken = async () => {
  if (!useSecureStore) return AsyncStorage.removeItem(TOKEN_KEY);

  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.removeItem(TOKEN_KEY);
};

// 訪客登入的嘗試次數。
//
// 為什麼是重試而不是把 timeout 調更大：冷啟動時間本來就會浮動，單次量到
// 62 秒不代表上限——Gemini 若在啟動時回 503，call_gemini_with_retry 的退避
// 會再加最多 30 秒。把 timeout 一路往上加只是換一個猜出來的數字，而且失敗
// 時使用者已經枯等了那麼久。
//
// 重試的好處是第一次請求其實已經把後端叫醒了，第二次通常幾秒內就回來。
const GUEST_LOGIN_ATTEMPTS = 3;


export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  // 🌟 強制攔截器：修復後端 /me API 永遠回傳 is_guest: false 的問題
  const formatUser = (userData) => {
    if (userData && userData.username && userData.username.startsWith('Guest_')) {
      return { ...userData, is_guest: true };
    }
    return userData;
  };

  const checkAuth = async () => {
    try {
      const token = await getToken();
      if (token) {
        client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const res = await client.get('/api/v1/auth/me');
        // 套用攔截器
        setUser(formatUser(res.data));
      } else {
        await silentGuestLogin();
      }
    } catch (error) {
      console.log('Token 驗證失敗，自動轉為訪客模式', error);
      await silentGuestLogin();
    } finally {
      setLoading(false);
    }
  };

  const silentGuestLogin = async () => {
    for (let attempt = 1; attempt <= GUEST_LOGIN_ATTEMPTS; attempt += 1) {
      try {
        const res = await client.post('/api/v1/auth/guest-login');
        const guestToken = res.data.access_token;

        if (guestToken) {
          await saveToken(guestToken);
          client.defaults.headers.common['Authorization'] = `Bearer ${guestToken}`;

          setUser(formatUser({
            id: res.data.user.id,
            username: res.data.user.username,
            is_guest: res.data.user.is_guest
          }));
        }
        return;
      } catch (error) {
        if (attempt < GUEST_LOGIN_ATTEMPTS) {
          console.log(`訪客登入第 ${attempt} 次失敗，重試中`, error?.message);
          continue;
        }
        // 重試都用盡才退回本地訪客狀態。注意這個狀態沒有 token，
        // 後續每一支 API 都會 401 —— 屬於後端真的連不上的情境，
        // 不該用來掩蓋單次逾時。
        setUser({ is_guest: true, username: '目前是訪客狀態' });
      }
    }
  };

  const login = async (email, password) => {
    const res = await client.post('/api/v1/auth/login', { identifier: email, password });
    const token = res.data.access_token;
    
    await saveToken(token);
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    const meRes = await client.get('/api/v1/auth/me');
    setUser(formatUser(meRes.data));
  };

  const logout = async () => {
    await clearToken();
    delete client.defaults.headers.common['Authorization'];
    setUser(null);
    await silentGuestLogin();
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};