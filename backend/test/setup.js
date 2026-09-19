// Shared test environment setup helper
// Preloaded via `node --import ./test/setup.js --test`

process.env.NODE_ENV ??= 'test';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY ??= 'test-secret-key';
