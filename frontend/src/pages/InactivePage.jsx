import React from 'react';
import { useAuth } from '../context/AuthContext';
import { AlertOctagon, LogOut } from 'lucide-react';

export function InactivePage() {
  const { user, signOut } = useAuth();

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
          <AlertOctagon size={36} color="#ef4444" />
        </div>

        <h1 style={{ fontSize: '1.4rem', marginBottom: '8px' }}>Account Deactivated</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: 1.6 }}>
          The LIFE-LINK application account for <strong style={{ color: '#fff' }}>{user?.email}</strong> is marked as inactive (<code style={{ color: '#ef4444' }}>is_active = false</code>).
        </p>

        <p style={{ color: 'var(--text-subtle)', fontSize: '0.85rem', marginBottom: '24px' }}>
          Access to emergency medical network operations is temporarily restricted. Please contact your organization administrator or LIFE-LINK support to reactivate your credentials.
        </p>

        <button onClick={signOut} className="btn btn-secondary" style={{ width: '100%' }}>
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
