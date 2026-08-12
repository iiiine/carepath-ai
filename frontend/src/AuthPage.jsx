import { useState } from 'react';
import api from './api/axios';
import { t } from './theme';
import { BaymaxAvatar } from './Baymax';

function AuthPage({ onAuthSuccess, isConnected, statusText }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');

  const isRegister = mode === 'register';

  const switchMode = () => {
    setError('');
    setPassword('');
    setConfirmPassword('');
    setMode(isRegister ? 'login' : 'register');
  };

  // 1. 一般會員 登入/註冊 處理
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
      setError(typeof detail === 'string' ? detail : '系統發生錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  // 2. 💡 訪客登入 處理
  const handleGuestLogin = async () => {
    setError('');
    setGuestLoading(true);

    try {
      const response = await api.post('/api/v1/auth/guest-login');
      const { access_token, user } = response.data;

      onAuthSuccess(user, access_token);
    } catch (err) {
      console.error('訪客登入失敗:', err);
      const detail = err.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : '訪客登入失敗，請確認後端服務是否正常');
    } finally {
      setGuestLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    border: `1px solid ${t.border}`,
    borderRadius: '8px',
    outline: 'none',
    fontSize: '0.9rem',
    marginTop: '6px',
    boxSizing: 'border-box'
  };

  const labelStyle = {
    color: t.text,
    fontWeight: 500,
    fontSize: '0.85rem',
    display: 'block',
    marginTop: '14px',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: t.page,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '410px',
          backgroundColor: t.panel,
          borderRadius: '12px',
          padding: '32px',
          border: `1px solid ${t.border}`,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            border: `1px solid ${t.border}`,
            padding: '4px 10px',
            borderRadius: '20px',
            fontSize: '0.75rem',
            color: t.muted,
            marginBottom: '20px',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: isConnected ? t.ok : t.danger,
            }}
          />
          {statusText}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '24px' }}>
          <BaymaxAvatar size={72} />
          <div>
            <h1 style={{ color: t.text, fontSize: '1.25rem', fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>
              智慧 AI 醫療問診系統
            </h1>
            <p style={{ color: t.muted, margin: '6px 0 0', fontSize: '0.85rem', lineHeight: 1.5 }}>
              {isRegister ? '建立帳號後即可使用問診與醫院地圖功能' : '請登入，或以訪客身份直接體驗'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          {isRegister ? (
            <>
              <label style={{ ...labelStyle, marginTop: 0 }}>
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

              <label style={labelStyle}>
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
            <label style={{ ...labelStyle, marginTop: 0 }}>
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

          <label style={labelStyle}>
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
            <label style={labelStyle}>
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
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: t.danger,
                borderRadius: '8px',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || guestLoading}
            style={{
              width: '100%',
              marginTop: '22px',
              padding: '11px',
              backgroundColor: loading ? t.muted : t.userBubble,
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: loading || guestLoading ? 'not-allowed' : 'pointer',
              fontSize: '0.92rem',
              fontWeight: 500,
            }}
          >
            {loading ? '處理中...' : isRegister ? '建立帳號' : '會員登入'}
          </button>
        </form>

        {/* 💡 分隔線與訪客按鈕 */}
        <div style={{ margin: '20px 0', borderTop: `1px solid ${t.border}`, position: 'relative', textAlign: 'center' }}>
          <span style={{ position: 'absolute', top: '-10px', backgroundColor: t.panel, padding: '0 10px', color: t.muted, fontSize: '0.8rem' }}>
            或
          </span>
        </div>

        <button
          type="button"
          onClick={handleGuestLogin}
          disabled={loading || guestLoading}
          style={{
            width: '100%',
            padding: '11px',
            backgroundColor: t.panel,
            color: t.text,
            border: `1px solid ${t.border}`,
            borderRadius: '8px',
            cursor: loading || guestLoading ? 'not-allowed' : 'pointer',
            fontSize: '0.92rem',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}
        >
          {guestLoading ? '建立訪客身份中...' : '以訪客身份直接體驗'}
        </button>

        <div style={{ textAlign: 'center', marginTop: '18px', color: t.muted, fontSize: '0.85rem' }}>
          {isRegister ? '已經有帳號？' : '還沒有帳號？'}
          <button
            type="button"
            onClick={switchMode}
            style={{
              marginLeft: '6px',
              border: 'none',
              background: 'transparent',
              color: t.text,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'underline',
              fontSize: '0.85rem',
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