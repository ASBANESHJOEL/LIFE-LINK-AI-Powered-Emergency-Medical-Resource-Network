import { supabase } from '../supabase/client';
import {
  EmergencyRequest,
  CreateEmergencyRequestPayload,
  InventoryResolutionResult,
  PeerBanksResolutionResult,
} from '../../types/requests';
import { AcceptTransferOfferResponse } from '../../types/transfers';
import {
  DonorDispatch,
  EligibleDonor,
  RankingResult,
  DispatchNextBatchResult,
  RouteInfo,
} from '../../types/dispatch';
import { NotificationsListResponse } from '../../types/notifications';
import { AuthUserResponse } from '../../types/auth';

class ApiClientError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Authorization')) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
    }
  }

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const response = await fetch(url, { ...options, headers });

  const contentType = response.headers.get('content-type');
  const isJson = contentType?.includes('application/json');
  const body = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      (typeof body === 'object' && body !== null && (body.error || body.message)) ||
      `Request failed with status ${response.status}`;
    throw new ApiClientError(message, response.status, body);
  }

  return body as T;
}

const bloodGroupToApi: Record<string, string> = {
  'A+': 'A_POSITIVE',
  'A-': 'A_NEGATIVE',
  'B+': 'B_POSITIVE',
  'B-': 'B_NEGATIVE',
  'AB+': 'AB_POSITIVE',
  'AB-': 'AB_NEGATIVE',
  'O+': 'O_POSITIVE',
  'O-': 'O_NEGATIVE',
};

const resourceTypeToApi: Record<string, string> = {
  WHOLE_BLOOD: 'WHOLE_BLOOD',
  PACKED_RED_CELLS: 'RED_BLOOD_CELLS',
  RED_BLOOD_CELLS: 'RED_BLOOD_CELLS',
  PLATELETS: 'PLATELETS',
  FRESH_FROZEN_PLASMA: 'PLASMA',
  PLASMA: 'PLASMA',
};

