import { useEffect, useRef, useState } from 'react';
import { verifyPin } from '../data/sales';

export const SESSION_KEY = 'analitika.pin';

export default function LoginGate({ onSuccess }: { onSuccess: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const attempt = async (value: string) => {
    setChecking(true);
    setError('');
    try {
      if (await verifyPin(value)) {
        sessionStorage.setItem(SESSION_KEY, value);
        onSuccess(value);
        return;
      }
      setError('Неверный код. Попробуйте ещё раз.');
      setPin('');
      inputRef.current?.focus();
    } catch {
      setError('Не удалось загрузить данные. Проверьте соединение.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      setPin(saved);
      void attempt(saved);
    } else {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 4);
    setPin(digits);
    setError('');
    if (digits.length === 4) void attempt(digits);
  };

  return (
    <div className="login">
      <form
        className="login__card"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin.length === 4 && !checking) void attempt(pin);
        }}
      >
        <h1 className="login__title">Аналитика</h1>
        <p className="login__subtitle">Введите код доступа</p>
        <input
          ref={inputRef}
          className={`login__input${error ? ' is-error' : ''}`}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={pin}
          disabled={checking}
          onChange={(e) => handleChange(e.target.value)}
          aria-label="Код доступа"
        />
        <p className="login__error" role="alert">{error}</p>
        <p className="login__hint">{checking ? 'Проверяем код…' : 'Код выдаёт администратор'}</p>
      </form>
    </div>
  );
}
