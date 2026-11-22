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
      settings: {
        Row: {
          early_clock_in_minutes: number
          id: boolean
          late_grace_minutes: number
          low_accuracy_threshold_m: number
          time_zone: string
          updated_at: string
        }
        Insert: {
          early_clock_in_minutes?: number
          id?: boolean
          late_grace_minutes?: number
          low_accuracy_threshold_m?: number
          time_zone?: string
          updated_at?: string
        }
        Update: {
          early_clock_in_minutes?: number
          id?: boolean
          late_grace_minutes?: number
          low_accuracy_threshold_m?: number
          time_zone?: string
          updated_at?: string
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      user_devices: {
        Row: {
          device_id: string
          id: string
          last_seen_at: string
          platform: Database["public"]["Enums"]["device_platform"]
          push_token: string | null
          registered_at: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          device_id: string
          id?: string
          last_seen_at?: string
          platform: Database["public"]["Enums"]["device_platform"]
          push_token?: string | null
          registered_at?: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          device_id?: string
          id?: string
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
      active_admin_ids: { Args: never; Returns: string[] }
      active_supervisor_ids: { Args: { p_except?: string }; Returns: string[] }
      approve_timesheet_entries: {
        Args: { p_entry_ids: string[] }
        Returns: number
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
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
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      distance_m: {
        Args: { lat1: number; lat2: number; lng1: number; lng2: number }
        Returns: number
      }
      format_shift_time: {
        Args: { p_ends_at: string; p_starts_at: string }
        Returns: string
      }
      is_active_user: { Args: never; Returns: boolean }
      is_locked_date: { Args: { p_date: string }; Returns: boolean }
      is_valid_time_zone: { Args: { p_name: string }; Returns: boolean }
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
      mark_missed_shifts: { Args: never; Returns: number }
      notify_expiring_licences: { Args: never; Returns: number }
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
      post_orders_pending: {
        Args: { p_at?: string; p_officer_id: string; p_site_id: string }
        Returns: number
      }
      request_push_delivery: {
        Args: { p_notification_ids?: string[] }
        Returns: undefined
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
    }
    Enums: {
      attendance_type: "clock_in" | "clock_out"
      dar_entry_type:
        | "patrol"
        | "observation"
        | "visitor"
        | "handover"
        | "other"
      device_platform: "ios" | "android"
      employment_status: "active" | "suspended" | "terminated"
      incident_severity: "low" | "medium" | "high" | "critical"
      incident_status: "submitted" | "under_review" | "approved" | "returned"
      pay_period_status: "open" | "locked"
      shift_status:
        | "scheduled"
        | "acknowledged"
        | "in_progress"
        | "completed"
        | "missed"
        | "cancelled"
      timesheet_status: "pending" | "approved"
      user_role: "admin" | "supervisor" | "officer"
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
      dar_entry_type: ["patrol", "observation", "visitor", "handover", "other"],
      device_platform: ["ios", "android"],
      employment_status: ["active", "suspended", "terminated"],
      incident_severity: ["low", "medium", "high", "critical"],
      incident_status: ["submitted", "under_review", "approved", "returned"],
      pay_period_status: ["open", "locked"],
      shift_status: [
        "scheduled",
        "acknowledged",
        "in_progress",
        "completed",
        "missed",
        "cancelled",
      ],
      timesheet_status: ["pending", "approved"],
      user_role: ["admin", "supervisor", "officer"],
    },
  },
} as const
