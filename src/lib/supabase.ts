import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client — the ONLY credentials the frontend ever holds are the
 * project URL and the publishable anon key, exactly as Supabase intends.
 * All real authorization is enforced by Row Level Security in PostgreSQL.
 *
 * Configure via environment variables (see .env.example):
 *   VITE_SUPABASE_URL=https://nrahbfmajwdgphmdllgm.supabase.co
 *   VITE_SUPABASE_ANON_KEY=…publishable key…
 *
 * When they are absent the app boots in a clearly-labelled offline demo mode
 * (local seed) so the UI stays usable; no request is ever faked.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured: boolean = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

export const supabaseProjectUrl = url ?? null;

/** Username-based login maps to a namespaced email (see supabase/README.md). */
export const usernameToEmail = (username: string) =>
  username.includes("@") ? username.trim().toLowerCase() : `${username.trim().toLowerCase()}@riverside.school`;
