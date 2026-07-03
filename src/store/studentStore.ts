import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { useAuthStore } from './authStore'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TiffinMenuItem {
  id: string
  meal_id: string
  scheduled_date: string
  time_slot: string
  capacity: number
  price: number
  is_available: boolean
  ordering_deadline_hours?: number
  /** Populated by the API: true when the ordering window has closed */
  deadline_passed?: boolean
  /** ISO string of when ordering closes for this item */
  deadline_at?: string
  created_at: string
  meal: {
    id: string
    name: string
    description: string | null
    meal_type: string
    dietary_tags: string[] | null
    image_url: string | null
  } | null
}

export interface StudentPaymentSummary {
  id: string
  status: 'pending' | 'success' | 'failed' | 'cancelled'
  amount: number
  currency: string
  tran_id: string | null
  created_at: string
}

export interface StudentOrder {
  id: string
  student_id: string
  tiffin_menu_id: string
  status: 'pending' | 'paid' | 'cancelled' | 'delivered'
  quantity: number
  total_amount: number
  order_date: string
  meal_date: string
  created_at: string
  updated_at: string
  tiffin_menu: TiffinMenuItem | null
  payment: StudentPaymentSummary | null
}

/** Flat: { [timeSlot]: items[] } — kept for legacy use */
export interface StudentMenuGrouped {
  [timeSlot: string]: TiffinMenuItem[]
}

/** Per-date entry returned by the API */
export interface StudentMenuDateEntry {
  slots: StudentMenuGrouped
  total_items: number
  has_open_slots: boolean
  label: 'today' | 'tomorrow' | 'other'
}

/** Full grouped response: { [YYYY-MM-DD]: StudentMenuDateEntry } */
export interface StudentMenuByDate {
  [date: string]: StudentMenuDateEntry
}

// ─── State ──────────────────────────────────────────────────────────────────

interface StudentState {
  // Menu
  /** Legacy flat slot map (first date's slots, or empty) — kept for backwards compatibility */
  menu: StudentMenuGrouped
  /** Legacy single-date field */
  menuDate: string | null
  /** Full grouped-by-date response from API */
  menuDates: StudentMenuByDate
  /** Convenience: today's slot map (may be empty) */
  menuToday: StudentMenuGrouped
  /** Convenience: tomorrow's slot map (may be empty) */
  menuTomorrow: StudentMenuGrouped
  /** Today's date string YYYY-MM-DD as returned by the API */
  today: string | null
  /** Tomorrow's date string YYYY-MM-DD as returned by the API */
  tomorrow: string | null
  isLoadingMenu: boolean
  /** Set when the last fetchMenu() call failed; cleared on the next successful fetch */
  menuError: string | null

  // Orders
  orders: StudentOrder[]
  upcomingOrders: StudentOrder[]
  pastOrders: StudentOrder[]
  isLoadingOrders: boolean
  /** Set when the last fetchOrders() call failed; cleared on the next successful fetch */
  ordersError: string | null

  // Actions
  fetchMenu: () => Promise<void>
  fetchOrders: () => Promise<void>
  createOrder: (tiffinMenuId: string, quantity?: number) => Promise<{ error: Error | null; order?: StudentOrder }>
  cancelOrder: (orderId: string) => Promise<{ error: Error | null }>
  payWithBalance: (orderId: string) => Promise<{ error: Error | null }>
  initiatePayment: (orderId: string) => Promise<{ error: Error | null; paymentUrl?: string; tranId?: string }>
}

