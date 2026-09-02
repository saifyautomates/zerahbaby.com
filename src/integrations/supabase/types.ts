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
    PostgrestVersion: "14.5"
  }
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
      admin_allowlist: {
        Row: {
          added_by: string | null
          created_at: string
          email: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          email: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      admin_order_deletion_logs: {
        Row: {
          cancellation_reason: string | null
          customer_email: string | null
          customer_name: string | null
          deleted_at: string
          deleted_by: string
          id: string
          order_id: string
          order_number: string | null
          total: number | null
          user_id: string | null
        }
        Insert: {
          cancellation_reason?: string | null
          customer_email?: string | null
          customer_name?: string | null
          deleted_at?: string
          deleted_by: string
          id?: string
          order_id: string
          order_number?: string | null
          total?: number | null
          user_id?: string | null
        }
        Update: {
          cancellation_reason?: string | null
          customer_email?: string | null
          customer_name?: string | null
          deleted_at?: string
          deleted_by?: string
          id?: string
          order_id?: string
          order_number?: string | null
          total?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          metadata: Json | null
          order_id: string | null
          product_id: string | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          product_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json | null
          order_id?: string | null
          product_id?: string | null
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      brands: {
        Row: {
          active: boolean
          created_at: string
          description: string
          id: string
          logo_url: string | null
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          price_at_add: number
          product_id: string
          quantity: number
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          price_at_add?: number
          product_id: string
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          price_at_add?: number
          product_id?: string
          quantity?: number
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          id: string
          session_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          session_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          description: string
          display_order: number
          id: string
          image_url: string | null
          name: string
          parent_id: string | null
          slug: string
          sort_order: number
          tagline: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          image_url?: string | null
          name: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          tagline?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string
          display_order?: number
          id?: string
          image_url?: string | null
          name?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          tagline?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          admin_notes: string | null
          created_at: string
          email: string
          handled: boolean
          id: string
          idempotency_key: string | null
          message: string
          name: string
          order_number: string | null
          phone: string | null
          priority: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          email: string
          handled?: boolean
          id?: string
          idempotency_key?: string | null
          message: string
          name: string
          order_number?: string | null
          phone?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          email?: string
          handled?: boolean
          id?: string
          idempotency_key?: string | null
          message?: string
          name?: string
          order_number?: string | null
          phone?: string | null
          priority?: string
          resolved_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      coupon_usage: {
        Row: {
          coupon_id: string
          created_at: string
          id: string
          order_id: string | null
          user_id: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          id?: string
          order_id?: string | null
          user_id: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          id?: string
          order_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_usage_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_usage_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          expires_at: string | null
          id: string
          maximum_discount: number
          minimum_order_value: number
          per_user_limit: number
          starts_at: string | null
          usage_count: number
          usage_limit: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          expires_at?: string | null
          id?: string
          maximum_discount?: number
          minimum_order_value?: number
          per_user_limit?: number
          starts_at?: string | null
          usage_count?: number
          usage_limit?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          expires_at?: string | null
          id?: string
          maximum_discount?: number
          minimum_order_value?: number
          per_user_limit?: number
          starts_at?: string | null
          usage_count?: number
          usage_limit?: number
        }
        Relationships: []
      }
      inventory_transactions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          new_quantity: number | null
          note: string
          previous_quantity: number | null
          product_id: string
          quantity: number
          reference_id: string | null
          reference_type: string
          type: Database["public"]["Enums"]["inventory_tx_type"]
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_quantity?: number | null
          note?: string
          previous_quantity?: number | null
          product_id: string
          quantity: number
          reference_id?: string | null
          reference_type?: string
          type: Database["public"]["Enums"]["inventory_tx_type"]
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          new_quantity?: number | null
          note?: string
          previous_quantity?: number | null
          product_id?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string
          type?: Database["public"]["Enums"]["inventory_tx_type"]
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_return_items: {
        Row: {
          barcode: string
          created_at: string
          id: string
          mrp_snapshot: number
          name: string
          original_sale_item_id: string | null
          product_id: string | null
          product_slug: string
          qty: number
          refund_price: number
          return_id: string
          sku: string
          subtotal: number
          unit_mrp: number | null
          variant_id: string | null
          variant_info: string
        }
        Insert: {
          barcode?: string
          created_at?: string
          id?: string
          mrp_snapshot?: number
          name?: string
          original_sale_item_id?: string | null
          product_id?: string | null
          product_slug?: string
          qty?: number
          refund_price?: number
          return_id: string
          sku?: string
          subtotal?: number
          unit_mrp?: number | null
          variant_id?: string | null
          variant_info?: string
        }
        Update: {
          barcode?: string
          created_at?: string
          id?: string
          mrp_snapshot?: number
          name?: string
          original_sale_item_id?: string | null
          product_id?: string | null
          product_slug?: string
          qty?: number
          refund_price?: number
          return_id?: string
          sku?: string
          subtotal?: number
          unit_mrp?: number | null
          variant_id?: string | null
          variant_info?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_return_items_original_sale_item_id_fkey"
            columns: ["original_sale_item_id"]
            isOneToOne: false
            referencedRelation: "offline_sale_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "offline_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_returns: {
        Row: {
          created_at: string
          created_by: string | null
          credit_balance: number
          credit_token: string | null
          credit_used: number
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          id: string
          idempotency_key: string | null
          linked_sale_id: string | null
          notes: string
          original_sale_id: string | null
          original_sale_number: string | null
          owner_notification_status: string | null
          owner_notified_at: string | null
          refund_amount: number
          refund_method: string
          refund_status: string
          return_number: string
          return_reason: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credit_balance?: number
          credit_token?: string | null
          credit_used?: number
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          idempotency_key?: string | null
          linked_sale_id?: string | null
          notes?: string
          original_sale_id?: string | null
          original_sale_number?: string | null
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          refund_amount?: number
          refund_method?: string
          refund_status?: string
          return_number: string
          return_reason?: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credit_balance?: number
          credit_token?: string | null
          credit_used?: number
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          id?: string
          idempotency_key?: string | null
          linked_sale_id?: string | null
          notes?: string
          original_sale_id?: string | null
          original_sale_number?: string | null
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          refund_amount?: number
          refund_method?: string
          refund_status?: string
          return_number?: string
          return_reason?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_returns_linked_sale_id_fkey"
            columns: ["linked_sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_returns_original_sale_id_fkey"
            columns: ["original_sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sale_items: {
        Row: {
          barcode: string | null
          barcode_snapshot: string
          buying_price: number
          color: string | null
          created_at: string
          id: string
          mrp_snapshot: number
          name: string
          price: number
          product_id: string | null
          product_slug: string
          qty: number
          sale_id: string
          size: string | null
          sku: string
          subtotal: number
          variant_info: string
        }
        Insert: {
          barcode?: string | null
          barcode_snapshot?: string
          buying_price?: number
          color?: string | null
          created_at?: string
          id?: string
          mrp_snapshot?: number
          name: string
          price?: number
          product_id?: string | null
          product_slug: string
          qty?: number
          sale_id: string
          size?: string | null
          sku?: string
          subtotal?: number
          variant_info?: string
        }
        Update: {
          barcode?: string | null
          barcode_snapshot?: string
          buying_price?: number
          color?: string | null
          created_at?: string
          id?: string
          mrp_snapshot?: number
          name?: string
          price?: number
          product_id?: string | null
          product_slug?: string
          qty?: number
          sale_id?: string
          size?: string | null
          sku?: string
          subtotal?: number
          variant_info?: string
        }
        Relationships: [
          {
            foreignKeyName: "offline_sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_sales: {
        Row: {
          coupon_code: string | null
          coupon_discount: number | null
          created_at: string
          created_by: string | null
          credit_token_used: string | null
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          discount: number
          discount_type: string
          discount_value: number
          id: string
          idempotency_key: string | null
          is_voided: boolean | null
          notes: string
          owner_notification_status: string | null
          owner_notified_at: string | null
          payment_method: string
          pos_token_date: string | null
          pos_token_number: number | null
          return_status: string
          returned_amount: number
          returned_units: number
          sale_number: string
          status: string
          store_credit_used: number
          subtotal: number
          total: number
          updated_at: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          coupon_code?: string | null
          coupon_discount?: number | null
          created_at?: string
          created_by?: string | null
          credit_token_used?: string | null
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          discount?: number
          discount_type?: string
          discount_value?: number
          id?: string
          idempotency_key?: string | null
          is_voided?: boolean | null
          notes?: string
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          payment_method?: string
          pos_token_date?: string | null
          pos_token_number?: number | null
          return_status?: string
          returned_amount?: number
          returned_units?: number
          sale_number?: string
          status?: string
          store_credit_used?: number
          subtotal?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          coupon_code?: string | null
          coupon_discount?: number | null
          created_at?: string
          created_by?: string | null
          credit_token_used?: string | null
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          discount?: number
          discount_type?: string
          discount_value?: number
          id?: string
          idempotency_key?: string | null
          is_voided?: boolean | null
          notes?: string
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          payment_method?: string
          pos_token_date?: string | null
          pos_token_number?: number | null
          return_status?: string
          returned_amount?: number
          returned_units?: number
          sale_number?: string
          status?: string
          store_credit_used?: number
          subtotal?: number
          total?: number
          updated_at?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "offline_sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
        ]
      }
      online_return_events: {
        Row: {
          actor_id: string | null
          actor_role: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          new_status: string | null
          note: string
          old_status: string | null
          return_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          note?: string
          old_status?: string | null
          return_id: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          new_status?: string | null
          note?: string
          old_status?: string | null
          return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_return_events_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "online_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      online_return_items: {
        Row: {
          allocated_discount: number
          color_snapshot: string | null
          created_at: string
          historical_paid_amount: number
          historical_unit_price: number
          id: string
          image_snapshot: string | null
          inventory_restored: boolean
          item_refund_amount: number
          order_item_id: string
          product_id: string | null
          product_name_snapshot: string
          product_slug: string
          qc_note: string | null
          qc_status: string
          quantity_approved: number
          quantity_received: number
          quantity_requested: number
          return_id: string
          size_snapshot: string | null
          sku_snapshot: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          allocated_discount?: number
          color_snapshot?: string | null
          created_at?: string
          historical_paid_amount?: number
          historical_unit_price?: number
          id?: string
          image_snapshot?: string | null
          inventory_restored?: boolean
          item_refund_amount?: number
          order_item_id: string
          product_id?: string | null
          product_name_snapshot?: string
          product_slug?: string
          qc_note?: string | null
          qc_status?: string
          quantity_approved?: number
          quantity_received?: number
          quantity_requested: number
          return_id: string
          size_snapshot?: string | null
          sku_snapshot?: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          allocated_discount?: number
          color_snapshot?: string | null
          created_at?: string
          historical_paid_amount?: number
          historical_unit_price?: number
          id?: string
          image_snapshot?: string | null
          inventory_restored?: boolean
          item_refund_amount?: number
          order_item_id?: string
          product_id?: string | null
          product_name_snapshot?: string
          product_slug?: string
          qc_note?: string | null
          qc_status?: string
          quantity_approved?: number
          quantity_received?: number
          quantity_requested?: number
          return_id?: string
          size_snapshot?: string | null
          sku_snapshot?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "online_return_items_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "online_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "online_return_items_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      online_returns: {
        Row: {
          admin_note: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_note: string | null
          eligible_refund_amount: number
          final_refund_amount: number
          id: string
          idempotency_key: string | null
          order_id: string
          pickup_scheduled_at: string | null
          qc_completed_at: string | null
          qc_summary: string | null
          razorpay_refund_id: string | null
          razorpay_refund_status: string | null
          reason_category: string
          reason_label: string
          received_at: string | null
          refund_calculation_snapshot: Json
          refund_completed_at: string | null
          refund_initiated_at: string | null
          refund_status: string
          return_number: string
          return_shipping_fee: number
          return_status: string
          shiprocket_return_awb: string | null
          shiprocket_return_courier: string | null
          shiprocket_return_order_id: number | null
          shiprocket_return_shipment_id: number | null
          shiprocket_return_status: string | null
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_note?: string | null
          eligible_refund_amount?: number
          final_refund_amount?: number
          id?: string
          idempotency_key?: string | null
          order_id: string
          pickup_scheduled_at?: string | null
          qc_completed_at?: string | null
          qc_summary?: string | null
          razorpay_refund_id?: string | null
          razorpay_refund_status?: string | null
          reason_category: string
          reason_label: string
          received_at?: string | null
          refund_calculation_snapshot?: Json
          refund_completed_at?: string | null
          refund_initiated_at?: string | null
          refund_status?: string
          return_number: string
          return_shipping_fee?: number
          return_status?: string
          shiprocket_return_awb?: string | null
          shiprocket_return_courier?: string | null
          shiprocket_return_order_id?: number | null
          shiprocket_return_shipment_id?: number | null
          shiprocket_return_status?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_note?: string | null
          eligible_refund_amount?: number
          final_refund_amount?: number
          id?: string
          idempotency_key?: string | null
          order_id?: string
          pickup_scheduled_at?: string | null
          qc_completed_at?: string | null
          qc_summary?: string | null
          razorpay_refund_id?: string | null
          razorpay_refund_status?: string | null
          reason_category?: string
          reason_label?: string
          received_at?: string | null
          refund_calculation_snapshot?: Json
          refund_completed_at?: string | null
          refund_initiated_at?: string | null
          refund_status?: string
          return_number?: string
          return_shipping_fee?: number
          return_status?: string
          shiprocket_return_awb?: string | null
          shiprocket_return_courier?: string | null
          shiprocket_return_order_id?: number | null
          shiprocket_return_shipment_id?: number | null
          shiprocket_return_status?: string | null
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "online_returns_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      open_box_events: {
        Row: {
          actor_id: string | null
          created_at: string
          decision: string
          id: string
          linked_return_id: string | null
          metadata: Json | null
          order_id: string
          rejection_notes: string | null
          rejection_reason: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          decision: string
          id?: string
          linked_return_id?: string | null
          metadata?: Json | null
          order_id: string
          rejection_notes?: string | null
          rejection_reason?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          decision?: string
          id?: string
          linked_return_id?: string | null
          metadata?: Json | null
          order_id?: string
          rejection_notes?: string | null
          rejection_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "open_box_events_linked_return_id_fkey"
            columns: ["linked_return_id"]
            isOneToOne: false
            referencedRelation: "online_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "open_box_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          barcode_snapshot: string | null
          buying_price: number
          color: string | null
          created_at: string
          id: string
          image_url: string | null
          image_url_snapshot: string | null
          name: string
          order_id: string
          price: number
          product_id: string | null
          product_name_snapshot: string
          product_slug: string
          qty: number
          size: string | null
          sku_snapshot: string
          subtotal: number
          variant_id: string | null
        }
        Insert: {
          barcode_snapshot?: string | null
          buying_price?: number
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_url_snapshot?: string | null
          name?: string
          order_id: string
          price?: number
          product_id?: string | null
          product_name_snapshot?: string
          product_slug?: string
          qty?: number
          size?: string | null
          sku_snapshot?: string
          subtotal?: number
          variant_id?: string | null
        }
        Update: {
          barcode_snapshot?: string | null
          buying_price?: number
          color?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          image_url_snapshot?: string | null
          name?: string
          order_id?: string
          price?: number
          product_id?: string | null
          product_name_snapshot?: string
          product_slug?: string
          qty?: number
          size?: string | null
          sku_snapshot?: string
          subtotal?: number
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_status: string
          note: string
          old_status: string | null
          order_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status: string
          note?: string
          old_status?: string | null
          order_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_status?: string
          note?: string
          old_status?: string | null
          order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          address: string
          address_line2: string
          alt_phone: string
          awb_code: string | null
          billing_address_snapshot: Json | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          city: string
          coupon_code: string | null
          courier_name: string | null
          created_at: string
          currency: string
          customer_phone: string
          discount: number
          email: string
          fulfillment_status: Database["public"]["Enums"]["fulfillment_status"]
          full_name: string
          id: string
          idempotency_key: string | null
          invoice_no: string | null
          landmark: string
          notes: string
          open_box_eligible: boolean | null
          open_box_inspected_at: string | null
          open_box_notes: string | null
          open_box_status: string | null
          order_number: string | null
          owner_notification_status: string | null
          owner_notified_at: string | null
          payment_method: string
          payment_status: Database["public"]["Enums"]["payment_status"]
          phone: string
          pincode: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          shipping: number
          shipping_address_snapshot: Json | null
          shipping_fee: number
          shiprocket_order_id: number | null
          shiprocket_shipment_id: number | null
          shiprocket_status: string | null
          state: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          tax: number
          total: number
          tracking_number: string | null
          tracking_url: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string
          address_line2?: string
          alt_phone?: string
          awb_code?: string | null
          billing_address_snapshot?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          city?: string
          coupon_code?: string | null
          courier_name?: string | null
          created_at?: string
          currency?: string
          customer_phone?: string
          discount?: number
          email?: string
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          full_name?: string
          id?: string
          idempotency_key?: string | null
          invoice_no?: string | null
          landmark?: string
          notes?: string
          open_box_eligible?: boolean | null
          open_box_inspected_at?: string | null
          open_box_notes?: string | null
          open_box_status?: string | null
          order_number?: string | null
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          payment_method?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone?: string
          pincode?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          shipping?: number
          shipping_address_snapshot?: Json | null
          shipping_fee?: number
          shiprocket_order_id?: number | null
          shiprocket_shipment_id?: number | null
          shiprocket_status?: string | null
          state?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          address_line2?: string
          alt_phone?: string
          awb_code?: string | null
          billing_address_snapshot?: Json | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          city?: string
          coupon_code?: string | null
          courier_name?: string | null
          created_at?: string
          currency?: string
          customer_phone?: string
          discount?: number
          email?: string
          fulfillment_status?: Database["public"]["Enums"]["fulfillment_status"]
          full_name?: string
          id?: string
          idempotency_key?: string | null
          invoice_no?: string | null
          landmark?: string
          notes?: string
          open_box_eligible?: boolean | null
          open_box_inspected_at?: string | null
          open_box_notes?: string | null
          open_box_status?: string | null
          order_number?: string | null
          owner_notification_status?: string | null
          owner_notified_at?: string | null
          payment_method?: string
          payment_status?: Database["public"]["Enums"]["payment_status"]
          phone?: string
          pincode?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          shipping?: number
          shipping_address_snapshot?: Json | null
          shipping_fee?: number
          shiprocket_order_id?: number | null
          shiprocket_shipment_id?: number | null
          shiprocket_status?: string | null
          state?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          tax?: number
          total?: number
          tracking_number?: string | null
          tracking_url?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      owner_notification_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          event_type: string
          id: string
          provider: string | null
          provider_message_id: string | null
          recipient: string
          reference_id: string | null
          reference_number: string | null
          sent_at: string | null
          status: string
          total: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient: string
          reference_id?: string | null
          reference_number?: string | null
          sent_at?: string | null
          status?: string
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          provider?: string | null
          provider_message_id?: string | null
          recipient?: string
          reference_id?: string | null
          reference_number?: string | null
          sent_at?: string | null
          status?: string
          total?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          metadata: Json | null
          method: string
          order_id: string
          order_reference: string | null
          payment_id: string | null
          provider: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          method?: string
          order_id: string
          order_reference?: string | null
          payment_id?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          metadata?: Json | null
          method?: string
          order_id?: string
          order_reference?: string | null
          payment_id?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_customers: {
        Row: {
          created_at: string
          email: string
          id: string
          name: string
          notes: string
          phone: string
          store_credit_balance: number
          total_purchases: number
          total_spend: number
          total_spent: number | null
          total_visits: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          store_credit_balance?: number
          total_purchases?: number
          total_spend?: number
          total_spent?: number | null
          total_visits?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          name?: string
          notes?: string
          phone?: string
          store_credit_balance?: number
          total_purchases?: number
          total_spend?: number
          total_spent?: number | null
          total_visits?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      pos_daily_token_seq: {
        Row: {
          last_token: number
          token_date: string
        }
        Insert: {
          last_token?: number
          token_date: string
        }
        Update: {
          last_token?: number
          token_date?: string
        }
        Relationships: []
      }
      product_costs: {
        Row: {
          buying_price: number
          created_at: string
          product_id: string
          updated_at: string
        }
        Insert: {
          buying_price?: number
          created_at?: string
          product_id: string
          updated_at?: string
        }
        Update: {
          buying_price?: number
          created_at?: string
          product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_images: {
        Row: {
          alt_text: string
          color: string | null
          created_at: string
          id: string
          is_primary: boolean
          product_id: string
          public_url: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          alt_text?: string
          color?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id: string
          public_url?: string
          sort_order?: number
          storage_path?: string
        }
        Update: {
          alt_text?: string
          color?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          product_id?: string
          public_url?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_images_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_relations: {
        Row: {
          created_at: string
          id: string
          product_1_id: string
          product_2_id: string
          sort_order_1: number
          sort_order_2: number
        }
        Insert: {
          created_at?: string
          id?: string
          product_1_id: string
          product_2_id: string
          sort_order_1?: number
          sort_order_2?: number
        }
        Update: {
          created_at?: string
          id?: string
          product_1_id?: string
          product_2_id?: string
          sort_order_1?: number
          sort_order_2?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_relations_product_1_id_fkey"
            columns: ["product_1_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_relations_product_2_id_fkey"
            columns: ["product_2_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          barcode: string | null
          color: string | null
          conflict_reconciliation_needed: boolean | null
          created_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          mrp_override: number | null
          name: string
          price_override: number | null
          product_id: string | null
          size: string | null
          sku: string | null
          stock: number
          updated_at: string | null
        }
        Insert: {
          barcode?: string | null
          color?: string | null
          conflict_reconciliation_needed?: boolean | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          mrp_override?: number | null
          name: string
          price_override?: number | null
          product_id?: string | null
          size?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string | null
        }
        Update: {
          barcode?: string | null
          color?: string | null
          conflict_reconciliation_needed?: boolean | null
          created_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          mrp_override?: number | null
          name?: string
          price_override?: number | null
          product_id?: string | null
          size?: string | null
          sku?: string | null
          stock?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_videos: {
        Row: {
          created_at: string
          duration: number
          id: string
          product_id: string
          sort_order: number
          storage_path: string
          thumbnail_url: string
          title: string
          video_url: string
        }
        Insert: {
          created_at?: string
          duration?: number
          id?: string
          product_id: string
          sort_order?: number
          storage_path?: string
          thumbnail_url?: string
          title?: string
          video_url?: string
        }
        Update: {
          created_at?: string
          duration?: number
          id?: string
          product_id?: string
          sort_order?: number
          storage_path?: string
          thumbnail_url?: string
          title?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_videos_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          age_group: string
          barcode: string | null
          bestseller: boolean
          brand: string
          brand_id: string | null
          category: string
          category_id: string | null
          created_at: string
          description: string
          highlights: string[]
          id: string
          is_active: boolean
          is_featured: boolean
          low_stock_at: number
          mrp: number
          name: string
          new_arrival: boolean
          price: number
          rating: number
          recommendation_mode: string
          reviews: number
          sales_channel: string
          seo_description: string
          seo_title: string
          short_description: string
          sku: string
          slug: string
          sort_order: number
          status: Database["public"]["Enums"]["product_status"]
          stock: number
          updated_at: string
        }
        Insert: {
          age_group?: string
          barcode?: string | null
          bestseller?: boolean
          brand?: string
          brand_id?: string | null
          category?: string
          category_id?: string | null
          created_at?: string
          description?: string
          highlights?: string[]
          id?: string
          is_active?: boolean
          is_featured?: boolean
          low_stock_at?: number
          mrp?: number
          name: string
          new_arrival?: boolean
          price?: number
          rating?: number
          recommendation_mode?: string
          reviews?: number
          sales_channel?: string
          seo_description?: string
          seo_title?: string
          short_description?: string
          sku?: string
          slug: string
          sort_order?: number
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          updated_at?: string
        }
        Update: {
          age_group?: string
          barcode?: string | null
          bestseller?: boolean
          brand?: string
          brand_id?: string | null
          category?: string
          category_id?: string | null
          created_at?: string
          description?: string
          highlights?: string[]
          id?: string
          is_active?: boolean
          is_featured?: boolean
          low_stock_at?: number
          mrp?: number
          name?: string
          new_arrival?: boolean
          price?: number
          rating?: number
          recommendation_mode?: string
          reviews?: number
          sales_channel?: string
          seo_description?: string
          seo_title?: string
          short_description?: string
          sku?: string
          slug?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string
          avatar_url: string | null
          city: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          pincode: string
          role: string
          state: string
          store_credit_balance: number
          updated_at: string
        }
        Insert: {
          address?: string
          avatar_url?: string | null
          city?: string
          created_at?: string
          email?: string
          full_name?: string
          id: string
          phone?: string
          pincode?: string
          role?: string
          state?: string
          store_credit_balance?: number
          updated_at?: string
        }
        Update: {
          address?: string
          avatar_url?: string | null
          city?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string
          pincode?: string
          role?: string
          state?: string
          store_credit_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          comment: string
          created_at: string
          id: string
          images: string[]
          order_id: string | null
          product_id: string
          rating: number
          status: Database["public"]["Enums"]["review_status"]
          title: string
          updated_at: string
          user_id: string
          verified_purchase: boolean
        }
        Insert: {
          comment?: string
          created_at?: string
          id?: string
          images?: string[]
          order_id?: string | null
          product_id: string
          rating: number
          status?: Database["public"]["Enums"]["review_status"]
          title?: string
          updated_at?: string
          user_id: string
          verified_purchase?: boolean
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          images?: string[]
          order_id?: string | null
          product_id?: string
          rating?: number
          status?: Database["public"]["Enums"]["review_status"]
          title?: string
          updated_at?: string
          user_id?: string
          verified_purchase?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_reviews_profiles"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      shiprocket_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: number
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: number
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: number
          token?: string
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      sms_logs: {
        Row: {
          created_at: string
          error_details: string | null
          id: string
          idempotency_key: string | null
          last_retried_at: string | null
          message_content: string | null
          message_type: string
          offline_sale_id: string | null
          order_id: string | null
          phone: string
          provider_message_id: string | null
          provider_status: string | null
          recipient_type: string
          retry_count: number
          sent_at: string | null
          status: string
          template_id: string | null
        }
        Insert: {
          created_at?: string
          error_details?: string | null
          id?: string
          idempotency_key?: string | null
          last_retried_at?: string | null
          message_content?: string | null
          message_type: string
          offline_sale_id?: string | null
          order_id?: string | null
          phone: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_type?: string
          retry_count?: number
          sent_at?: string | null
          status?: string
          template_id?: string | null
        }
        Update: {
          created_at?: string
          error_details?: string | null
          id?: string
          idempotency_key?: string | null
          last_retried_at?: string | null
          message_content?: string | null
          message_type?: string
          offline_sale_id?: string | null
          order_id?: string | null
          phone?: string
          provider_message_id?: string | null
          provider_status?: string | null
          recipient_type?: string
          retry_count?: number
          sent_at?: string | null
          status?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_logs_offline_sale_id_fkey"
            columns: ["offline_sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_logs_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      store_credit_ledger: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          change_amount: number | null
          created_at: string
          created_by: string | null
          credit_token: string
          customer_id: string | null
          customer_name: string
          customer_phone: string
          entry_type: string | null
          id: string
          notes: string
          return_id: string | null
          sale_id: string | null
          source_return_id: string | null
          type: string
          used_in_sale_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          balance_after?: number
          balance_before?: number
          change_amount?: number | null
          created_at?: string
          created_by?: string | null
          credit_token?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          entry_type?: string | null
          id?: string
          notes?: string
          return_id?: string | null
          sale_id?: string | null
          source_return_id?: string | null
          type: string
          used_in_sale_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          change_amount?: number | null
          created_at?: string
          created_by?: string | null
          credit_token?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string
          entry_type?: string | null
          id?: string
          notes?: string
          return_id?: string | null
          sale_id?: string | null
          source_return_id?: string | null
          type?: string
          used_in_sale_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_credit_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "pos_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_credit_ledger_source_return_id_fkey"
            columns: ["source_return_id"]
            isOneToOne: false
            referencedRelation: "offline_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_credit_ledger_used_in_sale_id_fkey"
            columns: ["used_in_sale_id"]
            isOneToOne: false
            referencedRelation: "offline_sales"
            referencedColumns: ["id"]
          },
        ]
      }
      user_addresses: {
        Row: {
          address_line_1: string
          address_line_2: string
          city: string
          country: string
          created_at: string
          full_name: string
          id: string
          is_default: boolean
          landmark: string
          phone: string
          postal_code: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          address_line_1?: string
          address_line_2?: string
          city?: string
          country?: string
          created_at?: string
          full_name?: string
          id?: string
          is_default?: boolean
          landmark?: string
          phone?: string
          postal_code?: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          address_line_1?: string
          address_line_2?: string
          city?: string
          country?: string
          created_at?: string
          full_name?: string
          id?: string
          is_default?: boolean
          landmark?: string
          phone?: string
          postal_code?: string
          state?: string
          updated_at?: string
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
          role?: Database["public"]["Enums"]["app_role"]
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
      webhook_events: {
        Row: {
          created_at: string | null
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
        }
        Relationships: []
      }
      website_visitors: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          customer_name: string | null
          id: string
          region: string | null
          session_id: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          region?: string | null
          session_id: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          region?: string | null
          session_id?: string
        }
        Relationships: []
      }
      wishlist_items: {
        Row: {
          created_at: string
          id: string
          product_id: string
          wishlist_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          product_id: string
          wishlist_id: string
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string
          wishlist_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey"
            columns: ["wishlist_id"]
            isOneToOne: false
            referencedRelation: "wishlists"
            referencedColumns: ["id"]
          },
        ]
      }
      wishlists: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
      admin_adjust_inventory: {
        Args: {
          _adjustment_delta?: number
          _new_stock?: number
          _product_id: string
          _reason?: string
          _variant_id?: string
        }
        Returns: Json
      }
      admin_delete_all_products: { Args: { _force?: boolean }; Returns: Json }
      admin_delete_offline_sale: { Args: { _sale_id: string }; Returns: Json }
      admin_delete_products: { Args: { _product_ids: string[] }; Returns: Json }
      admin_delete_query: { Args: { p_query_id: string }; Returns: boolean }
      admin_delete_sms_log: { Args: { p_log_id: string }; Returns: boolean }
      admin_nuke_all_sales: { Args: never; Returns: Json }
      admin_process_return_qc: {
        Args: {
          _items_qc: Json
          _qc_summary?: string
          _restock_approved?: boolean
          _return_id: string
        }
        Returns: Json
      }
      admin_purge_test_data: { Args: never; Returns: Json }
      admin_record_online_refund: {
        Args: {
          _gateway_refund_id?: string
          _notes?: string
          _refund_amount: number
          _refund_method?: string
          _return_id: string
        }
        Returns: Json
      }
      admin_update_online_return_status: {
        Args: {
          _admin_note?: string
          _metadata?: Json
          _new_status: string
          _return_id: string
        }
        Returns: Json
      }
      admin_void_offline_sale:
        | { Args: { _sale_id: string }; Returns: Json }
        | {
            Args: {
              _reason?: string
              _restore_stock?: boolean
              _sale_id: string
            }
            Returns: Json
          }
      admin_wipe_all_test_sales: { Args: never; Returns: Json }
      calculate_online_return_refund: {
        Args: { _items: Json; _order_id: string; _reason_category: string }
        Returns: Json
      }
      cancel_abandoned_order: { Args: { order_id: string }; Returns: undefined }
      cancel_customer_order: {
        Args: { order_id: string; reason?: string }
        Returns: Json
      }
      check_is_admin: { Args: never; Returns: boolean }
      claim_admin: { Args: never; Returns: boolean }
      clear_website_visitors: { Args: never; Returns: undefined }
      current_ist_date: { Args: never; Returns: string }
      delete_cancelled_order: { Args: { _order_id: string }; Returns: Json }
      delete_storage_object: {
        Args: { bucket: string; object_path: string }
        Returns: undefined
      }
      ensure_profile: { Args: never; Returns: undefined }
      generate_credit_token: { Args: never; Returns: string }
      generate_invoice_number: { Args: never; Returns: string }
      generate_online_return_number: { Args: never; Returns: string }
      generate_order_number: { Args: never; Returns: string }
      generate_pos_invoice_number: { Args: never; Returns: string }
      generate_pos_return_number: { Args: never; Returns: string }
      generate_pos_sale_number: { Args: never; Returns: string }
      generate_store_credit_code: { Args: never; Returns: string }
      get_admin_queries: {
        Args: { p_limit?: number; p_search?: string; p_status?: string }
        Returns: {
          admin_notes: string | null
          created_at: string
          email: string
          handled: boolean
          id: string
          idempotency_key: string | null
          message: string
          name: string
          order_number: string | null
          phone: string | null
          priority: string
          resolved_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "contact_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_admin_sms_logs: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          error_details: string | null
          id: string
          idempotency_key: string | null
          last_retried_at: string | null
          message_content: string | null
          message_type: string
          offline_sale_id: string | null
          order_id: string | null
          phone: string
          provider_message_id: string | null
          provider_status: string | null
          recipient_type: string
          retry_count: number
          sent_at: string | null
          status: string
          template_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "sms_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_customer_store_credit: {
        Args: { _customer_id?: string; _phone?: string; _token?: string }
        Returns: Json
      }
      get_related_products: {
        Args: { p_limit?: number; p_product_id: string }
        Returns: {
          brand: string
          category: string
          id: string
          image_url: string
          images: string[]
          is_active: boolean
          low_stock_at: number
          mrp: number
          name: string
          price: number
          relation_source: string
          slug: string
          sort_order: number
          stock: number
        }[]
      }
      get_unified_store_activities: {
        Args: { _limit?: number }
        Returns: {
          amount: number
          created_at: string
          customer_name: string
          event_type: string
          id: string
          metadata: Json
          product_image: string
          product_name: string
          product_slug: string
          source: string
          subtitle: string
          title: string
        }[]
      }
      grant_admin_by_email: { Args: { _email: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_admins: {
        Args: never
        Returns: {
          created_at: string
          email: string
          status: string
        }[]
      }
      lookup_barcode: { Args: { _code: string }; Returns: Json }
      place_offline_sale: {
        Args: {
          _coupon_code?: string
          _credit_token?: string
          _customer_email?: string
          _customer_id?: string
          _customer_name?: string
          _customer_phone?: string
          _discount_type?: string
          _discount_value?: number
          _idempotency_key?: string
          _items?: Json
          _notes?: string
          _payment_method?: string
          _store_credit_used?: number
        }
        Returns: Json
      }
      place_order: {
        Args: {
          _address: string
          _address_line2?: string
          _alt_phone?: string
          _city: string
          _coupon_code?: string
          _email: string
          _full_name: string
          _idempotency_key?: string
          _items: Json
          _landmark?: string
          _notes?: string
          _payment_method: string
          _phone: string
          _pincode: string
          _state: string
        }
        Returns: Json
      }
      process_offline_return: {
        Args: {
          _customer_email?: string
          _customer_id?: string
          _customer_name?: string
          _customer_phone?: string
          _idempotency_key?: string
          _items?: Json
          _notes?: string
          _original_sale_id?: string
          _refund_method?: string
          _refund_status?: string
          _return_reason?: string
        }
        Returns: Json
      }
      process_open_box_delivery: {
        Args: {
          _decision: string
          _idempotency_key?: string
          _order_id: string
          _rejection_notes?: string
          _rejection_reason?: string
        }
        Returns: Json
      }
      record_store_activity: {
        Args: {
          _event_name: string
          _metadata?: Json
          _order_id?: string
          _product_id?: string
          _session_id?: string
        }
        Returns: string
      }
      request_online_return: {
        Args: {
          _customer_note?: string
          _idempotency_key?: string
          _items: Json
          _order_id: string
          _reason_category: string
          _reason_label: string
        }
        Returns: Json
      }
      revoke_admin_by_email: { Args: { _email: string }; Returns: boolean }
      search_pos_customers: {
        Args: { _query: string }
        Returns: {
          created_at: string
          email: string
          id: string
          name: string
          notes: string
          phone: string
          store_credit_balance: number
          total_purchases: number
          total_spend: number
          total_spent: number | null
          total_visits: number | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pos_customers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_customer_query: {
        Args: {
          _email: string
          _idempotency_key?: string
          _message: string
          _name: string
          _order_number?: string
          _phone?: string
        }
        Returns: Json
      }
      sync_admin_from_allowlist: { Args: never; Returns: boolean }
      sync_offline_sales: { Args: { _sales: Json }; Returns: Json }
      sync_product_relations: {
        Args: { p_product_id: string; p_related_ids: string[] }
        Returns: undefined
      }
      update_query_status: {
        Args: {
          p_admin_notes?: string
          p_priority?: string
          p_query_id: string
          p_status: string
        }
        Returns: {
          admin_notes: string | null
          created_at: string
          email: string
          handled: boolean
          id: string
          idempotency_key: string | null
          message: string
          name: string
          order_number: string | null
          phone: string | null
          priority: string
          resolved_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "contact_messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      validate_coupon: {
        Args: { _code: string; _order_total: number; _user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "staff" | "customer" | "pos"
      discount_type: "percentage" | "fixed"
      fulfillment_status: "unfulfilled" | "partially_fulfilled" | "fulfilled"
      inventory_tx_type:
        | "purchase"
        | "sale"
        | "return"
        | "adjustment"
        | "damage"
        | "restock"
      order_status:
        | "placed"
        | "pending"
        | "confirmed"
        | "processing"
        | "packed"
        | "shipped"
        | "out_for_delivery"
        | "delivered"
        | "cancelled"
        | "returned"
        | "open_box_inspection"
        | "open_box_accepted"
        | "open_box_rejected"
        | "return_in_transit"
        | "return_received"
        | "refund_processing"
      payment_status:
        | "pending"
        | "paid"
        | "failed"
        | "refunded"
        | "processing"
        | "authorized"
      product_status: "draft" | "active" | "out_of_stock" | "archived"
      review_status: "pending" | "approved" | "rejected"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "staff", "customer", "pos"],
      discount_type: ["percentage", "fixed"],
      fulfillment_status: ["unfulfilled", "partially_fulfilled", "fulfilled"],
      inventory_tx_type: [
        "purchase",
        "sale",
        "return",
        "adjustment",
        "damage",
        "restock",
      ],
      order_status: [
        "placed",
        "pending",
        "confirmed",
        "processing",
        "packed",
        "shipped",
        "out_for_delivery",
        "delivered",
        "cancelled",
        "returned",
        "open_box_inspection",
        "open_box_accepted",
        "open_box_rejected",
        "return_in_transit",
        "return_received",
        "refund_processing",
      ],
      payment_status: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "processing",
        "authorized",
      ],
      product_status: ["draft", "active", "out_of_stock", "archived"],
      review_status: ["pending", "approved", "rejected"],
    },
  },
} as const