export const api = {
  auth: {
    getMe: () => request<AuthUserResponse>('/api/auth/me'),
    checkSignup: (email: string) =>
      request<{ exists: boolean; role?: string; is_active?: boolean; message?: string }>(
        '/api/auth/signup-check',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        }
      ),
  },

  requests: {
    create: (payload: CreateEmergencyRequestPayload) =>
      request<{ request: EmergencyRequest }>('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          ...payload,
          blood_group: bloodGroupToApi[payload.blood_group] ?? payload.blood_group,
          resource_type: resourceTypeToApi[payload.resource_type] ?? payload.resource_type,
          urgency: payload.urgency,
        }),
      }),

    resolveInventory: (requestId: string) =>
      request<InventoryResolutionResult>(`/api/requests/${requestId}/resolve/inventory`, {
        method: 'POST',
      }),

    resolvePeerBanks: (requestId: string) =>
      request<PeerBanksResolutionResult>(`/api/requests/${requestId}/resolve/peer-banks`, {
        method: 'POST',
      }),

    getEligibleDonors: (requestId: string) =>
      request<{ candidateCount: number; donors: EligibleDonor[] }>(
        `/api/requests/${requestId}/eligible-donors`
      ),

    getDonorRanking: (requestId: string) =>
      request<RankingResult>(`/api/requests/${requestId}/donor-ranking`),

    dispatchNextBatch: (requestId: string, batchSize: number = 5) =>
      request<DispatchNextBatchResult>(
        `/api/requests/${requestId}/donor-dispatches/next-batch`,
        {
          method: 'POST',
          body: JSON.stringify({ batchSize }),
        }
      ),

    cancel: (requestId: string) =>
      request<{ requestId: string; status: string; releasedDispatchCount: number }>(
        `/api/requests/${requestId}/cancel`,
        { method: 'POST' }
      ),
  },

  transfers: {
    accept: (offerId: string) =>
      request<AcceptTransferOfferResponse>(`/api/transfer-offers/${offerId}/accept`, {
        method: 'POST',
      }),
  },

  donors: {
    getAvailability: () =>
      request<{
        donorId: string;
        userId: string;
        availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
        eligibilityStatus: string;
      }>('/api/donors/availability'),

    setAvailability: (availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE', confirmWithdraw: boolean = false) =>
      request<{
        donorId: string;
        userId: string;
        availabilityStatus: 'AVAILABLE' | 'UNAVAILABLE';
        eligibilityStatus: string;
        activeDispatchesWithdrawn: number;
      }>('/api/donors/availability', {
        method: 'PATCH',
        body: JSON.stringify({ availabilityStatus, confirmWithdraw }),
      }),
  },

  donorDispatches: {
    respond: (dispatchId: string, response: 'ACCEPT' | 'DECLINE') =>
      request<DonorDispatch>(`/api/donor-dispatches/${dispatchId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ response }),
      }),

    startTracking: (dispatchId: string) =>
      request<{ status: string }>(`/api/donor-dispatches/${dispatchId}/tracking/start`, {
        method: 'POST',
      }),

    updateLocation: (dispatchId: string, latitude: number, longitude: number) =>
      request<{ status: string; dispatchId: string }>(
        `/api/donor-dispatches/${dispatchId}/location`,
        {
          method: 'POST',
          body: JSON.stringify({ latitude, longitude }),
        }
      ),

    getRoute: (dispatchId: string) =>
      request<RouteInfo>(`/api/donor-dispatches/${dispatchId}/route`),

    getTracking: (dispatchId: string) =>
      request<{
        dispatchId: string;
        requestId: string;
        donorId: string;
        status: string;
        trackingStatus: 'ACTIVE' | 'STALE' | 'WAITING_FOR_LOCATION' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'UNAVAILABLE';
        isStale: boolean;
        staleThresholdMinutes: number;
        cancellationReason: string | null;
        currentLocation: { latitude: number; longitude: number; eta: number | null; recordedAt: string } | null;
        timestamps: {
          notifiedAt: string | null;
          acceptedAt: string | null;
          enRouteAt: string | null;
          arrivedAt: string | null;
          completedAt: string | null;
          cancelledAt: string | null;
        };
      }>(`/api/donor-dispatches/${dispatchId}/tracking`),

    arrive: (dispatchId: string) =>
      request<{ status: string }>(`/api/donor-dispatches/${dispatchId}/tracking/arrive`, {
        method: 'POST',
      }),

    complete: (dispatchId: string) =>
      request<{ status: string; requestStatus: string }>(
        `/api/donor-dispatches/${dispatchId}/tracking/complete`,
        { method: 'POST' }
      ),

    withdraw: (dispatchId: string, makeUnavailable: boolean = false, reason?: string) =>
      request<{
        dispatchId: string;
        requestId: string;
        donorId: string;
        status: string;
        cancellationReason: string;
        availabilityStatus: string;
      }>(`/api/donor-dispatches/${dispatchId}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ makeUnavailable, reason }),
      }),

    gpsTimeout: (dispatchId: string) =>
      request<{
        dispatchId: string;
        requestId: string;
        donorId: string;
        status: string;
        cancellationReason: string;
      }>(`/api/donor-dispatches/${dispatchId}/gps-timeout`, {
        method: 'POST',
      }),

    etaCheck: (dispatchId: string, eta: number, maxThreshold?: number) =>
      request<{
        dispatchId: string;
        status: string;
        cancellationReason?: string;
        exceeded: boolean;
        eta: number;
        threshold?: number;
      }>(`/api/donor-dispatches/${dispatchId}/eta-check`, {
        method: 'POST',
        body: JSON.stringify({ eta, maxThreshold }),
      }),
  },

  notifications: {
    list: (params?: { unreadOnly?: boolean; page?: number; limit?: number }) => {
      const searchParams = new URLSearchParams();
      if (params?.unreadOnly) searchParams.set('unreadOnly', 'true');
      if (params?.page) searchParams.set('page', params.page.toString());
      if (params?.limit) searchParams.set('limit', params.limit.toString());
      const queryString = searchParams.toString();
      return request<NotificationsListResponse>(
        `/api/notifications${queryString ? `?${queryString}` : ''}`
      );
    },

    markRead: (id: string) =>
      request<{ success: boolean; notification: unknown }>(`/api/notifications/${id}/read`, {
        method: 'PATCH',
      }),
  },
};

export { ApiClientError };
