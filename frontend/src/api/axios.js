import axios from 'axios';

const api = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ||
    'https://baked-gender-unseen.ngrok-free.dev',

  headers: {
    'ngrok-skip-browser-warning': 'true',
  },
});


api.interceptors.request.use((config) => {

  const token =
    localStorage.getItem('access_token');

  if (token) {
    config.headers.Authorization =
      `Bearer ${token}`;
  }

  return config;
});


api.interceptors.response.use(

  (response) => response,

  (error) => {

    if (error.response?.status === 401) {

      localStorage.removeItem(
        'access_token'
      );

      window.dispatchEvent(
        new Event('auth-expired')
      );
    }

    return Promise.reject(error);
  }
);


export default api;