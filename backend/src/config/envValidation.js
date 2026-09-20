/**
 * Production environment and configuration validation.
 * Performs safe checks on startup without crashing local development or testing environments.
 */
export function validateEnvironment() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // Required database configuration
  if (!process.env.SUPABASE_URL) {
    errors.push('SUPABASE_URL is missing.');
  } else {
    try {
      new URL(process.env.SUPABASE_URL);
    } catch {
      errors.push('SUPABASE_URL must be a valid URL.');
    }
  }

  if (!process.env.SUPABASE_SECRET_KEY) {
    errors.push('SUPABASE_SECRET_KEY is missing.');
  }

  // Recommended production configuration
  if (isProd) {
    if (!process.env.FRONTEND_URL) {
      warnings.push('FRONTEND_URL is not configured; using default allowed production origins.');
    }
    if (!process.env.ML_API_URL) {
      warnings.push('ML_API_URL is not set; donor ranking will use deterministic fallback.');
    }
    if (process.env.LIFELINK_DEV_AUTH_ENABLED === 'true') {
      errors.push('LIFELINK_DEV_AUTH_ENABLED must NOT be true in production.');
    }
  }

  if (errors.length > 0) {
    if (isProd) {
      console.error('[CRITICAL] Production environment configuration errors:');
      for (const err of errors) console.error(`  - ${err}`);
      throw new Error(`Production startup aborted due to configuration errors: ${errors.join('; ')}`);
    } else {
      console.warn('[CONFIG WARNING] Missing configuration in non-production:');
      for (const err of errors) console.warn(`  - ${err}`);
    }
  }

  if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    for (const w of warnings) console.warn(`[CONFIG WARNING] ${w}`);
  }

  return { isValid: errors.length === 0, errors, warnings };
}
