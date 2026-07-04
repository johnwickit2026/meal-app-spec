import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatTime(time: string): string {
  if (!time) return ''
  const match = time.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i)
  if (!match) return time // Fallback for plain text like "Sehri"
  if (match[3]) return time // Already has AM/PM
  
  const hour = parseInt(match[1], 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${match[2]} ${ampm}`
}

export function getMealDeadline(scheduledDate: string, timeSlot: string, deadlineHours: number): Date {
  const match = timeSlot.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i)
  let hours = 23
  let minutes = 59
  if (match) {
    hours = parseInt(match[1], 10)
    minutes = parseInt(match[2], 10)
    const ampm = match[3]?.toUpperCase()
    if (ampm === 'PM' && hours < 12) hours += 12
    if (ampm === 'AM' && hours === 12) hours = 0
  }
  const mealDate = new Date(`${scheduledDate}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`)
  return new Date(mealDate.getTime() - deadlineHours * 60 * 60 * 1000)
}

export function formatDateShort(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export function isToday(date: Date | string): boolean {
  const today = new Date()
  const compareDate = new Date(date)
  return (
    today.getFullYear() === compareDate.getFullYear() &&
    today.getMonth() === compareDate.getMonth() &&
    today.getDate() === compareDate.getDate()
  )
}

export function isFuture(date: Date | string, time?: string): boolean {
  const now = new Date()
  const compareDate = new Date(date)
  
  if (time) {
    const [hours, minutes] = time.split(':')
    compareDate.setHours(parseInt(hours), parseInt(minutes))
  }
  
  return compareDate > now
}

export function canCancelBooking(date: Date | string, time: string): boolean {
  const now = new Date()
  const bookingTime = new Date(date)
  const [hours, minutes] = time.split(':')
  bookingTime.setHours(parseInt(hours), parseInt(minutes))
  
  // Can cancel if more than 1 hour before the meal time
  const oneHourBefore = new Date(bookingTime.getTime() - 60 * 60 * 1000)
  return now < oneHourBefore
}

export function getStatusBadgeClass(status: string): string {
  const classes: Record<string, string> = {
    pending: 'badge-pending',
    confirmed: 'badge-confirmed',
    denied: 'badge-denied',
    cancelled: 'badge-cancelled',
  }
  return classes[status] || 'badge'
}

export function getCapacityIndicator(remaining: number): {
  color: string
  label: string
} {
  if (remaining <= 0) {
    return { color: 'text-red-600 bg-red-50', label: 'Full' }
  }
  if (remaining <= 3) {
    return { color: 'text-yellow-600 bg-yellow-50', label: `${remaining} left` }
  }
  return { color: 'text-green-600 bg-green-50', label: `${remaining} available` }
}

// Convert English numerals to Bengali numerals
const bengaliNumerals = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']

export function toBengaliNumber(num: number | string): string {
  return num.toString().split('').map(char => {
    if (char >= '0' && char <= '9') {
      return bengaliNumerals[parseInt(char)]
    }
    return char
  }).join('')
}

/**
 * Adds Supabase image transformation parameters to resize images
 * Reduces download size significantly for avatars and thumbnails
 * @param url - The original Supabase storage URL
 * @param width - Desired width in pixels
 * @param height - Desired height in pixels
 * @returns Optimized URL with transformation parameters
 */
export function getOptimizedImageUrl(url: string | null | undefined, width = 128, height = 128): string | undefined {
  if (!url) return undefined
  
  // Only transform Supabase storage URLs
  if (!url.includes('.supabase.co/storage/v1/object/public/')) {
    return url
  }
  
  // Add transformation parameters
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}width=${width}&height=${height}&quality=80&fit=cover`
}
