import { z } from 'zod'

// UUID validation helper
const uuidSchema = z.string().uuid({ message: 'Invalid UUID format' })

// Date validation helper (YYYY-MM-DD)
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Date must be in YYYY-MM-DD format'
}).refine((date) => {
  const parsed = new Date(date + 'T00:00:00Z')
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}, {
  message: 'Invalid calendar date'
})

// String sanitization helpers - apply validations before transform
const sanitizedString = z.string()
  .max(500, { message: 'String too long (max 500 characters)' })

const sanitizedText = z.string()
  .max(2000, { message: 'Text too long (max 2000 characters)' })

// URL string validation (max 500 chars, then trim)
const urlString = z.string()
  .max(500, { message: 'URL too long' })
  .url({ message: 'Invalid URL format' })

// Booking validation schemas
export const createBookingSchema = z.object({
  menu_schedule_id: uuidSchema,
  notes: sanitizedText.optional().nullable().default(null).transform(s => s?.trim() || null),
})

export const cancelBookingSchema = z.object({
  booking_id: uuidSchema,
})

export const bookingHistoryQuerySchema = z.object({
  userId: uuidSchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'denied', 'all']).optional().default('all'),
})

// Admin meal management schemas
export const createMealSchema = z.object({
  name: sanitizedString.min(1, { message: 'Name is required' }).max(100).transform(s => s.trim()),
  description: sanitizedText.optional().nullable().default(null).transform(s => s?.trim() || null),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner']).optional().default('lunch'),
  dietary_tags: z.array(sanitizedString.transform(s => s.trim())).max(10).optional().nullable().default(null),
  image_url: urlString.optional().nullable().default(null),
})

export const updateMealSchema = z.object({
  id: uuidSchema,
  name: sanitizedString.min(1).max(100).optional().transform(s => s?.trim()),
  description: sanitizedText.optional().nullable().transform(s => s?.trim() || null),
  meal_type: z.enum(['breakfast', 'lunch', 'dinner']).optional(),
  dietary_tags: z.array(sanitizedString.transform(s => s.trim())).max(10).optional().nullable(),
  image_url: urlString.optional().nullable(),
  is_active: z.boolean().optional(),
  price: z.number().nonnegative().max(10000).optional(),
}).refine((data) => {
  // At least one field to update (besides id)
  const updateFields = Object.keys(data).filter(k => k !== 'id')
  return updateFields.length > 0
}, {
  message: 'At least one field must be provided to update'
})

export const deleteMealSchema = z.object({
  id: uuidSchema,
})

// Admin booking management schemas
export const approveBookingSchema = z.object({
  booking_id: uuidSchema,
})

export const denyBookingSchema = z.object({
  booking_id: uuidSchema,
  reason: sanitizedText.max(500).optional().nullable().default(null).transform(s => s?.trim() || null),
})

// Notification schemas
export const markNotificationReadSchema = z.object({
  notification_id: uuidSchema.optional(),
  mark_all: z.boolean().optional().default(false),
}).refine((data) => {
  return data.notification_id !== undefined || data.mark_all === true
}, {
  message: 'Either notification_id or mark_all must be provided'
})

// User management schemas
export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
})

// Schedule/Menu schemas
export const scheduleQuerySchema = z.object({
  date: dateSchema,
})

// Auth-related schemas (for logging)
export const authEventSchema = z.object({
  event: z.enum(['LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'PASSWORD_RESET_REQUEST', 'PASSWORD_RESET_SUCCESS', 'UNAUTHORIZED_ACCESS', 'FORBIDDEN_ACCESS']),
  email: z.string().email().optional(),
  userId: uuidSchema.optional(),
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/).optional(),
  userAgent: z.string().max(500).optional(),
  timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/),
  details: z.record(z.string(), z.unknown()).optional(),
})

// Validation helper function
export interface ValidationError {
  path: (string | number)[]
  message: string
}

export type ValidationSuccess<T> = { success: true; data: T; errors?: never }
export type ValidationFailure = { success: false; errors: ValidationError[]; data?: never }
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  // Convert Zod issues to our ValidationError format
  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    path: issue.path.map(p => typeof p === 'symbol' ? String(p) : p) as (string | number)[],
    message: issue.message,
  }))
  return { success: false, errors }
}

// Sanitization helpers
export function sanitizeString(input: string): string {
  return input
    .trim()
    .slice(0, 500)
    .replace(/[<>]/g, '') // Basic XSS prevention
}

export function sanitizeEmail(input: string): string {
  return input.toLowerCase().trim().slice(0, 255)
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const maskedLocal = local.length > 2 
    ? local[0] + '*'.repeat(local.length - 2) + local.slice(-1)
    : '*'.repeat(local.length)
  return `${maskedLocal}@${domain}`
}

// Export all schemas
export const schemas = {
  createBooking: createBookingSchema,
  cancelBooking: cancelBookingSchema,
  bookingHistory: bookingHistoryQuerySchema,
  createMeal: createMealSchema,
  updateMeal: updateMealSchema,
  deleteMeal: deleteMealSchema,
  approveBooking: approveBookingSchema,
  denyBooking: denyBookingSchema,
  markNotificationRead: markNotificationReadSchema,
  listUsers: listUsersQuerySchema,
  schedule: scheduleQuerySchema,
  authEvent: authEventSchema,
}
