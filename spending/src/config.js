// Supabase connection for the spending tracker — same project as the
// inventory app (they share the database), just a separate frontend.
// These are publishable values — safe to ship in the client. Row Level
// Security on the database is what limits what this key can do (read
// categories + past entries, insert new entries; never edit or delete —
// only the verified flag can flip, and only through an RPC).
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://aheiyytqvzxkoowykkgt.supabase.co'
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_gWE8hOq2mvCLmoq6wYJxJg_U42BMp18'
