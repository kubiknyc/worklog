export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          count: number
          usage_date: string
          user_id: string
        }
        Insert: {
          count?: number
          usage_date?: string
          user_id: string
        }
        Update: {
          count?: number
          usage_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          id: string
          item_id: string
          mentions: string[] | null
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          id?: string
          item_id: string
          mentions?: string[] | null
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          id?: string
          item_id?: string
          mentions?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_branding: {
        Row: {
          company_id: string
          footer_text: string | null
          header_text: string | null
          logo_storage_path: string | null
          primary_color: string | null
          secondary_color: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          footer_text?: string | null
          header_text?: string | null
          logo_storage_path?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          footer_text?: string | null
          header_text?: string | null
          logo_storage_path?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_branding_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_branding_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          role: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          role?: Database["public"]["Enums"]["company_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_report_audit_log: {
        Row: {
          actor_id: string | null
          detail: Json
          event: string
          id: number
          occurred_at: string
          report_id: string
        }
        Insert: {
          actor_id?: string | null
          detail?: Json
          event: string
          id?: never
          occurred_at?: string
          report_id: string
        }
        Update: {
          actor_id?: string | null
          detail?: Json
          event?: string
          id?: never
          occurred_at?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_report_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_report_audit_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_reports: {
        Row: {
          created_at: string
          created_by: string
          has_delay: boolean
          has_incident: boolean
          id: string
          locked_at: string | null
          locked_by: string | null
          project_id: string
          report_date: string
          status: Database["public"]["Enums"]["report_status"]
          submitted_at: string | null
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          has_delay?: boolean
          has_incident?: boolean
          id: string
          locked_at?: string | null
          locked_by?: string | null
          project_id: string
          report_date: string
          status?: Database["public"]["Enums"]["report_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          has_delay?: boolean
          has_incident?: boolean
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          project_id?: string
          report_date?: string
          status?: Database["public"]["Enums"]["report_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_reports_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      floors: {
        Row: {
          code: string
          id: string
          label: string
          plan_url: string | null
          project_id: string
          sort_order: number
        }
        Insert: {
          code: string
          id?: string
          label: string
          plan_url?: string | null
          project_id: string
          sort_order?: number
        }
        Update: {
          code?: string
          id?: string
          label?: string
          plan_url?: string | null
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "floors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      item_history: {
        Row: {
          actor_id: string
          created_at: string
          detail: Json | null
          id: string
          item_id: string
          kind: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          detail?: Json | null
          id?: string
          item_id: string
          kind: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          detail?: Json | null
          id?: string
          item_id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_history_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          assignee_id: string | null
          code: string
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          floor_id: string | null
          id: string
          pin_x: number | null
          pin_y: number | null
          priority: Database["public"]["Enums"]["item_priority"]
          project_id: string
          room: string | null
          status: Database["public"]["Enums"]["item_status"]
          title: string
          trade: string | null
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          code: string
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          floor_id?: string | null
          id?: string
          pin_x?: number | null
          pin_y?: number | null
          priority?: Database["public"]["Enums"]["item_priority"]
          project_id: string
          room?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title: string
          trade?: string | null
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          code?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          floor_id?: string | null
          id?: string
          pin_x?: number | null
          pin_y?: number | null
          priority?: Database["public"]["Enums"]["item_priority"]
          project_id?: string
          room?: string | null
          status?: Database["public"]["Enums"]["item_status"]
          title?: string
          trade?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_floor_id_fkey"
            columns: ["floor_id"]
            isOneToOne: false
            referencedRelation: "floors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          created_at: string
          created_by: string
          deleted_at: string | null
          height: number | null
          id: string
          item_id: string
          markups: Json
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          deleted_at?: string | null
          height?: number | null
          id?: string
          item_id: string
          markups?: Json
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          height?: number | null
          id?: string
          item_id?: string
          markups?: Json
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          email: string
          expo_push_token: string | null
          full_name: string
          id: string
          notify_digest: boolean
          notify_mentions: boolean
          notify_push: boolean
          phone: string | null
          trade: string | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email: string
          expo_push_token?: string | null
          full_name?: string
          id: string
          notify_digest?: boolean
          notify_mentions?: boolean
          notify_push?: boolean
          phone?: string | null
          trade?: string | null
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string
          expo_push_token?: string | null
          full_name?: string
          id?: string
          notify_digest?: boolean
          notify_mentions?: boolean
          notify_push?: boolean
          phone?: string | null
          trade?: string | null
        }
        Relationships: []
      }
      project_members: {
        Row: {
          created_at: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          role: Database["public"]["Enums"]["project_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          role?: Database["public"]["Enums"]["project_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          code_prefix: string | null
          company_id: string | null
          created_at: string
          created_by: string
          geocode_source: string | null
          geocoded_at: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          timezone: string | null
        }
        Insert: {
          address?: string | null
          code_prefix?: string | null
          company_id?: string | null
          created_at?: string
          created_by: string
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          timezone?: string | null
        }
        Update: {
          address?: string | null
          code_prefix?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_attempts: {
        Row: {
          attempt_date: string
          count: number
          key: string
        }
        Insert: {
          attempt_date?: string
          count?: number
          key: string
        }
        Update: {
          attempt_date?: string
          count?: number
          key?: string
        }
        Relationships: []
      }
      report_amendment_changes: {
        Row: {
          after_payload: Json
          amendment_id: string
          before_payload: Json
          id: string
          section: string
        }
        Insert: {
          after_payload: Json
          amendment_id: string
          before_payload: Json
          id: string
          section: string
        }
        Update: {
          after_payload?: Json
          amendment_id?: string
          before_payload?: Json
          id?: string
          section?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_amendment_changes_amendment_id_fkey"
            columns: ["amendment_id"]
            isOneToOne: false
            referencedRelation: "report_amendments"
            referencedColumns: ["id"]
          },
        ]
      }
      report_amendments: {
        Row: {
          amendment_number: number
          created_at: string
          created_by: string
          id: string
          reason: string
          report_id: string
          signature_id: string | null
        }
        Insert: {
          amendment_number: number
          created_at?: string
          created_by: string
          id: string
          reason: string
          report_id: string
          signature_id?: string | null
        }
        Update: {
          amendment_number?: number
          created_at?: string
          created_by?: string
          id?: string
          reason?: string
          report_id?: string
          signature_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_amendments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_amendments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_amendments_signature_id_fkey"
            columns: ["signature_id"]
            isOneToOne: false
            referencedRelation: "report_signatures"
            referencedColumns: ["id"]
          },
        ]
      }
      report_crew: {
        Row: {
          headcount: number
          hours: number
          id: string
          is_carried_forward: boolean
          report_id: string
          trade: string
        }
        Insert: {
          headcount: number
          hours: number
          id: string
          is_carried_forward?: boolean
          report_id: string
          trade: string
        }
        Update: {
          headcount?: number
          hours?: number
          id?: string
          is_carried_forward?: boolean
          report_id?: string
          trade?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_crew_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_customization: {
        Row: {
          company_id: string
          required_fields: Json
          section_toggles: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          company_id: string
          required_fields?: Json
          section_toggles?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          company_id?: string
          required_fields?: Json
          section_toggles?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_customization_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_customization_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_delays: {
        Row: {
          cause: string
          duration_hours: number | null
          id: string
          is_ongoing: boolean
          note: string | null
          report_id: string
          responsible_party: string | null
        }
        Insert: {
          cause: string
          duration_hours?: number | null
          id: string
          is_ongoing?: boolean
          note?: string | null
          report_id: string
          responsible_party?: string | null
        }
        Update: {
          cause?: string
          duration_hours?: number | null
          id?: string
          is_ongoing?: boolean
          note?: string | null
          report_id?: string
          responsible_party?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_delays_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_distribution_lists: {
        Row: {
          created_at: string
          created_by: string
          email: string
          id: string
          label: string | null
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          email: string
          id: string
          label?: string | null
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          email?: string
          id?: string
          label?: string | null
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_distribution_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_distribution_lists_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      report_equipment: {
        Row: {
          id: string
          name: string
          on_site: boolean
          report_id: string
          status: string
        }
        Insert: {
          id: string
          name: string
          on_site?: boolean
          report_id: string
          status: string
        }
        Update: {
          id?: string
          name?: string
          on_site?: boolean
          report_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_equipment_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_member_prefs: {
        Row: {
          project_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          project_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          project_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_member_prefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_member_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_photos: {
        Row: {
          added_at: string
          caption: string | null
          captured_at: string | null
          created_at: string
          created_by: string
          deleted_at: string | null
          exif_datetime_original: string | null
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          height: number | null
          id: string
          location_tag: string | null
          project_id: string
          report_id: string
          source: string
          storage_path: string
          trade_tag: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          added_at?: string
          caption?: string | null
          captured_at?: string | null
          created_at?: string
          created_by: string
          deleted_at?: string | null
          exif_datetime_original?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          height?: number | null
          id: string
          location_tag?: string | null
          project_id: string
          report_id: string
          source: string
          storage_path: string
          trade_tag?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          added_at?: string
          caption?: string | null
          captured_at?: string | null
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          exif_datetime_original?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          height?: number | null
          id?: string
          location_tag?: string | null
          project_id?: string
          report_id?: string
          source?: string
          storage_path?: string
          trade_tag?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_photos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_photos_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_safety_observations: {
        Row: {
          description: string | null
          id: string
          is_incident: boolean
          obs_type: string
          report_id: string
        }
        Insert: {
          description?: string | null
          id: string
          is_incident?: boolean
          obs_type: string
          report_id: string
        }
        Update: {
          description?: string | null
          id?: string
          is_incident?: boolean
          obs_type?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_safety_observations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_sections: {
        Row: {
          is_complete: boolean
          payload: Json
          report_id: string
          section: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          is_complete?: boolean
          payload?: Json
          report_id: string
          section: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          is_complete?: boolean
          payload?: Json
          report_id?: string
          section?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_sections_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_sections_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_signatures: {
        Row: {
          id: string
          kind: string
          png_bytes: string
          report_id: string
          signed_at: string
          signer_name: string
          signer_title: string | null
          signer_user_id: string
        }
        Insert: {
          id: string
          kind: string
          png_bytes: string
          report_id: string
          signed_at?: string
          signer_name: string
          signer_title?: string | null
          signer_user_id: string
        }
        Update: {
          id?: string
          kind?: string
          png_bytes?: string
          report_id?: string
          signed_at?: string
          signer_name?: string
          signer_title?: string | null
          signer_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_signatures_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_signatures_signer_user_id_fkey"
            columns: ["signer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_weather: {
        Row: {
          auto_condition: string | null
          auto_fetched_at: string | null
          auto_raw_response: Json | null
          auto_temp_f: number | null
          override_at: string | null
          override_by: string | null
          override_condition: string | null
          override_temp_f: number | null
          report_id: string
          updated_at: string
          weather_source: string
        }
        Insert: {
          auto_condition?: string | null
          auto_fetched_at?: string | null
          auto_raw_response?: Json | null
          auto_temp_f?: number | null
          override_at?: string | null
          override_by?: string | null
          override_condition?: string | null
          override_temp_f?: number | null
          report_id: string
          updated_at?: string
          weather_source?: string
        }
        Update: {
          auto_condition?: string | null
          auto_fetched_at?: string | null
          auto_raw_response?: Json | null
          auto_temp_f?: number | null
          override_at?: string | null
          override_by?: string | null
          override_condition?: string | null
          override_temp_f?: number | null
          report_id?: string
          updated_at?: string
          weather_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_weather_override_by_fkey"
            columns: ["override_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_weather_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_work_performed: {
        Row: {
          area: string
          id: string
          note: string
          report_id: string
          trade: string
        }
        Insert: {
          area: string
          id: string
          note: string
          report_id: string
          trade: string
        }
        Update: {
          area?: string
          id?: string
          note?: string
          report_id?: string
          trade?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_work_performed_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      worklog_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_status: {
        Args: {
          p_expected_from?: Database["public"]["Enums"]["item_status"]
          p_history_id?: string
          p_item: string
          p_to: Database["public"]["Enums"]["item_status"]
        }
        Returns: undefined
      }
      amend_report: {
        Args: {
          p_amendment_client_id: string
          p_changes: Json
          p_reason: string
          p_report_id: string
          p_signature_png?: string
          p_signer_title?: string
        }
        Returns: number
      }
      consume_ai_quota: { Args: { p_limit: number }; Returns: boolean }
      consume_registration_quota: {
        Args: { p_key: string; p_limit: number }
        Returns: boolean
      }
      create_report: {
        Args: {
          p_client_id: string
          p_project_id: string
          p_report_date: string
        }
        Returns: {
          report_id: string
          was_created: boolean
        }[]
      }
      lock_report: { Args: { p_report_id: string }; Returns: undefined }
      lock_stale_submitted_reports: { Args: never; Returns: number }
      next_item_code: { Args: { p: string }; Returns: string }
      set_push_token: { Args: { p_token: string }; Returns: undefined }
      soft_delete_photo: { Args: { p_photo_id: string }; Returns: undefined }
      submit_report: {
        Args: {
          p_report_id: string
          p_signature_png: string
          p_signer_title: string
        }
        Returns: undefined
      }
      update_photo_markups: {
        Args: { p_markups: Json; p_photo_id: string }
        Returns: undefined
      }
      update_section: {
        Args: {
          p_is_complete?: boolean
          p_payload: Json
          p_report_id: string
          p_section: string
        }
        Returns: string
      }
      vault_secret: { Args: { p_name: string }; Returns: string }
      worklog_apply_section: {
        Args: {
          p_actor: string
          p_is_complete: boolean
          p_payload: Json
          p_report_id: string
          p_section: string
        }
        Returns: string
      }
      worklog_lock_report_core: {
        Args: { p_actor: string; p_detail?: Json; p_report_id: string }
        Returns: undefined
      }
      worklog_section_rows: {
        Args: { p_report_id: string; p_section: string }
        Returns: Json
      }
    }
    Enums: {
      company_role: "admin" | "member"
      item_priority: "high" | "medium" | "low"
      item_status: "open" | "in_progress" | "review" | "closed"
      markup_type: "circle" | "arrow"
      project_role: "super" | "sub"
      report_status: "draft" | "submitted" | "locked"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      company_role: ["admin", "member"],
      item_priority: ["high", "medium", "low"],
      item_status: ["open", "in_progress", "review", "closed"],
      markup_type: ["circle", "arrow"],
      project_role: ["super", "sub"],
      report_status: ["draft", "submitted", "locked"],
    },
  },
} as const

