import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { Droplet, LogOut, ShieldCheck } from 'lucide-react';

export function BloodBankDashboard() {
  const { userProfile, organization, signOut } = useAuth();

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
                background: 'var(--accent-amber-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(245, 158, 11, 0.3)'
              }}
            >
              <Droplet size={24} color="#f59e0b" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem' }}>Blood Bank Portal</h2>
              <span className="role-badge badge-BLOOD_BANK">Blood Bank Authorized</span>
            </div>
          </div>

          <button onClick={signOut} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>

        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '20px', border: '1px solid var(--bg-card-border)', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Verified Staff Identity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: '8px', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-subtle)' }}>Staff User ID:</span>
            <span style={{ fontFamily: 'monospace', color: '#fff' }}>{userProfile?.id}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Email:</span>
            <span>{userProfile?.email}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Role:</span>
            <span style={{ fontWeight: 600 }}>{userProfile?.role}</span>
          </div>
        </div>

        {organization && (
          <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '20px', border: '1px solid var(--bg-card-border)' }}>
            <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Affiliated Blood Bank</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', rowGap: '8px', fontSize: '0.9rem' }}>
              <span style={{ color: 'var(--text-subtle)' }}>Facility:</span>
              <span style={{ color: '#fff', fontWeight: 600 }}>{organization.bloodBank?.name || organization.bloodBankId}</span>
              <span style={{ color: 'var(--text-subtle)' }}>Reg ID:</span>
              <span>{organization.bloodBank?.registration_id || 'Verified'}</span>
              <span style={{ color: 'var(--text-subtle)' }}>Staff Position:</span>
              <span style={{ color: '#f59e0b', fontWeight: 600 }}>{organization.membershipRole}</span>
            </div>
          </div>
        )}

        <p style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-subtle)', textAlign: 'center' }}>
          LIFE-LINK Emergency Blood & Resource Network — V1 Authentication Foundation
        </p>
      </div>
    </div>
  );
}
