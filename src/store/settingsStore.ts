import { create } from 'zustand'
import { supabase } from '../lib/supabaseClient'

interface SettingsState {
  bookingTimeLimit: number // minutes before meal time when booking closes
  cancellationTimeLimit: number // minutes before meal time when cancellation is allowed
  advancePaymentEnabled: boolean // whether advance payment feature is enabled
  autoConfirmEnabled: boolean // whether to auto-confirm orders within the time window
  isLoading: boolean
  error: string | null

  // Actions
  fetchSettings: () => Promise<void>
  updateSetting: (key: string, value: string, userId?: string) => Promise<{ error: Error | null }>
}

const DEFAULT_BOOKING_TIME_LIMIT = 60 // 1 hour before meal time
const DEFAULT_CANCELLATION_TIME_LIMIT = 120 // 2 hours before meal time
const DEFAULT_ADVANCE_PAYMENT_ENABLED = false
const DEFAULT_AUTO_CONFIRM_ENABLED = true

export const useSettingsStore = create<SettingsState>((set) => ({
  bookingTimeLimit: DEFAULT_BOOKING_TIME_LIMIT,
  cancellationTimeLimit: DEFAULT_CANCELLATION_TIME_LIMIT,
  advancePaymentEnabled: DEFAULT_ADVANCE_PAYMENT_ENABLED,
  autoConfirmEnabled: DEFAULT_AUTO_CONFIRM_ENABLED,
  isLoading: false,
  error: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null })
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('*')
        .in('key', ['booking_time_limit', 'cancellation_time_limit', 'advance_payment_enabled', 'auto_confirm_enabled'])

      if (error) throw error

      const settings: Record<string, number | boolean> = {
        booking_time_limit: DEFAULT_BOOKING_TIME_LIMIT,
        cancellation_time_limit: DEFAULT_CANCELLATION_TIME_LIMIT,
        advance_payment_enabled: DEFAULT_ADVANCE_PAYMENT_ENABLED,
        auto_confirm_enabled: DEFAULT_AUTO_CONFIRM_ENABLED,
      }

      data?.forEach((setting) => {
        if (setting.key === 'advance_payment_enabled' || setting.key === 'auto_confirm_enabled') {
          settings[setting.key] = setting.value === 'true'
        } else {
          settings[setting.key] = parseInt(setting.value, 10) || settings[setting.key]
        }
      })

      set({
        bookingTimeLimit: settings.booking_time_limit as number,
        cancellationTimeLimit: settings.cancellation_time_limit as number,
        advancePaymentEnabled: settings.advance_payment_enabled as boolean,
        autoConfirmEnabled: settings.auto_confirm_enabled as boolean,
      })
    } catch (error) {
      set({ error: (error as Error).message })
      // Keep defaults on error
    } finally {
      set({ isLoading: false })
    }
  },

  updateSetting: async (key: string, value: string, userId?: string) => {
    try {
      const { error } = await supabase
        .from('app_settings')
        .upsert(
          {
            key,
            value,
            updated_at: new Date().toISOString(),
            updated_by: userId || null,
          },
          { onConflict: 'key' }
        )

      if (error) throw error

      // Update local state
      if (key === 'booking_time_limit') {
        set({ bookingTimeLimit: parseInt(value, 10) })
      } else if (key === 'cancellation_time_limit') {
        set({ cancellationTimeLimit: parseInt(value, 10) })
      } else if (key === 'advance_payment_enabled') {
        set({ advancePaymentEnabled: value === 'true' })
      } else if (key === 'auto_confirm_enabled') {
        set({ autoConfirmEnabled: value === 'true' })
      }

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },
}))

import { getMealDeadline } from '../lib/utils'

// Helper function to check if booking is still allowed.
// Bookings stay open right up until the meal time itself; the ordering
// deadline is intentionally ignored so meals (incl. same-day) remain bookable.
export function isBookingAllowed(
  scheduledDate: string,
  timeSlot: string,
  _orderingDeadlineHours: number
): boolean {
  const cutoffTime = getMealDeadline(scheduledDate, timeSlot, 0)
  return new Date() < cutoffTime
}

// Helper function to get remaining time for booking (counts down to meal time)
export function getBookingTimeRemaining(
  scheduledDate: string,
  timeSlot: string,
  _orderingDeadlineHours: number
): { hours: number; minutes: number; totalMinutes: number; isExpired: boolean } {
  const now = new Date()
  const cutoffTime = getMealDeadline(scheduledDate, timeSlot, 0)
  
  const diffMs = cutoffTime.getTime() - now.getTime()
  const totalMinutes = Math.max(0, Math.floor(diffMs / (1000 * 60)))
  const hrs = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60

  return {
    hours: hrs,
    minutes: mins,
    totalMinutes,
    isExpired: diffMs <= 0,
  }
}

// Helper function to check if cancellation is allowed
export function isCancellationAllowed(
  scheduledDate: string,
  timeSlot: string,
  cancellationTimeLimitMinutes: number
): boolean {
  const now = new Date()
  const mealTime = getMealDeadline(scheduledDate, timeSlot, 0)

  const cutoffTime = new Date(mealTime.getTime() - cancellationTimeLimitMinutes * 60 * 1000)
  return now < cutoffTime
}
