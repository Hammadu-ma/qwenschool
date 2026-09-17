import { apiSession, type ServerProfile } from "./http";

/**
 * Instant session restore, without holding a credential.
 *
 * WHAT THIS USED TO DO, AND WHY IT CHANGED
 * The first version of this file decoded the Supabase JWT out of localStorage
 * to decide, synchronously, whether to paint the app shell or the login page.
 * It worked, but it depended on a token being readable by JavaScript — which
 * is exactly the property the move to a server backend removed.
 *
 * So there is no token to read now. What the server sets instead is a small,
 * deliberately non-secret "hint" cookie: the role, the display name, and when
 * the session expires. Nothing in it authenticates anything. Forging it buys
 * you a wrongly-painted shell for one frame and then an empty screen, because
 * every actual request is authorised by the httpOnly cookie you cannot forge.
 *
 * That is the trade worth understanding: the hint is for rendering, never for
 * access. Anything that decides what a person may *do* must come from
 * `confirmSession()` or from the server's response to a real request.
 */

export interface SessionHint {
  role: "admin" | "teacher" | "student" | "guardian";
  name: string;
  /** Seconds since epoch. */
  exp: number;
}

const HINT_COOKIE = "sms_hint";

/**
 * Reads the hint synchronously — no network, no await — so the first render
 * can already show the right shell instead of a spinner. Returns null when
 * there is no hint or it has expired.
 */
export function peekSession(): SessionHint | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${HINT_COOKIE}=([^;]*)`));
    if (!match) return null;

    const parsed = JSON.parse(decodeURIComponent(match[1])) as Partial<SessionHint>;
    if (!parsed?.role || !parsed?.exp) return null;

    // 30 seconds of slack, so we don't paint a shell whose first request is
    // about to come back 401 anyway.
    if (parsed.exp * 1000 <= Date.now() + 30_000) return null;

    return {
      role: parsed.role,
      name: String(parsed.name ?? ""),
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** True when the hint says someone is signed in. Rendering only. */
export const looksSignedIn = () => peekSession() !== null;

/**
 * The authoritative answer, from the server. Use this for anything that
 * gates an action rather than a pixel.
 */
export async function confirmSession(): Promise<ServerProfile | null> {
  return apiSession();
}

/**
 * Warms the session before the app needs it. Calling this at module load in
 * main.tsx overlaps the round trip with downloading the page chunks, so by
 * the time the router mounts the answer is usually already back.
 */
export function prewarmSession(): void {
  if (!looksSignedIn()) return;
  void apiSession().catch(() => {
    /* best effort — the real call surfaces any error */
  });
}
