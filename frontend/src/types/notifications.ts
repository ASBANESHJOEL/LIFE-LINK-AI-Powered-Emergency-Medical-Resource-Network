export type NotificationChannel = 'EMAIL' | 'SMS' | 'IN_APP' | 'PUSH';
export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'READ';

export interface AppNotification {
  id: string;
  user_id: string;
  donor_dispatch_id?: string | null;
  request_id?: string | null;
  channel: NotificationChannel;
  status: NotificationStatus;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  sent_at?: string | null;
  read_at?: string | null;
}

export interface NotificationsListResponse {
  notifications: AppNotification[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    unreadCount: number;
  };
}
