import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Route guard enforcing:
 * 1. Valid Supabase authentication
 * 2. Active provisioned account in public.users
 * 3. Role-based authorization matching allowedRoles
 */
export function ProtectedRoute({ children, allowedRoles }) {
  const { session, user, role, profileStatus, authError, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="center-content" style={{ minHeight: '60vh' }}>
        <div className="spinner" style={{ width: '36px', height: '36px', borderWidth: '3px' }} />
        <p style={{ marginTop: '16px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Verifying secure credentials...
        </p>
      </div>
    );
  }

  // 1. Not authenticated with Supabase Auth
  if (!session || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // 2. Authenticated in Supabase Auth, but no matching record in public.users
  if (profileStatus === 'UNPROVISIONED') {
    return <Navigate to="/unprovisioned" replace />;
  }

  // 3. Authenticated, but user.is_active is false
  if (profileStatus === 'INACTIVE') {
    return <Navigate to="/inactive" replace />;
  }

  // 4. API / Configuration Error (surfaced instead of treating as unprovisioned)
  if (profileStatus === 'ERROR') {
    return (
      <div className="center-content" style={{ minHeight: '60vh' }}>
        <div className="glass-panel" style={{ maxWidth: '460px', padding: '32px', textAlign: 'center' }}>
          <h2 style={{ color: '#ef4444', marginBottom: '12px' }}>Authentication Error</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px', fontSize: '0.95rem' }}>
            {authError || 'Failed to verify account authorization with the LIFE-LINK backend service.'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Retry Verification
          </button>
        </div>
      </div>
    );
  }

  // 4. Role Authorization Guard
  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return <Navigate to="/unauthorized" state={{ attemptedRole: role, allowedRoles }} replace />;
  }

  return children;
}
