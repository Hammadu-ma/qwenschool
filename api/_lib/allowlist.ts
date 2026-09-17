/**
 * The allowlist.
 *
 * This is the single most important file in the backend. The browser can no
 * longer reach PostgREST, so the ONLY database operations that exist as far
 * as the internet is concerned are the ones named below. A function that
 * isn't here cannot be called, whatever the client sends.
 *
 * Two things this buys beyond RLS:
 *
 *   - No table surface. Previously the anon key gave the browser the full
 *     PostgREST API: every table, every column, every filter operator, bounded
 *     only by policy correctness. One policy with a gap was one exposed table.
 *     Now there is no `from('students').select('*')` to get wrong.
 *
 *   - Enforced bounds. `p_limit` is clamped here as well as in SQL, so a
 *     client asking for a million rows gets 200 regardless of what the
 *     function would have allowed.
 *
 * Every entry declares its arguments. Anything not declared is DROPPED before
 * the call — not rejected, dropped — so an extra field in a request body can
 * never become an extra argument to a SQL function.
 */

type ArgType = "string" | "number" | "boolean" | "date" | "timestamp" | "string[]" | "json";

interface ArgSpec {
  type: ArgType;
  optional?: boolean;
  /** Clamp for numeric arguments — the server's own ceiling. */
  max?: number;
  min?: number;
  /** Cap on string length, so a search term can't be used to burn CPU. */
  maxLength?: number;
  /** For `json`: maximum number of keys, so a payload can't be unbounded. */
  maxKeys?: number;
}

interface RpcSpec {
  args: Record<string, ArgSpec>;
  /** GET-safe reads are cheap to retry and can be prefetched. */
  read: boolean;
  /** Per-minute ceiling per user for this specific function. */
  rateLimit?: number;
}

const ID: ArgSpec = { type: "string", optional: true, maxLength: 128 };
const SEARCH: ArgSpec = { type: "string", optional: true, maxLength: 100 };
const LIMIT: ArgSpec = { type: "number", optional: true, min: 1, max: 200 };
const OFFSET: ArgSpec = { type: "number", optional: true, min: 0, max: 100_000 };

