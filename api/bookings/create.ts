import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { createBookingSchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

export const handler: Handler = async (event: HandlerEvent) => {
  const { req, res } = createReqRes(event)
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method }
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting check
  const rateLimitKey = `booking_create:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { 
        reason: 'Booking creation rate limit exceeded',
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
    const validation = validateInput(createBookingSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid input',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      })
    }

    const { menu_schedule_id, notes } = validation.data

    // Get schedule details
    const { data: schedule, error: scheduleError } = await supabase
      .from('menu_schedules')
      .select('scheduled_date, time_slot, capacity, ordering_deadline_hours')
      .eq('id', menu_schedule_id)
      .single()

    if (scheduleError || !schedule) {
      return res.status(404).json({ error: 'Schedule not found' })
    }

    // Check ordering deadline
    const match = schedule.time_slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
    let hours = 23
    let minutes = 59
    if (match) {
      hours = parseInt(match[1], 10)
      minutes = parseInt(match[2], 10)
      const ampm = match[3]?.toUpperCase()
      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0
    }
    const mealDateStr = `${schedule.scheduled_date}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00+06:00`
    const mealDate = new Date(mealDateStr)
    const deadline = new Date(mealDate.getTime() - (schedule.ordering_deadline_hours || 1) * 60 * 60 * 1000)
    
    if (new Date() > deadline) {
      return res.status(400).json({ error: "Ordering deadline has passed for this meal" })
    }


    // Parallelize independent queries: existing bookings check + capacity check
    const [
      { data: existingBooking, error: existingError },
      { count, error: countError }
    ] = await Promise.all([
      // Check if user already has a booking at this time slot
      supabase
        .from('bookings')
        .select(`
          id,
          menu_schedule:menu_schedules!inner (
            scheduled_date,
            time_slot
          )
        `)
        .eq('user_id', user.id)
        .in('status', ['pending', 'confirmed']),
      // Check slot capacity
      supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('menu_schedule_id', menu_schedule_id)
        .in('status', ['pending', 'confirmed'])
    ])

    if (existingError) throw existingError
    if (countError) throw countError

    const hasConflict = existingBooking?.some(
      (booking: any) => {
        const ms = Array.isArray(booking.menu_schedule) ? booking.menu_schedule[0] : booking.menu_schedule
        return ms?.scheduled_date === schedule.scheduled_date && ms?.time_slot === schedule.time_slot
      }
    )

    if (hasConflict) {
      return res.status(409).json({ error: 'You already have a booking at this time slot' })
    }

    if (count !== null && count >= schedule.capacity) {
      return res.status(409).json({ error: 'This time slot is fully booked' })
    }

    // Create the booking
    const { data: newBooking, error: createError } = await supabase
      .from('bookings')
      .insert({
        user_id: user.id,
        menu_schedule_id,
        status: 'pending',
        notes: notes,
      })
      .select()
      .single()

    if (createError) throw createError

    // Log successful booking creation
    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: { 
        action: 'BOOKING_CREATED',
        bookingId: newBooking.id,
        menuScheduleId: menu_schedule_id 
      }
    })

    // Create notification for the user
    await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'reminder',
      message: `Your booking is pending approval.`,
    })

    return res.status(201).json(newBooking)
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Booking creation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
