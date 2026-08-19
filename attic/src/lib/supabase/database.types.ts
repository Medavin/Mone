export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_monthly: {
        Row: {
          adjustments: number | null
          charges: number | null
          clinic_id: number
          financial_class_id: number
          id: number
          new_patients: number | null
          payments: number | null
          period_month: string
          source_batch_id: number | null
          unapplied_payments: number | null
          units: number | null
          updated_at: string
          visits: number | null
        }
        Insert: {
          adjustments?: number | null
          charges?: number | null
          clinic_id: number
          financial_class_id: number
          id?: number
          new_patients?: number | null
          payments?: number | null
          period_month: string
          source_batch_id?: number | null
          unapplied_payments?: number | null
          units?: number | null
          updated_at?: string
          visits?: number | null
        }
        Update: {
          adjustments?: number | null
          charges?: number | null
          clinic_id?: number
          financial_class_id?: number
          id?: number
          new_patients?: number | null
          payments?: number | null
          period_month?: string
          source_batch_id?: number | null
          unapplied_payments?: number | null
          units?: number | null
          updated_at?: string
          visits?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_monthly_financial_class_id_fkey"
            columns: ["financial_class_id"]
            isOneToOne: false
            referencedRelation: "financial_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      ar_monthly: {
        Row: {
          bucket_120_plus: number | null
          bucket_30: number | null
          bucket_60: number | null
          bucket_90: number | null
          bucket_current: number | null
          clinic_id: number
          closing_ar: number | null
          financial_class_id: number
          id: number
          note: string | null
          opening_ar: number | null
          period_month: string
          source_batch_id: number | null
          updated_at: string
        }
        Insert: {
          bucket_120_plus?: number | null
          bucket_30?: number | null
          bucket_60?: number | null
          bucket_90?: number | null
          bucket_current?: number | null
          clinic_id: number
          closing_ar?: number | null
          financial_class_id: number
          id?: number
          note?: string | null
          opening_ar?: number | null
          period_month: string
          source_batch_id?: number | null
          updated_at?: string
        }
        Update: {
          bucket_120_plus?: number | null
          bucket_30?: number | null
          bucket_60?: number | null
          bucket_90?: number | null
          bucket_current?: number | null
          clinic_id?: number
          closing_ar?: number | null
          financial_class_id?: number
          id?: number
          note?: string | null
          opening_ar?: number | null
          period_month?: string
          source_batch_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ar_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ar_monthly_financial_class_id_fkey"
            columns: ["financial_class_id"]
            isOneToOne: false
            referencedRelation: "financial_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      cam_assignments: {
        Row: {
          cam_id: string
          clinic_id: number
          created_at: string
          effective_from: string
          effective_to: string | null
          id: number
        }
        Insert: {
          cam_id: string
          clinic_id: number
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: number
        }
        Update: {
          cam_id?: string
          clinic_id?: number
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: number
        }
        Relationships: [
          {
            foreignKeyName: "cam_assignments_cam_id_fkey"
            columns: ["cam_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cam_assignments_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      cam_seed_map: {
        Row: {
          cam_name: string
          clinic_name: string
        }
        Insert: {
          cam_name: string
          clinic_name: string
        }
        Update: {
          cam_name?: string
          clinic_name?: string
        }
        Relationships: []
      }
      carrier_ar_monthly: {
        Row: {
          bucket_120_plus: number | null
          bucket_30: number | null
          bucket_60: number | null
          bucket_90: number | null
          bucket_current: number | null
          carrier_id: number
          clinic_id: number
          id: number
          period_month: string
          provider_id: number | null
          source_batch_id: number | null
          total_ar: number | null
        }
        Insert: {
          bucket_120_plus?: number | null
          bucket_30?: number | null
          bucket_60?: number | null
          bucket_90?: number | null
          bucket_current?: number | null
          carrier_id: number
          clinic_id: number
          id?: number
          period_month: string
          provider_id?: number | null
          source_batch_id?: number | null
          total_ar?: number | null
        }
        Update: {
          bucket_120_plus?: number | null
          bucket_30?: number | null
          bucket_60?: number | null
          bucket_90?: number | null
          bucket_current?: number | null
          carrier_id?: number
          clinic_id?: number
          id?: number
          period_month?: string
          provider_id?: number | null
          source_batch_id?: number | null
          total_ar?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "carrier_ar_monthly_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_ar_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carrier_ar_monthly_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          code: string | null
          id: number
          name: string
        }
        Insert: {
          code?: string | null
          id?: number
          name: string
        }
        Update: {
          code?: string | null
          id?: number
          name?: string
        }
        Relationships: []
      }
      clinics: {
        Row: {
          code: string | null
          created_at: string
          go_live_date: string | null
          id: number
          name: string
          notes: string | null
          status: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          go_live_date?: string | null
          id?: number
          name: string
          notes?: string | null
          status?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          go_live_date?: string | null
          id?: number
          name?: string
          notes?: string | null
          status?: string
        }
        Relationships: []
      }
      financial_classes: {
        Row: {
          code: string
          id: number
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: number
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: number
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          clinic_id: number | null
          error_detail: string | null
          finished_at: string | null
          id: number
          period_month: string | null
          report_kind: string | null
          rows_accepted: number | null
          rows_read: number | null
          rows_rejected: number | null
          run_by: string | null
          source_name: string | null
          source_type: string
          started_at: string
          status: string
        }
        Insert: {
          clinic_id?: number | null
          error_detail?: string | null
          finished_at?: string | null
          id?: number
          period_month?: string | null
          report_kind?: string | null
          rows_accepted?: number | null
          rows_read?: number | null
          rows_rejected?: number | null
          run_by?: string | null
          source_name?: string | null
          source_type: string
          started_at?: string
          status?: string
        }
        Update: {
          clinic_id?: number | null
          error_detail?: string | null
          finished_at?: string | null
          id?: number
          period_month?: string | null
          report_kind?: string | null
          rows_accepted?: number | null
          rows_read?: number | null
          rows_rejected?: number | null
          run_by?: string | null
          source_name?: string | null
          source_type?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      procedures: {
        Row: {
          code: string
          description: string | null
          id: number
          is_active: boolean
        }
        Insert: {
          code: string
          description?: string | null
          id?: number
          is_active?: boolean
        }
        Update: {
          code?: string
          description?: string | null
          id?: number
          is_active?: boolean
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name: string
          id: string
          is_active?: boolean
          role?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          credential: string | null
          id: number
          is_active: boolean
          name: string
        }
        Insert: {
          credential?: string | null
          id?: number
          is_active?: boolean
          name: string
        }
        Update: {
          credential?: string | null
          id?: number
          is_active?: boolean
          name?: string
        }
        Relationships: []
      }
      referrals_monthly: {
        Row: {
          clinic_id: number
          id: number
          new_patients_mtd: number | null
          new_patients_ytd: number | null
          period_month: string
          referring_provider_id: number
          source_batch_id: number | null
          visits_mtd: number | null
        }
        Insert: {
          clinic_id: number
          id?: number
          new_patients_mtd?: number | null
          new_patients_ytd?: number | null
          period_month: string
          referring_provider_id: number
          source_batch_id?: number | null
          visits_mtd?: number | null
        }
        Update: {
          clinic_id?: number
          id?: number
          new_patients_mtd?: number | null
          new_patients_ytd?: number | null
          period_month?: string
          referring_provider_id?: number
          source_batch_id?: number | null
          visits_mtd?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "referrals_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_monthly_referring_provider_id_fkey"
            columns: ["referring_provider_id"]
            isOneToOne: false
            referencedRelation: "referring_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      referring_providers: {
        Row: {
          city: string | null
          email: string | null
          id: number
          name: string
          phone: string | null
          state: string | null
          street: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          email?: string | null
          id?: number
          name: string
          phone?: string | null
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          email?: string | null
          id?: number
          name?: string
          phone?: string | null
          state?: string | null
          street?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      service_monthly: {
        Row: {
          charges: number | null
          clinic_id: number
          financial_class_id: number
          id: number
          period_month: string
          procedure_id: number
          source_batch_id: number | null
          units: number | null
        }
        Insert: {
          charges?: number | null
          clinic_id: number
          financial_class_id: number
          id?: number
          period_month: string
          procedure_id: number
          source_batch_id?: number | null
          units?: number | null
        }
        Update: {
          charges?: number | null
          clinic_id?: number
          financial_class_id?: number
          id?: number
          period_month?: string
          procedure_id?: number
          source_batch_id?: number | null
          units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "service_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_monthly_financial_class_id_fkey"
            columns: ["financial_class_id"]
            isOneToOne: false
            referencedRelation: "financial_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_monthly_procedure_id_fkey"
            columns: ["procedure_id"]
            isOneToOne: false
            referencedRelation: "procedures"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ar_monthly_clinic_total: {
        Row: {
          bucket_120_plus: number | null
          bucket_30: number | null
          bucket_60: number | null
          bucket_90: number | null
          bucket_current: number | null
          clinic_id: number | null
          closing_ar: number | null
          opening_ar: number | null
          period_month: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ar_monthly_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      can_see_clinic: { Args: { p_clinic_id: number }; Returns: boolean }
      current_role_of: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_cam_of: { Args: { p_clinic_id: number }; Returns: boolean }
      sees_all_clinics: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
