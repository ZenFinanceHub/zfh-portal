
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"client_id": string | null,"created_at": string,"entity": string,"entity_id": string | null,"id": number,"ip": string | null,"meta": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"client_id"?: string | null,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: never,"ip"?: string | null,"meta"?: NonNullable<Json>
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"client_id"?: string | null,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never,"ip"?: string | null,"meta"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"client_contacts": {
                  Row: {
                    "client_id": string,"created_at": string,"profile_id": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"profile_id": string,"role": string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"profile_id"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_contacts_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "client_contacts_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "assigned_to": string | null,"company_number": string | null,"created_at": string,"ended_at": string | null,"entity_type": string,"id": string,"name": string,"status": string,"utr": string | null,"xero_contact_id": string | null,"year_end": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"company_number"?: string | null,"created_at"?: string,"ended_at"?: string | null,"entity_type": string,"id"?: string,"name": string,"status"?: string,"utr"?: string | null,"xero_contact_id"?: string | null,"year_end"?: string | null
                  }
                  Update: {
                    "assigned_to"?: string | null,"company_number"?: string | null,"created_at"?: string,"ended_at"?: string | null,"entity_type"?: string,"id"?: string,"name"?: string,"status"?: string,"utr"?: string | null,"xero_contact_id"?: string | null,"year_end"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"connector_grants": {
                  Row: {
                    "approved_at": string,"client_id": string,"id": string,"revoked_at": string | null,"revoked_by": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string,"client_id": string,"id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"user_id": string
                  }
                  Update: {
                    "approved_at"?: string,"client_id"?: string,"id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connector_grants_revoked_by_fkey"
      columns: ["revoked_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "connector_grants_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"consents": {
                  Row: {
                    "client_id": string,"consent_type": string,"created_at": string,"id": string,"ip": string | null,"job_id": string | null,"profile_id": string,"recipient": string | null,"request_id": string | null,"user_agent": string | null,"wording_text": string,"wording_version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"consent_type": string,"created_at"?: string,"id"?: string,"ip"?: string | null,"job_id"?: string | null,"profile_id": string,"recipient"?: string | null,"request_id"?: string | null,"user_agent"?: string | null,"wording_text": string,"wording_version": string
                  }
                  Update: {
                    "client_id"?: string,"consent_type"?: string,"created_at"?: string,"id"?: string,"ip"?: string | null,"job_id"?: string | null,"profile_id"?: string,"recipient"?: string | null,"request_id"?: string | null,"user_agent"?: string | null,"wording_text"?: string,"wording_version"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "consents_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consents_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consents_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "consents_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    }
                  ]
                },"files": {
                  Row: {
                    "client_id": string,"created_at": string,"deleted_at": string | null,"deleted_by": string | null,"id": string,"job_id": string | null,"mime_type": string | null,"original_name": string,"request_id": string | null,"retain_until": string | null,"scan_attempts": number,"scan_retry": boolean,"scan_status": string,"scanned_at": string | null,"sha256": string | null,"size_bytes": number | null,"storage_path": string,"uploaded_by": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"job_id"?: string | null,"mime_type"?: string | null,"original_name": string,"request_id"?: string | null,"retain_until"?: string | null,"scan_attempts"?: number,"scan_retry"?: boolean,"scan_status"?: string,"scanned_at"?: string | null,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path": string,"uploaded_by"?: string,"visibility"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"deleted_by"?: string | null,"id"?: string,"job_id"?: string | null,"mime_type"?: string | null,"original_name"?: string,"request_id"?: string | null,"retain_until"?: string | null,"scan_attempts"?: number,"scan_retry"?: boolean,"scan_status"?: string,"scanned_at"?: string | null,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path"?: string,"uploaded_by"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_deleted_by_fkey"
      columns: ["deleted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "files_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"job_contacts": {
                  Row: {
                    "job_id": string,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "job_id": string,"profile_id": string
                  }
                  Update: {
                    "job_id"?: string,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_contacts_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_contacts_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "area": string,"assigned_to": string | null,"client_id": string,"created_at": string,"created_by": string | null,"due_date": string | null,"finance_stage": string | null,"id": string,"pending_blueprints": NonNullable<Json>,"period_end": string | null,"service": string,"stage": string,"template_id": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area"?: never,"assigned_to"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"finance_stage"?: string | null,"id"?: string,"pending_blueprints"?: NonNullable<Json>,"period_end"?: string | null,"service": string,"stage"?: string,"template_id"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "area"?: never,"assigned_to"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"finance_stage"?: string | null,"id"?: string,"pending_blueprints"?: NonNullable<Json>,"period_end"?: string | null,"service"?: string,"stage"?: string,"template_id"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_assigned_to_fkey"
      columns: ["assigned_to"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_template_id_fkey"
      columns: ["template_id"]
isOneToOne: false
      referencedRelation: "templates"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"internal": boolean,"job_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string,"body": string,"created_at"?: string,"id"?: string,"internal"?: boolean,"job_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"internal"?: boolean,"job_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"notification_settings": {
                  Row: {
                    "bank_holiday_region": string,"client_bundle_minutes": number,"digest_enabled": boolean,"digest_time": string,"fallback_email": string,"id": boolean,"quiet_end": string,"quiet_start": string,"reminder_days": (number)[],"reminders_enabled": boolean,"staff_batch_minutes": number,"updated_at": string,"updated_by": string | null,"urgent_approvals": boolean,"urgent_finance_activity": boolean,"urgent_lender_consents": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "bank_holiday_region"?: string,"client_bundle_minutes"?: number,"digest_enabled"?: boolean,"digest_time"?: string,"fallback_email"?: string,"id"?: boolean,"quiet_end"?: string,"quiet_start"?: string,"reminder_days"?: (number)[],"reminders_enabled"?: boolean,"staff_batch_minutes"?: number,"updated_at"?: string,"updated_by"?: string | null,"urgent_approvals"?: boolean,"urgent_finance_activity"?: boolean,"urgent_lender_consents"?: boolean
                  }
                  Update: {
                    "bank_holiday_region"?: string,"client_bundle_minutes"?: number,"digest_enabled"?: boolean,"digest_time"?: string,"fallback_email"?: string,"id"?: boolean,"quiet_end"?: string,"quiet_start"?: string,"reminder_days"?: (number)[],"reminders_enabled"?: boolean,"staff_batch_minutes"?: number,"updated_at"?: string,"updated_by"?: string | null,"urgent_approvals"?: boolean,"urgent_finance_activity"?: boolean,"urgent_lender_consents"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "notification_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications_log": {
                  Row: {
                    "attempts": number,"client_id": string | null,"created_at": string,"dedupe_key": string,"event_count": number,"id": number,"job_id": string | null,"kind": string,"last_error": string | null,"sent_at": string | null,"status": string,"updated_at": string,"window_end": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"client_id"?: string | null,"created_at"?: string,"dedupe_key": string,"event_count"?: number,"id"?: never,"job_id"?: string | null,"kind": string,"last_error"?: string | null,"sent_at"?: string | null,"status": string,"updated_at"?: string,"window_end"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"client_id"?: string | null,"created_at"?: string,"dedupe_key"?: string,"event_count"?: number,"id"?: never,"job_id"?: string | null,"kind"?: string,"last_error"?: string | null,"sent_at"?: string | null,"status"?: string,"updated_at"?: string,"window_end"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_log_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_log_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications_queue": {
                  Row: {
                    "audience": string,"client_id": string,"event": string,"id": number,"job_id": string,"occurred_at": string,"processed_at": string | null,"request_id": string | null,"request_kind": string | null,"state": string,"urgent_reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": string,"client_id": string,"event": string,"id"?: never,"job_id": string,"occurred_at"?: string,"processed_at"?: string | null,"request_id"?: string | null,"request_kind"?: string | null,"state"?: string,"urgent_reason"?: string | null
                  }
                  Update: {
                    "audience"?: string,"client_id"?: string,"event"?: string,"id"?: never,"job_id"?: string,"occurred_at"?: string,"processed_at"?: string | null,"request_id"?: string | null,"request_kind"?: string | null,"state"?: string,"urgent_reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_queue_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_queue_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_queue_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_settings": {
                  Row: {
                    "id": boolean,"privacy_notice_url": string | null,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"privacy_notice_url"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "id"?: boolean,"privacy_notice_url"?: string | null,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "portal_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"email_reminders": boolean,"full_name": string | null,"id": string,"is_staff": boolean,"phone": string | null,"staff_areas": (string)[],"staff_role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"email_reminders"?: boolean,"full_name"?: string | null,"id": string,"is_staff"?: boolean,"phone"?: string | null,"staff_areas"?: (string)[],"staff_role"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"email_reminders"?: boolean,"full_name"?: string | null,"id"?: string,"is_staff"?: boolean,"phone"?: string | null,"staff_areas"?: (string)[],"staff_role"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "hits": number,"key_hash": string,"scope": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "hits"?: number,"key_hash": string,"scope": string,"window_start": string
                  }
                  Update: {
                    "hits"?: number,"key_hash"?: string,"scope"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"requests": {
                  Row: {
                    "consent_type": string | null,"created_at": string,"created_by": string | null,"due_date": string | null,"help_text": string | null,"id": string,"job_id": string,"kind": string,"options": Json | null,"partner_firm": string | null,"question_type": string | null,"return_reason": string | null,"sort_order": number,"status": string,"submitted_at": string | null,"submitted_by": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_type"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"help_text"?: string | null,"id"?: string,"job_id": string,"kind": string,"options"?: Json | null,"partner_firm"?: string | null,"question_type"?: string | null,"return_reason"?: string | null,"sort_order"?: number,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"title": string
                  }
                  Update: {
                    "consent_type"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"help_text"?: string | null,"id"?: string,"job_id"?: string,"kind"?: string,"options"?: Json | null,"partner_firm"?: string | null,"question_type"?: string | null,"return_reason"?: string | null,"sort_order"?: number,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "requests_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requests_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requests_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"responses": {
                  Row: {
                    "answer": NonNullable<Json>,"author_id": string,"created_at": string,"id": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": NonNullable<Json>,"author_id"?: string,"created_at"?: string,"id"?: string,"request_id": string
                  }
                  Update: {
                    "answer"?: NonNullable<Json>,"author_id"?: string,"created_at"?: string,"id"?: string,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "responses_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "responses_request_id_fkey"
      columns: ["request_id"]
isOneToOne: false
      referencedRelation: "requests"
      referencedColumns: ["id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "active": boolean,"area": string,"created_at": string,"description": string | null,"id": string,"name": string,"requests": NonNullable<Json>,"service": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"area"?: never,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"requests"?: NonNullable<Json>,"service": string
                  }
                  Update: {
                    "active"?: boolean,"area"?: never,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"requests"?: NonNullable<Json>,"service"?: string
                  }
                  Relationships: [
                    
                  ]
                },"uk_bank_holidays": {
                  Row: {
                    "holiday_date": string,"name": string,"region": string
                  }
                  ComputedFields: never
                  Insert: {
                    "holiday_date": string,"name": string,"region": string
                  }
                  Update: {
                    "holiday_date"?: string,"name"?: string,"region"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_pending_request":
{ Args: { "p_due_date"?: string,"p_index": number,"p_job_id": string,"p_partner_firm"?: string }; Returns: string
                           },
"admin_audit":
{ Args: { "p_action"?: string,"p_actor"?: string,"p_area"?: string,"p_client"?: string,"p_from"?: string,"p_limit"?: number,"p_offset"?: number,"p_to"?: string }; Returns: {
              "action": string,"actor_id": string,"actor_name": string,"area": string,"client_id": string,"client_name": string,"created_at": string,"entity": string,"entity_id": string,"id": number,"ip": string,"meta": Json,"total": number
            }[]
                           },
"admin_client_audit":
{ Args: { "p_client": string }; Returns: {
              "action": string,
"actor_id": string | null,
"client_id": string | null,
"created_at": string,
"entity": string,
"entity_id": string | null,
"id": number,
"ip": string | null,
"meta": NonNullable<Json>
            }[]
                          SetofOptions: {
        from: "*"
        to: "audit_log"
        isOneToOne: false
        isSetofReturn: true
      } },
"area_of_service":
{ Args: { "p_service": string }; Returns: string
                           },
"attached_documents_ready":
{ Args: { "p_request_id": string }; Returns: boolean
                           },
"can_access_client":
{ Args: { "p_client_id": string }; Returns: boolean
                           },
"can_access_job":
{ Args: { "p_job_id": string }; Returns: boolean
                           },
"compute_file_retention":
{ Args: { "p_client_id": string,"p_created": string,"p_job_id": string }; Returns: string
                           },
"connector_add_note":
{ Args: { "p_body": string,"p_confirm"?: boolean,"p_job_id": string }; Returns: Json
                           },
"connector_add_requests":
{ Args: { "p_confirm"?: boolean,"p_job_id": string,"p_lender_text"?: string,"p_requests": Json }; Returns: Json
                           },
"connector_authorization_client":
{ Args: { "p_authorization_id": string }; Returns: string
                           },
"connector_check":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"connector_create_job":
{ Args: { "p_client_id": string,"p_confirm"?: boolean,"p_service": string,"p_template": string,"p_title": string }; Returns: Json
                           },
"connector_expire":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"connector_gate":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"connector_list_jobs":
{ Args: { "p_client_id": string,"p_open_only"?: boolean }; Returns: Json
                           },
"connector_outstanding":
{ Args: { "p_client_id"?: string,"p_job_id"?: string }; Returns: Json
                           },
"connector_rate_limit":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"connector_record_grant":
{ Args: { "p_client_id": string }; Returns: undefined
                           },
"connector_revoke_grant":
{ Args: { "p_grant_id": string }; Returns: undefined
                           },
"connector_search_clients":
{ Args: { "p_query": string }; Returns: Json
                           },
"connector_send_message":
{ Args: { "p_body": string,"p_confirm"?: boolean,"p_job_id": string }; Returns: Json
                           },
"create_job_from_template":
{ Args: { "p_assigned_to": string,"p_client_id": string,"p_contributors"?: (string)[],"p_due_date": string,"p_period_end": string,"p_service": string,"p_template_id": string,"p_title": string }; Returns: string
                           },
"discard_failed_upload":
{ Args: { "p_file_id": string }; Returns: undefined
                           },
"get_privacy_notice_url":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"insert_request_from_blueprint":
{ Args: { "b": Json,"p_due_date": string,"p_job_id": string,"p_sort": number }; Returns: string
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_client_owner":
{ Args: { "p_client_id": string }; Returns: boolean
                           },
"is_staff":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"log_audit_export":
{ Args: { "p_filters": Json,"p_rows": number }; Returns: undefined
                           },
"log_audit_export_failed":
{ Args: { "p_filters": Json }; Returns: undefined
                           },
"log_event":
{ Args: { "p_action": string,"p_client_id"?: string,"p_entity": string,"p_entity_id": string }; Returns: undefined
                           },
"rate_limit_magic_link":
{ Args: { "p_email": string,"p_ip": string }; Returns: Json
                           },
"rate_limit_mfa":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"record_consent":
{ Args: { "p_recipient"?: string,"p_request_id": string,"p_wording_text": string,"p_wording_version": string }; Returns: string
                           },
"request_ip":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"request_user_agent":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"set_privacy_notice_url":
{ Args: { "p_url": string }; Returns: undefined
                           },
"set_staff_areas":
{ Args: { "p_areas": (string)[],"p_profile_id": string }; Returns: undefined
                           },
"staff_can_access_area":
{ Args: { "p_area": string }; Returns: boolean
                           },
"staff_can_access_client":
{ Args: { "p_client_id": string }; Returns: boolean
                           },
"staff_can_access_job":
{ Args: { "p_job_id": string }; Returns: boolean
                           },
"staff_can_access_optional_job":
{ Args: { "p_job_id": string }; Returns: boolean
                           },
"staff_has_any_area":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"submit_request":
{ Args: { "p_request_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
