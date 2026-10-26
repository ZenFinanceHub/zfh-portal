
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
                    "client_id": string,"created_at": string,"id": string,"job_id": string | null,"mime_type": string | null,"original_name": string,"request_id": string | null,"retain_until": string | null,"scan_status": string,"sha256": string | null,"size_bytes": number | null,"storage_path": string,"uploaded_by": string,"visibility": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_id": string,"created_at"?: string,"id"?: string,"job_id"?: string | null,"mime_type"?: string | null,"original_name": string,"request_id"?: string | null,"retain_until"?: string | null,"scan_status"?: string,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path": string,"uploaded_by"?: string,"visibility"?: string
                  }
                  Update: {
                    "client_id"?: string,"created_at"?: string,"id"?: string,"job_id"?: string | null,"mime_type"?: string | null,"original_name"?: string,"request_id"?: string | null,"retain_until"?: string | null,"scan_status"?: string,"sha256"?: string | null,"size_bytes"?: number | null,"storage_path"?: string,"uploaded_by"?: string,"visibility"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "files_client_id_fkey"
      columns: ["client_id"]
isOneToOne: false
      referencedRelation: "clients"
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
                    "assigned_to": string | null,"client_id": string,"created_at": string,"created_by": string | null,"due_date": string | null,"finance_stage": string | null,"id": string,"pending_blueprints": NonNullable<Json>,"period_end": string | null,"service": string,"stage": string,"template_id": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"client_id": string,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"finance_stage"?: string | null,"id"?: string,"pending_blueprints"?: NonNullable<Json>,"period_end"?: string | null,"service": string,"stage"?: string,"template_id"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"client_id"?: string,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"finance_stage"?: string | null,"id"?: string,"pending_blueprints"?: NonNullable<Json>,"period_end"?: string | null,"service"?: string,"stage"?: string,"template_id"?: string | null,"title"?: string,"updated_at"?: string
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
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"id": string,"is_staff": boolean,"phone": string | null,"staff_role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"is_staff"?: boolean,"phone"?: string | null,"staff_role"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"is_staff"?: boolean,"phone"?: string | null,"staff_role"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"requests": {
                  Row: {
                    "consent_type": string | null,"created_at": string,"created_by": string | null,"due_date": string | null,"help_text": string | null,"id": string,"job_id": string,"kind": string,"options": Json | null,"question_type": string | null,"return_reason": string | null,"sort_order": number,"status": string,"submitted_at": string | null,"submitted_by": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consent_type"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"help_text"?: string | null,"id"?: string,"job_id": string,"kind": string,"options"?: Json | null,"question_type"?: string | null,"return_reason"?: string | null,"sort_order"?: number,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"title": string
                  }
                  Update: {
                    "consent_type"?: string | null,"created_at"?: string,"created_by"?: string | null,"due_date"?: string | null,"help_text"?: string | null,"id"?: string,"job_id"?: string,"kind"?: string,"options"?: Json | null,"question_type"?: string | null,"return_reason"?: string | null,"sort_order"?: number,"status"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"title"?: string
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
                    "active": boolean,"created_at": string,"description": string | null,"id": string,"name": string,"requests": NonNullable<Json>,"service": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"requests"?: NonNullable<Json>,"service": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"requests"?: NonNullable<Json>,"service"?: string
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
{ Args: { "p_due_date"?: string,"p_index": number,"p_job_id": string }; Returns: string
                           },
"can_access_client":
{ Args: { "p_client_id": string }; Returns: boolean
                           },
"can_access_job":
{ Args: { "p_job_id": string }; Returns: boolean
                           },
"create_job_from_template":
{ Args: { "p_assigned_to": string,"p_client_id": string,"p_contributors"?: (string)[],"p_due_date": string,"p_period_end": string,"p_service": string,"p_template_id": string,"p_title": string }; Returns: string
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
"log_event":
{ Args: { "p_action": string,"p_client_id"?: string,"p_entity": string,"p_entity_id": string }; Returns: undefined
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
