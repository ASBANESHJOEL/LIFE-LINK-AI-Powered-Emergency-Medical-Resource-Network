import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ShieldX, LogOut, ArrowLeft } from 'lucide-react';

export function UnauthorizedPage() {
  const { role, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const rolePaths = {
    DONOR: '/donor',
    HOSPITAL: '/hospital',
    BLOOD_BANK: '/blood-bank',
    ADMIN: '/admin'
  };

  const authorizedHome = role ? rolePaths[role] : '/login';

  return (
    <div className="center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '36px', textAlign: 'center' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px auto'
          }}
        >
          <ShieldX size={36} color="#ef4444" />
        </div>

        <h1 style={{ fontSize: '1.5rem', marginBottom: '8px' }}>403 — Access Denied</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
          Your authenticated role <strong style={{ color: '#fff' }}>[{role || 'UNKNOWN'}]</strong> does not have permission to access the requested resource.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {role && (
            <button onClick={() => navigate(authorizedHome)} className="btn btn-primary">
              <ArrowLeft size={16} />
              <span>Return to My Dashboard</span>
            </button>
          )}

          <button onClick={signOut} className="btn btn-secondary">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
