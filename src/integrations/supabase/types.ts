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
      ai_usage_log: {
        Row: {
          created_at: string
          estimated_cost_usd: number
          id: string
          input_tokens: number
          label: string | null
          latency_ms: number | null
          model: string | null
          output_tokens: number
          provider: string
          status: number | null
          streamed: boolean
          total_tokens: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number
          provider: string
          status?: number | null
          streamed?: boolean
          total_tokens?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          label?: string | null
          latency_ms?: number | null
          model?: string | null
          output_tokens?: number
          provider?: string
          status?: number | null
          streamed?: boolean
          total_tokens?: number
          user_id?: string | null
        }
        Relationships: []
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
      analytics_summaries: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          plan_id: string | null
          summary: string
          user_id: string
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          plan_id?: string | null
          summary: string
          user_id: string
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          plan_id?: string | null
          summary?: string
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          ai_provider: string
          claude_model: string
          id: number
          updated_at: string
        }
        Insert: {
          ai_provider?: string
          claude_model?: string
          id?: number
          updated_at?: string
        }
        Update: {
          ai_provider?: string
          claude_model?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      blog_comments: {
        Row: {
          author_name: string
          content: string
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          author_name: string
          content: string
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          author_name?: string
          content?: string
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_likes: {
        Row: {
          created_at: string
          id: string
          post_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_likes_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "blog_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          author_id: string
          content: string
          cover_image: string | null
          created_at: string
          excerpt: string | null
          id: string
          published: boolean
          published_at: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          content?: string
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          content?: string
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published?: boolean
          published_at?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
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
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      ga4_tokens: {
        Row: {
          access_token: string | null
          created_at: string
          expires_at: number | null
          id: string
          property_id: string | null
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          expires_at?: number | null
          id?: string
          property_id?: string | null
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          expires_at?: number | null
          id?: string
          property_id?: string | null
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      intervals_credentials: {
        Row: {
          api_key: string
          athlete_id: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          athlete_id: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          athlete_id?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      keyword_actions: {
        Row: {
          action_taken: string
          actioned_at: string
          actioned_by: string
          actioned_by_email: string | null
          created_at: string
          id: string
          keyword: string
          next_review_at: string
          notes: string | null
        }
        Insert: {
          action_taken: string
          actioned_at?: string
          actioned_by: string
          actioned_by_email?: string | null
          created_at?: string
          id?: string
          keyword: string
          next_review_at?: string
          notes?: string | null
        }
        Update: {
          action_taken?: string
          actioned_at?: string
          actioned_by?: string
          actioned_by_email?: string | null
          created_at?: string
          id?: string
          keyword?: string
          next_review_at?: string
          notes?: string | null
        }
        Relationships: []
      }
      oauth_state: {
        Row: {
          created_at: string
          expires_at: string
          nonce: string
          provider: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          nonce: string
          provider: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          nonce?: string
          provider?: string
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
          advice: string | null
          created_at: string
          factors: Json | null
          hour: number
          id: string
          insight: string | null
          is_backfilled: boolean
          kind: string
          recommendation: string | null
          recorded_at: string
          score: number
          user_id: string
        }
        Insert: {
          advice?: string | null
          created_at?: string
          factors?: Json | null
          hour: number
          id?: string
          insight?: string | null
          is_backfilled?: boolean
          kind?: string
          recommendation?: string | null
          recorded_at?: string
          score: number
          user_id: string
        }
        Update: {
          advice?: string | null
          created_at?: string
          factors?: Json | null
          hour?: number
          id?: string
          insight?: string | null
          is_backfilled?: boolean
          kind?: string
          recommendation?: string | null
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
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
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
          goal_time: string | null
          id: string
          last_adaptation_reason: string | null
          last_adapted_at: string | null
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
          goal_time?: string | null
          id?: string
          last_adaptation_reason?: string | null
          last_adapted_at?: string | null
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
          goal_time?: string | null
          id?: string
          last_adaptation_reason?: string | null
          last_adapted_at?: string | null
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
      user_feedback: {
        Row: {
          category: string | null
          created_at: string
          id: string
          message: string
          rating: number | null
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          message: string
          rating?: number | null
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          message?: string
          rating?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workout_reviews: {
        Row: {
          activity_id: string
          ai_summary: string | null
          coach_recommendation: string | null
          created_at: string
          difficulty: string | null
          feel: string | null
          id: string
          injury: string | null
          pace: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          activity_id: string
          ai_summary?: string | null
          coach_recommendation?: string | null
          created_at?: string
          difficulty?: string | null
          feel?: string | null
          id?: string
          injury?: string | null
          pace?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          activity_id?: string
          ai_summary?: string | null
          coach_recommendation?: string | null
          created_at?: string
          difficulty?: string | null
          feel?: string | null
          id?: string
          injury?: string | null
          pace?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_ai_usage_stats: { Args: never; Returns: Json }
      admin_dashboard_stats: { Args: never; Returns: Json }
      admin_feedback_stats: { Args: never; Returns: Json }
      admin_system_health_stats: { Args: never; Returns: Json }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_user_count: { Args: never; Returns: number }
      get_user_emails: {
        Args: never
        Returns: {
          created_at: string
          email: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
