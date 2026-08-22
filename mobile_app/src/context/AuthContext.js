// src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import client from '../api/client';

export const AuthContext = createContext();

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
      const token = await AsyncStorage.getItem('access_token');
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
    try {
      const res = await client.post('/api/v1/auth/guest-login'); 
      const guestToken = res.data.access_token; 
      
      if (guestToken) {
        await AsyncStorage.setItem('access_token', guestToken);
        client.defaults.headers.common['Authorization'] = `Bearer ${guestToken}`;
        
        setUser(formatUser({ 
          id: res.data.user.id,
          username: res.data.user.username,
          is_guest: res.data.user.is_guest 
        }));
      }
    } catch (error) {
      setUser({ is_guest: true, username: '目前是訪客狀態' }); 
    }
  };

  const login = async (email, password) => {
    const res = await client.post('/api/v1/auth/login', { identifier: email, password });
    const token = res.data.access_token;
    
    await AsyncStorage.setItem('access_token', token);
    client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    
    const meRes = await client.get('/api/v1/auth/me');
    setUser(formatUser(meRes.data));
  };

  const logout = async () => {
    await AsyncStorage.removeItem('access_token');
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