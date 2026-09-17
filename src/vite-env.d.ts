/// <reference types="vite/client" />

/**
 * Deliberately empty of Supabase variables.
 *
 * Anything declared here and referenced as `import.meta.env.VITE_*` is
 * inlined into the client bundle by Vite at build time. Credentials must
 * never be declared in this file — they belong in the serverless functions'
 * environment (see .env.example and api/_lib/env.ts), which the browser
 * cannot read.
 */
interface ImportMetaEnv {
  /** Optional: overrides the API base path. Not a secret. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
