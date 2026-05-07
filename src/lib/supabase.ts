import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client using the service role key.
// Bypasses RLS — only ever import from server-only code (route handlers,
// server actions, server components). Never expose to the browser.
//
// We cache one instance per process to avoid spinning up a new fetch agent
// per request. Next will hot-reload modules in dev, which resets this.
let serverClient: SupabaseClient | null = null;

export function getSupabaseServerClient(): SupabaseClient {
  if (serverClient) return serverClient;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      "Supabase server env missing: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }

  serverClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serverClient;
}
