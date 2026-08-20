export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      admin_allowlist: {
        Row: {
          added_by: string | null;
          created_at: string;
          email: string;
        };
        Insert: {
          added_by?: string | null;
          created_at?: string;
          email: string;
        };
        Update: {
          added_by?: string | null;
          created_at?: string;
          email?: string;
        };
        Relationships: [];
      };
      analytics_events: {
        Row: {
          created_at: string;
          event_name: string;
          id: string;
          metadata: Json | null;
          order_id: string | null;
          product_id: string | null;
          session_id: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string;
          event_name: string;
          id?: string;
          metadata?: Json | null;
          order_id?: string | null;
          product_id?: string | null;
          session_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          event_name?: string;
          id?: string;
          metadata?: Json | null;
          order_id?: string | null;
          product_id?: string | null;
          session_id?: string | null;
          user_id?: string | null;
        };
        Relationships: [];
      };
      cart_items: {
        Row: {
          cart_id: string;
          created_at: string;
          id: string;
          price_at_add: number | null;
          product_id: string;
          quantity: number;
        };
        Insert: {
          cart_id: string;
          created_at?: string;
          id?: string;
          price_at_add?: number | null;
          product_id: string;
          quantity?: number;
        };
        Update: {
          cart_id?: string;
          created_at?: string;
          id?: string;
          price_at_add?: number | null;
          product_id?: string;
          quantity?: number;
        };
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey";
            columns: ["cart_id"];
            isOneToOne: false;
            referencedRelation: "carts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cart_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      carts: {
        Row: {
          created_at: string;
          id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          name: string;
          slug: string;
          sort_order: number;
          tagline: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          name: string;
          slug: string;
          sort_order?: number;
          tagline?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          name?: string;
          slug?: string;
          sort_order?: number;
          tagline?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      coupon_redemptions: {
        Row: {
          coupon_id: string;
          created_at: string;
          id: string;
          order_id: string | null;
          user_id: string;
        };
        Insert: {
          coupon_id: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          user_id: string;
        };
        Update: {
          coupon_id?: string;
          created_at?: string;
          id?: string;
          order_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey";
            columns: ["coupon_id"];
            isOneToOne: false;
            referencedRelation: "coupons";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "coupon_redemptions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      coupons: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          discount_type: string;
          discount_value: number;
          expires_at: string | null;
          id: string;
          maximum_discount: number;
          minimum_order_value: number;
          per_user_limit: number;
          starts_at: string | null;
          usage_count: number;
          usage_limit: number;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          maximum_discount?: number;
          minimum_order_value?: number;
          per_user_limit?: number;
          starts_at?: string | null;
          usage_count?: number;
          usage_limit?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          discount_type?: string;
          discount_value?: number;
          expires_at?: string | null;
          id?: string;
          maximum_discount?: number;
          minimum_order_value?: number;
          per_user_limit?: number;
          starts_at?: string | null;
          usage_count?: number;
          usage_limit?: number;
        };
        Relationships: [];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          image_url: string | null;
          name: string;
          order_id: string;
          price: number;
          product_slug: string;
          qty: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          name?: string;
          order_id: string;
          price?: number;
          product_slug?: string;
          qty?: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          image_url?: string | null;
          name?: string;
          order_id?: string;
          price?: number;
          product_slug?: string;
          qty?: number;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_status_history: {
        Row: {
          created_at: string;
          id: string;
          note: string | null;
          order_id: string;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          note?: string | null;
          order_id: string;
          status: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          note?: string | null;
          order_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_status_history_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address: string;
          address_line2: string;
          alt_phone: string;
          city: string;
          coupon_code: string | null;
          created_at: string;
          discount: number;
          email: string;
          full_name: string;
          id: string;
          invoice_no: string | null;
          landmark: string;
          notes: string;
          payment_method: string;
          phone: string;
          pincode: string;
          shipping: number;
          state: string;
          status: string;
          subtotal: number;
          total: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address?: string;
          address_line2?: string;
          alt_phone?: string;
          city?: string;
          coupon_code?: string | null;
          created_at?: string;
          discount?: number;
          email?: string;
          full_name?: string;
          id?: string;
          invoice_no?: string | null;
          landmark?: string;
          notes?: string;
          payment_method?: string;
          phone?: string;
          pincode?: string;
          shipping?: number;
          state?: string;
          status?: string;
          subtotal?: number;
          total?: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address?: string;
          address_line2?: string;
          alt_phone?: string;
          city?: string;
          coupon_code?: string | null;
          created_at?: string;
          discount?: number;
          email?: string;
          full_name?: string;
          id?: string;
          invoice_no?: string | null;
          landmark?: string;
          notes?: string;
          payment_method?: string;
          phone?: string;
          pincode?: string;
          shipping?: number;
          state?: string;
          status?: string;
          subtotal?: number;
          total?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          age_group: string;
          brand: string;
          category: string;
          created_at: string;
          description: string;
          highlights: string[];
          id: string;
          image_url: string | null;
          images: string[];
          is_active: boolean;
          is_featured: boolean;
          low_stock_at: number;
          mrp: number;
          name: string;
          price: number;
          rating: number;
          reviews: number;
          sku: string;
          slug: string;
          sort_order: number;
          stock: number;
          updated_at: string;
        };
        Insert: {
          age_group?: string;
          brand?: string;
          category?: string;
          created_at?: string;
          description?: string;
          highlights?: string[];
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_active?: boolean;
          is_featured?: boolean;
          low_stock_at?: number;
          mrp?: number;
          name: string;
          price?: number;
          rating?: number;
          reviews?: number;
          sku?: string;
          slug: string;
          sort_order?: number;
          stock?: number;
          updated_at?: string;
        };
        Update: {
          age_group?: string;
          brand?: string;
          category?: string;
          created_at?: string;
          description?: string;
          highlights?: string[];
          id?: string;
          image_url?: string | null;
          images?: string[];
          is_active?: boolean;
          is_featured?: boolean;
          low_stock_at?: number;
          mrp?: number;
          name?: string;
          price?: number;
          rating?: number;
          reviews?: number;
          sku?: string;
          slug?: string;
          sort_order?: number;
          stock?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          address: string;
          city: string;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          phone: string;
          pincode: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          address?: string;
          city?: string;
          created_at?: string;
          email?: string;
          full_name?: string;
          id: string;
          phone?: string;
          pincode?: string;
          state?: string;
          updated_at?: string;
        };
        Update: {
          address?: string;
          city?: string;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          phone?: string;
          pincode?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reviews: {
        Row: {
          comment: string;
          created_at: string;
          id: string;
          images: Json;
          order_id: string | null;
          product_id: string;
          rating: number;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
          verified_purchase: boolean;
        };
        Insert: {
          comment?: string;
          created_at?: string;
          id?: string;
          images?: Json;
          order_id?: string | null;
          product_id: string;
          rating?: number;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id: string;
          verified_purchase?: boolean;
        };
        Update: {
          comment?: string;
          created_at?: string;
          id?: string;
          images?: Json;
          order_id?: string | null;
          product_id?: string;
          rating?: number;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
          verified_purchase?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "reviews_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "reviews_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      site_settings: {
        Row: {
          key: string;
          updated_at: string;
          value: string;
        };
        Insert: {
          key: string;
          updated_at?: string;
          value?: string;
        };
        Update: {
          key?: string;
          updated_at?: string;
          value?: string;
        };
        Relationships: [];
      };
      user_addresses: {
        Row: {
          address_line_1: string;
          address_line_2: string;
          city: string;
          created_at: string;
          full_name: string;
          id: string;
          is_default: boolean;
          landmark: string;
          phone: string;
          postal_code: string;
          state: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          address_line_1?: string;
          address_line_2?: string;
          city?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_default?: boolean;
          landmark?: string;
          phone?: string;
          postal_code?: string;
          state?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          address_line_1?: string;
          address_line_2?: string;
          city?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_default?: boolean;
          landmark?: string;
          phone?: string;
          postal_code?: string;
          state?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      wishlist_items: {
        Row: {
          created_at: string;
          id: string;
          product_id: string;
          wishlist_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          product_id: string;
          wishlist_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          product_id?: string;
          wishlist_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wishlist_items_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wishlist_items_wishlist_id_fkey";
            columns: ["wishlist_id"];
            isOneToOne: false;
            referencedRelation: "wishlists";
            referencedColumns: ["id"];
          },
        ];
      };
      wishlists: {
        Row: {
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_admin: { Args: never; Returns: boolean };
      ensure_profile: { Args: never; Returns: undefined };
      grant_admin_by_email: { Args: { _email: string }; Returns: string };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      list_admins: {
        Args: never;
        Returns: {
          created_at: string;
          email: string;
          status: string;
        }[];
      };
      revoke_admin_by_email: { Args: { _email: string }; Returns: boolean };
      sync_admin_from_allowlist: { Args: never; Returns: boolean };
      validate_coupon: {
        Args: { _code: string; _order_total: number; _user_id: string };
        Returns: Json;
      };
      place_order: {
        Args: {
          _full_name: string;
          _email: string;
          _phone: string;
          _alt_phone?: string;
          _address?: string;
          _address_line2?: string;
          _landmark?: string;
          _city?: string;
          _state?: string;
          _pincode?: string;
          _payment_method?: string;
          _notes?: string;
          _coupon_code?: string | null;
          _items?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      app_role: "admin" | "user";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const;
