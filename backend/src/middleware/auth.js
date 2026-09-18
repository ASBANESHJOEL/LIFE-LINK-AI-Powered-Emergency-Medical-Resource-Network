import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { isDevAuthEnabled, validateMockToken } from '../services/devAuthService.js';

/**
 * Validates the Supabase access token and resolves the trusted
 * application user and organization membership from the database.
 * Never trusts client-supplied identity or roles.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header. Expected Bearer <token>'
      });
    }

    const token = authHeader.split(' ')[1]?.trim();
    if (!token) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Bearer token is missing'
      });
    }

    // Development Mock Auth token validation (strictly disabled in production)
    if (isDevAuthEnabled()) {
      const mockUser = validateMockToken(token);
      if (mockUser) {
        req.user = mockUser;
        req.organization = null;
        return next();
      }
    }

    // 1. Verify token with Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: authError?.message || 'Invalid or expired session token'
      });
    }

    const authUser = authData.user;

    // 2. Resolve application user from public.users
    // public.users.id must match auth.users.id by design
    const { data: dbUser, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, role, is_active, is_synthetic, created_at, last_login_at')
      .eq('id', authUser.id)
      .maybeSingle();

    if (dbError) {
      console.error('Error resolving public.users:', dbError);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Failed to resolve user record'
      });
    }

    // 3. Unprovisioned Account Handling
    if (!dbUser) {
      return res.status(403).json({
        error: 'ACCOUNT_NOT_PROVISIONED',
        message: 'Your account is authenticated with Supabase Auth, but has not been provisioned in LIFE-LINK. Access denied.',
        userId: authUser.id
      });
    }

    // 4. Inactive User Check
    if (dbUser.is_active === false) {
      return res.status(403).json({
        error: 'ACCOUNT_INACTIVE',
        message: 'Your LIFE-LINK account has been deactivated. Access denied.'
      });
    }

    // 5. Attach trusted identity to request (never trusting client headers/body)
    req.user = {
      id: dbUser.id,
      email: dbUser.email || authUser.email,
      phone: dbUser.phone,
      role: dbUser.role,
      is_active: dbUser.is_active,
      is_synthetic: dbUser.is_synthetic
    };

    // 6. Organization Membership Resolution (for HOSPITAL and BLOOD_BANK)
    req.organization = null;
    if (dbUser.role === 'HOSPITAL' || dbUser.role === 'BLOOD_BANK') {
      const { data: orgMember, error: orgError } = await supabaseAdmin
        .from('organization_members')
        .select(`
          id,
          organization_type,
          hospital_id,
          blood_bank_id,
          membership_role,
          is_active,
          hospitals (id, hospital_name, registration_id),
          blood_banks (id, name, registration_id)
        `)
        .eq('user_id', dbUser.id)
        .eq('is_active', true)
        .maybeSingle();

      if (orgError) {
        console.error('Error resolving organization_members:', orgError);
      } else if (orgMember) {
        req.organization = {
          membershipId: orgMember.id,
          organizationType: orgMember.organization_type,
          hospitalId: orgMember.hospital_id,
          bloodBankId: orgMember.blood_bank_id,
          membershipRole: orgMember.membership_role,
          hospital: orgMember.hospitals,
          bloodBank: orgMember.blood_banks
        };
      }
    }

    next();
  } catch (err) {
    console.error('Unexpected auth middleware error:', err);
    return res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected authentication error occurred'
    });
  }
}

/**
 * Reusable role-authorization middleware.
 * Validates that req.user.role exists in the permitted roles.
 */
export function requireRole(...permittedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required'
      });
    }

    if (!permittedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role '${req.user.role}' is not authorized to access this resource. Required: [${permittedRoles.join(', ')}]`
      });
    }

    next();
  };
}
