import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { HeartHandshake, LogOut, Bell, Check, AlertCircle } from 'lucide-react';

export function DonorDashboard() {
  const { userProfile, session, signOut } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(true);
  const [loading, setLoading] = useState(false);

  // Fetch initial notifications via authenticated backend API
  useEffect(() => {
    if (!userProfile?.id || !session?.access_token) return;

    async function loadNotifications() {
      setLoading(true);
      try {
        const res = await fetch('/api/notifications?limit=20', {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.notifications)) {
            setNotifications(json.notifications);
            setUnreadCount(json.pagination?.unreadCount ?? 0);
          }
        } else {
          console.error(`Failed to fetch notifications: HTTP ${res.status}`);
        }
      } catch (err) {
        console.error('Error fetching notifications from backend API:', err);
      } finally {
        setLoading(false);
      }
    }

    loadNotifications();

    // Supabase Realtime Subscription for incoming donor notifications
    const channel = supabase
      .channel(`donor-notifications-${userProfile.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userProfile.id}`
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            if (payload.new.channel === 'IN_APP') {
              setNotifications((prev) => [payload.new, ...prev]);
              if (!payload.new.read_at) {
                setUnreadCount((count) => count + 1);
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((prev) =>
              prev.map((item) => (item.id === payload.new.id ? payload.new : item))
            );
            if (payload.new.read_at && payload.old && !payload.old.read_at) {
              setUnreadCount((count) => Math.max(0, count - 1));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userProfile?.id, session?.access_token]);

  // Handle Mark As Read via authenticated backend API
  const handleMarkAsRead = async (notificationId) => {
    if (!session?.access_token) return;

    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        const nowIso = new Date().toISOString();
        setNotifications((prev) =>
          prev.map((n) => (n.id === notificationId ? { ...n, status: 'READ', read_at: nowIso } : n))
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } else {
        console.error(`Failed to mark notification as read: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Error marking notification as read via backend API:', err);
    }
  };

  return (
    <div className="center-content">
      <div className="glass-panel" style={{ width: '100%', maxWidth: '640px', padding: '36px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: 'var(--primary-light)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}
            >
              <HeartHandshake size={24} color="#ef4444" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Donor Portal</h2>
              <span className="role-badge badge-DONOR">Donor Authorized</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Notification Bell with Badge */}
            <button
              onClick={() => setShowNotifications((prev) => !prev)}
              className="btn btn-secondary"
              style={{ position: 'relative', padding: '8px 12px' }}
              title="Toggle notifications"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: '#ef4444',
                    color: '#fff',
                    borderRadius: '10px',
                    padding: '2px 6px',
                    fontSize: '0.7rem',
                    fontWeight: 700
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </button>

            <button onClick={signOut} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
              <LogOut size={16} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>

        {/* Emergency Notifications Feed */}
        {showNotifications && (
          <div
            style={{
              background: 'rgba(0,0,0,0.25)',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '20px',
              border: '1px solid var(--bg-card-border)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '0.95rem', color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} color="#ef4444" />
                <span>Emergency Notifications</span>
              </h3>
              {unreadCount > 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {unreadCount} unread
                </span>
              )}
            </div>

            {loading ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Loading alerts...</p>
            ) : notifications.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>No active notifications at this time.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '240px', overflowY: 'auto' }}>
                {notifications.map((notif) => {
                  const isUnread = !notif.read_at;
                  return (
                    <div
                      key={notif.id}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isUnread ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                        border: isUnread ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '12px'
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <strong style={{ fontSize: '0.85rem', color: isUnread ? '#fca5a5' : '#e5e7eb' }}>
                            {notif.title}
                          </strong>
                          {isUnread && (
                            <span style={{ fontSize: '0.65rem', background: '#ef4444', color: '#fff', padding: '1px 4px', borderRadius: '4px' }}>
                              NEW
                            </span>
                          )}
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>
                          {notif.body}
                        </p>
                      </div>

                      {isUnread && (
                        <button
                          onClick={() => handleMarkAsRead(notif.id)}
                          className="btn btn-secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          title="Mark as read"
                        >
                          <Check size={14} />
                          <span>Read</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Identity Panel */}
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '12px', padding: '20px', border: '1px solid var(--bg-card-border)' }}>
          <h3 style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Verified Identity</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: '8px', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-subtle)' }}>User ID:</span>
            <span style={{ fontFamily: 'monospace', color: '#fff' }}>{userProfile?.id}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Email:</span>
            <span>{userProfile?.email}</span>
            <span style={{ color: 'var(--text-subtle)' }}>Account Status:</span>
            <span style={{ color: '#10b981', fontWeight: 600 }}>Active & Verified</span>
            <span style={{ color: 'var(--text-subtle)' }}>Data Type:</span>
            <span>{userProfile?.is_synthetic ? 'Synthetic / Demo' : 'Real Application User'}</span>
          </div>
        </div>

        <p style={{ marginTop: '24px', fontSize: '0.8rem', color: 'var(--text-subtle)', textAlign: 'center' }}>
          LIFE-LINK Emergency Blood & Resource Network — V1 Notification & Dispatch Layer
        </p>
      </div>
    </div>
  );
}

export default DonorDashboard;
