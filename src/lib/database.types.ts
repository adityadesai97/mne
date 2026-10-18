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
      allowed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          is_admin: boolean
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_admin?: boolean
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_admin?: boolean
        }
        Relationships: []
      }
      api_proxy_calls: {
        Row: {
          called_at: string
          id: number
          kind: string
          user_id: string
        }
        Insert: {
          called_at?: string
          id?: never
          kind: string
          user_id: string
        }
        Update: {
          called_at?: string
          id?: never
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      assets: {
        Row: {
          asset_type: string
          face_value: number | null
          fixed_income_subtype: string | null
          id: string
          initial_price: number | null
          interest_rate: number | null
          location_id: string
          maturity_date: string | null
          name: string
          notes: string | null
          ownership: string
          price: number | null
          ticker_id: string | null
          user_id: string
        }
        Insert: {
          asset_type: string
          face_value?: number | null
          fixed_income_subtype?: string | null
          id?: string
          initial_price?: number | null
          interest_rate?: number | null
          location_id: string
          maturity_date?: string | null
          name: string
          notes?: string | null
          ownership?: string
          price?: number | null
          ticker_id?: string | null
          user_id: string
        }
        Update: {
          asset_type?: string
          face_value?: number | null
          fixed_income_subtype?: string | null
          id?: string
          initial_price?: number | null
          interest_rate?: number | null
          location_id?: string
          maturity_date?: string | null
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
      client_errors: {
        Row: {
          app_version: string | null
          created_at: string
          id: string
          message: string
          source: string
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          id?: string
          message: string
          source: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          id?: string
          message?: string
          source?: string
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      command_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          origin: string
          title: string
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          origin?: string
          title: string
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          origin?: string
          title?: string
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      command_feedback: {
        Row: {
          addressed_at: string | null
          agent_response: string
          attachment_content: string | null
          attachment_filename: string | null
          attachment_mime_type: string | null
          conversation_origin: string
          created_at: string
          feedback_text: string | null
          fix_commit: string | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          user_id: string
          user_query: string | null
        }
        Insert: {
          addressed_at?: string | null
          agent_response: string
          attachment_content?: string | null
          attachment_filename?: string | null
          attachment_mime_type?: string | null
          conversation_origin?: string
          created_at?: string
          feedback_text?: string | null
          fix_commit?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          user_id: string
          user_query?: string | null
        }
        Update: {
          addressed_at?: string | null
          agent_response?: string
          attachment_content?: string | null
          attachment_filename?: string | null
          attachment_mime_type?: string | null
          conversation_origin?: string
          created_at?: string
          feedback_text?: string | null
          fix_commit?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          user_id?: string
          user_query?: string | null
        }
        Relationships: []
      }
      fixed_income_lots: {
        Row: {
          asset_id: string
          cost_price: number
          count: number
          id: string
          purchase_date: string
        }
        Insert: {
          asset_id: string
          cost_price: number
          count: number
          id?: string
          purchase_date: string
        }
        Update: {
          asset_id?: string
          cost_price?: number
          count?: number
          id?: string
          purchase_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "fixed_income_lots_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_credential_secrets: {
        Row: {
          api_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_credential_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "llm_credentials"
            referencedColumns: ["user_id"]
          },
        ]
      }
      llm_credentials: {
        Row: {
          secret_set: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          secret_set?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          secret_set?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      llm_usage_log: {
        Row: {
          conversation_id: string | null
          created_at: string
          feature: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          provider: string
          user_id: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          provider: string
          user_id: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          provider?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "llm_usage_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "command_conversations"
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
      market_credential_secrets: {
        Row: {
          coingecko_api_key: string | null
          finnhub_api_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          coingecko_api_key?: string | null
          finnhub_api_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          coingecko_api_key?: string | null
          finnhub_api_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_credential_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "market_credentials"
            referencedColumns: ["user_id"]
          },
        ]
      }
      market_credentials: {
        Row: {
          coingecko_set: boolean
          finnhub_set: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          coingecko_set?: boolean
          finnhub_set?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          coingecko_set?: boolean
          finnhub_set?: boolean
          updated_at?: string
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
      plaid_credential_secrets: {
        Row: {
          secret: string
          updated_at: string
          user_id: string
        }
        Insert: {
          secret: string
          updated_at?: string
          user_id: string
        }
        Update: {
          secret?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_credential_secrets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "plaid_credentials"
            referencedColumns: ["user_id"]
          },
        ]
      }
      plaid_credentials: {
        Row: {
          client_id: string | null
          created_at: string
          plaid_env: string
          secret_set: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          plaid_env?: string
          secret_set?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          plaid_env?: string
          secret_set?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plaid_item_secrets: {
        Row: {
          access_token: string
          item_id: string
        }
        Insert: {
          access_token: string
          item_id: string
        }
        Update: {
          access_token?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_item_secrets_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          created_at: string
          id: string
          institution_id: string | null
          institution_name: string | null
          item_id: string
          last_error: string | null
          last_synced_at: string | null
          status: string
          txn_synced_through: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          txn_synced_through?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string
          last_error?: string | null
          last_synced_at?: string | null
          status?: string
          txn_synced_through?: string | null
          user_id?: string
        }
        Relationships: []
      }
      plaid_lot_links: {
        Row: {
          created_at: string
          external_account_id: string
          external_security_id: string
          id: string
          plaid_item_id: string
          plaid_lot_date: string
          plaid_lot_price: number
          transaction_id: string
        }
        Insert: {
          created_at?: string
          external_account_id: string
          external_security_id: string
          id?: string
          plaid_item_id: string
          plaid_lot_date: string
          plaid_lot_price: number
          transaction_id: string
        }
        Update: {
          created_at?: string
          external_account_id?: string
          external_security_id?: string
          id?: string
          plaid_item_id?: string
          plaid_lot_date?: string
          plaid_lot_price?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_lot_links_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_lot_links_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_pending_positions: {
        Row: {
          created_at: string
          detected_type: string
          external_account_id: string
          external_security_id: string | null
          id: string
          matched_asset_id: string | null
          payload: Json
          plaid_item_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detected_type: string
          external_account_id: string
          external_security_id?: string | null
          id?: string
          matched_asset_id?: string | null
          payload: Json
          plaid_item_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          detected_type?: string
          external_account_id?: string
          external_security_id?: string | null
          id?: string
          matched_asset_id?: string | null
          payload?: Json
          plaid_item_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_pending_positions_matched_asset_id_fkey"
            columns: ["matched_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_pending_positions_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_synced_positions: {
        Row: {
          asset_id: string | null
          checked_at: string | null
          created_at: string
          drift_shares: number | null
          external_account_id: string
          external_security_id: string | null
          fixed_income_lot_id: string | null
          id: string
          plaid_cost_price: number | null
          plaid_item_id: string
          plaid_quantity: number | null
          transaction_id: string | null
        }
        Insert: {
          asset_id?: string | null
          checked_at?: string | null
          created_at?: string
          drift_shares?: number | null
          external_account_id: string
          external_security_id?: string | null
          fixed_income_lot_id?: string | null
          id?: string
          plaid_cost_price?: number | null
          plaid_item_id: string
          plaid_quantity?: number | null
          transaction_id?: string | null
        }
        Update: {
          asset_id?: string | null
          checked_at?: string | null
          created_at?: string
          drift_shares?: number | null
          external_account_id?: string
          external_security_id?: string | null
          fixed_income_lot_id?: string | null
          id?: string
          plaid_cost_price?: number | null
          plaid_item_id?: string
          plaid_quantity?: number | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_synced_positions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_synced_positions_fixed_income_lot_id_fkey"
            columns: ["fixed_income_lot_id"]
            isOneToOne: false
            referencedRelation: "fixed_income_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_synced_positions_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_synced_positions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_synced_transactions: {
        Row: {
          asset_id: string | null
          created_at: string
          id: string
          investment_transaction_id: string
          plaid_item_id: string
          price: number | null
          quantity: number | null
          reason: string | null
          status: string
          txn_date: string | null
          txn_type: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          id?: string
          investment_transaction_id: string
          plaid_item_id: string
          price?: number | null
          quantity?: number | null
          reason?: string | null
          status?: string
          txn_date?: string | null
          txn_type?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          id?: string
          investment_transaction_id?: string
          plaid_item_id?: string
          price?: number | null
          quantity?: number | null
          reason?: string | null
          status?: string
          txn_date?: string | null
          txn_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_synced_transactions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_synced_transactions_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_explanations: {
        Row: {
          basis_net_worth: number | null
          day_change_dollars: number | null
          day_change_percent: number | null
          generated_at: string
          has_major_moves: boolean
          id: string
          input_tokens: number | null
          is_broad_market_move: boolean
          market_date: string
          market_headlines: Json
          movers: Json
          output_tokens: number | null
          scope: string
          scope_key: string
          summary: string
          theme_moves: Json
          timeframe: string
          trigger: string
          user_id: string
          window_days: number
        }
        Insert: {
          basis_net_worth?: number | null
          day_change_dollars?: number | null
          day_change_percent?: number | null
          generated_at?: string
          has_major_moves?: boolean
          id?: string
          input_tokens?: number | null
          is_broad_market_move?: boolean
          market_date?: string
          market_headlines?: Json
          movers?: Json
          output_tokens?: number | null
          scope?: string
          scope_key?: string
          summary: string
          theme_moves?: Json
          timeframe?: string
          trigger: string
          user_id: string
          window_days?: number
        }
        Update: {
          basis_net_worth?: number | null
          day_change_dollars?: number | null
          day_change_percent?: number | null
          generated_at?: string
          has_major_moves?: boolean
          id?: string
          input_tokens?: number | null
          is_broad_market_move?: boolean
          market_date?: string
          market_headlines?: Json
          movers?: Json
          output_tokens?: number | null
          scope?: string
          scope_key?: string
          summary?: string
          theme_moves?: Json
          timeframe?: string
          trigger?: string
          user_id?: string
          window_days?: number
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
          vesting_frequency: string
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
          vesting_frequency?: string
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
          vesting_frequency?: string
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
      ticker_price_history: {
        Row: {
          date: string
          id: string
          price: number
          ticker_id: string
          user_id: string
        }
        Insert: {
          date: string
          id?: string
          price: number
          ticker_id: string
          user_id: string
        }
        Update: {
          date?: string
          id?: string
          price?: number
          ticker_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticker_price_history_ticker_id_fkey"
            columns: ["ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
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
          coingecko_id: string | null
          current_price: number | null
          id: string
          kind: string
          last_updated: string | null
          logo: string | null
          previous_close: number | null
          symbol: string
          user_id: string
          watchlist_only: boolean | null
        }
        Insert: {
          coingecko_id?: string | null
          current_price?: number | null
          id?: string
          kind?: string
          last_updated?: string | null
          logo?: string | null
          previous_close?: number | null
          symbol: string
          user_id: string
          watchlist_only?: boolean | null
        }
        Update: {
          coingecko_id?: string | null
          current_price?: number | null
          id?: string
          kind?: string
          last_updated?: string | null
          logo?: string | null
          previous_close?: number | null
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
          rsu_grant_id: string | null
          sold_at_vest: number
          subtype_id: string
        }
        Insert: {
          capital_gains_status?: string | null
          cost_price: number
          count: number
          id?: string
          purchase_date: string
          rsu_grant_id?: string | null
          sold_at_vest?: number
          subtype_id: string
        }
        Update: {
          capital_gains_status?: string | null
          cost_price?: number
          count?: number
          id?: string
          purchase_date?: string
          rsu_grant_id?: string | null
          sold_at_vest?: number
          subtype_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_rsu_grant_id_fkey"
            columns: ["rsu_grant_id"]
            isOneToOne: false
            referencedRelation: "rsu_grants"
            referencedColumns: ["id"]
          },
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
          capital_gains_alerts_enabled: boolean
          dashboard_layouts: Json | null
          gemini_api_key: string | null
          id: string
          price_alert_threshold: number | null
          price_alerts_enabled: boolean
          rsu_alert_days_before: number | null
          user_id: string
          vest_alerts_enabled: boolean
        }
        Insert: {
          auto_theme_assignment_enabled?: boolean
          capital_gains_alerts_enabled?: boolean
          dashboard_layouts?: Json | null
          gemini_api_key?: string | null
          id?: string
          price_alert_threshold?: number | null
          price_alerts_enabled?: boolean
          rsu_alert_days_before?: number | null
          user_id: string
          vest_alerts_enabled?: boolean
        }
        Update: {
          auto_theme_assignment_enabled?: boolean
          capital_gains_alerts_enabled?: boolean
          dashboard_layouts?: Json | null
          gemini_api_key?: string | null
          id?: string
          price_alert_threshold?: number | null
          price_alerts_enabled?: boolean
          rsu_alert_days_before?: number | null
          user_id?: string
          vest_alerts_enabled?: boolean
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_allowed_email_admin: { Args: never; Returns: boolean }
      record_net_worth_snapshots: { Args: { p_date?: string }; Returns: number }
      save_llm_key: { Args: { p_key: string }; Returns: undefined }
      save_market_keys: {
        Args: { p_coingecko?: string; p_finnhub?: string }
        Returns: undefined
      }
      save_plaid_credentials: {
        Args: { p_client_id: string; p_env: string; p_secret?: string }
        Returns: undefined
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
    Enums: {},
  },
} as const
