import { BloodGroup, EmergencyRequest } from './requests';

export type DispatchStatus =
  | 'NOTIFIED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'TIMEOUT'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface DonorDispatch {
  id: string;
  request_id: string;
  donor_id: string;
  batch_number: number;
  priority_score: number;
  eta: number | null;
  status: DispatchStatus;
  notified_at: string;
  responded_at?: string | null;
  accepted_at?: string | null;
  en_route_at?: string | null;
  arrived_at?: string | null;
  completed_at?: string | null;
  current_latitude?: number | null;
  current_longitude?: number | null;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  donor?: {
    id: string;
    blood_group: BloodGroup;
    current_latitude?: number;
    current_longitude?: number;
    users?: {
      email: string;
    };
  };
  emergency_requests?: EmergencyRequest;
}

export interface EligibleDonor {
  donorId: string;
  bloodGroup: BloodGroup;
  verified: boolean;
  eligible: boolean;
  available: boolean;
  distanceKm: number;
  currentLatitude: number;
  currentLongitude: number;
}

export interface RankedDonor {
  donorId: string;
  bloodGroup: BloodGroup;
  distanceKm: number;
  priorityScore: number;
  rank?: number;
  modelFeatures?: Record<string, unknown>;
}

export interface RankingResult {
  candidateCount: number;
  modelVersion: string;
  rankedDonors: RankedDonor[];
  nextBatch: RankedDonor[];
}

export interface DispatchNextBatchResult {
  batchNumber: number;
  batchSize: number;
  dispatches: DonorDispatch[];
  notified: number;
}

export interface RouteGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface RouteInfo {
  dispatchId: string;
  status: DispatchStatus;
  distanceKm: number;
  durationSeconds: number;
  etaMinutes: number;
  geometry: RouteGeometry;
  routingProvider: string;
  fallback: boolean;
  donorLocation?: { latitude: number; longitude: number };
  hospitalLocation?: { latitude: number; longitude: number };
}
