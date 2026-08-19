// Supabase connection for the dorm inventory.
// These are publishable values — safe to ship in the client. Row Level
// Security on the database is what limits what this key can do
// (read the catalog + past checks, submit new checks; never edit/delete).
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://aheiyytqvzxkoowykkgt.supabase.co'
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_gWE8hOq2mvCLmoq6wYJxJg_U42BMp18'
