import m1 from "../../supabase/migrations/0001_schema.sql?raw";
import m2 from "../../supabase/migrations/0002_rls_functions.sql?raw";
import m3 from "../../supabase/migrations/0003_seed_core.sql?raw";
import m4 from "../../supabase/migrations/0004_seed_academics.sql?raw";

/**
 * The migration bundle ships inside the app as plain text. SQL DDL is not a
 * secret — authorization lives in the RLS policies it creates. Privileged
 * keys are NEVER part of this bundle; they are typed into the setup console
 * at runtime and held in memory only.
 */
export const PROJECT_REF = "nrahbfmajwdgphmdllgm";

export interface MigrationFile {
  file: string;
  title: string;
  sql: string;
}

export const MIGRATIONS: MigrationFile[] = [
  { file: "0001_schema.sql", title: "Relational schema — 30 tables, FKs, indexes", sql: m1 },
  { file: "0002_rls_functions.sql", title: "RLS policies, authz functions, workflow triggers", sql: m2 },
  { file: "0003_seed_core.sql", title: "School structure, people, roles + demo logins", sql: m3 },
  { file: "0004_seed_academics.sql", title: "Assessments, marks, attendance, communication", sql: m4 },
];

export const sqlEditorUrl = `https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new`;
