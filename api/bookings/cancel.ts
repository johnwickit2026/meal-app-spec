import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { cancelBookingSchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log(`[cancel] ${req.method} /api/bookings/cancel — body:`, req.body)
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'PATCH') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method }
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting check
  const rateLimitKey = `booking_cancel:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { 
        reason: 'Booking cancellation rate limit exceeded',
        resetTime: rateLimitResult.resetTime 
      }
    })
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
    })
  }

  // Verify JWT token
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
      severity: 'WARNING',
      details: { reason: 'Missing or invalid authorization header' }
    })
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    // Verify the token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
        severity: 'WARNING',
        details: { reason: 'Invalid token', error: authError?.message }
      })
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Validate and sanitize input
    const validation = validateInput(cancelBookingSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      })
    }

    const { booking_id } = validation.data

    // Determine if the caller is an admin (admins may cancel any booking)
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const isAdmin = callerProfile?.role === 'admin'

    // Get booking with schedule details
    let bookingQuery = supabase
      .from('bookings')
      .select(`
        *,
        menu_schedule:menu_schedules (
          scheduled_date,
          time_slot
        )
      `)
      .eq('id', booking_id)

    // Non-admins can only cancel their own bookings
    if (!isAdmin) {
      bookingQuery = bookingQuery.eq('user_id', user.id)
    }

    const { data: booking, error: bookingError } = await bookingQuery.single()

    if (bookingError || !booking) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    // Check if booking can be cancelled (pending or confirmed)
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return res.status(400).json({ error: 'This booking cannot be cancelled' })
    }

    // Check if it's more than 1 hour before the meal time
    const mealTime = new Date(`${booking.menu_schedule.scheduled_date}T${booking.menu_schedule.time_slot}`)
    const oneHourBefore = new Date(mealTime.getTime() - 60 * 60 * 1000)
    
    if (new Date() >= oneHourBefore) {
      return res.status(400).json({ error: 'Cancellation deadline has passed (1 hour before meal time)' })
    }

    // Cancel the booking
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateError) throw updateError

    // Log successful cancellation
    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: { 
        action: 'BOOKING_CANCELLED',
        bookingId: booking_id
      }
    })

    // Create notification for the user
    await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'cancelled',
      message: `Your booking has been cancelled.`,
    })

    return res.status(200).json(updatedBooking)
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Booking cancellation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
