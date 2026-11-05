import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/auth/me').then(result => setUser(result.data.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const signIn = async credentials => {
    setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: credentials });
      setUser(result.data.user);
      return result.data.user;
    } catch (err) { setError(err.message); throw err; }
  };

  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } finally { setUser(null); }
  };

  const value = useMemo(() => ({ user, loading, error, signIn, signOut, clearError: () => setError(''), refreshUser: async () => {
    const result = await api('/auth/me'); setUser(result.data.user); return result.data.user;
  } }), [user, loading, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
