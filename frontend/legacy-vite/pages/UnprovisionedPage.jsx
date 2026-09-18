import React from 'react';
import { useAuth } from '../context/AuthContext';
import { UserX, LogOut } from 'lucide-react';

export function UnprovisionedPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '36px', textAlign: 'center' }}>
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '20px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px auto'
          }}
        >
          <UserX size={36} color="#f59e0b" />
        </div>

        <h1 style={{ fontSize: '1.4rem', marginBottom: '8px' }}>Account Not Provisioned</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px', lineHeight: 1.6 }}>
          Your email <strong style={{ color: '#fff' }}>{user?.email}</strong> successfully authenticated with Supabase Auth, but no application profile exists in the LIFE-LINK registry.
        </p>

        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '12px', textAlign: 'left', marginBottom: '24px', fontSize: '0.85rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>
            LIFE-LINK is a restricted medical resource network. Application accounts must be approved and provisioned by an authorized institutional administrator before accessing network services.
          </p>
        </div>

        <button onClick={signOut} className="btn btn-secondary" style={{ width: '100%' }}>
          <LogOut size={16} />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
