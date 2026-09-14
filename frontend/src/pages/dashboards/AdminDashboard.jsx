import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, LogOut, CheckCircle2 } from 'lucide-react';

export function AdminDashboard() {
  const { userProfile, signOut } = useAuth();

  return (
    <div className="center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', padding: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'rgba(168, 85, 247, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(168, 85, 247, 0.3)'
              }}
            >
              <ShieldAlert size={24} color="#c084fc" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem' }}>System Administration</h2>
              <span className="role-badge badge-ADMIN">Administrator</span>
            </div>
          </div>

          <button onClick={signOut} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '20px', border: '1px solid var(--bg-card-border)' }}>
          <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Administrative Identity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: '8px', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-subtle)' }}>Admin ID:</span>
            <span style={{ fontFamily: 'monospace', color: '#fff' }}>{userProfile?.id}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Email:</span>
            <span>{userProfile?.email}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Privilege Level:</span>
            <span style={{ color: '#c084fc', fontWeight: 600 }}>Superadmin (V1)</span>
          </div>
        </div>

        <p style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-subtle)', textAlign: 'center' }}>
          LIFE-LINK Emergency Blood & Resource Network — V1 Authentication Foundation
        </p>
      </div>
    </div>
  );
}
