export class SupabaseConfigurationError extends Error {
  constructor(code, message) { super(message); this.name = 'SupabaseConfigurationError'; this.code = code; }
}

// Never print a raw driver error or URL parser input: either can contain secrets.
export function describeSupabaseError(error) {
  if (error instanceof SupabaseConfigurationError) return error.message;
  if (['28P01', '28000'].includes(error?.code)) return 'Supabase rejected the database login. Use your Supabase database password, which is different from the draw admin password. Run npm run connect:supabase to try again.';
  if (['42P01', '3F000'].includes(error?.code)) return 'Supabase was reached, but the draw tables are missing. Run npm run setup:supabase once, then npm start.';
  if (error?.code === '42501') return 'The database account cannot create or access the draw tables. Use the database connection URI from your Supabase project’s Connect panel.';
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(error?.code)) return 'The database host could not be resolved. Copy the complete Session pooler URI from Supabase → Connect; do not guess the pooler host.';
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(error?.code)) return 'The database could not be reached. Use Supabase → Connect → Session pooler and check that the project is running and the network permits the connection.';
  if (['SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED'].includes(error?.code)) return 'The database TLS certificate could not be verified. Download the root certificate from Supabase Database settings and set SUPABASE_SSL_CA to its local file path.';
  return 'The Supabase connection could not be completed. Run npm run connect:supabase to check the connection details.';
}
