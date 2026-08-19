/**
 * Types for tables defined in supabase/migrations/20260818120000_dashboard_schema.sql
 * that have not been pushed yet.
 *
 * `database.types.ts` is generated from the live database, so it can't know
 * about them. Rather than hand-editing a generated file, declare them here and
 * merge. Once the migration is applied and types are regenerated, DELETE THIS
 * FILE and switch the clients back to `Database`.
 *
 * These mirror the DDL by hand, so if you change the migration, change this too.
 */
import type { Database as Generated } from "./database.types";

type Timestamp = string;
type DateOnly = string;

export type CrlStatus = "open" | "pending" | "answered" | "closed";
export type CrlRequestedFrom = "clinic" | "patient";
export type WorkStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";
export type RoutingDestination = "cam" | "collector";
export type AgingBucket = "current" | "30" | "60" | "90" | "120_plus";

/**
 * supabase-js resolves embedded selects (`clinics ( name )`) from this
 * metadata, so a table with no relationships can't be joined in a typed query.
 * Names must match the constraint names Postgres generates, because that's how
 * an ambiguous embed is disambiguated: `profiles!tasks_assigned_to_fkey`.
 */
type Rel<Name extends string, Column extends string, Ref extends string> = {
  foreignKeyName: Name;
  columns: [Column];
  isOneToOne: false;
  referencedRelation: Ref;
  referencedColumns: ["id"];
};

type Table<
  Row,
  Required extends keyof Row = never,
  Relationships extends readonly unknown[] = [],
> = {
  Row: Row;
  Insert: Partial<Row> & Pick<Row, Required>;
  Update: Partial<Row>;
  Relationships: Relationships;
};

export type PendingTables = {
  collectors: Table<
    {
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      is_active: boolean;
    },
    "name"
  >;

  accounts: Table<
    {
      id: number;
      clinic_id: number;
      account_number: string;
      patient_name: string | null;
      as_of_month: DateOnly;
      balance: number;
      aging_bucket: AgingBucket;
      financial_class_id: number | null;
      carrier_id: number | null;
      provider_id: number | null;
      last_activity_date: DateOnly | null;
      source_batch_id: number | null;
      updated_at: Timestamp;
    },
    "clinic_id" | "account_number" | "as_of_month" | "aging_bucket",
    [
      Rel<"accounts_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"accounts_carrier_id_fkey", "carrier_id", "carriers">,
      Rel<"accounts_provider_id_fkey", "provider_id", "providers">,
      Rel<"accounts_financial_class_id_fkey", "financial_class_id", "financial_classes">,
    ]
  >;

  account_routing: Table<
    {
      id: number;
      account_id: number;
      clinic_id: number;
      destination: RoutingDestination;
      collector_id: number | null;
      amount: number;
      sent_at: Timestamp;
      sent_by: string | null;
      returned_at: Timestamp | null;
      note: string | null;
    },
    "account_id" | "clinic_id" | "destination",
    [
      Rel<"account_routing_account_id_fkey", "account_id", "accounts">,
      Rel<"account_routing_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"account_routing_collector_id_fkey", "collector_id", "collectors">,
    ]
  >;

  crl_entries: Table<
    {
      id: number;
      clinic_id: number;
      account_id: number | null;
      requested_from: CrlRequestedFrom;
      request_type: string | null;
      detail: string;
      status: CrlStatus;
      opened_at: Timestamp;
      opened_by: string | null;
      responded_at: Timestamp | null;
      closed_at: Timestamp | null;
      updated_at: Timestamp;
    },
    "clinic_id" | "requested_from" | "detail",
    [
      Rel<"crl_entries_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"crl_entries_account_id_fkey", "account_id", "accounts">,
      Rel<"crl_entries_opened_by_fkey", "opened_by", "profiles">,
    ]
  >;

  files: Table<
    {
      id: number;
      clinic_id: number | null;
      storage_path: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      uploaded_by: string | null;
      uploaded_at: Timestamp;
    },
    "storage_path" | "file_name",
    [
      Rel<"files_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"files_uploaded_by_fkey", "uploaded_by", "profiles">,
    ]
  >;

  tasks: Table<
    {
      id: number;
      clinic_id: number | null;
      title: string;
      detail: string | null;
      assigned_to: string;
      assigned_by: string;
      status: WorkStatus;
      due_date: DateOnly | null;
      created_at: Timestamp;
      completed_at: Timestamp | null;
      updated_at: Timestamp;
    },
    "title" | "assigned_to" | "assigned_by",
    [
      Rel<"tasks_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"tasks_assigned_to_fkey", "assigned_to", "profiles">,
      Rel<"tasks_assigned_by_fkey", "assigned_by", "profiles">,
    ]
  >;

  projects: Table<
    {
      id: number;
      clinic_id: number | null;
      name: string;
      detail: string | null;
      amount: number | null;
      claim_count: number | null;
      tat_days: number | null;
      assigned_to: string;
      assigned_by: string;
      status: WorkStatus;
      progress_pct: number;
      started_on: DateOnly | null;
      due_on: DateOnly | null;
      completed_at: Timestamp | null;
      created_at: Timestamp;
      updated_at: Timestamp;
    },
    "name" | "assigned_to" | "assigned_by",
    [
      Rel<"projects_clinic_id_fkey", "clinic_id", "clinics">,
      Rel<"projects_assigned_to_fkey", "assigned_to", "profiles">,
      Rel<"projects_assigned_by_fkey", "assigned_by", "profiles">,
    ]
  >;

  project_assignments: Table<
    {
      id: number;
      project_id: number;
      assigned_to: string;
      assigned_by: string;
      assigned_at: Timestamp;
      comment: string | null;
    },
    "project_id" | "assigned_to" | "assigned_by",
    [
      Rel<"project_assignments_project_id_fkey", "project_id", "projects">,
      Rel<"project_assignments_assigned_to_fkey", "assigned_to", "profiles">,
      Rel<"project_assignments_assigned_by_fkey", "assigned_by", "profiles">,
    ]
  >;

  project_updates: Table<
    {
      id: number;
      project_id: number;
      author_id: string;
      progress_pct: number | null;
      comment: string;
      created_at: Timestamp;
    },
    "project_id" | "author_id" | "comment",
    [
      Rel<"project_updates_project_id_fkey", "project_id", "projects">,
      Rel<"project_updates_author_id_fkey", "author_id", "profiles">,
    ]
  >;

  task_accounts: Table<{ task_id: number; account_id: number }, "task_id" | "account_id">;
  task_files: Table<{ task_id: number; file_id: number }, "task_id" | "file_id">;
  project_accounts: Table<
    { project_id: number; account_id: number },
    "project_id" | "account_id"
  >;
  project_files: Table<{ project_id: number; file_id: number }, "project_id" | "file_id">;
};

