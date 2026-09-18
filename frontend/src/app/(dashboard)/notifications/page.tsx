'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, Check, CheckCheck, RefreshCw, ExternalLink, ShieldCheck, Mail, MessageSquare } from 'lucide-react';
import { api } from '../../../lib/api/client';
import { AppNotification } from '../../../types/notifications';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const res = await api.notifications.list({ unreadOnly });
      if (res && res.notifications) {
        setNotifications(res.notifications);
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [unreadOnly]);

  const handleMarkRead = async (id: string) => {
    setMarkingId(id);
    try {
      await api.notifications.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, status: 'READ', read_at: new Date().toISOString() } : n))
      );
    } catch (err) {
      console.error('Failed to mark read:', err);
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Bell className="w-6 h-6 text-sky-400" />
            Network Notifications & Dispatch Alerts
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time audit log of system dispatches, inventory reservations, and trauma escalations
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant={unreadOnly ? 'medical' : 'outline'}
            size="sm"
            onClick={() => setUnreadOnly(!unreadOnly)}
            className="text-xs"
          >
            {unreadOnly ? 'Showing Unread' : 'Filter Unread'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchNotifications} className="text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">System Feed</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading alerts stream...</div>
          ) : notifications.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No notifications in your feed.
            </div>
          ) : (
            <div className="divide-y divide-slate-800/60">
              {notifications.map((n) => {
                const isUnread = n.status !== 'READ' && !n.read_at;

                return (
                  <div
                    key={n.id}
                    className={`p-4 transition-colors flex items-start justify-between gap-4 ${
                      isUnread ? 'bg-slate-800/30' : 'hover:bg-slate-800/10'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                          isUnread
                            ? 'bg-red-950/80 border border-red-800/80 text-red-400'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {n.channel === 'SMS' ? (
                          <MessageSquare className="w-4 h-4" />
                        ) : (
                          <Mail className="w-4 h-4" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-white">{n.title}</h4>
                          {isUnread && (
                            <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
                          )}
                          <span className="text-[10px] uppercase font-bold text-slate-500">
                            {n.channel}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{n.body}</p>
                        <span className="text-[11px] text-slate-500 mt-2 block">
                          {new Date(n.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {n.request_id && (
                        <Link href={`/hospital/requests/${n.request_id}`}>
                          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                            Request
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      )}

                      {isUnread && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          isLoading={markingId === n.id}
                          onClick={() => handleMarkRead(n.id)}
                        >
                          <Check className="w-3 h-3" />
                          Mark read
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
