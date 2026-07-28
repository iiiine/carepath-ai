import { useState } from 'react';
import api from './api/axios';

function AuthPage({ onAuthSuccess, isConnected, statusText }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isRegister = mode === 'register';

  const switchMode = () => {
    setError('');
    setPassword('');
    setConfirmPassword('');
    setMode(isRegister ? 'login' : 'register');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isRegister && password !== confirmPassword) {
      setError('兩次輸入的密碼不一致');
      return;
    }

    if (password.length < 8) {
      setError('密碼至少需要 8 個字元');
      return;
    }

    setLoading(true);

    try {
      const endpoint = isRegister
        ? '/api/v1/auth/register'
        : '/api/v1/auth/login';

      const payload = isRegister
        ? {
            username: username.trim(),
            email: email.trim(),
            password,
          }
        : {
            identifier: identifier.trim(),
            password,
          };

      const response = await api.post(endpoint, payload);
      const { access_token, user } = response.data;

      onAuthSuccess(user, access_token);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : '登入系統發生錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid #cbd5e1',
    borderRadius: '8px',
    outline: 'none',
    fontSize: '0.95rem',
    marginTop: '6px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #bee7f7 0%, #e7f7ff 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: '#fff',
          borderRadius: '18px',
          padding: '32px',
          boxShadow: '0 18px 50px rgba(5, 80, 160, 0.16)',
          border: '1px solid rgba(5, 80, 160, 0.1)',
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#f8fafc',
            padding: '5px 11px',
            borderRadius: '20px',
            fontSize: '0.78rem',
            fontWeight: 'bold',
            color: '#475569',
            marginBottom: '18px',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: isConnected ? '#28a745' : '#dc3545',
            }}
          />
          {statusText}
        </div>

        <h1 style={{ color: '#0550a0', fontSize: '1.8rem', marginBottom: '6px' }}>
          🏥 智慧 AI 醫療問診系統
        </h1>
        <p style={{ color: '#64748b', marginBottom: '24px' }}>
          {isRegister ? '建立帳號後即可使用問診與醫院地圖功能' : '請先登入以使用醫療問診系統'}
        </p>

        <form onSubmit={handleSubmit}>
          {isRegister ? (
            <>
              <label style={{ color: '#334155', fontWeight: 600 }}>
                使用者帳號
                <input
                  style={inputStyle}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="例如：ziyan"
                  minLength={3}
                  maxLength={50}
                  required
                />
              </label>

              <label
                style={{
                  color: '#334155',
                  fontWeight: 600,
                  display: 'block',
                  marginTop: '14px',
                }}
              >
                Email
                <input
                  style={inputStyle}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                />
              </label>
            </>
          ) : (
            <label style={{ color: '#334155', fontWeight: 600 }}>
              帳號或 Email
              <input
                style={inputStyle}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="輸入帳號或 Email"
                required
              />
            </label>
          )}

          <label
            style={{
              color: '#334155',
              fontWeight: 600,
              display: 'block',
              marginTop: '14px',
            }}
          >
            密碼
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 個字元"
              minLength={8}
              required
            />
          </label>

          {isRegister && (
            <label
              style={{
                color: '#334155',
                fontWeight: 600,
                display: 'block',
                marginTop: '14px',
              }}
            >
              確認密碼
              <input
                style={inputStyle}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再輸入一次密碼"
                minLength={8}
                required
              />
            </label>
          )}

          {error && (
            <div
              style={{
                marginTop: '16px',
                padding: '10px 12px',
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                color: '#be123c',
                borderRadius: '8px',
                fontSize: '0.88rem',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              marginTop: '22px',
              padding: '12px',
              backgroundColor: loading ? '#94a3b8' : '#0550a0',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            {loading ? '處理中...' : isRegister ? '建立帳號' : '登入'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '18px', color: '#64748b' }}>
          {isRegister ? '已經有帳號？' : '還沒有帳號？'}
          <button
            type="button"
            onClick={switchMode}
            style={{
              marginLeft: '6px',
              border: 'none',
              background: 'transparent',
              color: '#0550a0',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            {isRegister ? '返回登入' : '立即註冊'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AuthPage;
