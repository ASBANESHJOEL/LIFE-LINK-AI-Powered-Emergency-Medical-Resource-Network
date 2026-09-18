export type UserRole =
  | 'HOSPITAL'
  | 'BLOOD_BANK'
  | 'DONOR'
  | 'REGULATOR'
  | 'ADMIN';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  is_synthetic?: boolean;
  created_at?: string;
}

export interface OrganizationMembership {
  membershipId?: string | null;
  organizationType?: string | null;
  hospitalId: string | null;
  bloodBankId: string | null;
  membershipRole: string | null;
  hospital: {
    id: string;
    hospital_name?: string;
    name?: string;
    registration_id?: string;
    code?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  bloodBank: {
    id: string;
    name: string;
    registration_id?: string;
    licenseNumber?: string;
    latitude?: number;
    longitude?: number;
  } | null;
}

export interface AuthUserResponse {
  user: UserProfile;
  organization: OrganizationMembership | null;
}

export interface AuthContextType {
  user: UserProfile | null;
  organization: OrganizationMembership | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithOtp: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyOtp: (email: string, token: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}
