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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          activity_type: string | null
          avg_cadence: number | null
          avg_heart_rate: number | null
          avg_power: number | null
          avg_speed: number | null
          avg_temperature: number | null
          calories: number | null
          created_at: string
          distance_meters: number | null
          duration_seconds: number | null
          id: string
          latitude: number | null
          longitude: number | null
          max_heart_rate: number | null
          max_power: number | null
          max_speed: number | null
          raw_data: Json | null
          source_file: string | null
          start_time: string | null
          total_ascent: number | null
          total_descent: number | null
          total_steps: number | null
          training_effect: number | null
          training_load: number | null
          training_plan_id: string | null
          upload_id: string | null
          user_id: string
        }
        Insert: {
          activity_type?: string | null
          avg_cadence?: number | null
          avg_heart_rate?: number | null
          avg_power?: number | null
          avg_speed?: number | null
          avg_temperature?: number | null
          calories?: number | null
          created_at?: string
          distance_meters?: number | null
          duration_seconds?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_heart_rate?: number | null
          max_power?: number | null
          max_speed?: number | null
          raw_data?: Json | null
          source_file?: string | null
          start_time?: string | null
          total_ascent?: number | null
          total_descent?: number | null
          total_steps?: number | null
          training_effect?: number | null
          training_load?: number | null
          training_plan_id?: string | null
          upload_id?: string | null
          user_id: string
        }
        Update: {
          activity_type?: string | null
          avg_cadence?: number | null
          avg_heart_rate?: number | null
          avg_power?: number | null
          avg_speed?: number | null
          avg_temperature?: number | null
          calories?: number | null
          created_at?: string
          distance_meters?: number | null
          duration_seconds?: number | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          max_heart_rate?: number | null
          max_power?: number | null
          max_speed?: number | null
          raw_data?: Json | null
          source_file?: string | null
          start_time?: string | null
          total_ascent?: number | null
          total_descent?: number | null
          total_steps?: number | null
          training_effect?: number | null
          training_load?: number | null
          training_plan_id?: string | null
          upload_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_training_plan_id_fkey"
            columns: ["training_plan_id"]
            isOneToOne: false
            referencedRelation: "training_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      analyses: {
        Row: {
          content: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      daily_metrics: {
        Row: {
          active_calories: number | null
          awake_during_night_minutes: number | null
          body_fat_percentage: number | null
          calories_total: number | null
          created_at: string
          date: string
          deep_sleep_minutes: number | null
          height_m: number | null
          hrv: number | null
          id: string
          light_sleep_minutes: number | null
          raw_data: Json | null
          rem_sleep_minutes: number | null
          resting_heart_rate: number | null
          sleep_duration_seconds: number | null
          sleep_score: number | null
          source_file: string | null
          spo2: number | null
          steps: number | null
          stress_score: number | null
          upload_id: string | null
          user_id: string
          vo2_max: number | null
          weight: number | null
        }
        Insert: {
          active_calories?: number | null
          awake_during_night_minutes?: number | null
          body_fat_percentage?: number | null
          calories_total?: number | null
          created_at?: string
          date: string
          deep_sleep_minutes?: number | null
          height_m?: number | null
          hrv?: number | null
          id?: string
          light_sleep_minutes?: number | null
          raw_data?: Json | null
          rem_sleep_minutes?: number | null
          resting_heart_rate?: number | null
          sleep_duration_seconds?: number | null
          sleep_score?: number | null
          source_file?: string | null
          spo2?: number | null
          steps?: number | null
          stress_score?: number | null
          upload_id?: string | null
          user_id: string
          vo2_max?: number | null
          weight?: number | null
        }
        Update: {
          active_calories?: number | null
          awake_during_night_minutes?: number | null
          body_fat_percentage?: number | null
          calories_total?: number | null
          created_at?: string
          date?: string
          deep_sleep_minutes?: number | null
          height_m?: number | null
          hrv?: number | null
          id?: string
          light_sleep_minutes?: number | null
          raw_data?: Json | null
          rem_sleep_minutes?: number | null
          resting_heart_rate?: number | null
          sleep_duration_seconds?: number | null
          sleep_score?: number | null
          source_file?: string | null
          spo2?: number | null
          steps?: number | null
          stress_score?: number | null
          upload_id?: string | null
          user_id?: string
          vo2_max?: number | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_metrics_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      google_fit_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: number
          id: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: number
          id?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: number
          id?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          athlete_context: string | null
          created_at: string
          date_of_birth: string | null
          experience_level: string | null
          height_cm: number | null
          id: string
          name: string | null
          onboarding_completed: boolean
          primary_sport: string | null
          sex: string | null
          training_goals: string | null
          unit_distance: string
          unit_elevation: string
          unit_height: string
          unit_speed: string
          unit_temperature: string
          unit_weight: string
          updated_at: string
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          athlete_context?: string | null
          created_at?: string
          date_of_birth?: string | null
          experience_level?: string | null
          height_cm?: number | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean
          primary_sport?: string | null
          sex?: string | null
          training_goals?: string | null
          unit_distance?: string
          unit_elevation?: string
          unit_height?: string
          unit_speed?: string
          unit_temperature?: string
          unit_weight?: string
          updated_at?: string
          user_id: string
          weight_kg?: number | null
        }
        Update: {
          athlete_context?: string | null
          created_at?: string
          date_of_birth?: string | null
          experience_level?: string | null
          height_cm?: number | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean
          primary_sport?: string | null
          sex?: string | null
          training_goals?: string | null
          unit_distance?: string
          unit_elevation?: string
          unit_height?: string
          unit_speed?: string
          unit_temperature?: string
          unit_weight?: string
          updated_at?: string
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      readiness_snapshots: {
        Row: {
          created_at: string
          factors: Json | null
          hour: number
          id: string
          recorded_at: string
          score: number
          user_id: string
        }
        Insert: {
          created_at?: string
          factors?: Json | null
          hour: number
          id?: string
          recorded_at?: string
          score: number
          user_id: string
        }
        Update: {
          created_at?: string
          factors?: Json | null
          hour?: number
          id?: string
          recorded_at?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      running_iq_snapshots: {
        Row: {
          adjusted_score: number
          coaching_tip: string | null
          created_at: string
          id: string
          label: string
          lowest_pillar: string | null
          pillars: Json
          recorded_at: string
          score: number
          user_id: string
        }
        Insert: {
          adjusted_score: number
          coaching_tip?: string | null
          created_at?: string
          id?: string
          label: string
          lowest_pillar?: string | null
          pillars?: Json
          recorded_at?: string
          score: number
          user_id: string
        }
        Update: {
          adjusted_score?: number
          coaching_tip?: string | null
          created_at?: string
          id?: string
          label?: string
          lowest_pillar?: string | null
          pillars?: Json
          recorded_at?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      sleep_stages: {
        Row: {
          created_at: string
          date: string
          duration_seconds: number
          end_time: string | null
          id: string
          source: string | null
          stage: string
          start_time: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date: string
          duration_seconds?: number
          end_time?: string | null
          id?: string
          source?: string | null
          stage: string
          start_time?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          duration_seconds?: number
          end_time?: string | null
          id?: string
          source?: string | null
          stage?: string
          start_time?: string | null
          user_id?: string
        }
        Relationships: []
      }
      strava_tokens: {
        Row: {
          access_token: string
          athlete_id: number
          created_at: string
          expires_at: number
          id: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          athlete_id: number
          created_at?: string
          expires_at: number
          id?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          athlete_id?: number
          created_at?: string
          expires_at?: number
          id?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_schedules: {
        Row: {
          created_at: string
          google_fit_enabled: boolean
          google_fit_hour_utc: number
          id: string
          intervals_enabled: boolean
          intervals_interval_hours: number
          last_google_fit_sync: string | null
          last_intervals_sync: string | null
          last_strava_sync: string | null
          strava_enabled: boolean
          strava_interval_hours: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          google_fit_enabled?: boolean
          google_fit_hour_utc?: number
          id?: string
          intervals_enabled?: boolean
          intervals_interval_hours?: number
          last_google_fit_sync?: string | null
          last_intervals_sync?: string | null
          last_strava_sync?: string | null
          strava_enabled?: boolean
          strava_interval_hours?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          google_fit_enabled?: boolean
          google_fit_hour_utc?: number
          id?: string
          intervals_enabled?: boolean
          intervals_interval_hours?: number
          last_google_fit_sync?: string | null
          last_intervals_sync?: string | null
          last_strava_sync?: string | null
          strava_enabled?: boolean
          strava_interval_hours?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      training_plans: {
        Row: {
          archived: boolean
          content: string
          created_at: string
          id: string
          race_date: string | null
          race_distance: string
          start_date: string
          training_days: string[]
          user_id: string
        }
        Insert: {
          archived?: boolean
          content: string
          created_at?: string
          id?: string
          race_date?: string | null
          race_distance: string
          start_date: string
          training_days: string[]
          user_id: string
        }
        Update: {
          archived?: boolean
          content?: string
          created_at?: string
          id?: string
          race_date?: string | null
          race_distance?: string
          start_date?: string
          training_days?: string[]
          user_id?: string
        }
        Relationships: []
      }
      uploads: {
        Row: {
          created_at: string
          file_name: string
          file_type: string
          id: string
          record_count: number
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_type?: string
          id?: string
          record_count?: number
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_type?: string
          id?: string
          record_count?: number
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
