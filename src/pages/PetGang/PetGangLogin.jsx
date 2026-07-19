import { useState } from 'react';
import styles from './PetGang.module.css';

const PetGangLogin = ({ onLogin }) => {
  const [authMethod, setAuthMethod] = useState('email'); // email | telegram
  const [step, setStep] = useState('form'); // form | code | register | verify-email
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Email auth state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

  const clearState = () => {
    setError('');
    setSuccess('');
    setEmail('');
    setPassword('');
    setName('');
    setCode('');
  };

  // ==================== EMAIL ====================

  const handleEmailLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('petgang_token', data.data.token);
        onLogin();
      } else {
        setError(data.error || 'Ошибка входа');
      }
    } catch (e) {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!name || !email || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password })
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(data.data.message || 'Проверьте email для подтверждения');
        setStep('form');
      } else {
        setError(data.error || 'Ошибка регистрации');
      }
    } catch (e) {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  // ==================== TELEGRAM ====================

  const requestCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setStep('code');
        if (data.data.code) {
          setError(`Dev код: ${data.data.code}`);
        }
      } else {
        setError(data.error || 'Ошибка отправки кода');
      }
    } catch (e) {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('petgang_token', data.data.token);
        onLogin();
      } else {
        setError(data.error || 'Неверный код');
      }
    } catch (e) {
      setError('Ошибка сети');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.loginContainer}>
      <div className={styles.loginCard}>
        <h1 className={styles.loginTitle}>Pet Gang</h1>
        <p className={styles.loginSubtitle}>Вход в паспорт питомца</p>

        {error && <div className={styles.loginError}>{error}</div>}
        {success && <div className={styles.loginSuccess}>{success}</div>}

        {/* Вкладки */}
        <div className={styles.loginTabs}>
          <button
            className={`${styles.loginTab} ${authMethod === 'email' ? styles.loginTabActive : ''}`}
            onClick={() => { setAuthMethod('email'); setStep('form'); clearState(); }}
          >
            Email
          </button>
          <button
            className={`${styles.loginTab} ${authMethod === 'telegram' ? styles.loginTabActive : ''}`}
            onClick={() => { setAuthMethod('telegram'); setStep('form'); clearState(); }}
          >
            Telegram
          </button>
        </div>

        {/* Email авторизация */}
        {authMethod === 'email' && step === 'form' && (
          <div className={styles.loginForm}>
            <input
              className={styles.input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Пароль"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button
              className={styles.btnPrimary}
              onClick={handleEmailLogin}
              disabled={loading || !email || !password}
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
            <button
              className={styles.btn}
              onClick={() => { setStep('register'); clearState(); }}
            >
              Зарегистрироваться
            </button>
          </div>
        )}

        {/* Регистрация */}
        {authMethod === 'email' && step === 'register' && (
          <div className={styles.loginForm}>
            <input
              className={styles.input}
              type="text"
              placeholder="Ваше имя"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
            <input
              className={styles.input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Пароль (минимум 8 символов)"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button
              className={styles.btnPrimary}
              onClick={handleRegister}
              disabled={loading || !name || !email || !password || password.length < 8}
            >
              {loading ? 'Регистрация...' : 'Зарегистрироваться'}
            </button>
            <button
              className={styles.btn}
              onClick={() => { setStep('form'); clearState(); }}
            >
              Уже есть аккаунт? Войти
            </button>
          </div>
        )}

        {/* Telegram авторизация */}
        {authMethod === 'telegram' && step === 'form' && (
          <div className={styles.loginForm}>
            <p className={styles.loginHint}>
              Нажмите кнопку чтобы получить код подтверждения в Telegram
            </p>
            <button
              className={styles.btnPrimary}
              onClick={requestCode}
              disabled={loading}
            >
              {loading ? 'Отправка...' : 'Получить код'}
            </button>
          </div>
        )}

        {authMethod === 'telegram' && step === 'code' && (
          <div className={styles.loginForm}>
            <p className={styles.loginHint}>
              Код отправлен в Telegram. Введите его ниже:
            </p>
            <input
              className={styles.input}
              type="text"
              placeholder="6-значный код"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={6}
              autoFocus
            />
            <button
              className={styles.btnPrimary}
              onClick={verifyCode}
              disabled={loading || code.length < 6}
            >
              {loading ? 'Проверка...' : 'Войти'}
            </button>
            <button
              className={styles.btn}
              onClick={() => { setStep('form'); setCode(''); setError(''); }}
            >
              Отправить код заново
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PetGangLogin;
