import { BloodGroup, ResourceType } from './requests';

export interface BloodInventoryItem {
  id: string;
  blood_bank_id: string;
  blood_group: BloodGroup;
  component_type: ResourceType;
  available_units: number;
  reserved_units: number;
  expiry_date: string;
  created_at?: string;
  updated_at?: string;
  blood_banks?: {
    id: string;
    name: string;
  };
}

export interface InventoryStats {
  totalAvailable: number;
  totalReserved: number;
  expiringSoonUnits: number;
  byBloodGroup: Record<BloodGroup, number>;
}
