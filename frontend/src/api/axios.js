// src/api/axios.js
import axios from 'axios';

const api = axios.create({
baseURL: 'https://baked-gender-unseen.ngrok-free.dev',
});

export default api;