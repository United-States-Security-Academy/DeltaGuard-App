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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      assessment_attempt_grants: {
        Row: {
          assessment_id: string
          extra_attempts: number
          granted_at: string
          granted_by: string | null
          id: string
          officer_id: string
          reason: string | null
        }
        Insert: {
          assessment_id: string
          extra_attempts?: number
          granted_at?: string
          granted_by?: string | null
          id?: string
          officer_id: string
          reason?: string | null
        }
        Update: {
          assessment_id?: string
          extra_attempts?: number
          granted_at?: string
          granted_by?: string | null
          id?: string
          officer_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assessment_attempt_grants_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_attempt_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_attempt_grants_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_attempts: {
        Row: {
          answers: Json | null
          assessment_id: string
          attempt_number: number
          device_integrity: string | null
          id: string
          officer_id: string
          passed: boolean | null
          score_percent: number | null
          started_at: string
          submitted_at: string | null
          timed_out: boolean
        }
        Insert: {
          answers?: Json | null
          assessment_id: string
          attempt_number: number
          device_integrity?: string | null
          id?: string
          officer_id: string
          passed?: boolean | null
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          timed_out?: boolean
        }
        Update: {
          answers?: Json | null
          assessment_id?: string
          attempt_number?: number
          device_integrity?: string | null
          id?: string
          officer_id?: string
          passed?: boolean | null
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          timed_out?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "assessment_attempts_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_attempts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          created_at: string
          id: string
          lesson_id: string
          max_attempts: number | null
          pass_mark_percent: number
          show_correct_answers_after: Database["public"]["Enums"]["show_answers_after"]
          shuffle_options: boolean
          shuffle_questions: boolean
          time_limit_minutes: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id: string
          max_attempts?: number | null
          pass_mark_percent?: number
          show_correct_answers_after?: Database["public"]["Enums"]["show_answers_after"]
          shuffle_options?: boolean
          shuffle_questions?: boolean
          time_limit_minutes?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string
          max_attempts?: number | null
          pass_mark_percent?: number
          show_correct_answers_after?: Database["public"]["Enums"]["show_answers_after"]
          shuffle_options?: boolean
          shuffle_questions?: boolean
          time_limit_minutes?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: true
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_events: {
        Row: {
          accepted: boolean
          accuracy_m: number | null
          device_id: string
          device_time: string | null
          distance_from_site_m: number | null
          flags: string[]
          id: string
          is_mock_location: boolean
          latitude: number
          longitude: number
          officer_id: string
          recorded_at: string
          shift_id: string
          type: Database["public"]["Enums"]["attendance_type"]
        }
        Insert: {
          accepted?: boolean
          accuracy_m?: number | null
          device_id: string
          device_time?: string | null
          distance_from_site_m?: number | null
          flags?: string[]
          id?: string
          is_mock_location?: boolean
          latitude: number
          longitude: number
          officer_id: string
          recorded_at?: string
          shift_id: string
          type: Database["public"]["Enums"]["attendance_type"]
        }
        Update: {
          accepted?: boolean
          accuracy_m?: number | null
          device_id?: string
          device_time?: string | null
          distance_from_site_m?: number | null
          flags?: string[]
          id?: string
          is_mock_location?: boolean
          latitude?: number
          longitude?: number
          officer_id?: string
          recorded_at?: string
          shift_id?: string
          type?: Database["public"]["Enums"]["attendance_type"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_events_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          at: string
          details: Json
          id: number
          ip: string | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          at?: string
          details?: Json
          id?: never
          ip?: string | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          at?: string
          details?: Json
          id?: never
          ip?: string | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          contact_person: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          contact_person?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversation_members: {
        Row: {
          added_by: string | null
          conversation_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          conversation_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          conversation_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_reads: {
        Row: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          last_read_at: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_reads_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_reads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string | null
          direct_key: string | null
          id: string
          last_message_at: string | null
          name: string | null
          site_id: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direct_key?: string | null
          id?: string
          last_message_at?: string | null
          name?: string | null
          site_id?: string | null
          type: Database["public"]["Enums"]["conversation_type"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direct_key?: string | null
          id?: string
          last_message_at?: string | null
          name?: string | null
          site_id?: string | null
          type?: Database["public"]["Enums"]["conversation_type"]
        }
        Relationships: [
          {
            foreignKeyName: "conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_activity_reports: {
        Row: {
          created_at: string
          id: string
          officer_id: string
          shift_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          officer_id: string
          shift_id: string
        }
        Update: {
          created_at?: string
          id?: string
          officer_id?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_activity_reports_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_activity_reports_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      dar_entries: {
        Row: {
          created_at: string
          description: string
          id: string
          occurred_at: string
          officer_id: string
          photo_path: string | null
          report_id: string
          type: Database["public"]["Enums"]["dar_entry_type"]
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          occurred_at?: string
          officer_id: string
          photo_path?: string | null
          report_id: string
          type: Database["public"]["Enums"]["dar_entry_type"]
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          occurred_at?: string
          officer_id?: string
          photo_path?: string | null
          report_id?: string
          type?: Database["public"]["Enums"]["dar_entry_type"]
        }
        Relationships: [
          {
            foreignKeyName: "dar_entries_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dar_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "daily_activity_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      device_heartbeats: {
        Row: {
          app_state: string
          battery_level: number | null
          device_id: string
          last_seen_at: string
          officer_id: string
          shift_id: string | null
        }
        Insert: {
          app_state?: string
          battery_level?: number | null
          device_id: string
          last_seen_at?: string
          officer_id: string
          shift_id?: string | null
        }
        Update: {
          app_state?: string
          battery_level?: number | null
          device_id?: string
          last_seen_at?: string
          officer_id?: string
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_heartbeats_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_heartbeats_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      device_integrity_challenges: {
        Row: {
          challenge: string
          created_at: string
          device_id: string
          expires_at: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          challenge: string
          created_at?: string
          device_id: string
          expires_at?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          challenge?: string
          created_at?: string
          device_id?: string
          expires_at?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_integrity_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          officer_id: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          site_id: string | null
          template_id: string
          template_version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          officer_id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          site_id?: string | null
          template_id: string
          template_version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          officer_id?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          site_id?: string | null
          template_id?: string
          template_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_assignments_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          acroform_name: string | null
          created_at: string
          font_size: number
          height: number
          id: string
          key: string
          label: string
          options: Json | null
          page: number
          required: boolean
          sort_order: number
          template_id: string
          type: Database["public"]["Enums"]["form_field_type"]
          width: number
          x: number
          y: number
        }
        Insert: {
          acroform_name?: string | null
          created_at?: string
          font_size?: number
          height: number
          id?: string
          key: string
          label: string
          options?: Json | null
          page: number
          required?: boolean
          sort_order?: number
          template_id: string
          type: Database["public"]["Enums"]["form_field_type"]
          width: number
          x: number
          y: number
        }
        Update: {
          acroform_name?: string | null
          created_at?: string
          font_size?: number
          height?: number
          id?: string
          key?: string
          label?: string
          options?: Json | null
          page?: number
          required?: boolean
          sort_order?: number
          template_id?: string
          type?: Database["public"]["Enums"]["form_field_type"]
          width?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_submissions: {
        Row: {
          assignment_id: string | null
          created_at: string
          device_id: string | null
          device_integrity: string | null
          filled_pdf_path: string | null
          filled_pdf_sha256: string | null
          id: string
          officer_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          signature_path: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["form_submission_status"]
          submitted_at: string | null
          template_id: string
          template_version: number
          updated_at: string
          values: Json
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string
          device_id?: string | null
          device_integrity?: string | null
          filled_pdf_path?: string | null
          filled_pdf_sha256?: string | null
          id?: string
          officer_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          signature_path?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["form_submission_status"]
          submitted_at?: string | null
          template_id: string
          template_version?: number
          updated_at?: string
          values?: Json
        }
        Update: {
          assignment_id?: string | null
          created_at?: string
          device_id?: string | null
          device_integrity?: string | null
          filled_pdf_path?: string | null
          filled_pdf_sha256?: string | null
          id?: string
          officer_id?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          signature_path?: string | null
          signed_at?: string | null
          status?: Database["public"]["Enums"]["form_submission_status"]
          submitted_at?: string | null
          template_id?: string
          template_version?: number
          updated_at?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "form_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "form_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_submissions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_template_versions: {
        Row: {
          description: string | null
          fields: Json
          original_pdf_path: string
          page_count: number
          page_image_paths: string[]
          published_at: string
          published_by: string | null
          template_id: string
          title: string
          version: number
        }
        Insert: {
          description?: string | null
          fields: Json
          original_pdf_path: string
          page_count: number
          page_image_paths: string[]
          published_at?: string
          published_by?: string | null
          template_id: string
          title: string
          version: number
        }
        Update: {
          description?: string | null
          fields?: Json
          original_pdf_path?: string
          page_count?: number
          page_image_paths?: string[]
          published_at?: string
          published_by?: string | null
          template_id?: string
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_template_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          edited_at: string
          id: string
          original_pdf_path: string | null
          page_count: number | null
          page_image_paths: string[]
          status: Database["public"]["Enums"]["form_template_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edited_at?: string
          id?: string
          original_pdf_path?: string | null
          page_count?: number | null
          page_image_paths?: string[]
          status?: Database["public"]["Enums"]["form_template_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          edited_at?: string
          id?: string
          original_pdf_path?: string | null
          page_count?: number | null
          page_image_paths?: string[]
          status?: Database["public"]["Enums"]["form_template_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "form_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_photos: {
        Row: {
          created_at: string
          id: string
          incident_id: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_id: string
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_photos_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_status: Database["public"]["Enums"]["incident_status"] | null
          id: string
          incident_id: string
          notes: string | null
          to_status: Database["public"]["Enums"]["incident_status"]
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["incident_status"] | null
          id?: string
          incident_id: string
          notes?: string | null
          to_status: Database["public"]["Enums"]["incident_status"]
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_status?: Database["public"]["Enums"]["incident_status"] | null
          id?: string
          incident_id?: string
          notes?: string | null
          to_status?: Database["public"]["Enums"]["incident_status"]
        }
        Relationships: [
          {
            foreignKeyName: "incident_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_status_history_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          category: string
          created_at: string
          description: string
          id: string
          occurred_at: string
          officer_id: string
          people_involved: string | null
          police_called: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift_id: string | null
          site_id: string
          status: Database["public"]["Enums"]["incident_status"]
          submitted_at: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description: string
          id: string
          occurred_at: string
          officer_id: string
          people_involved?: string | null
          police_called?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift_id?: string | null
          site_id: string
          status?: Database["public"]["Enums"]["incident_status"]
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string
          id?: string
          occurred_at?: string
          officer_id?: string
          people_involved?: string | null
          police_called?: boolean
          review_notes?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          severity?: Database["public"]["Enums"]["incident_severity"]
          shift_id?: string | null
          site_id?: string
          status?: Database["public"]["Enums"]["incident_status"]
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_assignments: {
        Row: {
          created_at: string
          created_by: string | null
          creates_qualification_type: string | null
          due_at: string | null
          id: string
          lesson_id: string
          officer_id: string | null
          qualification_valid_months: number | null
          role: Database["public"]["Enums"]["user_role"] | null
          site_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          creates_qualification_type?: string | null
          due_at?: string | null
          id?: string
          lesson_id: string
          officer_id?: string | null
          qualification_valid_months?: number | null
          role?: Database["public"]["Enums"]["user_role"] | null
          site_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          creates_qualification_type?: string | null
          due_at?: string | null
          id?: string
          lesson_id?: string
          officer_id?: string | null
          qualification_valid_months?: number | null
          role?: Database["public"]["Enums"]["user_role"] | null
          site_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_assignments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_reading_at: string | null
          lesson_id: string
          officer_id: string
          pages_viewed: number[]
          seconds_spent: number
          started_at: string
          updated_at: string
        }
        Insert: {
          completed_reading_at?: string | null
          lesson_id: string
          officer_id: string
          pages_viewed?: number[]
          seconds_spent?: number
          started_at?: string
          updated_at?: string
        }
        Update: {
          completed_reading_at?: string | null
          lesson_id?: string
          officer_id?: string
          pages_viewed?: number[]
          seconds_spent?: number
          started_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_progress_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          estimated_minutes: number | null
          id: string
          page_count: number | null
          page_image_paths: string[]
          pdf_path: string | null
          status: Database["public"]["Enums"]["lesson_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          page_count?: number | null
          page_image_paths?: string[]
          pdf_path?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          page_count?: number | null
          page_image_paths?: string[]
          pdf_path?: string | null
          status?: Database["public"]["Enums"]["lesson_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lessons_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachment_path: string | null
          body: string | null
          conversation_id: string
          created_at: string
          id: string
          sender_id: string
        }
        Insert: {
          attachment_path?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_path?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          claimed_at: string | null
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          push_attempts: number
          push_error: string | null
          push_status: string
          pushed_at: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body: string
          claimed_at?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          push_attempts?: number
          push_error?: string | null
          push_status?: string
          pushed_at?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string
          claimed_at?: string | null
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          id?: string
          push_attempts?: number
          push_error?: string | null
          push_status?: string
          pushed_at?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_details: {
        Row: {
          address: string | null
          created_at: string
          date_hired: string | null
          emergency_contact: Json | null
          employee_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          date_hired?: string | null
          emergency_contact?: Json | null
          employee_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          date_hired?: string | null
          emergency_contact?: Json | null
          employee_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "officer_details_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      officer_welfare_settings: {
        Row: {
          mode: string
          officer_id: string
          policy_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          mode: string
          officer_id: string
          policy_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          mode?: string
          officer_id?: string
          policy_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "officer_welfare_settings_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_settings_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "welfare_check_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "officer_welfare_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_periods: {
        Row: {
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          locked_at: string | null
          locked_by: string | null
          starts_on: string
          status: Database["public"]["Enums"]["pay_period_status"]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          ends_on: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          starts_on: string
          status?: Database["public"]["Enums"]["pay_period_status"]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          ends_on?: string
          id?: string
          locked_at?: string | null
          locked_by?: string | null
          starts_on?: string
          status?: Database["public"]["Enums"]["pay_period_status"]
        }
        Relationships: [
          {
            foreignKeyName: "pay_periods_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_periods_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_order_acknowledgements: {
        Row: {
          acknowledged_at: string
          id: string
          officer_id: string
          post_order_id: string
          version: number
        }
        Insert: {
          acknowledged_at?: string
          id?: string
          officer_id: string
          post_order_id: string
          version: number
        }
        Update: {
          acknowledged_at?: string
          id?: string
          officer_id?: string
          post_order_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_order_acknowledgements_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_order_acknowledgements_post_order_id_version_fkey"
            columns: ["post_order_id", "version"]
            isOneToOne: false
            referencedRelation: "post_order_versions"
            referencedColumns: ["post_order_id", "version"]
          },
        ]
      }
      post_order_versions: {
        Row: {
          body: string
          post_order_id: string
          published_at: string
          published_by: string | null
          title: string
          version: number
        }
        Insert: {
          body: string
          post_order_id: string
          published_at: string
          published_by?: string | null
          title: string
          version: number
        }
        Update: {
          body?: string
          post_order_id?: string
          published_at?: string
          published_by?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_order_versions_post_order_id_fkey"
            columns: ["post_order_id"]
            isOneToOne: false
            referencedRelation: "post_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_order_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_orders: {
        Row: {
          archived_at: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          published_at: string
          published_by: string | null
          site_id: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string
          published_by?: string | null
          site_id: string
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          published_at?: string
          published_by?: string | null
          site_id?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_orders_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_orders_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          employment_status: Database["public"]["Enums"]["employment_status"]
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          employment_status?: Database["public"]["Enums"]["employment_status"]
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_tickets: {
        Row: {
          checked_at: string | null
          created_at: string
          device_id: string | null
          id: string
          notification_id: string
          receipt_error: string | null
          receipt_status: string | null
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          device_id?: string | null
          id: string
          notification_id: string
          receipt_error?: string | null
          receipt_status?: string | null
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          device_id?: string | null
          id?: string
          notification_id?: string
          receipt_error?: string | null
          receipt_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_tickets_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "user_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_tickets_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      qualifications: {
        Row: {
          created_at: string
          document_path: string | null
          expires_on: string | null
          id: string
          issued_on: string | null
          license_number: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_path?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          license_number?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_path?: string | null
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          license_number?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      question_options: {
        Row: {
          id: string
          is_correct: boolean
          question_id: string
          sort_order: number
          text: string
        }
        Insert: {
          id?: string
          is_correct?: boolean
          question_id: string
          sort_order?: number
          text: string
        }
        Update: {
          id?: string
          is_correct?: boolean
          question_id?: string
          sort_order?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          assessment_id: string
          created_at: string
          explanation: string | null
          id: string
          points: number
          prompt: string
          sort_order: number
          type: Database["public"]["Enums"]["question_type"]
        }
        Insert: {
          assessment_id: string
          created_at?: string
          explanation?: string | null
          id?: string
          points?: number
          prompt: string
          sort_order?: number
          type: Database["public"]["Enums"]["question_type"]
        }
        Update: {
          assessment_id?: string
          created_at?: string
          explanation?: string | null
          id?: string
          points?: number
          prompt?: string
          sort_order?: number
          type?: Database["public"]["Enums"]["question_type"]
        }
        Relationships: [
          {
            foreignKeyName: "questions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limit_counters: {
        Row: {
          action: string
          hits: number
          user_id: string
          window_start: string
        }
        Insert: {
          action: string
          hits?: number
          user_id: string
          window_start: string
        }
        Update: {
          action?: string
          hits?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          early_clock_in_minutes: number
          id: boolean
          integrity_enforcement: string
          late_grace_minutes: number
          low_accuracy_threshold_m: number
          time_zone: string
          updated_at: string
          welfare_policy_id: string | null
        }
        Insert: {
          early_clock_in_minutes?: number
          id?: boolean
          integrity_enforcement?: string
          late_grace_minutes?: number
          low_accuracy_threshold_m?: number
          time_zone?: string
          updated_at?: string
          welfare_policy_id?: string | null
        }
        Update: {
          early_clock_in_minutes?: number
          id?: boolean
          integrity_enforcement?: string
          late_grace_minutes?: number
          low_accuracy_threshold_m?: number
          time_zone?: string
          updated_at?: string
          welfare_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_welfare_policy_id_fkey"
            columns: ["welfare_policy_id"]
            isOneToOne: false
            referencedRelation: "welfare_check_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          notes: string | null
          officer_id: string
          site_id: string
          starts_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          notes?: string | null
          officer_id: string
          site_id: string
          starts_at: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          notes?: string | null
          officer_id?: string
          site_id?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_assignments: {
        Row: {
          created_at: string
          id: string
          officer_id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          officer_id: string
          site_id: string
        }
        Update: {
          created_at?: string
          id?: string
          officer_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_assignments_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_assignments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          active: boolean
          address: string | null
          client_id: string
          clock_in_radius_m: number
          created_at: string
          emergency_instructions: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          site_contacts: Json
          updated_at: string
          welfare_checks_enabled: boolean
          welfare_policy_id: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          client_id: string
          clock_in_radius_m?: number
          created_at?: string
          emergency_instructions?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          site_contacts?: Json
          updated_at?: string
          welfare_checks_enabled?: boolean
          welfare_policy_id?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          client_id?: string
          clock_in_radius_m?: number
          created_at?: string
          emergency_instructions?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          site_contacts?: Json
          updated_at?: string
          welfare_checks_enabled?: boolean
          welfare_policy_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_welfare_policy_id_fkey"
            columns: ["welfare_policy_id"]
            isOneToOne: false
            referencedRelation: "welfare_check_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_alerts: {
        Row: {
          accuracy_m: number | null
          acknowledge_notes: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          created_at: string
          escalation_level: number
          id: string
          latitude: number | null
          location_at: string | null
          longitude: number | null
          next_escalation_at: string | null
          officer_id: string
          officer_name: string
          officer_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        Insert: {
          accuracy_m?: number | null
          acknowledge_notes?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledged_by_name?: string | null
          created_at?: string
          escalation_level?: number
          id: string
          latitude?: number | null
          location_at?: string | null
          longitude?: number | null
          next_escalation_at?: string | null
          officer_id: string
          officer_name: string
          officer_phone?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          shift_id?: string | null
          site_id?: string | null
          site_name?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        Update: {
          accuracy_m?: number | null
          acknowledge_notes?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          acknowledged_by_name?: string | null
          created_at?: string
          escalation_level?: number
          id?: string
          latitude?: number | null
          location_at?: string | null
          longitude?: number | null
          next_escalation_at?: string | null
          officer_id?: string
          officer_name?: string
          officer_phone?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_by_name?: string | null
          shift_id?: string | null
          site_id?: string | null
          site_name?: string | null
          status?: Database["public"]["Enums"]["sos_status"]
          triggered_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_alerts_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_contacts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          phone: string
          position: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          phone: string
          position: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          phone?: string
          position?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sos_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_events: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          alert_id: string
          created_at: string
          data: Json
          id: number
          notes: string | null
          type: string
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          alert_id: string
          created_at?: string
          data?: Json
          id?: never
          notes?: string | null
          type: string
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          alert_id?: string
          created_at?: string
          data?: Json
          id?: never
          notes?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_locations: {
        Row: {
          accuracy_m: number | null
          alert_id: string
          id: number
          latitude: number
          longitude: number
          received_at: string
          recorded_at: string
        }
        Insert: {
          accuracy_m?: number | null
          alert_id: string
          id?: never
          latitude: number
          longitude: number
          received_at?: string
          recorded_at: string
        }
        Update: {
          accuracy_m?: number | null
          alert_id?: string
          id?: never
          latitude?: number
          longitude?: number
          received_at?: string
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_locations_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_sms_outbox: {
        Row: {
          alert_id: string
          attempts: number
          body: string
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          next_attempt_at: string
          phone: string
          provider_id: string | null
          recipient_name: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          alert_id: string
          attempts?: number
          body: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          next_attempt_at?: string
          phone: string
          provider_id?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          alert_id?: string
          attempts?: number
          body?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          next_attempt_at?: string
          phone?: string
          provider_id?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_sms_outbox_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_corrections: {
        Row: {
          corrected_at: string
          corrected_by: string | null
          entry_id: string
          id: string
          new_clock_in_at: string
          new_clock_out_at: string
          original_clock_in_at: string | null
          original_clock_out_at: string | null
          previous_clock_in_at: string | null
          previous_clock_out_at: string | null
          reason: string
        }
        Insert: {
          corrected_at?: string
          corrected_by?: string | null
          entry_id: string
          id?: string
          new_clock_in_at: string
          new_clock_out_at: string
          original_clock_in_at?: string | null
          original_clock_out_at?: string | null
          previous_clock_in_at?: string | null
          previous_clock_out_at?: string | null
          reason: string
        }
        Update: {
          corrected_at?: string
          corrected_by?: string | null
          entry_id?: string
          id?: string
          new_clock_in_at?: string
          new_clock_out_at?: string
          original_clock_in_at?: string | null
          original_clock_out_at?: string | null
          previous_clock_in_at?: string | null
          previous_clock_out_at?: string | null
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_corrections_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_corrections_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "timesheet_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheet_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          clock_in_at: string | null
          clock_out_at: string | null
          corrected_clock_in_at: string | null
          corrected_clock_out_at: string | null
          created_at: string
          flags: string[]
          id: string
          officer_id: string
          original_clock_in_at: string | null
          original_clock_out_at: string | null
          shift_id: string
          site_id: string
          status: Database["public"]["Enums"]["timesheet_status"]
          updated_at: string
          work_date: string
          worked_minutes: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in_at?: string | null
          clock_out_at?: string | null
          corrected_clock_in_at?: string | null
          corrected_clock_out_at?: string | null
          created_at?: string
          flags?: string[]
          id?: string
          officer_id: string
          original_clock_in_at?: string | null
          original_clock_out_at?: string | null
          shift_id: string
          site_id: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          work_date: string
          worked_minutes?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          clock_in_at?: string | null
          clock_out_at?: string | null
          corrected_clock_in_at?: string | null
          corrected_clock_out_at?: string | null
          created_at?: string
          flags?: string[]
          id?: string
          officer_id?: string
          original_clock_in_at?: string | null
          original_clock_out_at?: string | null
          shift_id?: string
          site_id?: string
          status?: Database["public"]["Enums"]["timesheet_status"]
          updated_at?: string
          work_date?: string
          worked_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: true
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheet_entries_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_checks: {
        Row: {
          attempts: number
          bucket_id: string
          checked_at: string | null
          claimed_at: string | null
          created_at: string
          name: string
          owner_id: string | null
          reason: string | null
          status: string
        }
        Insert: {
          attempts?: number
          bucket_id: string
          checked_at?: string | null
          claimed_at?: string | null
          created_at?: string
          name: string
          owner_id?: string | null
          reason?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          bucket_id?: string
          checked_at?: string | null
          claimed_at?: string | null
          created_at?: string
          name?: string
          owner_id?: string | null
          reason?: string | null
          status?: string
        }
        Relationships: []
      }
      user_devices: {
        Row: {
          attest_counter: number
          attest_key_id: string | null
          attest_public_key: Json | null
          device_id: string
          id: string
          integrity_checked_at: string | null
          integrity_reasons: string[]
          integrity_signals: string[]
          integrity_status: string
          last_seen_at: string
          platform: Database["public"]["Enums"]["device_platform"]
          push_token: string | null
          registered_at: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          attest_counter?: number
          attest_key_id?: string | null
          attest_public_key?: Json | null
          device_id: string
          id?: string
          integrity_checked_at?: string | null
          integrity_reasons?: string[]
          integrity_signals?: string[]
          integrity_status?: string
          last_seen_at?: string
          platform: Database["public"]["Enums"]["device_platform"]
          push_token?: string | null
          registered_at?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          attest_counter?: number
          attest_key_id?: string | null
          attest_public_key?: Json | null
          device_id?: string
          id?: string
          integrity_checked_at?: string | null
          integrity_reasons?: string[]
          integrity_signals?: string[]
          integrity_status?: string
          last_seen_at?: string
          platform?: Database["public"]["Enums"]["device_platform"]
          push_token?: string | null
          registered_at?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      welfare_check_policies: {
        Row: {
          alarm_seconds: number
          call_attempts: number
          call_gap_seconds: number
          created_at: string
          enabled: boolean
          id: string
          max_interval_minutes: number
          min_interval_minutes: number
          name: string
          night_end: string | null
          night_max_interval_minutes: number | null
          night_min_interval_minutes: number | null
          night_start: string | null
          response_seconds: number
          supervisor_alert_after_seconds: number | null
          updated_at: string
        }
        Insert: {
          alarm_seconds?: number
          call_attempts?: number
          call_gap_seconds?: number
          created_at?: string
          enabled?: boolean
          id?: string
          max_interval_minutes?: number
          min_interval_minutes?: number
          name: string
          night_end?: string | null
          night_max_interval_minutes?: number | null
          night_min_interval_minutes?: number | null
          night_start?: string | null
          response_seconds?: number
          supervisor_alert_after_seconds?: number | null
          updated_at?: string
        }
        Update: {
          alarm_seconds?: number
          call_attempts?: number
          call_gap_seconds?: number
          created_at?: string
          enabled?: boolean
          id?: string
          max_interval_minutes?: number
          min_interval_minutes?: number
          name?: string
          night_end?: string | null
          night_max_interval_minutes?: number | null
          night_min_interval_minutes?: number | null
          night_start?: string | null
          response_seconds?: number
          supervisor_alert_after_seconds?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      welfare_checks: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alerted_user_ids: string[]
          biometric_verified: boolean
          calls_made: number
          created_at: string
          device_id: string | null
          escalation_log: Json
          id: string
          officer_id: string
          policy: Json
          policy_id: string | null
          prompted_at: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          responded_at: string | null
          responded_at_device: string | null
          responded_offline: boolean
          response_flags: string[]
          response_seconds: number | null
          scheduled_at: string
          shift_id: string
          site_id: string
          status: Database["public"]["Enums"]["welfare_check_status"]
          step_due_at: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alerted_user_ids?: string[]
          biometric_verified?: boolean
          calls_made?: number
          created_at?: string
          device_id?: string | null
          escalation_log?: Json
          id?: string
          officer_id: string
          policy: Json
          policy_id?: string | null
          prompted_at?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responded_at?: string | null
          responded_at_device?: string | null
          responded_offline?: boolean
          response_flags?: string[]
          response_seconds?: number | null
          scheduled_at: string
          shift_id: string
          site_id: string
          status?: Database["public"]["Enums"]["welfare_check_status"]
          step_due_at?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alerted_user_ids?: string[]
          biometric_verified?: boolean
          calls_made?: number
          created_at?: string
          device_id?: string | null
          escalation_log?: Json
          id?: string
          officer_id?: string
          policy?: Json
          policy_id?: string | null
          prompted_at?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          responded_at?: string | null
          responded_at_device?: string | null
          responded_offline?: boolean
          response_flags?: string[]
          response_seconds?: number | null
          scheduled_at?: string
          shift_id?: string
          site_id?: string
          status?: Database["public"]["Enums"]["welfare_check_status"]
          step_due_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "welfare_checks_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checks_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checks_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "welfare_check_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checks_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_checks_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      welfare_outbox: {
        Row: {
          attempt_no: number
          attempts: number
          body: string
          check_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          next_attempt_at: string
          phone: string
          provider_id: string | null
          recipient_id: string | null
          recipient_name: string | null
          sent_at: string | null
          status: string
        }
        Insert: {
          attempt_no?: number
          attempts?: number
          body: string
          check_id: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          next_attempt_at?: string
          phone: string
          provider_id?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
        }
        Update: {
          attempt_no?: number
          attempts?: number
          body?: string
          check_id?: string
          claimed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          next_attempt_at?: string
          phone?: string
          provider_id?: string | null
          recipient_id?: string | null
          recipient_name?: string | null
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "welfare_outbox_check_id_fkey"
            columns: ["check_id"]
            isOneToOne: false
            referencedRelation: "welfare_checks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      welfare_pauses: {
        Row: {
          id: string
          officer_id: string
          paused_at: string
          paused_by: string | null
          paused_by_name: string | null
          reason: string
          resume_at: string | null
          resume_reason: string | null
          resumed_at: string | null
          resumed_by: string | null
          resumed_by_name: string | null
          shift_id: string
          site_id: string
        }
        Insert: {
          id?: string
          officer_id: string
          paused_at?: string
          paused_by?: string | null
          paused_by_name?: string | null
          reason: string
          resume_at?: string | null
          resume_reason?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          resumed_by_name?: string | null
          shift_id: string
          site_id: string
        }
        Update: {
          id?: string
          officer_id?: string
          paused_at?: string
          paused_by?: string | null
          paused_by_name?: string | null
          reason?: string
          resume_at?: string | null
          resume_reason?: string | null
          resumed_at?: string | null
          resumed_by?: string | null
          resumed_by_name?: string | null
          shift_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "welfare_pauses_officer_id_fkey"
            columns: ["officer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_pauses_paused_by_fkey"
            columns: ["paused_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_pauses_resumed_by_fkey"
            columns: ["resumed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_pauses_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "welfare_pauses_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_post_order: {
        Args: { p_post_order_id: string; p_version: number }
        Returns: {
          acknowledged_at: string
          id: string
          officer_id: string
          post_order_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "post_order_acknowledgements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_shift: {
        Args: { p_shift_id: string }
        Returns: {
          acknowledged_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          notes: string | null
          officer_id: string
          site_id: string
          starts_at: string
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "shifts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_sos: {
        Args: { p_alert_id: string; p_notes?: string }
        Returns: {
          accuracy_m: number | null
          acknowledge_notes: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          created_at: string
          escalation_level: number
          id: string
          latitude: number | null
          location_at: string | null
          longitude: number | null
          next_escalation_at: string | null
          officer_id: string
          officer_name: string
          officer_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sos_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      acknowledge_welfare_check: {
        Args: { p_check_id: string; p_notes?: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alerted_user_ids: string[]
          biometric_verified: boolean
          calls_made: number
          created_at: string
          device_id: string | null
          escalation_log: Json
          id: string
          officer_id: string
          policy: Json
          policy_id: string | null
          prompted_at: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          responded_at: string | null
          responded_at_device: string | null
          responded_offline: boolean
          response_flags: string[]
          response_seconds: number | null
          scheduled_at: string
          shift_id: string
          site_id: string
          status: Database["public"]["Enums"]["welfare_check_status"]
          step_due_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "welfare_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      active_admin_ids: { Args: never; Returns: string[] }
      active_supervisor_ids: { Args: { p_except?: string }; Returns: string[] }
      add_conversation_members: {
        Args: { p_conversation_id: string; p_user_ids: string[] }
        Returns: number
      }
      add_members_internal: {
        Args: {
          p_added_by: string
          p_conversation_id: string
          p_user_ids: string[]
        }
        Returns: string[]
      }
      approve_timesheet_entries: {
        Args: { p_entry_ids: string[] }
        Returns: number
      }
      assessment_answers_visible: {
        Args: {
          p_assessment: Database["public"]["Tables"]["assessments"]["Row"]
          p_officer: string
        }
        Returns: boolean
      }
      assessment_gate: {
        Args: { p_assessment_id: string }
        Returns: {
          created_at: string
          id: string
          lesson_id: string
          max_attempts: number | null
          pass_mark_percent: number
          show_correct_answers_after: Database["public"]["Enums"]["show_answers_after"]
          shuffle_options: boolean
          shuffle_questions: boolean
          time_limit_minutes: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "assessments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      assessment_overview: { Args: { p_assessment_id: string }; Returns: Json }
      attempt_review: {
        Args: {
          p_attempt: Database["public"]["Tables"]["assessment_attempts"]["Row"]
        }
        Returns: Json
      }
      audit: {
        Args: {
          p_action: string
          p_actor?: string
          p_details?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: undefined
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      call_edge_function: {
        Args: { p_body: Json; p_function: string }
        Returns: undefined
      }
      can_manage_welfare_check: {
        Args: { p_check_id: string }
        Returns: boolean
      }
      can_read_form_template_file: {
        Args: { p_name: string }
        Returns: boolean
      }
      can_read_lesson_file: { Args: { p_name: string }; Returns: boolean }
      can_see_sos: { Args: { p_alert_id: string }; Returns: boolean }
      can_upload_form_submission_file: {
        Args: { p_name: string }
        Returns: boolean
      }
      chat_contacts: {
        Args: never
        Returns: {
          full_name: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }[]
      }
      claim_notifications: {
        Args: { p_ids?: string[] }
        Returns: {
          body: string
          claimed_at: string | null
          created_at: string
          data: Json
          dedupe_key: string | null
          id: string
          push_attempts: number
          push_error: string | null
          push_status: string
          pushed_at: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_sos_sms: {
        Args: { p_limit?: number }
        Returns: {
          alert_id: string
          attempts: number
          body: string
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          next_attempt_at: string
          phone: string
          provider_id: string | null
          recipient_name: string | null
          sent_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "sos_sms_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_upload_checks: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          bucket_id: string
          checked_at: string | null
          claimed_at: string | null
          created_at: string
          name: string
          owner_id: string | null
          reason: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "upload_checks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_welfare_outbox: {
        Args: { p_limit?: number }
        Returns: {
          attempt_no: number
          attempts: number
          body: string
          check_id: string
          claimed_at: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          next_attempt_at: string
          phone: string
          provider_id: string | null
          recipient_id: string | null
          recipient_name: string | null
          sent_at: string | null
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "welfare_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clock_event: {
        Args: {
          p_accuracy_m: number
          p_device_id: string
          p_device_time?: string
          p_handover_note?: string
          p_is_mock_location: boolean
          p_latitude: number
          p_longitude: number
          p_queued?: boolean
          p_shift_id: string
          p_type: Database["public"]["Enums"]["attendance_type"]
        }
        Returns: {
          accepted: boolean
          accuracy_m: number | null
          device_id: string
          device_time: string | null
          distance_from_site_m: number | null
          flags: string[]
          id: string
          is_mock_location: boolean
          latitude: number
          longitude: number
          officer_id: string
          recorded_at: string
          shift_id: string
          type: Database["public"]["Enums"]["attendance_type"]
        }
        SetofOptions: {
          from: "*"
          to: "attendance_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_form_submission: {
        Args: {
          p_expected_signature_path: string
          p_expected_values: Json
          p_id: string
          p_pdf_path: string
          p_sha256: string
          p_signed_at: string
          p_template_version: number
        }
        Returns: {
          assignment_id: string | null
          created_at: string
          device_id: string | null
          device_integrity: string | null
          filled_pdf_path: string | null
          filled_pdf_sha256: string | null
          id: string
          officer_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          signature_path: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["form_submission_status"]
          submitted_at: string | null
          template_id: string
          template_version: number
          updated_at: string
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "form_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      conversation_people: {
        Args: { p_conversation_id: string }
        Returns: {
          full_name: string
          is_member: boolean
          last_read_at: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }[]
      }
      correct_timesheet_entry: {
        Args: {
          p_clock_in_at: string
          p_clock_out_at: string
          p_entry_id: string
          p_reason: string
        }
        Returns: {
          approved_at: string | null
          approved_by: string | null
          clock_in_at: string | null
          clock_out_at: string | null
          corrected_clock_in_at: string | null
          corrected_clock_out_at: string | null
          created_at: string
          flags: string[]
          id: string
          officer_id: string
          original_clock_in_at: string | null
          original_clock_out_at: string | null
          shift_id: string
          site_id: string
          status: Database["public"]["Enums"]["timesheet_status"]
          updated_at: string
          work_date: string
          worked_minutes: number | null
        }
        SetofOptions: {
          from: "*"
          to: "timesheet_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_group_conversation: {
        Args: { p_member_ids?: string[]; p_name: string; p_site_id?: string }
        Returns: string
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      dashboard_attendance: {
        Args: { p_days?: number; p_now?: string }
        Returns: {
          day: string
          late: number
          missed: number
          on_time: number
        }[]
      }
      dashboard_incidents_by_site: {
        Args: { p_days?: number; p_now?: string }
        Returns: {
          high_or_critical: number
          incidents: number
          site_id: string
          site_name: string
        }[]
      }
      dashboard_summary: {
        Args: { p_now?: string }
        Returns: {
          flagged: number
          incidents_awaiting_review: number
          late: number
          late_arrivals: number
          licences_expired: number
          licences_expiring_60: number
          missed: number
          not_clocked_in: number
          on_duty: number
          shifts_covered: number
          shifts_scheduled: number
          timesheets_pending: number
          timesheets_pending_period_id: string
        }[]
      }
      device_integrity_for: { Args: { p_user_id: string }; Returns: string }
      device_integrity_gate: {
        Args: { p_action: string; p_user_id: string }
        Returns: string
      }
      distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      e164_or_null: { Args: { p_phone: string }; Returns: string }
      effective_max_attempts: {
        Args: {
          p_assessment: Database["public"]["Tables"]["assessments"]["Row"]
          p_officer: string
        }
        Returns: number
      }
      enforce_rate_limit: { Args: { p_action: string }; Returns: undefined }
      expire_open_attempt: {
        Args: {
          p_assessment: Database["public"]["Tables"]["assessments"]["Row"]
          p_officer: string
        }
        Returns: undefined
      }
      finish_sos_sms: {
        Args: {
          p_error?: string
          p_id: string
          p_provider_id?: string
          p_status: string
        }
        Returns: undefined
      }
      finish_upload_check: {
        Args: {
          p_bucket: string
          p_name: string
          p_reason?: string
          p_status: string
        }
        Returns: undefined
      }
      finish_welfare_outbox: {
        Args: {
          p_error?: string
          p_id: string
          p_provider_id?: string
          p_status: string
        }
        Returns: undefined
      }
      form_assignment_applies_to_me: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      form_inbox: {
        Args: {
          p_limit?: number
          p_now?: string
          p_officer_id?: string
          p_overdue?: boolean
          p_site_id?: string
          p_status?: string
          p_template_id?: string
        }
        Returns: {
          assignment_id: string
          due_at: string
          has_pdf: boolean
          officer_id: string
          officer_name: string
          overdue: boolean
          reviewed_at: string
          row_key: string
          status: string
          submission_id: string
          submitted_at: string
          template_id: string
          template_title: string
          template_version: number
        }[]
      }
      form_template_visible_to_me: {
        Args: { p_template_id: string }
        Returns: boolean
      }
      format_shift_time: {
        Args: { p_ends_at: string; p_starts_at: string }
        Returns: string
      }
      get_assessment_for_officer: {
        Args: { p_assessment_id: string }
        Returns: Json
      }
      get_attempt_review: { Args: { p_attempt_id: string }; Returns: Json }
      get_next_welfare_check: {
        Args: never
        Returns: {
          id: string
          scheduled_at: string
        }[]
      }
      grant_extra_attempt: {
        Args: {
          p_assessment_id: string
          p_officer_id: string
          p_reason?: string
        }
        Returns: number
      }
      is_active_user: { Args: never; Returns: boolean }
      is_conversation_folder_member: {
        Args: { p_folder: string }
        Returns: boolean
      }
      is_conversation_member: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_locked_date: { Args: { p_date: string }; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_valid_time_zone: { Args: { p_name: string }; Returns: boolean }
      lesson_assigned_to: {
        Args: { p_lesson_id: string; p_user: string }
        Returns: boolean
      }
      lesson_assignment_applies_to_me: {
        Args: { p_assignment_id: string }
        Returns: boolean
      }
      lesson_question_stats: {
        Args: { p_lesson_id: string }
        Returns: {
          attempts: number
          correct: number
          prompt: string
          question_id: string
          sort_order: number
          type: Database["public"]["Enums"]["question_type"]
          wrong_percent: number
        }[]
      }
      lesson_results: {
        Args: { p_lesson_id: string; p_now?: string }
        Returns: {
          attempts: number
          attempts_allowed: number
          best_score: number
          completed_reading_at: string
          due_at: string
          last_attempt_id: string
          officer_id: string
          officer_name: string
          overdue: boolean
          page_count: number
          pages_viewed: number
          passed_at: string
          seconds_spent: number
          status: string
        }[]
      }
      lesson_visible_to_me: { Args: { p_lesson_id: string }; Returns: boolean }
      list_conversations: {
        Args: never
        Returns: {
          created_at: string
          id: string
          last_message_at: string
          last_message_preview: string
          last_message_sender_id: string
          member_count: number
          other_user_id: string
          other_user_role: Database["public"]["Enums"]["user_role"]
          site_id: string
          title: string
          type: Database["public"]["Enums"]["conversation_type"]
          unread_count: number
        }[]
      }
      lock_pay_period: {
        Args: { p_period_id: string }
        Returns: {
          created_at: string
          created_by: string | null
          ends_on: string
          id: string
          locked_at: string | null
          locked_by: string | null
          starts_on: string
          status: Database["public"]["Enums"]["pay_period_status"]
        }
        SetofOptions: {
          from: "*"
          to: "pay_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_details?: Json
          p_target_id?: string
          p_target_type?: string
        }
        Returns: undefined
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_missed_shifts: { Args: never; Returns: number }
      notify_expiring_licences: { Args: never; Returns: number }
      notify_lessons_due_soon: { Args: { p_now?: string }; Returns: number }
      notify_upcoming_shifts: { Args: never; Returns: number }
      notify_users: {
        Args: {
          p_body: string
          p_data?: Json
          p_dedupe_key?: string
          p_title: string
          p_type: string
          p_user_ids: string[]
        }
        Returns: number
      }
      pause_welfare_checks: {
        Args: { p_reason: string; p_resume_at?: string; p_shift_id: string }
        Returns: {
          id: string
          officer_id: string
          paused_at: string
          paused_by: string | null
          paused_by_name: string | null
          reason: string
          resume_at: string | null
          resume_reason: string | null
          resumed_at: string | null
          resumed_by: string | null
          resumed_by_name: string | null
          shift_id: string
          site_id: string
        }
        SetofOptions: {
          from: "*"
          to: "welfare_pauses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      post_orders_pending: {
        Args: { p_at?: string; p_officer_id: string; p_site_id: string }
        Returns: number
      }
      publish_form_template: { Args: { p_id: string }; Returns: number }
      queue_sos_sms: {
        Args: { p_alert_id: string; p_body: string; p_targets: Json }
        Returns: number
      }
      raise_sos: {
        Args: {
          p_accuracy_m?: number
          p_id: string
          p_latitude?: number
          p_longitude?: number
          p_triggered_at?: string
        }
        Returns: {
          accuracy_m: number | null
          acknowledge_notes: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          created_at: string
          escalation_level: number
          id: string
          latitude: number | null
          location_at: string | null
          longitude: number | null
          next_escalation_at: string | null
          officer_id: string
          officer_name: string
          officer_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sos_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rate_limit_hit: {
        Args: {
          p_action: string
          p_max: number
          p_user: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      record_device_heartbeat: {
        Args: {
          p_app_state?: string
          p_battery_level?: number
          p_device_id: string
        }
        Returns: boolean
      }
      record_device_integrity: {
        Args: {
          p_device_id: string
          p_reasons: string[]
          p_signals: string[]
          p_status: string
          p_user_id: string
        }
        Returns: undefined
      }
      record_lesson_progress: {
        Args: { p_lesson_id: string; p_pages: number[]; p_seconds?: number }
        Returns: {
          completed_reading_at: string | null
          lesson_id: string
          officer_id: string
          pages_viewed: number[]
          seconds_spent: number
          started_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "lesson_progress"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remove_conversation_member: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
      reorder_questions: {
        Args: { p_assessment_id: string; p_ids: string[] }
        Returns: undefined
      }
      replace_form_fields: {
        Args: { p_fields: Json; p_template_id: string }
        Returns: number
      }
      request_push_delivery: {
        Args: { p_notification_ids?: string[] }
        Returns: undefined
      }
      request_sos_sms: { Args: never; Returns: undefined }
      request_upload_sweep: { Args: never; Returns: undefined }
      request_welfare_delivery: { Args: never; Returns: undefined }
      resolve_sos: {
        Args: {
          p_alert_id: string
          p_notes: string
          p_status: Database["public"]["Enums"]["sos_status"]
        }
        Returns: {
          accuracy_m: number | null
          acknowledge_notes: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          created_at: string
          escalation_level: number
          id: string
          latitude: number | null
          location_at: string | null
          longitude: number | null
          next_escalation_at: string | null
          officer_id: string
          officer_name: string
          officer_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sos_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_welfare_check: {
        Args: { p_check_id: string; p_notes: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          alerted_user_ids: string[]
          biometric_verified: boolean
          calls_made: number
          created_at: string
          device_id: string | null
          escalation_log: Json
          id: string
          officer_id: string
          policy: Json
          policy_id: string | null
          prompted_at: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          responded_at: string | null
          responded_at_device: string | null
          responded_offline: boolean
          response_flags: string[]
          response_seconds: number | null
          scheduled_at: string
          shift_id: string
          site_id: string
          status: Database["public"]["Enums"]["welfare_check_status"]
          step_due_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "welfare_checks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      respond_welfare_check: {
        Args: {
          p_biometric_verified: boolean
          p_check_id: string
          p_device_id?: string
          p_offline: boolean
          p_responded_at_device: string
        }
        Returns: Json
      }
      resume_welfare_checks: {
        Args: { p_shift_id: string }
        Returns: {
          id: string
          officer_id: string
          paused_at: string
          paused_by: string | null
          paused_by_name: string | null
          reason: string
          resume_at: string | null
          resume_reason: string | null
          resumed_at: string | null
          resumed_by: string | null
          resumed_by_name: string | null
          shift_id: string
          site_id: string
        }
        SetofOptions: {
          from: "*"
          to: "welfare_pauses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_form_submission: {
        Args: {
          p_id: string
          p_notes?: string
          p_status: Database["public"]["Enums"]["form_submission_status"]
        }
        Returns: {
          assignment_id: string | null
          created_at: string
          device_id: string | null
          device_integrity: string | null
          filled_pdf_path: string | null
          filled_pdf_sha256: string | null
          id: string
          officer_id: string
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          signature_path: string | null
          signed_at: string | null
          status: Database["public"]["Enums"]["form_submission_status"]
          submitted_at: string | null
          template_id: string
          template_version: number
          updated_at: string
          values: Json
        }
        SetofOptions: {
          from: "*"
          to: "form_submissions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_incident: {
        Args: {
          p_incident_id: string
          p_notes?: string
          p_status: Database["public"]["Enums"]["incident_status"]
        }
        Returns: {
          category: string
          created_at: string
          description: string
          id: string
          occurred_at: string
          officer_id: string
          people_involved: string | null
          police_called: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift_id: string | null
          site_id: string
          status: Database["public"]["Enums"]["incident_status"]
          submitted_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      save_attest_key: {
        Args: {
          p_counter: number
          p_device_id: string
          p_key_id: string
          p_public_key: Json
          p_user_id: string
        }
        Returns: undefined
      }
      save_questions: {
        Args: { p_assessment_id: string; p_questions: Json }
        Returns: string[]
      }
      shift_handover: {
        Args: { p_shift_id: string }
        Returns: {
          entry_id: string
          from_shift_id: string
          note: string
          noted_at: string
          officer_name: string
        }[]
      }
      shift_work_date: { Args: { p_starts_at: string }; Returns: string }
      sos_contacts_for_me: {
        Args: never
        Returns: {
          kind: string
          name: string
          phone: string
          sort: number
        }[]
      }
      sos_location_update: {
        Args: {
          p_accuracy_m?: number
          p_alert_id: string
          p_latitude: number
          p_longitude: number
          p_recorded_at?: string
        }
        Returns: boolean
      }
      sos_log_officer_action: {
        Args: {
          p_alert_id: string
          p_at?: string
          p_data?: Json
          p_type: string
        }
        Returns: undefined
      }
      sos_mark_safe: {
        Args: { p_alert_id: string; p_false_alarm: boolean; p_notes?: string }
        Returns: {
          accuracy_m: number | null
          acknowledge_notes: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          acknowledged_by_name: string | null
          created_at: string
          escalation_level: number
          id: string
          latitude: number | null
          location_at: string | null
          longitude: number | null
          next_escalation_at: string | null
          officer_id: string
          officer_name: string
          officer_phone: string | null
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_by_name: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["sos_status"]
          triggered_at: string
        }
        SetofOptions: {
          from: "*"
          to: "sos_alerts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sos_run_dispatch: { Args: { p_alert_id?: string }; Returns: number }
      sos_sms_text: {
        Args: {
          p_alert: Database["public"]["Tables"]["sos_alerts"]["Row"]
          p_prefix: string
        }
        Returns: string
      }
      sos_staff_targets: { Args: { p_except: string }; Returns: string[] }
      start_direct_conversation: {
        Args: { p_user_id: string }
        Returns: string
      }
      storage_upload_allowed: { Args: { p_bucket: string }; Returns: boolean }
      submit_attempt: {
        Args: { p_answers: Json; p_assessment_id: string }
        Returns: Json
      }
      submit_incident: {
        Args: {
          p_category: string
          p_description: string
          p_id: string
          p_occurred_at: string
          p_people_involved: string
          p_photo_paths?: string[]
          p_police_called: boolean
          p_severity: Database["public"]["Enums"]["incident_severity"]
          p_shift_id: string
          p_site_id: string
        }
        Returns: {
          category: string
          created_at: string
          description: string
          id: string
          occurred_at: string
          officer_id: string
          people_involved: string | null
          police_called: boolean
          review_notes: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          severity: Database["public"]["Enums"]["incident_severity"]
          shift_id: string | null
          site_id: string
          status: Database["public"]["Enums"]["incident_status"]
          submitted_at: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "incidents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      supervises_form_submission: {
        Args: { p_assignment_id: string; p_officer_id: string }
        Returns: boolean
      }
      supervises_form_submission_file: {
        Args: { p_name: string }
        Returns: boolean
      }
      supervises_officer: { Args: { p_officer_id: string }; Returns: boolean }
      supervises_site: { Args: { p_site_id: string }; Returns: boolean }
      upload_is_clean: {
        Args: { p_bucket: string; p_name: string }
        Returns: boolean
      }
      welfare_board: {
        Args: never
        Returns: {
          answered_count: number
          app_state: string
          battery_level: number
          checks_enabled: boolean
          ends_at: string
          heartbeat_at: string
          last_check_id: string
          last_responded_at: string
          last_response_flags: string[]
          last_response_seconds: number
          last_scheduled_at: string
          last_status: Database["public"]["Enums"]["welfare_check_status"]
          missed_count: number
          officer_id: string
          officer_name: string
          officer_phone: string
          open_acknowledged_at: string
          open_check_id: string
          open_prompted_at: string
          open_scheduled_at: string
          open_status: Database["public"]["Enums"]["welfare_check_status"]
          pause_id: string
          pause_reason: string
          pause_resume_at: string
          paused_at: string
          paused_by_name: string
          policy_id: string
          policy_name: string
          policy_source: string
          shift_id: string
          site_id: string
          site_name: string
          starts_at: string
        }[]
      }
      welfare_check_rows: {
        Args: {
          p_from: string
          p_night_end?: string
          p_night_start?: string
          p_officer_id?: string
          p_period?: string
          p_shift_id?: string
          p_site_id?: string
          p_to: string
        }
        Returns: {
          acknowledged_at: string
          answered: boolean
          calls_made: number
          check_id: string
          due_at: string
          escalated: boolean
          is_night: boolean
          local_date: string
          local_time: string
          missed: boolean
          officer_id: string
          officer_name: string
          policy_name: string
          prompted_at: string
          resolution_notes: string
          resolved_at: string
          resolved_by_name: string
          responded_at: string
          response_flags: string[]
          response_seconds: number
          shift_id: string
          site_id: string
          site_name: string
          status: Database["public"]["Enums"]["welfare_check_status"]
        }[]
      }
      welfare_end_pause: {
        Args: {
          p_at: string
          p_by: string
          p_pause_id: string
          p_reason: string
        }
        Returns: {
          id: string
          officer_id: string
          paused_at: string
          paused_by: string | null
          paused_by_name: string | null
          reason: string
          resume_at: string | null
          resume_reason: string | null
          resumed_at: string | null
          resumed_by: string | null
          resumed_by_name: string | null
          shift_id: string
          site_id: string
        }
        SetofOptions: {
          from: "*"
          to: "welfare_pauses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      welfare_escalate: {
        Args: {
          p_check: Database["public"]["Tables"]["welfare_checks"]["Row"]
          p_now: string
          p_reason: string
        }
        Returns: number
      }
      welfare_interval_minutes: {
        Args: { p_at: string; p_policy_id: string }
        Returns: number[]
      }
      welfare_is_night: {
        Args: {
          p_at: string
          p_policy: Database["public"]["Tables"]["welfare_check_policies"]["Row"]
        }
        Returns: boolean
      }
      welfare_local_time: { Args: { p_at: string }; Returns: string }
      welfare_log: {
        Args: {
          p_at: string
          p_check_id: string
          p_data?: Json
          p_step: string
        }
        Returns: undefined
      }
      welfare_policy_for: {
        Args: { p_officer_id: string; p_site_id: string }
        Returns: {
          alarm_seconds: number
          call_attempts: number
          call_gap_seconds: number
          created_at: string
          enabled: boolean
          id: string
          max_interval_minutes: number
          min_interval_minutes: number
          name: string
          night_end: string | null
          night_max_interval_minutes: number | null
          night_min_interval_minutes: number | null
          night_start: string | null
          response_seconds: number
          supervisor_alert_after_seconds: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "welfare_check_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      welfare_policy_for_site: {
        Args: { p_site_id: string }
        Returns: {
          alarm_seconds: number
          call_attempts: number
          call_gap_seconds: number
          created_at: string
          enabled: boolean
          id: string
          max_interval_minutes: number
          min_interval_minutes: number
          name: string
          night_end: string | null
          night_max_interval_minutes: number | null
          night_min_interval_minutes: number | null
          night_start: string | null
          response_seconds: number
          supervisor_alert_after_seconds: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "welfare_check_policies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      welfare_report: {
        Args: {
          p_from: string
          p_group?: string
          p_night_end?: string
          p_night_start?: string
          p_officer_id?: string
          p_period?: string
          p_site_id?: string
          p_to: string
        }
        Returns: {
          answered: number
          answered_late: number
          avg_response_seconds: number
          escalated: number
          group_id: string
          group_name: string
          max_response_seconds: number
          missed: number
          prompted: number
        }[]
      }
      welfare_resume_due_pauses: { Args: never; Returns: number }
      welfare_run_escalation: {
        Args: { p_now?: string; p_request_delivery?: boolean }
        Returns: number
      }
      welfare_schedule_next: {
        Args: { p_from: string; p_shift_id: string }
        Returns: string
      }
      welfare_shift_paused: { Args: { p_shift_id: string }; Returns: boolean }
    }
    Enums: {
      attendance_type: "clock_in" | "clock_out"
      conversation_type: "direct" | "group"
      dar_entry_type:
        | "patrol"
        | "observation"
        | "visitor"
        | "handover"
        | "other"
      device_platform: "ios" | "android"
      employment_status: "active" | "suspended" | "terminated"
      form_field_type:
        | "text"
        | "multiline"
        | "number"
        | "date"
        | "checkbox"
        | "select"
        | "signature"
      form_submission_status: "draft" | "submitted" | "returned" | "approved"
      form_template_status: "draft" | "published" | "archived"
      incident_severity: "low" | "medium" | "high" | "critical"
      incident_status: "submitted" | "under_review" | "approved" | "returned"
      lesson_status: "draft" | "published" | "archived"
      pay_period_status: "open" | "locked"
      question_type: "single_choice" | "multiple_choice" | "true_false"
      shift_status:
        | "scheduled"
        | "acknowledged"
        | "in_progress"
        | "completed"
        | "missed"
        | "cancelled"
      show_answers_after: "never" | "after_pass" | "after_final_attempt"
      sos_status: "active" | "acknowledged" | "resolved" | "false_alarm"
      timesheet_status: "pending" | "approved"
      user_role: "admin" | "supervisor" | "officer"
      welfare_check_status:
        | "scheduled"
        | "prompted"
        | "responded"
        | "alarm"
        | "calling"
        | "escalated"
        | "resolved"
        | "cancelled"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      attendance_type: ["clock_in", "clock_out"],
      conversation_type: ["direct", "group"],
      dar_entry_type: ["patrol", "observation", "visitor", "handover", "other"],
      device_platform: ["ios", "android"],
      employment_status: ["active", "suspended", "terminated"],
      form_field_type: [
        "text",
        "multiline",
        "number",
        "date",
        "checkbox",
        "select",
        "signature",
      ],
      form_submission_status: ["draft", "submitted", "returned", "approved"],
      form_template_status: ["draft", "published", "archived"],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: ["submitted", "under_review", "approved", "returned"],
      lesson_status: ["draft", "published", "archived"],
      pay_period_status: ["open", "locked"],
      question_type: ["single_choice", "multiple_choice", "true_false"],
      shift_status: [
        "scheduled",
        "acknowledged",
        "in_progress",
        "completed",
        "missed",
        "cancelled",
      ],
      show_answers_after: ["never", "after_pass", "after_final_attempt"],
      sos_status: ["active", "acknowledged", "resolved", "false_alarm"],
      timesheet_status: ["pending", "approved"],
      user_role: ["admin", "supervisor", "officer"],
      welfare_check_status: [
        "scheduled",
        "prompted",
        "responded",
        "alarm",
        "calling",
        "escalated",
        "resolved",
        "cancelled",
      ],
    },
  },
} as const