/** Views the same migration creates. Read-only, so no Insert/Update. */
export type PendingViews = {
  account_summary_monthly: {
    Row: {
      clinic_id: number | null;
      as_of_month: DateOnly | null;
      account_count: number | null;
      total_balance: number | null;
      accounts_120_plus: number | null;
      amount_120_plus: number | null;
      accounts_sent_to_cam: number | null;
      amount_sent_to_cam: number | null;
      accounts_sent_to_collector: number | null;
      amount_sent_to_collector: number | null;
    };
    Relationships: [
      Rel<"accounts_clinic_id_fkey", "clinic_id", "clinics">,
    ];
  };
  project_tat: {
    Row: {
      project_id: number | null;
      clinic_id: number | null;
      name: string | null;
      status: WorkStatus | null;
      progress_pct: number | null;
      amount: number | null;
      claim_count: number | null;
      assigned_to: string | null;
      target_tat_days: number | null;
      elapsed_days: number | null;
      is_complete: boolean | null;
      is_overdue: boolean | null;
    };
    Relationships: [Rel<"projects_clinic_id_fkey", "clinic_id", "clinics">];
  };
};

/** Columns added to `clinics` by the same migration. */
type ClinicContactColumns = {
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  contact_name: string | null;
  contact_title: string | null;
};

type GeneratedPublic = Generated["public"];
type GeneratedTables = GeneratedPublic["Tables"];
type GeneratedClinics = GeneratedTables["clinics"];

type ExtendedClinics = Omit<GeneratedClinics, "Row" | "Insert" | "Update"> & {
  Row: GeneratedClinics["Row"] & ClinicContactColumns;
  Insert: GeneratedClinics["Insert"] & Partial<ClinicContactColumns>;
  Update: GeneratedClinics["Update"] & Partial<ClinicContactColumns>;
};

/** The generated schema plus everything the pending migration adds. */
export type AppDatabase = Omit<Generated, "public"> & {
  public: Omit<GeneratedPublic, "Tables" | "Views"> & {
    Tables: Omit<GeneratedTables, "clinics"> & {
      clinics: ExtendedClinics;
    } & PendingTables;
    Views: GeneratedPublic["Views"] & PendingViews;
  };
};

export type AppTables<T extends keyof AppDatabase["public"]["Tables"]> =
  AppDatabase["public"]["Tables"][T]["Row"];
