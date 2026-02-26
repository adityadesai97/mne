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
      assets: {
        Row: {
          asset_type: string
          id: string
          location_id: string
          name: string
          notes: string | null
          ownership: string
          price: number | null
          ticker_id: string | null
          user_id: string
        }
        Insert: {
          asset_type: string
          id?: string
          location_id: string
          name: string
          notes?: string | null
          ownership?: string
          price?: number | null
          ticker_id?: string | null
          user_id: string
        }
        Update: {
          asset_type?: string
          id?: string
          location_id?: string
          name?: string
          notes?: string | null
          ownership?: string
          price?: number | null
          ticker_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_ticker_id_fkey"
            columns: ["ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          account_type: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          account_type: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          account_type?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      net_worth_snapshots: {
        Row: {
          date: string
          id: string
          user_id: string
          value: number
        }
        Insert: {
          date: string
          id?: string
          user_id: string
          value: number
        }
        Update: {
          date?: string
          id?: string
          user_id?: string
          value?: number
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      rsu_grants: {
        Row: {
          cliff_date: string | null
          ended_at: string | null
          grant_date: string
          id: string
          subtype_id: string
          total_shares: number
          vest_end: string
          vest_start: string
        }
        Insert: {
          cliff_date?: string | null
          ended_at?: string | null
          grant_date: string
          id?: string
          subtype_id: string
          total_shares: number
          vest_end: string
          vest_start: string
        }
        Update: {
          cliff_date?: string | null
          ended_at?: string | null
          grant_date?: string
          id?: string
          subtype_id?: string
          total_shares?: number
          vest_end?: string
          vest_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsu_grants_subtype_id_fkey"
            columns: ["subtype_id"]
            isOneToOne: false
            referencedRelation: "stock_subtypes"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_subtypes: {
        Row: {
          asset_id: string
          id: string
          subtype: string
        }
        Insert: {
          asset_id: string
          id?: string
          subtype: string
        }
        Update: {
          asset_id?: string
          id?: string
          subtype?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_subtypes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      theme_targets: {
        Row: {
          id: string
          is_active: boolean | null
          target_percentage: number
          theme_id: string | null
          user_id: string
        }
        Insert: {
          id?: string
          is_active?: boolean | null
          target_percentage: number
          theme_id?: string | null
          user_id: string
        }
        Update: {
          id?: string
          is_active?: boolean | null
          target_percentage?: number
          theme_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "theme_targets_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
        ]
      }
      themes: {
        Row: {
          id: string
          name: string
          user_id: string
        }
        Insert: {
          id?: string
          name: string
          user_id: string
        }
        Update: {
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      ticker_themes: {
        Row: {
          theme_id: string
          ticker_id: string
        }
        Insert: {
          theme_id: string
          ticker_id: string
        }
        Update: {
          theme_id?: string
          ticker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticker_themes_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "themes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticker_themes_ticker_id_fkey"
            columns: ["ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
      }
      tickers: {
        Row: {
          current_price: number | null
          id: string
          last_updated: string | null
          logo: string | null
          symbol: string
          user_id: string
          watchlist_only: boolean | null
        }
        Insert: {
          current_price?: number | null
          id?: string
          last_updated?: string | null
          logo?: string | null
          symbol: string
          user_id: string
          watchlist_only?: boolean | null
        }
        Update: {
          current_price?: number | null
          id?: string
          last_updated?: string | null
          logo?: string | null
          symbol?: string
          user_id?: string
          watchlist_only?: boolean | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          capital_gains_status: string | null
          cost_price: number
          count: number
          id: string
          purchase_date: string
          subtype_id: string
        }
        Insert: {
          capital_gains_status?: string | null
          cost_price: number
          count: number
          id?: string
          purchase_date: string
          subtype_id: string
        }
        Update: {
          capital_gains_status?: string | null
          cost_price?: number
          count?: number
          id?: string
          purchase_date?: string
          subtype_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_subtype_id_fkey"
            columns: ["subtype_id"]
            isOneToOne: false
            referencedRelation: "stock_subtypes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          auto_theme_assignment_enabled: boolean
          claude_api_key: string | null
          finnhub_api_key: string | null
          id: string
          price_alert_threshold: number | null
          rsu_alert_days_before: number | null
          tax_harvest_threshold: number | null
          user_id: string
        }
        Insert: {
          auto_theme_assignment_enabled?: boolean
          claude_api_key?: string | null
          finnhub_api_key?: string | null
          id?: string
          price_alert_threshold?: number | null
          rsu_alert_days_before?: number | null
          tax_harvest_threshold?: number | null
          user_id: string
        }
        Update: {
          auto_theme_assignment_enabled?: boolean
          claude_api_key?: string | null
          finnhub_api_key?: string | null
          id?: string
          price_alert_threshold?: number | null
          rsu_alert_days_before?: number | null
          tax_harvest_threshold?: number | null
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
