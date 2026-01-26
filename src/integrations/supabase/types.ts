export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      api_list: {
        Row: {
          id: number
          provider: string
          model: string | null
          api: string | null
          usage_count: number | null
          is_active: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: number
          provider: string
          model?: string | null
          api?: string | null
          usage_count?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: number
          provider?: string
          model?: string | null
          api?: string | null
          usage_count?: number | null
          is_active?: boolean | null
          created_at?: string | null
        }
      }
      payment_transactions: {
        Row: {
          id: string
          user_email: string
          amount: number
          method: string
          trx_id: string
          sender_number: string
          status: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          user_email: string
          amount: number
          method: string
          trx_id: string
          sender_number: string
          status?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          user_email?: string
          amount?: number
          method?: string
          trx_id?: string
          sender_number?: string
          status?: string | null
          created_at?: string | null
        }
      }
      app_users: {
        Row: {
          id: number
          key: string
          pas: string | null
        }
        Insert: {
          id?: never
          key: string
          pas?: string | null
        }
        Update: {
          id?: never
          key?: string
          pas?: string | null
        }
      }
      referral_codes: {
        Row: {
          id: string
          code: string
          type: string
          value: number
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          code: string
          type: string
          value: number
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          code?: string
          type?: string
          value?: number
          status?: string
          created_at?: string
        }
      }
      whatsapp_sessions: {
        Row: {
          id: string
          session_id: string
          session_name: string | null
          user_email: string | null
          user_id: string | null
          plan_days: number | null
          qr_code: string | null
          status: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          session_id: string
          session_name?: string | null
          user_email?: string | null
          user_id?: string | null
          plan_days?: number | null
          qr_code?: string | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          session_id?: string
          session_name?: string | null
          user_email?: string | null
          user_id?: string | null
          plan_days?: number | null
          qr_code?: string | null
          status?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      user_configs: {
        Row: {
          id: string
          user_id: string
          balance: number | null
          ai_provider: string | null
          api_key: string | null
          model_name: string | null
          system_prompt: string | null
          auto_reply: boolean | null
          ai_enabled: boolean | null
          media_enabled: boolean | null
          response_language: string | null
          response_tone: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          balance?: number | null
          ai_provider?: string | null
          api_key?: string | null
          model_name?: string | null
          system_prompt?: string | null
          auto_reply?: boolean | null
          ai_enabled?: boolean | null
          media_enabled?: boolean | null
          response_language?: string | null
          response_tone?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          balance?: number | null
          ai_provider?: string | null
          api_key?: string | null
          model_name?: string | null
          system_prompt?: string | null
          auto_reply?: boolean | null
          ai_enabled?: boolean | null
          media_enabled?: boolean | null
          response_language?: string | null
          response_tone?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
      }
      wpp_debounce: {
        Row: {
          id: string
          debounce_key: string
          last_message_at: string | null
          is_processing: boolean | null
        }
        Insert: {
          id?: string
          debounce_key: string
          last_message_at?: string | null
          is_processing?: boolean | null
        }
        Update: {
          id?: string
          debounce_key?: string
          last_message_at?: string | null
          is_processing?: boolean | null
        }
      }
      fb_message_database: {
        Row: {
          id: number
          reply_message: boolean
          swipe_reply: boolean
          image_detection: boolean
          image_send: boolean
          template: boolean
          order_tracking: boolean
          text_prompt: string | null
          image_prompt: string | null
          template_prompt_x1: string | null
          template_prompt_x2: string | null
          page_id: string | null
          verified: boolean | null
        }
        Insert: {
          id: number
          reply_message?: boolean
          swipe_reply?: boolean
          image_detection?: boolean
          image_send?: boolean
          template?: boolean
          order_tracking?: boolean
          text_prompt?: string | null
          image_prompt?: string | null
          template_prompt_x1?: string | null
          template_prompt_x2?: string | null
          page_id?: string | null
          verified?: boolean | null
        }
        Update: {
          id?: number
          reply_message?: boolean
          swipe_reply?: boolean
          image_detection?: boolean
          image_send?: boolean
          template?: boolean
          order_tracking?: boolean
          text_prompt?: string | null
          image_prompt?: string | null
          template_prompt_x1?: string | null
          template_prompt_x2?: string | null
          page_id?: string | null
          verified?: boolean | null
        }
      }
      page_access_token_message: {
        Row: {
          name: string
          page_id: string
          data_sheet: string | null
          page_access_token: string | null
          secret_key: string | null
          found_id: string | null
          subscription_plan: string | null
          subscription_expiry: string | null
          subscription_status: string | null
          api_key: string | null
          chat_model: string | null
          ai: string | null
          email: string | null
        }
        Insert: {
          name: string
          page_id: string
          data_sheet?: string | null
          page_access_token?: string | null
          secret_key?: string | null
          found_id?: string | null
          subscription_plan?: string | null
          subscription_expiry?: string | null
          subscription_status?: string | null
          api_key?: string | null
          chat_model?: string | null
          ai?: string | null
          email?: string | null
        }
        Update: {
          name?: string
          page_id?: string
          data_sheet?: string | null
          page_access_token?: string | null
          secret_key?: string | null
          found_id?: string | null
          subscription_plan?: string | null
          subscription_expiry?: string | null
          subscription_status?: string | null
          api_key?: string | null
          chat_model?: string | null
          ai?: string | null
          email?: string | null
        }
      }
      fb_order_tracking: {
        Row: {
          id: number
          product_name: string | null
          number: number | null
          location: string | null
          product_quantity: string | null
          price: string | null
          created_at: string
        }
        Insert: {
          id?: number
          product_name?: string | null
          number?: number | null
          location?: string | null
          product_quantity?: string | null
          price?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          product_name?: string | null
          number?: number | null
          location?: string | null
          product_quantity?: string | null
          price?: string | null
          created_at?: string
        }
      }
      wp_chats: {
        Row: {
          id: number
          sender_id: string | null
          page_id: string | null
          message_id: string | null
          text: string | null
          timestamp: string | null
          status: string | null
          response: string | null
          media_type: string | null
          media_url: string | null
        }
        Insert: {
          id?: number
          sender_id?: string | null
          page_id?: string | null
          message_id?: string | null
          text?: string | null
          timestamp?: string | null
          status?: string | null
          response?: string | null
          media_type?: string | null
          media_url?: string | null
        }
        Update: {
          id?: number
          sender_id?: string | null
          page_id?: string | null
          message_id?: string | null
          text?: string | null
          timestamp?: string | null
          status?: string | null
          response?: string | null
          media_type?: string | null
          media_url?: string | null
        }
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
