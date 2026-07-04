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
      profiles: {
        Row: {
          id: string
          full_name: string
          email: string
          phone: string | null
          avatar_url: string | null
          department: string | null
          role: 'employee' | 'admin' | 'food_editor' | 'finance_editor' | 'student'
          dietary_preferences: string[] | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          full_name: string
          email: string
          phone?: string | null
          avatar_url?: string | null
          department?: string | null
          role?: 'employee' | 'admin' | 'food_editor' | 'finance_editor' | 'student'
          dietary_preferences?: string[] | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string
          email?: string
          phone?: string | null
          avatar_url?: string | null
          department?: string | null
          role?: 'employee' | 'admin' | 'food_editor' | 'finance_editor' | 'student'
          dietary_preferences?: string[] | null
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      meals: {
        Row: {
          id: string
          name: string
          description: string | null
          meal_type: 'breakfast' | 'lunch' | 'afternoon_snack' | 'evening_snack' | 'dinner'
          image_url: string | null
          price: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          meal_type: 'breakfast' | 'lunch' | 'afternoon_snack' | 'evening_snack' | 'dinner'
          image_url?: string | null
          price?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          meal_type?: 'breakfast' | 'lunch' | 'afternoon_snack' | 'evening_snack' | 'dinner'
          image_url?: string | null
          price?: number
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      menu_schedules: {
        Row: {
          id: string
          meal_id: string
          scheduled_date: string
          time_slot: string
          capacity: number
          is_available: boolean
          booking_time_limit: number
          ordering_deadline_hours: number
          price: number | null
          created_at: string
        }
        Insert: {
          id?: string
          meal_id: string
          scheduled_date: string
          time_slot: string
          capacity?: number
          is_available?: boolean
          booking_time_limit?: number
          ordering_deadline_hours?: number
          price?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          meal_id?: string
          scheduled_date?: string
          time_slot?: string
          capacity?: number
          is_available?: boolean
          booking_time_limit?: number
          ordering_deadline_hours?: number
          price?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_schedules_meal_id_fkey"
            columns: ["meal_id"]
            referencedRelation: "meals"
            referencedColumns: ["id"]
          }
        ]
      }
      bookings: {
        Row: {
          id: string
          user_id: string
          menu_schedule_id: string
          status: 'pending' | 'confirmed' | 'denied' | 'cancelled'
          notes: string | null
          quantity: number
          booked_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          menu_schedule_id: string
          status?: 'pending' | 'confirmed' | 'denied' | 'cancelled'
          notes?: string | null
          quantity?: number
          booked_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          menu_schedule_id?: string
          status?: 'pending' | 'confirmed' | 'denied' | 'cancelled'
          notes?: string | null
          quantity?: number
          booked_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_menu_schedule_id_fkey"
            columns: ["menu_schedule_id"]
            referencedRelation: "menu_schedules"
            referencedColumns: ["id"]
          }
        ]
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: 'booking_confirmed' | 'booking_denied' | 'conflict' | 'reminder' | 'cancelled' | 'payment_success' | 'new_payment' | 'payment_pending' | 'cash_request' | 'balance_added' | 'payment_confirmed' | 'pay_later' | 'order_confirmed' | 'order_rejected'
          message: string
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: 'booking_confirmed' | 'booking_denied' | 'conflict' | 'reminder' | 'cancelled' | 'payment_success' | 'new_payment' | 'payment_pending' | 'cash_request' | 'balance_added' | 'payment_confirmed' | 'pay_later' | 'order_confirmed' | 'order_rejected'
          message: string
          is_read?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          type?: 'booking_confirmed' | 'booking_denied' | 'conflict' | 'reminder' | 'cancelled' | 'payment_success' | 'new_payment' | 'payment_pending' | 'cash_request' | 'balance_added' | 'payment_confirmed' | 'pay_later' | 'order_confirmed' | 'order_rejected'
          message?: string
          is_read?: boolean
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      payments: {
        Row: {
          id: string
          user_id: string
          month: string
          amount: number
          meal_count: number
          status: 'paid' | 'unpaid' | 'refunded'
          paid_at: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          month: string
          amount: number
          meal_count?: number
          status?: 'paid' | 'unpaid' | 'refunded'
          paid_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          month?: string
          amount?: number
          meal_count?: number
          status?: 'paid' | 'unpaid' | 'refunded'
          paid_at?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      app_settings: {
        Row: {
          id: string
          key: string
          value: string
          description: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          key: string
          value: string
          description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          key?: string
          value?: string
          description?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      user_balances: {
        Row: {
          id: string
          user_id: string
          balance: number
          total_deposits: number
          total_consumed: number
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          balance?: number
          total_deposits?: number
          total_consumed?: number
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          balance?: number
          total_deposits?: number
          total_consumed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_balances_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      advance_payments: {
        Row: {
          id: string
          user_id: string
          amount: number
          type: 'deposit' | 'adjustment' | 'meal_charge' | 'refund'
          description: string | null
          month: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          type: 'deposit' | 'adjustment' | 'meal_charge' | 'refund'
          description?: string | null
          month?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          type?: 'deposit' | 'adjustment' | 'meal_charge' | 'refund'
          description?: string | null
          month?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advance_payments_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advance_payments_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      cash_payment_requests: {
        Row: {
          id: string
          user_id: string
          amount: number
          status: 'pending' | 'confirmed' | 'rejected'
          notes: string | null
          created_at: string
          confirmed_at: string | null
          confirmed_by: string | null
        }
        Insert: {
          id?: string
          user_id: string
          amount: number
          status?: 'pending' | 'confirmed' | 'rejected'
          notes?: string | null
          created_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          amount?: number
          status?: 'pending' | 'confirmed' | 'rejected'
          notes?: string | null
          created_at?: string
          confirmed_at?: string | null
          confirmed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_payment_requests_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_payment_requests_confirmed_by_fkey"
            columns: ["confirmed_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      student_tiffin_menu: {
        Row: {
          id: string
          meal_id: string
          scheduled_date: string
          time_slot: string
          capacity: number
          price: number
          is_available: boolean
          ordering_deadline_hours: number
          created_at: string
        }
        Insert: {
          id?: string
          meal_id: string
          scheduled_date: string
          time_slot: string
          capacity?: number
          price?: number
          is_available?: boolean
          ordering_deadline_hours?: number
          created_at?: string
        }
        Update: {
          id?: string
          meal_id?: string
          scheduled_date?: string
          time_slot?: string
          capacity?: number
          price?: number
          is_available?: boolean
          ordering_deadline_hours?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_tiffin_menu_meal_id_fkey"
            columns: ["meal_id"]
            referencedRelation: "meals"
            referencedColumns: ["id"]
          }
        ]
      }
      student_orders: {
        Row: {
          id: string
          student_id: string
          tiffin_menu_id: string
          status: 'pending' | 'confirmed' | 'paid' | 'cancelled' | 'delivered'
          quantity: number
          total_amount: number
          order_date: string
          meal_date: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          student_id: string
          tiffin_menu_id: string
          status?: 'pending' | 'confirmed' | 'paid' | 'cancelled' | 'delivered'
          quantity?: number
          total_amount?: number
          order_date?: string
          meal_date: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          student_id?: string
          tiffin_menu_id?: string
          status?: 'pending' | 'confirmed' | 'paid' | 'cancelled' | 'delivered'
          quantity?: number
          total_amount?: number
          order_date?: string
          meal_date?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_orders_student_id_fkey"
            columns: ["student_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_orders_tiffin_menu_id_fkey"
            columns: ["tiffin_menu_id"]
            referencedRelation: "student_tiffin_menu"
            referencedColumns: ["id"]
          }
        ]
      }
      student_payments: {
        Row: {
          id: string
          order_id: string
          student_id: string
          sslcommerz_session_key: string | null
          tran_id: string | null
          val_id: string | null
          amount: number
          currency: string
          status: 'pending' | 'success' | 'failed' | 'cancelled'
          payment_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          student_id: string
          sslcommerz_session_key?: string | null
          tran_id?: string | null
          val_id?: string | null
          amount?: number
          currency?: string
          status?: 'pending' | 'success' | 'failed' | 'cancelled'
          payment_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          student_id?: string
          sslcommerz_session_key?: string | null
          tran_id?: string | null
          val_id?: string | null
          amount?: number
          currency?: string
          status?: 'pending' | 'success' | 'failed' | 'cancelled'
          payment_data?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_payments_order_id_fkey"
            columns: ["order_id"]
            referencedRelation: "student_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "student_payments_student_id_fkey"
            columns: ["student_id"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      meal_routines: {
        Row: {
          id: string
          name: string
          description: string | null
          routine_type: 'weekly' | 'monthly'
          is_active: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          routine_type?: 'weekly' | 'monthly'
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          routine_type?: 'weekly' | 'monthly'
          is_active?: boolean
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meal_routines_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          }
        ]
      }
      meal_routine_items: {
        Row: {
          id: string
          routine_id: string
          meal_id: string
          day_of_week: number | null
          day_of_month: number | null
          time_slot: string
          capacity: number | null
          ordering_deadline_hours: number | null
          meal_type: 'employee' | 'student' | 'both' | null
          price: number | null
        }
        Insert: {
          id?: string
          routine_id: string
          meal_id: string
          day_of_week?: number | null
          day_of_month?: number | null
          time_slot: string
          capacity?: number | null
          ordering_deadline_hours?: number | null
          meal_type?: 'employee' | 'student' | 'both' | null
          price?: number | null
        }
        Update: {
          id?: string
          routine_id?: string
          meal_id?: string
          day_of_week?: number | null
          day_of_month?: number | null
          time_slot?: string
          capacity?: number | null
          ordering_deadline_hours?: number | null
          meal_type?: 'employee' | 'student' | 'both' | null
          price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meal_routine_items_routine_id_fkey"
            columns: ["routine_id"]
            referencedRelation: "meal_routines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meal_routine_items_meal_id_fkey"
            columns: ["meal_id"]
            referencedRelation: "meals"
            referencedColumns: ["id"]
          }
        ]
      }
      guest_meals: {
        Row: {
          id: string
          created_by: string | null
          guest_name: string
          department: 'School' | 'Educare'
          meal_id: string | null
          menu_schedule_id: string | null
          quantity: number
          notes: string | null
          meal_date: string
          time_slot: string
          status: string
          created_at: string
        }
        Insert: {
          id?: string
          created_by?: string | null
          guest_name: string
          department: 'School' | 'Educare'
          meal_id?: string | null
          menu_schedule_id?: string | null
          quantity?: number
          notes?: string | null
          meal_date: string
          time_slot: string
          status?: string
          created_at?: string
        }
        Update: {
          id?: string
          created_by?: string | null
          guest_name?: string
          department?: 'School' | 'Educare'
          meal_id?: string | null
          menu_schedule_id?: string | null
          quantity?: number
          notes?: string | null
          meal_date?: string
          time_slot?: string
          status?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guest_meals_created_by_fkey"
            columns: ["created_by"]
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_meals_meal_id_fkey"
            columns: ["meal_id"]
            referencedRelation: "meals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guest_meals_menu_schedule_id_fkey"
            columns: ["menu_schedule_id"]
            referencedRelation: "menu_schedules"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_booking_atomic: {
        Args: {
          p_user_id: string
          p_menu_schedule_id: string
          p_notes?: string | null
          p_quantity?: number
        }
        Returns: string
      }
    }
    Enums: {
      booking_status: 'pending' | 'confirmed' | 'denied' | 'cancelled'
      meal_type: 'breakfast' | 'lunch'
      notification_type: 'booking_confirmed' | 'booking_denied' | 'conflict' | 'reminder' | 'cancelled' | 'payment_success' | 'new_payment' | 'payment_pending' | 'cash_request' | 'balance_added' | 'payment_confirmed' | 'pay_later' | 'order_confirmed' | 'order_rejected'
      user_role: 'employee' | 'admin' | 'food_editor' | 'finance_editor' | 'student'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Helper types for easier use throughout the app
export type Profile = Database['public']['Tables']['profiles']['Row']
export type Meal = Database['public']['Tables']['meals']['Row']
export type MenuSchedule = Database['public']['Tables']['menu_schedules']['Row']
export type Booking = Database['public']['Tables']['bookings']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type Payment = Database['public']['Tables']['payments']['Row']
export type AppSettings = Database['public']['Tables']['app_settings']['Row']
export type StudentTiffinMenu = Database['public']['Tables']['student_tiffin_menu']['Row']
export type StudentOrder = Database['public']['Tables']['student_orders']['Row']
export type StudentPayment = Database['public']['Tables']['student_payments']['Row']
export type MealRoutine = Database['public']['Tables']['meal_routines']['Row']
export type MealRoutineItem = Database['public']['Tables']['meal_routine_items']['Row']
export type GuestMeal = Database['public']['Tables']['guest_meals']['Row']

// Extended types with relations
export interface MenuScheduleWithMeal extends MenuSchedule {
  meal: Meal
  booking_count?: number
  remaining_capacity?: number
}

export interface BookingWithDetails extends Booking {
  menu_schedule: MenuScheduleWithMeal
  profile?: Profile
}

export interface BookingStatus {
  pending: 'pending'
  confirmed: 'confirmed'
  denied: 'denied'
  cancelled: 'cancelled'
}

export interface MealType {
  breakfast: 'breakfast'
  lunch: 'lunch'
  afternoon_snack: 'afternoon_snack'
  evening_snack: 'evening_snack'
  dinner: 'dinner'
}

export interface PaymentWithProfile extends Payment {
  profile?: Profile
}

export interface UserBalance {
  id: string
  user_id: string
  balance: number
  total_deposits: number
  total_consumed: number
  updated_at: string
}

export interface AdvancePayment {
  id: string
  user_id: string
  amount: number
  type: 'deposit' | 'adjustment' | 'meal_charge' | 'refund'
  description: string | null
  month: string | null
  created_by: string | null
  created_at: string
}

export interface UserBalanceWithProfile extends UserBalance {
  profile?: Profile
}

export interface AdvancePaymentWithProfile extends AdvancePayment {
  profile?: Profile
  creator?: Profile
}

