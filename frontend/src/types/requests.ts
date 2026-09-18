export type BloodGroup =
  | 'A+'
  | 'A-'
  | 'B+'
  | 'B-'
  | 'AB+'
  | 'AB-'
  | 'O+'
  | 'O-';

export type ResourceType =
  | 'WHOLE_BLOOD'
  | 'PACKED_RED_CELLS'
  | 'PLATELETS'
  | 'FRESH_FROZEN_PLASMA';

export type UrgencyLevel = 'CRITICAL' | 'URGENT' | 'STANDARD';

export type RequestStatus =
  | 'OPEN'
  | 'SEARCHING'
  | 'INVENTORY_RESERVED'
  | 'PEER_TRANSFER_PENDING'
  | 'DONORS_NOTIFIED'
  | 'EN_ROUTE'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'ESCALATED';

export interface EmergencyRequest {
  id: string;
  hospital_id: string;
  blood_group: BloodGroup;
  resource_type: ResourceType;
  quantity: number;
  urgency: UrgencyLevel;
  status: RequestStatus;
  hospital_latitude: number;
  hospital_longitude: number;
  created_at: string;
  completed_at?: string | null;
  hospital?: {
    id: string;
    name: string;
  };
}

export interface CreateEmergencyRequestPayload {
  blood_group: BloodGroup;
  quantity: number;
  resource_type: ResourceType;
  urgency: UrgencyLevel;
  hospital_latitude: number;
  hospital_longitude: number;
}

export interface InventoryAllocationItem {
  id: string;
  inventoryId: string;
  unitsAllocated: number;
  status: string;
  expiryDate?: string;
  reservedAt?: string;
}

export interface InventoryResolutionResult {
  requestedUnits: number;
  allocatedUnits: number;
  remainingUnits: number;
  fullyReserved: boolean;
  allocations: InventoryAllocationItem[];
}

export interface PeerBankOffer {
  id: string;
  bloodBankId: string;
  bloodBankName: string;
  availableUnits: number;
  offeredUnits: number;
  distanceKm: number;
  reason?: string;
}

export interface PeerBanksResolutionResult {
  requestedUnits: number;
  remainingUnits: number;
  fullySourced: boolean;
  offers: PeerBankOffer[];
}