// ─── Helper ─────────────────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? `Bearer ${session.access_token}` : null
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useStudentStore = create<StudentState>((set, get) => ({
  menu: {},
  menuDate: null,
  menuDates: {},
  menuToday: {},
  menuTomorrow: {},
  today: null,
  tomorrow: null,
  isLoadingMenu: false,
  menuError: null,

  orders: [],
  upcomingOrders: [],
  pastOrders: [],
  isLoadingOrders: false,
  ordersError: null,

  fetchMenu: async () => {
    set({ isLoadingMenu: true, menuError: null })
    try {
      const token = await getAuthHeader()
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/student/menu', {
        headers: { Authorization: token },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.detail) console.error('fetchMenu API detail:', err.detail)
        throw new Error(err.error || `Failed to fetch menu: ${res.status} ${res.statusText}`)
      }
      const data = await res.json()
      console.log('Student menu API response:', data)

      // New grouped-by-date shape
      const menuDates: StudentMenuByDate = data.dates ?? {}
      const todayStr: string | null = data.today ?? null
      const tomorrowStr: string | null = data.tomorrow ?? null

      const menuToday: StudentMenuGrouped = todayStr && menuDates[todayStr]
        ? menuDates[todayStr].slots
        : {}
      const menuTomorrow: StudentMenuGrouped = tomorrowStr && menuDates[tomorrowStr]
        ? menuDates[tomorrowStr].slots
        : {}

      // Legacy compat: expose first available date's slots as `menu`
      const firstDate = Object.keys(menuDates).sort()[0]
      const legacyMenu: StudentMenuGrouped = firstDate ? menuDates[firstDate].slots : {}

      set({
        menuDates,
        menuToday,
        menuTomorrow,
        today: todayStr,
        tomorrow: tomorrowStr,
        // legacy fields
        menu: legacyMenu,
        menuDate: data.date ?? todayStr,
      })
    } catch (error) {
      console.error('fetchMenu error:', error)
      // Store empty menus on error so the UI shows "No tiffin scheduled"
      set({
        menuDates: {},
        menuToday: {},
        menuTomorrow: {},
        menu: {},
        menuDate: null,
        today: null,
        tomorrow: null,
        menuError: (error as Error).message || 'Failed to load menu',
      })
    } finally {
      set({ isLoadingMenu: false })
    }
  },

  fetchOrders: async () => {
    set({ isLoadingOrders: true, ordersError: null })
    try {
      const token = await getAuthHeader()
      if (!token) throw new Error('Not authenticated')

      const res = await fetch('/api/student/orders/list', {
        headers: { Authorization: token },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch orders')
      }
      const data = await res.json()
      set({
        orders: [...(data.upcoming ?? []), ...(data.past ?? [])],
        upcomingOrders: data.upcoming ?? [],
        pastOrders: data.past ?? [],
      })
    } catch (error) {
      console.error('fetchOrders error:', error)
      set({ ordersError: (error as Error).message || 'Failed to load orders' })
    } finally {
      set({ isLoadingOrders: false })
    }
  },

  createOrder: async (tiffinMenuId, quantity = 1) => {
    try {
      const token = await getAuthHeader()
      if (!token) return { error: new Error('Not authenticated') }

      const res = await fetch('/api/student/orders/create', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiffin_menu_id: tiffinMenuId, quantity }),
      })
      const data = await res.json()
      if (!res.ok) return { error: new Error(data.error || 'Failed to create order') }

      // Refresh orders list
      await get().fetchOrders()
      return { error: null, order: data.order }
    } catch (error) {
      return { error: error as Error }
    }
  },

  cancelOrder: async (orderId) => {
    try {
      const token = await getAuthHeader()
      if (!token) return { error: new Error('Not authenticated') }

      // Update status directly via Supabase client (student can update own rows per RLS)
      const { error } = await supabase
        .from('student_orders')
        // @ts-ignore
        .update({ status: 'cancelled' })
        .eq('id', orderId)

      if (error) return { error: new Error(error.message) }

      // Optimistically update local state
      set((state) => ({
        orders: state.orders.map((o) =>
          o.id === orderId ? { ...o, status: 'cancelled' as const } : o
        ),
        upcomingOrders: state.upcomingOrders.filter((o) => o.id !== orderId),
        pastOrders: state.pastOrders.map((o) =>
          o.id === orderId ? { ...o, status: 'cancelled' as const } : o
        ),
      }))

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  payWithBalance: async (orderId) => {
    try {
      const token = await getAuthHeader()
      if (!token) return { error: new Error('Not authenticated') }

      const state = get()
      const order = state.orders.find(o => o.id === orderId)
      if (!order) return { error: new Error('Order not found') }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return { error: new Error('Not authenticated') }

      // Deduct balance
      const { error: balanceError } = await supabase.rpc('deduct_meal_balance' as any, {
        p_user_id: user.id,
        p_amount: order.total_amount
      } as any)
      
      if (balanceError) throw balanceError

      // Update status directly via Supabase client (student can update own rows per RLS)
      const { error } = await supabase
        .from('student_orders')
        // @ts-ignore
        .update({ status: 'paid' })
        .eq('id', orderId)

      if (error) return { error: new Error(error.message) }

      // Optimistically update local state
      set((state) => ({
        orders: state.orders.map((o) =>
          o.id === orderId ? { ...o, status: 'paid' as const } : o
        ),
        upcomingOrders: state.upcomingOrders.map((o) =>
          o.id === orderId ? { ...o, status: 'paid' as const } : o
        ),
        pastOrders: state.pastOrders.map((o) =>
          o.id === orderId ? { ...o, status: 'paid' as const } : o
        ),
      }))

      // trigger fetch profile to update balance in auth store
      useAuthStore.getState().fetchProfile(user.id)

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  initiatePayment: async (orderId) => {
    try {
      const token = await getAuthHeader()
      if (!token) return { error: new Error('Not authenticated') }

      const res = await fetch('/api/payments/initiate', {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      })
      const data = await res.json()
      if (!res.ok) return { error: new Error(data.error || 'Failed to initiate payment') }

      return { error: null, paymentUrl: data.payment_url, tranId: data.tran_id }
    } catch (error) {
      return { error: error as Error }
    }
  },
}))