export const RPC_ALLOWLIST: Record<string, RpcSpec> = {
  /* ---------- session & reference ---------- */
  get_bootstrap: { read: true, args: { p_year_id: ID } },
  get_reference: { read: true, args: { p_year_id: ID } },
  my_scope: { read: true, args: { p_year_id: ID } },

  /* ---------- students ---------- */
  list_students: {
    read: true,
    args: {
      p_year_id: ID,
      p_class_id: ID,
      p_section_id: ID,
      p_status: { type: "string", optional: true, maxLength: 20 },
      p_search: SEARCH,
      p_sort: { type: "string", optional: true, maxLength: 10 },
      p_limit: LIMIT,
      p_offset: OFFSET,
    },
  },
  get_student_detail: {
    read: true,
    args: { p_student_id: { type: "string", maxLength: 128 }, p_year_id: ID },
  },

  /* ---------- academics ---------- */
  get_marksheet: { read: true, args: { p_structure_id: { type: "string", maxLength: 128 } } },
  get_register: {
    read: true,
    args: { p_year_id: ID, p_class_id: ID, p_section_id: ID, p_day: { type: "date" } },
  },
  get_attendance_summary: {
    read: true,
    args: {
      p_year_id: ID,
      p_class_id: ID,
      p_section_id: ID,
      p_from: { type: "date", optional: true },
      p_to: { type: "date", optional: true },
    },
  },

  /* ---------- fees ---------- */
  list_fees: {
    read: true,
    args: {
      p_year_id: ID,
      p_class_id: ID,
      p_section_id: ID,
      p_only_outstanding: { type: "boolean", optional: true },
      p_search: SEARCH,
      p_limit: LIMIT,
      p_offset: OFFSET,
    },
  },

  /* ---------- communication ---------- */
  list_conversations: { read: true, args: { p_year_id: ID, p_limit: LIMIT, p_offset: OFFSET } },
  list_messages: {
    read: true,
    args: {
      p_conversation_id: { type: "string", maxLength: 128 },
      p_before: { type: "timestamp", optional: true },
      p_limit: LIMIT,
    },
  },
  list_notifications: {
    read: true,
    args: {
      p_before: { type: "timestamp", optional: true },
      p_limit: LIMIT,
      p_unread_only: { type: "boolean", optional: true },
    },
  },
  list_audit: {
    read: true,
    args: { p_year_id: ID, p_before: { type: "timestamp", optional: true }, p_limit: LIMIT },
  },

  /* ---------- writes ---------- */
  save_student_marks: {
    read: false,
    rateLimit: 240, // mark entry is bursty by nature — a teacher tabs through a class
    args: {
      p_structure_id: { type: "string", maxLength: 128 },
      p_student_id: { type: "string", maxLength: 128 },
      p_values: { type: "json", maxKeys: 100 },
    },
  },
  save_register: {
    read: false,
    rateLimit: 60,
    args: {
      p_year_id: { type: "string", maxLength: 128 },
      p_class_id: { type: "string", maxLength: 128 },
      p_section_id: { type: "string", maxLength: 128 },
      p_day: { type: "date" },
      p_marks: { type: "json", maxKeys: 500 }, // a section's register
    },
  },
  send_message: {
    read: false,
    rateLimit: 60,
    args: {
      p_conversation_id: { type: "string", maxLength: 128 },
      p_body: { type: "string", maxLength: 4000 },
    },
  },
  mark_notifications_read: {
    read: false,
    args: { p_ids: { type: "string[]", optional: true } },
  },
  record_fee_payment: {
    read: false,
    rateLimit: 60,
    args: {
      p_fee_item_id: { type: "string", maxLength: 128 },
      p_amount: { type: "number", min: 0, max: 100_000_000 },
      p_note: { type: "string", optional: true, maxLength: 500 },
    },
  },
  set_submission_status: {
    read: false,
    args: {
      p_structure_id: { type: "string", maxLength: 128 },
      p_status: { type: "string", maxLength: 20 },
      p_reason: { type: "string", optional: true, maxLength: 500 },
    },
  },

  save_student: {
    read: false,
    rateLimit: 120,
    args: { p_payload: { type: "json", maxKeys: 40 }, p_year_id: ID },
  },
  set_student_status: {
    read: false,
    args: {
      p_student_id: { type: "string", maxLength: 128 },
      p_status: { type: "string", maxLength: 20 },
    },
  },

  register_file: {
    read: false,
    rateLimit: 60,
    args: {
      p_owner_type: { type: "string", maxLength: 40 },
      p_owner_id: { type: "string", maxLength: 128 },
      p_storage_key: { type: "string", maxLength: 400 },
      p_original_name: { type: "string", optional: true, maxLength: 200 },
      p_mime_type: { type: "string", optional: true, maxLength: 120 },
      p_size_bytes: { type: "number", optional: true, min: 0, max: 100_000_000 },
      p_kind: { type: "string", optional: true, maxLength: 60 },
    },
  },
  unregister_file: {
    read: false,
    args: { p_storage_key: { type: "string", maxLength: 400 } },
  },

  save_role: { read: false, rateLimit: 30, args: { p_payload: { type: "json", maxKeys: 20 } } },
  update_user_account: {
    read: false,
    rateLimit: 60,
    args: { p_payload: { type: "json", maxKeys: 20 } },
  },

  /* ----------------------------------------------------------------------
     DEPRECATED compatibility entry. `get_app_snapshot` returns the entire
     database in one response — the thing 0023 exists to replace. It stays
     published only so pages that haven't been migrated to the paged hooks
     keep working (see the legacy read path in src/lib/backend.ts). Its rate
     limit is deliberately low: it should be called once per session at
     most, never in a loop. Delete this entry once no page needs it.
     ---------------------------------------------------------------------- */
  get_app_snapshot: { read: true, rateLimit: 10, args: {} },

  /* ---------- year lifecycle (admin) ---------- */
  create_academic_year: {
    read: false,
    rateLimit: 10,
    args: {
      p_id: { type: "string", maxLength: 64 },
      p_name: { type: "string", maxLength: 120 },
      p_start: { type: "date" },
      p_end: { type: "date" },
      p_terms: { type: "string[]", optional: true },
    },
  },
  set_active_year: { read: false, rateLimit: 10, args: { p_year_id: { type: "string", maxLength: 64 } } },
  close_year: { read: false, rateLimit: 10, args: { p_year_id: { type: "string", maxLength: 64 } } },
  rollover_year: {
    read: false,
    rateLimit: 5,
    args: {
      p_from_year: { type: "string", maxLength: 64 },
      p_to_year: { type: "string", maxLength: 64 },
      p_copy_assignments: { type: "boolean", optional: true },
      p_copy_timetable: { type: "boolean", optional: true },
      p_copy_structures: { type: "boolean", optional: true },
      p_copy_fees: { type: "boolean", optional: true },
    },
  },
  promote_students: {
    read: false,
    rateLimit: 5,
    args: {
      p_from_year: { type: "string", maxLength: 64 },
      p_to_year: { type: "string", maxLength: 64 },
      p_class_id: ID,
      p_graduate_top: { type: "boolean", optional: true },
    },
  },
  apply_fee_template: { read: false, rateLimit: 20, args: { p_template_id: { type: "string", maxLength: 128 } } },

  /* ---------- user administration ---------- */
  create_user_account: {
    read: false,
    rateLimit: 30,
    args: {
      p_username: { type: "string", maxLength: 64 },
      p_password: { type: "string", maxLength: 200 },
      p_full_name: { type: "string", maxLength: 200 },
      p_role: { type: "string", maxLength: 20 },
      p_role_def_id: { type: "string", maxLength: 64 },
      p_teacher_id: ID,
      p_student_id: ID,
      p_email: { type: "string", optional: true, maxLength: 200 },
      p_phone: { type: "string", optional: true, maxLength: 40 },
    },
  },
  delete_user_account: { read: false, rateLimit: 20, args: { p_id: { type: "string", maxLength: 64 } } },
};

