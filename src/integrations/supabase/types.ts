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
          max_heart_rate: number | null
          max_power: number | null
          max_speed: number | null
          raw_data: Json | null
          source_file: string | null
          start_time: string | null
          total_ascent: number | null
          total_descent: number | null
          training_effect: number | null
          training_load: number | null
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
          max_heart_rate?: number | null
          max_power?: number | null
          max_speed?: number | null
          raw_data?: Json | null
          source_file?: string | null
          start_time?: string | null
          total_ascent?: number | null
          total_descent?: number | null
          training_effect?: number | null
          training_load?: number | null
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
          max_heart_rate?: number | null
          max_power?: number | null
          max_speed?: number | null
          raw_data?: Json | null
          source_file?: string | null
          start_time?: string | null
          total_ascent?: number | null
          total_descent?: number | null
          training_effect?: number | null
          training_load?: number | null
          upload_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_metrics: {
        Row: {
          body_fat_percentage: number | null
          calories_total: number | null
          created_at: string
          date: string
          hrv: number | null
          id: string
          raw_data: Json | null
          resting_heart_rate: number | null
          sleep_duration_seconds: number | null
          sleep_score: number | null
          source_file: string | null
          steps: number | null
          stress_score: number | null
          upload_id: string | null
          user_id: string
          weight: number | null
        }
        Insert: {
          body_fat_percentage?: number | null
          calories_total?: number | null
          created_at?: string
          date: string
          hrv?: number | null
          id?: string
          raw_data?: Json | null
          resting_heart_rate?: number | null
          sleep_duration_seconds?: number | null
          sleep_score?: number | null
          source_file?: string | null
          steps?: number | null
          stress_score?: number | null
          upload_id?: string | null
          user_id: string
          weight?: number | null
        }
        Update: {
          body_fat_percentage?: number | null
          calories_total?: number | null
          created_at?: string
          date?: string
          hrv?: number | null
          id?: string
          raw_data?: Json | null
          resting_heart_rate?: number | null
          sleep_duration_seconds?: number | null
          sleep_score?: number | null
          source_file?: string | null
          steps?: number | null
          stress_score?: number | null
          upload_id?: string | null
          user_id?: string
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
      profiles: {
        Row: {
          athlete_context: string | null
          created_at: string
          experience_level: string | null
          id: string
          name: string | null
          onboarding_completed: boolean
          primary_sport: string | null
          training_goals: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          athlete_context?: string | null
          created_at?: string
          experience_level?: string | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean
          primary_sport?: string | null
          training_goals?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          athlete_context?: string | null
          created_at?: string
          experience_level?: string | null
          id?: string
          name?: string | null
          onboarding_completed?: boolean
          primary_sport?: string | null
          training_goals?: string | null
          updated_at?: string
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
      training_plans: {
        Row: {
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
