'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './client';
import { api } from '../api/client';
import { AuthContextType, OrganizationMembership, UserProfile } from '../../types/auth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<OrganizationMembership | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (accessToken: string) => {
    try {
      const data = await api.auth.getMe();
      if (data && data.user) {
        setUser(data.user);
        setOrganization(data.organization || null);
      }
    } catch (err) {
      console.error('[LIFE-LINK Auth] Failed to fetch user profile:', err);
      setUser(null);
      setOrganization(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      setToken(session.access_token);
      await fetchProfile(session.access_token);
    } else {
      setUser(null);
      setOrganization(null);
      setToken(null);
    }
  }, [fetchProfile]);

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (mounted && session?.access_token) {
          setToken(session.access_token);
          await fetchProfile(session.access_token);
        }
      } catch (err) {
        console.error('[LIFE-LINK Auth] Session initialization error:', err);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (session?.access_token) {
        setToken(session.access_token);
        await fetchProfile(session.access_token);
      } else {
        setToken(null);
        setUser(null);
        setOrganization(null);
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithOtp = async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: false,
        },
      });

      if (error) {
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to send OTP code';
      return { success: false, error: message };
    }
  };

  const verifyOtp = async (
    email: string,
    otpCode: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otpCode.trim(),
        type: 'email',
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (data.session?.access_token) {
        setToken(data.session.access_token);
        await fetchProfile(data.session.access_token);
      }

      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid or expired OTP code';
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[LIFE-LINK Auth] Sign out error:', err);
    } finally {
      setUser(null);
      setOrganization(null);
      setToken(null);
    }
  };

  const value: AuthContextType = {
    user,
    organization,
    token,
    isLoading,
    isAuthenticated: !!user && !!token,
    signInWithOtp,
    verifyOtp,
    signOut,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
