'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from './client';
import { api, ApiClientError } from '../api/client';
import { AuthContextType, OrganizationMembership, UserProfile, ProfileStatus } from '../../types/auth';
import { normalizeEmail, clearPendingEmail } from './pending-email';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [organization, setOrganization] = useState<OrganizationMembership | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('LOADING');
  const [authError, setAuthError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (accessToken: string): Promise<ProfileStatus> => {
    try {
      const data = await api.auth.getMe();
      if (data && data.user) {
        setUser(data.user);
        setOrganization(data.organization || null);
        setProfileStatus('ACTIVE');
        setAuthError(null);
        return 'ACTIVE';
      } else {
        setUser(null);
        setOrganization(null);
        setProfileStatus('ERROR');
        setAuthError('Invalid user profile structure returned from server.');
        return 'ERROR';
      }
    } catch (err: unknown) {
      console.error('[LIFE-LINK Auth] Profile resolution error:', err);

      if (err instanceof ApiClientError) {
        if (err.status === 403) {
          const details = err.details as { error?: string | { code?: string; message?: string }; message?: string } | undefined;
          const errorCode = typeof details?.error === 'string' ? details.error : details?.error?.code;
          const errorMessage = typeof details?.error === 'object' && details?.error?.message ? details.error.message : details?.message;
          if (errorCode === 'ACCOUNT_NOT_PROVISIONED') {
            setUser(null);
            setOrganization(null);
            setProfileStatus('UNPROVISIONED');
            setAuthError(
              errorMessage ||
                'Your email is authenticated, but your account has not been provisioned in the LIFE-LINK medical registry.'
            );
            return 'UNPROVISIONED';
          } else if (errorCode === 'ACCOUNT_INACTIVE') {
            setUser(null);
            setOrganization(null);
            setProfileStatus('INACTIVE');
            setAuthError(
              errorMessage ||
                'Your LIFE-LINK account has been deactivated by regional policy. Access denied.'
            );
            return 'INACTIVE';
          } else {
            setUser(null);
            setOrganization(null);
            setProfileStatus('ERROR');
            setAuthError(err.message || 'Access denied.');
            return 'ERROR';
          }
        } else if (err.status === 401) {
          // Token rejected as invalid or expired by backend
          setUser(null);
          setOrganization(null);
          setToken(null);
          setProfileStatus('UNAUTHENTICATED');
          setAuthError('Your session has expired. Please log in again.');
          await supabase.auth.signOut().catch(() => {});
          return 'UNAUTHENTICATED';
        }
      }

      // Network, server timeout or 500 error: preserve the authenticated token
      // so temporary infrastructure issues do not destroy a valid session
      setProfileStatus('ERROR');
      setAuthError('Unable to connect to the authentication service. Please check your network.');
      return 'ERROR';
    }
  }, []);

  const getStoredDevToken = () => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('lifelink_dev_token');
  };

  const refreshProfile = useCallback(async () => {
    const devToken = getStoredDevToken();
    if (devToken) {
      setToken(devToken);
      await fetchProfile(devToken);
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      setToken(session.access_token);
      await fetchProfile(session.access_token);
    } else {
      setUser(null);
      setOrganization(null);
      setToken(null);
      setProfileStatus('UNAUTHENTICATED');
      setAuthError(null);
    }
  }, [fetchProfile]);

  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const devToken = getStoredDevToken();
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = devToken || session?.access_token;
        if (mounted && accessToken) {
          setToken(accessToken);
          await fetchProfile(accessToken);
        } else if (mounted) {
          setProfileStatus('UNAUTHENTICATED');
        }
      } catch (err) {
        console.error('[LIFE-LINK Auth] Session initialization error:', err);
        if (mounted) {
          setProfileStatus('UNAUTHENTICATED');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return;

      if (event === 'SIGNED_OUT') {
        setToken(null);
        setUser(null);
        setOrganization(null);
        setProfileStatus('UNAUTHENTICATED');
        setAuthError(null);
        setIsLoading(false);
        return;
      }

      if (session?.access_token) {
        setToken(session.access_token);
        await fetchProfile(session.access_token);
      } else {
        setToken(null);
        setUser(null);
        setOrganization(null);
        setProfileStatus('UNAUTHENTICATED');
      }
      setIsLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithDevRole = async (
    role: 'DONOR' | 'HOSPITAL' | 'BLOOD_BANK' | 'ADMIN'
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const session = await api.auth.devLogin(role);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('lifelink_dev_token', session.token);
      }
      setToken(session.token);
      const status = await fetchProfile(session.token);
      return status === 'ACTIVE'
        ? { success: true }
        : { success: false, error: 'Development account could not be provisioned.' };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Development login failed.'
      };
    }
  };

  const signInWithOtp = async (
    email: string,
    options?: { shouldCreateUser?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) {
      return { success: false, error: 'Please provide a valid email address.' };
    }

    try {
      const shouldCreate = options?.shouldCreateUser ?? false;
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: shouldCreate,
        },
      });

      if (error) {
        const lower = error.message.toLowerCase();
        if (lower.includes('signups not allowed') || lower.includes('user not found')) {
          return {
            success: false,
            error: 'This email is not registered with LIFE-LINK. Please create an account or contact your administrator.',
          };
        }
        if (lower.includes('rate limit') || lower.includes('security purposes')) {
          return {
            success: false,
            error: 'Too many requests. Please wait a moment before requesting another verification code.',
          };
        }
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
  ): Promise<{ success: boolean; error?: string; profileStatus?: ProfileStatus }> => {
    const cleanEmail = normalizeEmail(email);
    const cleanToken = otpCode.trim();

    if (!cleanEmail) {
      return { success: false, error: 'Email address is required for verification.' };
    }

    if (!/^\d{6,8}$/.test(cleanToken)) {
      return { success: false, error: 'Verification code must be between 6 and 8 digits.' };
    }

    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'email',
      });

      if (error) {
        const lower = error.message.toLowerCase();
        let userFriendly = error.message;

        if (lower.includes('token has expired') || lower.includes('invalid') || lower.includes('expired')) {
          userFriendly =
            'The verification code is invalid or has expired. If you recently requested a new code, please ensure you use the latest one received.';
        } else if (lower.includes('rate limit') || lower.includes('security purposes')) {
          userFriendly = 'Too many failed attempts. Please wait a moment before trying again.';
        }

        return { success: false, error: userFriendly };
      }

      if (data.session?.access_token) {
        setToken(data.session.access_token);
        const status = await fetchProfile(data.session.access_token);
        clearPendingEmail();
        return { success: true, profileStatus: status };
      }

      clearPendingEmail();
      return { success: true, profileStatus: 'ACTIVE' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid or expired OTP code';
      return { success: false, error: message };
    }
  };

  const signOut = async () => {
    try {
      clearPendingEmail();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('lifelink_dev_token');
      }
      await supabase.auth.signOut();
    } catch (err) {
      console.error('[LIFE-LINK Auth] Sign out error:', err);
    } finally {
      setUser(null);
      setOrganization(null);
      setToken(null);
      setProfileStatus('UNAUTHENTICATED');
      setAuthError(null);
    }
  };

  const value: AuthContextType = {
    user,
    organization,
    token,
    isLoading,
    isAuthenticated: !!user && !!token && profileStatus === 'ACTIVE',
    profileStatus,
    authError,
    signInWithOtp,
    signInWithDevRole,
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
