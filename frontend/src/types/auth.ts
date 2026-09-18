export type UserRole =
  | 'HOSPITAL_COORDINATOR'
  | 'BLOOD_BANK_OFFICER'
  | 'DONOR'
  | 'REGULATOR'
  | 'SUPER_ADMIN';

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  is_synthetic?: boolean;
  created_at?: string;
}

export interface OrganizationMembership {
  hospitalId: string | null;
  bloodBankId: string | null;
  membershipRole: string | null;
  hospital: {
    id: string;
    name: string;
    code?: string;
    latitude?: number;
    longitude?: number;
  } | null;
  bloodBank: {
    id: string;
    name: string;
    licenseNumber?: string;
    latitude?: number;
    longitude?: number;
  } | null;
}

export interface AuthUserResponse {
  user: UserProfile;
  organization: OrganizationMembership;
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
