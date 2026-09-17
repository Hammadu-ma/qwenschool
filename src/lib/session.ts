import { supabase } from "./supabase";

/**
 * Instant session restore.
 *
 * THE PROBLEM
 * App.tsx blocks the entire router on `sessionChecked`, and that flag only
 * flips once `supabase.auth.getSession()` resolves. On a cold load that is a
 * network round trip before a single pixel of the app renders — so every
 * reload shows the spinner in <CheckingSession/>, even for someone who was
 * signed in two seconds ago.
 *
 * THE FIX
 * Supabase already persisted the session in localStorage. A JWT is three
 * base64url segments; the middle one is plain JSON containing the subject and
 * the expiry. Reading and decoding it is synchronous and takes microseconds,
 * so the app can decide "there is a live session, render the shell" during the
 * very first render, and let the real getSession()/token refresh confirm it a
 * moment later.
 *
 * WHY THIS IS NOT A SECURITY SHORTCUT
 * Nothing here grants access to anything. The decoded claims are used only to
 * decide what to *paint* while the real check is in flight. Every byte of data
 * still arrives through PostgREST with the actual access token attached, and
 * Row Level Security in PostgreSQL decides what comes back. A tampered token
 * in localStorage would let someone paint an empty admin shell for one frame
 * and then receive nothing from the server — the signature is verified there,
 * not here.
 */

export interface OptimisticSession {
  userId: string;
  email: string | null;
  /** Seconds since epoch. */
  expiresAt: number;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  // decodeURIComponent/escape round-trip keeps non-ASCII names intact.
  return decodeURIComponent(
    atob(padded + pad)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
}

/** Supabase namespaces its storage key by project ref: sb-<ref>-auth-token. */
function findAuthTokenKey(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) return k;
    }
  } catch {
    /* private browsing / storage disabled — fall back to the async path */
  }
  return null;
}

/**
 * Reads the persisted session without touching the network. Returns null when
 * there is none, when it is unreadable, or when it has already expired — in
 * all three cases the caller should show the login screen and let the async
 * check correct it if needed.
 */
export function peekSession(): OptimisticSession | null {
  const key = findAuthTokenKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    // Supabase has used a few shapes for this value across versions.
    const parsed = JSON.parse(raw);
    const token: string | undefined =
      parsed?.access_token ?? parsed?.currentSession?.access_token ?? parsed?.[0];
    if (typeof token !== "string") return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const claims = JSON.parse(base64UrlDecode(parts[1])) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (!claims.sub || !claims.exp) return null;

    // 30s of slack: a token about to expire is treated as expired so we don't
    // paint a shell that is about to 401 on its first request.
    if (claims.exp * 1000 <= Date.now() + 30_000) return null;

    return { userId: claims.sub, email: claims.email ?? null, expiresAt: claims.exp };
  } catch {
    return null;
  }
}

/** True when a usable token is sitting in storage right now. */
export const hasLiveSession = () => peekSession() !== null;

/**
 * The authoritative check, for when correctness matters more than the first
 * frame — e.g. immediately after peekSession() said yes, or before a
 * privileged action.
 */
export async function confirmSession(): Promise<OptimisticSession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  const s = data.session;
  return {
    userId: s.user.id,
    email: s.user.email ?? null,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

/**
 * Warms the auth token before the app needs it. Calling this at module load
 * in main.tsx means the refresh (when one is due) overlaps with downloading
 * the page chunks instead of happening after them.
 */
export function prewarmSession(): void {
  if (!supabase) return;
  void supabase.auth.getSession().catch(() => {
    /* best effort — the real call will surface any error */
  });
}
