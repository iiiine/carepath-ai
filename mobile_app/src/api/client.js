// src/api/client.js
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const API_BASE_URL = 'https://baked-gender-unseen.ngrok-free.dev';

const client = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'ngrok-skip-browser-warning': 'true' },
  timeout: 45000,
});

// 與 AuthContext 一致：web 沒有 SecureStore 實作，退回 AsyncStorage
const readToken = () =>
  Platform.OS === 'web'
    ? AsyncStorage.getItem('access_token')
    : SecureStore.getItemAsync('access_token');

client.interceptors.request.use(async (config) => {
  const token = await readToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      // 光刪儲存的 token 不夠：AuthContext 另外把 token 設在 defaults，
      // 沒一起清掉的話，過期憑證還是會被夾帶在後續每一個請求上。
      if (Platform.OS === 'web') {
        await AsyncStorage.removeItem('access_token');
      } else {
        await SecureStore.deleteItemAsync('access_token');
      }
      delete client.defaults.headers.common['Authorization'];
    }
    return Promise.reject(err);
  }
);

export default client;