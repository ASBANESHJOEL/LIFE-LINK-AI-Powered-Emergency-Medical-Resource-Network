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
  const [loading, setLoading] = useState(true);

  // Fetch trusted profile and role from the backend using the authenticated session token
  const fetchUserProfile = useCallback(async (currentSession) => {
    if (!currentSession?.access_token) {
      setUserProfile(null);
      setRole(null);
      setOrganization(null);
      setProfileStatus('UNAUTHENTICATED');
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

      if (response.ok) {
        const data = await response.json();
        setUserProfile(data.user);
        setRole(data.user.role);
        setOrganization(data.organization || null);
        setProfileStatus('ACTIVE');
      } else if (response.status === 403) {
        const errData = await response.json().catch(() => ({}));
        if (errData.error === 'ACCOUNT_NOT_PROVISIONED') {
          setUserProfile(null);
          setRole(null);
          setOrganization(null);
          setProfileStatus('UNPROVISIONED');
        } else if (errData.error === 'ACCOUNT_INACTIVE') {
          setUserProfile(null);
          setRole(null);
          setOrganization(null);
          setProfileStatus('INACTIVE');
        } else {
          setProfileStatus('ERROR');
        }
      } else if (response.status === 401) {
        // Session invalid on backend
        await supabase.auth.signOut();
        setProfileStatus('UNAUTHENTICATED');
      } else {
        // Fallback: If backend is offline, try direct query (subject to database RLS)
        const { data: dbUser, error: dbError } = await supabase
          .from('users')
          .select('id, email, phone, role, is_active, is_synthetic')
          .eq('id', currentSession.user.id)
          .maybeSingle();

        if (dbError || !dbUser) {
          setProfileStatus('UNPROVISIONED');
        } else if (dbUser.is_active === false) {
          setProfileStatus('INACTIVE');
        } else {
          setUserProfile(dbUser);
          setRole(dbUser.role);
          setProfileStatus('ACTIVE');
        }
      }
    } catch (err) {
      console.error('[LIFE-LINK] Failed to fetch application user profile:', err);
      // Direct query fallback
      try {
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, email, phone, role, is_active, is_synthetic')
          .eq('id', currentSession.user.id)
          .maybeSingle();

        if (dbUser && dbUser.is_active !== false) {
          setUserProfile(dbUser);
          setRole(dbUser.role);
          setProfileStatus('ACTIVE');
        } else if (dbUser && dbUser.is_active === false) {
          setProfileStatus('INACTIVE');
        } else {
          setProfileStatus('UNPROVISIONED');
        }
      } catch {
        setProfileStatus('ERROR');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize session and auth state listener
  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
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

  // Request passwordless Email OTP
  const signInWithOtp = async (email) => {
    // Uses shouldCreateUser: false so unprovisioned accounts are not silently created
    const { data, error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });

    if (error) {
      // Map Supabase error message cleanly
      if (error.message?.toLowerCase().includes('signups not allowed')) {
        throw new Error('Account not found. Your email must be provisioned before signing in.');
      }
      throw error;
    }

    return data;
  };

  // Verify 6-digit OTP
  const verifyOtp = async (email, token) => {
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
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setUserProfile(null);
    setRole(null);
    setOrganization(null);
    setProfileStatus('UNAUTHENTICATED');
    setLoading(false);
  };

  const value = {
    session,
    user,
    userProfile,
    role,
    organization,
    profileStatus,
    loading,
    signInWithOtp,
    verifyOtp,
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
