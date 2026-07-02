import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'
import { useSettingsStore } from './settingsStore'
import type { BookingWithDetails, MenuScheduleWithMeal } from '../types'

interface BookingState {
  bookings: BookingWithDetails[]
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  cachedUserId: string | null

  // Actions
  fetchUserBookings: (userId: string, forceRefresh?: boolean) => Promise<void>
  fetchAllBookings: (forceRefresh?: boolean) => Promise<BookingWithDetails[]>
  createBooking: (menuScheduleId: string, userId: string, notes?: string, quantity?: number) => Promise<{ error: Error | null }>
  createManualBooking: (menuScheduleId: string, targetUserId: string, notes: string | undefined, quantity: number, adminId: string) => Promise<{ error: Error | null }>
  cancelBooking: (bookingId: string) => Promise<{ error: Error | null }>
  updateBookingStatus: (bookingId: string, status: 'confirmed' | 'denied' | 'cancelled') => Promise<{ error: Error | null }>
  checkConflict: (userId: string, date: string, timeSlot: string) => Promise<boolean>
}

const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export const useBookingStore = create<BookingState>((set, get) => ({
  bookings: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  cachedUserId: null,

  fetchUserBookings: async (userId: string, forceRefresh = false) => {
    const { lastFetched, cachedUserId, bookings } = get()

    // Return cached data if valid (same user, within cache duration, and not forced)
    const isCacheValid = lastFetched &&
      cachedUserId === userId &&
      Date.now() - lastFetched < CACHE_DURATION &&
      !forceRefresh

    if (isCacheValid) {
      return
    }

    set({ isLoading: bookings.length === 0, error: null }) // Only show loading if no cached data
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules (
            *,
            meal:meals (*)
          )
        `)
        .eq('user_id', userId)
        .order('booked_at', { ascending: false })

      if (error) throw error

      set({
        bookings: data as BookingWithDetails[],
        lastFetched: Date.now(),
        cachedUserId: userId
      })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  fetchAllBookings: async (forceRefresh = false) => {
    const { lastFetched, cachedUserId, bookings } = get()

    // Return cached data if valid (must be 'all' cache, within cache duration, and not forced)
    const isCacheValid = lastFetched &&
      cachedUserId === 'all' &&
      Date.now() - lastFetched < CACHE_DURATION &&
      !forceRefresh

    if (isCacheValid) {
      return bookings
    }

    set({ isLoading: bookings.length === 0, error: null })
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules (
            *,
            meal:meals (*)
          ),
          profile:profiles (*)
        `)
        .order('booked_at', { ascending: false })

      if (error) throw error

      set({
        bookings: data as BookingWithDetails[],
        lastFetched: Date.now(),
        cachedUserId: 'all'
      })
      return data as BookingWithDetails[]
    } catch (error) {
      set({ error: (error as Error).message })
      return []
    } finally {
      set({ isLoading: false })
    }
  },

  createBooking: async (menuScheduleId: string, userId: string, notes?: string, quantity: number = 1) => {
    try {
      // Use atomic database function to prevent race conditions
      const { error } = await supabase.rpc('create_booking_atomic', {
        p_user_id: userId,
        p_menu_schedule_id: menuScheduleId,
        p_notes: notes || null,
        p_quantity: quantity,
      })

      if (error) {
        // Check for foreign key constraint violation
        if (error.message?.includes('bookings_user_id_fkey')) {
          return { error: new Error('User profile not found. Please complete your profile first.') }
        }
        throw new Error(error.message)
      }

      // Check settings and deduct balance if enabled
      const { advancePaymentEnabled } = useSettingsStore.getState();
      if (advancePaymentEnabled) {
        // Get the meal price
        const { data: scheduleData } = await supabase
          .from('menu_schedules')
          .select('price, meal:meals(price)')
          .eq('id', menuScheduleId)
          .single();
          
        let mealPrice = 0;
        if (scheduleData) {
          const sPrice = scheduleData.price;
          // @ts-ignore
          const mPrice = scheduleData.meal?.price;
          mealPrice = sPrice ?? mPrice ?? 0;
        }

        const totalDeduction = mealPrice * quantity;
        
        if (totalDeduction > 0) {
          await supabase.rpc('deduct_meal_balance' as any, { 
            p_user_id: userId, 
            p_amount: totalDeduction 
          });
        }
      }

      // Refresh bookings (force refresh to bypass cache)
      await get().fetchUserBookings(userId, true)

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  createManualBooking: async (menuScheduleId: string, targetUserId: string, notes: string | undefined, quantity: number, _adminId: string) => {
    try {
      const { error } = await supabase.from('bookings').insert({
        menu_schedule_id: menuScheduleId,
        user_id: targetUserId,
        notes: notes || null,
        quantity,
        status: 'confirmed'
      })

      if (error) {
        throw new Error(error.message)
      }

      await get().fetchAllBookings(true)

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  cancelBooking: async (bookingId: string) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return { error: new Error('Not authenticated') }

      const res = await fetch('/api/bookings/cancel', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ booking_id: bookingId }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: new Error(data.error || `Cancel failed: ${res.status}`) }

      // Update local state only after confirmed server update
      set((state) => ({
        bookings: state.bookings.map((b) =>
          b.id === bookingId ? { ...b, status: 'cancelled' } : b
        ),
      }))

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  updateBookingStatus: async (bookingId: string, status: 'confirmed' | 'denied' | 'cancelled') => {
    try {
      const { error } = await supabase
        .from('bookings')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', bookingId)

      if (error) throw error

      // Update local state
      set((state) => ({
        bookings: state.bookings.map((b) =>
          b.id === bookingId ? { ...b, status } : b
        ),
      }))

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  checkConflict: async (userId: string, date: string, timeSlot: string) => {
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id,
        menu_schedule:menu_schedules!inner (
          scheduled_date,
          time_slot
        )
      `)
      .eq('user_id', userId)
      .in('status', ['pending', 'confirmed'])

    if (error) {
      console.error('Error checking conflict:', error)
      return false
    }

    type BookingWithSchedule = { id: string; menu_schedule: { scheduled_date: string; time_slot: string } | { scheduled_date: string; time_slot: string }[] }
    return (data as unknown as BookingWithSchedule[]).some(
      (booking) => {
        const schedule = Array.isArray(booking.menu_schedule) 
          ? booking.menu_schedule[0] 
          : booking.menu_schedule
        return schedule?.scheduled_date === date && schedule?.time_slot === timeSlot
      }
    )
  },
}))

// Menu store for fetching schedules
interface MenuState {
  schedules: MenuScheduleWithMeal[]
  isLoading: boolean
  error: string | null
  lastFetched: number | null
  cachedDate: string | null

  fetchSchedules: (date: string, forceRefresh?: boolean) => Promise<void>
  fetchSchedulesByDateRange: (startDate: string, endDate: string, forceRefresh?: boolean) => Promise<void>
}

export const useMenuStore = create<MenuState>((set, get) => ({
  schedules: [],
  isLoading: false,
  error: null,
  lastFetched: null,
  cachedDate: null,

  fetchSchedules: async (date: string, forceRefresh = false) => {
    const { lastFetched, cachedDate, schedules } = get()

    // Return cached data if valid (same date, within cache duration)
    const isCacheValid = lastFetched &&
      cachedDate === date &&
      Date.now() - lastFetched < CACHE_DURATION &&
      !forceRefresh

    if (isCacheValid) {
      return
    }

    set({ isLoading: schedules.length === 0, error: null })
    try {
      // Fetch schedules and booking counts in parallel
      const [{ data: schedulesData, error: schedulesError }, { data: bookingsData }] = await Promise.all([
        supabase
          .from('menu_schedules')
          .select(`
            *,
            meal:meals (*)
          `)
          .eq('scheduled_date', date)
          .eq('is_available', true)
          .order('time_slot', { ascending: true }),
        supabase
          .from('bookings')
          .select('menu_schedule_id, quantity')
          .eq('status', 'confirmed')
          .or('status.eq.pending')
      ])

      if (schedulesError) throw schedulesError

      // Count bookings per schedule in memory (sum of quantities)
      const bookingCounts: Record<string, number> = {}
      if (bookingsData) {
        for (const booking of bookingsData) {
          bookingCounts[booking.menu_schedule_id] = (bookingCounts[booking.menu_schedule_id] || 0) + (booking.quantity || 1)
        }
      }

      type ScheduleWithMeal = MenuScheduleWithMeal & { id: string; capacity: number }
      
      const schedulesWithCounts = ((schedulesData || []) as ScheduleWithMeal[]).map((schedule) => ({
        ...schedule,
        booking_count: bookingCounts[schedule.id] || 0,
        remaining_capacity: schedule.capacity - (bookingCounts[schedule.id] || 0),
      }))

      set({
        schedules: schedulesWithCounts as MenuScheduleWithMeal[],
        lastFetched: Date.now(),
        cachedDate: date
      })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },

  fetchSchedulesByDateRange: async (startDate: string, endDate: string, forceRefresh = false) => {
    const { lastFetched, cachedDate, schedules } = get()

    // Return cached data if valid
    const isCacheValid = lastFetched &&
      cachedDate === `${startDate}-${endDate}` &&
      Date.now() - lastFetched < CACHE_DURATION &&
      !forceRefresh

    if (isCacheValid) {
      return
    }

    set({ isLoading: schedules.length === 0, error: null })
    try {
      const { data, error } = await supabase
        .from('menu_schedules')
        .select(`
          *,
          meal:meals (*)
        `)
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)
        .eq('is_available', true)
        .order('scheduled_date', { ascending: true })
        .order('time_slot', { ascending: true })

      if (error) throw error

      set({
        schedules: data as MenuScheduleWithMeal[],
        lastFetched: Date.now(),
        cachedDate: `${startDate}-${endDate}`
      })
    } catch (error) {
      set({ error: (error as Error).message })
    } finally {
      set({ isLoading: false })
    }
  },
}))
