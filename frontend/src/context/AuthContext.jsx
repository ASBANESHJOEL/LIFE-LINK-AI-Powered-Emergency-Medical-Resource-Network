import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [role, setRole] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [profileStatus, setProfileStatus] = useState('LOADING'); // 'LOADING' | 'ACTIVE' | 'UNPROVISIONED' | 'INACTIVE' | 'ERROR' | 'UNAUTHENTICATED'
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch trusted profile and role from the backend using the authenticated session token
  const fetchUserProfile = useCallback(async (currentSession) => {
    if (!currentSession?.access_token) {
      setUserProfile(null);
      setRole(null);
      setOrganization(null);
      setProfileStatus('UNAUTHENTICATED');
      setAuthError(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      // Backend /api/auth/me verifies JWT and resolves public.users + organization_members
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`
        }
      });

      // Verify response content-type before attempting JSON parsing
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.toLowerCase().includes('application/json');

      if (!isJson) {
        console.error(
          `[LIFE-LINK] API configuration error: /api/auth/me returned non-JSON content-type: "${contentType}" (HTTP ${response.status})`
        );
        setUserProfile(null);
        setRole(null);
        setOrganization(null);
        setProfileStatus('ERROR');
        setAuthError(
          `Authentication service configuration error: Expected JSON from API, but received ${contentType || 'non-JSON response'}. Check API routing.`
        );
        return;
      }

      if (response.ok) {
        const data = await response.json();
        if (data?.user) {
          setUserProfile(data.user);
          setRole(data.user.role);
          setOrganization(data.organization || null);
          setProfileStatus('ACTIVE');
          setAuthError(null);
        } else {
          setUserProfile(null);
          setRole(null);
          setOrganization(null);
          setProfileStatus('ERROR');
          setAuthError('Authentication server returned an invalid profile structure.');
        }
      } else if (response.status === 403) {
        const errData = await response.json().catch(() => ({}));
        setUserProfile(null);
        setRole(null);
        setOrganization(null);
        if (errData.error === 'ACCOUNT_NOT_PROVISIONED') {
          setProfileStatus('UNPROVISIONED');
          setAuthError('Your account has not been provisioned in the LIFE-LINK registry.');
        } else if (errData.error === 'ACCOUNT_INACTIVE') {
          setProfileStatus('INACTIVE');
          setAuthError('Your LIFE-LINK account has been deactivated.');
        } else {
          setProfileStatus('ERROR');
          setAuthError(errData.message || 'Access forbidden.');
        }
      } else if (response.status === 401) {
        // Session invalid on backend
        await supabase.auth.signOut();
        setUserProfile(null);
        setRole(null);
        setOrganization(null);
        setProfileStatus('UNAUTHENTICATED');
        setAuthError('Session expired. Please sign in again.');
      } else {
        const errData = await response.json().catch(() => ({}));
        console.error(`[LIFE-LINK] Auth endpoint error: HTTP ${response.status}`, errData);
        setUserProfile(null);
        setRole(null);
        setOrganization(null);
        setProfileStatus('ERROR');
        setAuthError(errData.message || `Authentication service error (HTTP ${response.status}).`);
      }
    } catch (err) {
      console.error('[LIFE-LINK] Network or configuration failure connecting to /api/auth/me:', err);
      setUserProfile(null);
      setRole(null);
      setOrganization(null);
      setProfileStatus('ERROR');
      setAuthError('Unable to connect to the authentication service. Please check your network or server configuration.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize session and auth state listener
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        const savedMock = localStorage.getItem('lifelink_dev_session');
        if (savedMock) {
          try {
            const parsed = JSON.parse(savedMock);
            if (parsed?.session?.access_token && parsed?.user) {
              setSession(parsed.session);
              setUser(parsed.user);
              setUserProfile(parsed.user);
              setRole(parsed.user.role);
              setOrganization(null);
              setProfileStatus('ACTIVE');
              setAuthError(null);
              setLoading(false);
              return;
            }
          } catch {
            localStorage.removeItem('lifelink_dev_session');
          }
        }

        const { data: { session: initialSession } } = await supabase.auth.getSession();
        if (mounted) {
          setSession(initialSession);
          setUser(initialSession?.user || null);
          if (initialSession) {
            await fetchUserProfile(initialSession);
          } else {
            setProfileStatus('UNAUTHENTICATED');
            setLoading(false);
          }
        }
      } catch (err) {
        console.error('[LIFE-LINK] Session restoration error:', err);
        if (mounted) {
          setProfileStatus('UNAUTHENTICATED');
          setLoading(false);
        }
      }
    }

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;
      if (localStorage.getItem('lifelink_dev_session')) return;

      setSession(newSession);
      setUser(newSession?.user || null);

      if (event === 'SIGNED_IN' && newSession) {
        await fetchUserProfile(newSession);
      } else if (event === 'SIGNED_OUT') {
        setUserProfile(null);
        setRole(null);
        setOrganization(null);
        setProfileStatus('UNAUTHENTICATED');
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [fetchUserProfile]);

  // Dev Mock Login
  const loginWithMock = async (role = 'DONOR', email = 'dev-donor@lifelink.test') => {
    try {
      setLoading(true);
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, email })
      }).catch(() => null);

      if (!res || !res.ok) {
        const errData = await res?.json().catch(() => ({}));
        throw new Error(errData?.message || errData?.error || 'Development authentication is unavailable or disabled');
      }

      const data = await res.json();
      const token = data.token;
      const userObj = data.user;

      const mockSession = {
        access_token: token,
        token_type: 'bearer',
        user: userObj
      };

      localStorage.setItem('lifelink_dev_session', JSON.stringify({ session: mockSession, user: userObj }));
      setSession(mockSession);
      setUser(userObj);
      setUserProfile(userObj);
      setRole(userObj.role);
      setOrganization(null);
      setProfileStatus('ACTIVE');
      setAuthError(null);
      setLoading(false);
      return { user: userObj, session: mockSession };
    } catch (err) {
      console.error('Mock login failed:', err);
      setAuthError(err.message);
      setLoading(false);
      throw err;
    }
  };

  // Request passwordless Email OTP
  const signInWithOtp = async (email) => {
    if (import.meta.env.DEV && (email.toLowerCase().includes('dev-donor') || email.toLowerCase().endsWith('@lifelink.test'))) {
      return { message: 'Dev OTP dispatched' };
    }

    // Uses shouldCreateUser: false so unprovisioned accounts are not silently created
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });

    if (error) {
      // Map Supabase error message cleanly
      if (error.message.toLowerCase().includes('signups not allowed')) {
        throw new Error('This email is not registered with LIFE-LINK. Contact your administrator to provision access.');
      }
      throw error;
    }

    return data;
  };

  // Verify 6 or 8-digit OTP
  const verifyOtp = async (email, token) => {
    if (import.meta.env.DEV && (email.toLowerCase().includes('dev-donor') || email.toLowerCase().endsWith('@lifelink.test') || token === '00000000')) {
      return loginWithMock('DONOR', email);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    });

    if (error) {
      throw error;
    }

    return data;
  };

  // Sign out cleanly
  const signOut = async () => {
    setLoading(true);
    localStorage.removeItem('lifelink_dev_session');
    await supabase.auth.signOut().catch(() => {});
    setSession(null);
    setUser(null);
    setUserProfile(null);
    setRole(null);
    setOrganization(null);
    setProfileStatus('UNAUTHENTICATED');
    setAuthError(null);
    setLoading(false);
  };

  const value = {
    session,
    user,
    userProfile,
    role,
    organization,
    profileStatus,
    authError,
    loading,
    signInWithOtp,
    verifyOtp,
    loginWithMock,
    signOut,
    refreshProfile: () => fetchUserProfile(session)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
