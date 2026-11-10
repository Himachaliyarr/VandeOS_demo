import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/auth/me').then(result => { setUser(result.data.user); setOrganization(result.data.organization); }).catch(() => { setUser(null); setOrganization(null); }).finally(() => setLoading(false));
  }, []);

  const signIn = async credentials => {
    setError('');
    try {
      const result = await api('/auth/login', { method: 'POST', body: credentials });
      setUser(result.data.user);
      setOrganization(result.data.organization);
      return result.data.user;
    } catch (err) { setError(err.message); throw err; }
  };

  const signOut = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } finally { setUser(null); setOrganization(null); }
  };

  const value = useMemo(() => ({ user, organization, loading, error, signIn, signOut, clearError: () => setError(''), refreshUser: async () => {
    const result = await api('/auth/me'); setUser(result.data.user); setOrganization(result.data.organization); return result.data.user;
  } }), [user, organization, loading, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