export interface ValidationResult {
  ok: boolean;
  args?: Record<string, unknown>;
  error?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates and NORMALISES a request body against a function's declared args.
 *
 * Unknown keys are dropped silently rather than rejected. That's deliberate:
 * rejecting turns "the client sent a stray field" into a hard failure during
 * a deploy where old and new clients overlap, while dropping keeps the
 * guarantee that matters — an undeclared key never reaches the database.
 */
export function validateArgs(fn: string, body: Record<string, unknown>): ValidationResult {
  const spec = RPC_ALLOWLIST[fn];
  if (!spec) return { ok: false, error: "Unknown operation." };

  const out: Record<string, unknown> = {};

  for (const [name, rule] of Object.entries(spec.args)) {
    const raw = body[name];

    if (raw === undefined || raw === null) {
      if (!rule.optional && rule.type !== "string[]") {
        // Required args may still be explicitly null where SQL defaults
        // handle it, but a missing *mandatory* id is a client bug worth
        // surfacing rather than turning into a confusing SQL error.
        if (!("optional" in rule)) return { ok: false, error: `Missing required field: ${name}` };
      }
      out[name] = null;
      continue;
    }

    switch (rule.type) {
      case "string": {
        if (typeof raw !== "string") return { ok: false, error: `${name} must be text.` };
        if (rule.maxLength && raw.length > rule.maxLength) {
          return { ok: false, error: `${name} is too long.` };
        }
        out[name] = raw;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a number.` };
        // Clamp rather than reject: the ceiling is ours to enforce, and a
        // client asking for 10,000 rows should get 200, not an error.
        const clamped = Math.min(Math.max(n, rule.min ?? -Infinity), rule.max ?? Infinity);
        out[name] = clamped;
        break;
      }
      case "boolean": {
        out[name] = raw === true || raw === "true";
        break;
      }
      case "date": {
        if (typeof raw !== "string" || !DATE_RE.test(raw)) {
          return { ok: false, error: `${name} must be a YYYY-MM-DD date.` };
        }
        out[name] = raw;
        break;
      }
      case "timestamp": {
        if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) {
          return { ok: false, error: `${name} must be a timestamp.` };
        }
        out[name] = raw;
        break;
      }
      case "json": {
        // Passed through to a jsonb parameter. Objects only — an array or a
        // bare scalar where SQL expects an object produces a confusing error
        // deep in plpgsql, so it's rejected here where the message is useful.
        if (typeof raw !== "object" || Array.isArray(raw)) {
          return { ok: false, error: `${name} must be an object.` };
        }
        const keys = Object.keys(raw as Record<string, unknown>);
        if (keys.length > (rule.maxKeys ?? 200)) {
          return { ok: false, error: `${name} has too many entries.` };
        }
        out[name] = raw;
        break;
      }
      case "string[]": {
        if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
          return { ok: false, error: `${name} must be a list of text values.` };
        }
        if (raw.length > 500) return { ok: false, error: `${name} has too many entries.` };
        out[name] = raw;
        break;
      }
    }
  }

  return { ok: true, args: out };
}

export const isReadOnly = (fn: string) => RPC_ALLOWLIST[fn]?.read === true;
export const rateLimitFor = (fn: string) => RPC_ALLOWLIST[fn]?.rateLimit ?? (isReadOnly(fn) ? 600 : 120);
