import { BloodGroup, ResourceType, UrgencyLevel } from './requests';

export type TransferOfferStatus =
  | 'OFFERED'
  | 'ACCEPTED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface BloodBankTransferOffer {
  id: string;
  request_id: string;
  blood_bank_id: string;
  blood_group: BloodGroup;
  component_type: ResourceType;
  offered_units: number;
  distance_km: number;
  status: TransferOfferStatus;
  created_at: string;
  accepted_at?: string | null;
  completed_at?: string | null;
  blood_banks?: {
    id: string;
    name: string;
  };
  emergency_requests?: {
    id: string;
    urgency: UrgencyLevel;
    hospital_id: string;
    hospitals?: {
      hospital_name: string;
    };
  };
}

export interface AcceptTransferOfferResponse {
  offerId: string;
  requestId: string;
  bloodBankId: string;
  reservedUnits: number;
  remainingRequestUnits: number;
  requestStatus: string;
}
