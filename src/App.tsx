import { useState } from 'react';
import Home from './pages/Home';
import LoginGate, { SESSION_KEY } from './components/LoginGate';

export default function App() {
  const [pin, setPin] = useState<string | null>(null);

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setPin(null);
  };

  if (!pin) return <LoginGate onSuccess={setPin} />;
  return <Home pin={pin} onLogout={logout} />;
}
