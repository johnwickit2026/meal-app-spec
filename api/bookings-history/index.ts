import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { isAdmin as checkIsAdmin } from '../_utils.js'
import { bookingHistoryQuerySchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

let supabase: SupabaseClient<any, any, any>

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

type UserRole = 'employee' | 'admin' | 'food_editor' | 'finance_editor'

async function verifyTokenWithRole(token: string): Promise<{ user: any, role: UserRole } | null> {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('Profile query error:', profileError)
    return null
  }

  return { user, role: profile?.role as UserRole }
}

export const handler: Handler = async (event: HandlerEvent) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        success: false, 
        error: 'Server configuration error' 
      })
    }
  }

  supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { req, res } = createReqRes(event)
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'GET') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method }
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting check
  const rateLimitKey = `booking_history:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Booking history rate limit exceeded' }
    })
    return res.status(429).json({ 
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
    })
  }

  try {
    // Verify token
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
        severity: 'WARNING',
        details: { reason: 'Missing authorization token' }
      })
      return res.status(401).json({ error: 'No authorization token' })
    }

    const auth = await verifyTokenWithRole(token)
    if (!auth) {
      logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
        severity: 'WARNING',
        details: { reason: 'Invalid token' }
      })
      return res.status(401).json({ error: 'Invalid token' })
    }

    const { user, role } = auth
    const isAdmin = checkIsAdmin(role)

    // Validate query parameters
    const validation = validateInput(bookingHistoryQuerySchema, {
      userId: req.query.userId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
    })
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      })
    }

    const { userId, startDate, endDate, status } = validation.data

    // Build the query
    let query = supabase
      .from('bookings')
      .select(`
        id,
        status,
        notes,
        booked_at,
        updated_at,
        user_id,
        profiles:user_id (id, full_name, email, department),
        menu_schedule:menu_schedule_id (
          id,
          scheduled_date,
          time_slot,
          price,
          meal:meal_id (id, name, description, meal_type, image_url)
        )
      `)

    // If not admin, only show own bookings
    if (!isAdmin) {
      query = query.eq('user_id', user.id)
    } else if (userId) {
      // Admin can filter by specific user
      query = query.eq('user_id', userId)
    }

    // Apply date filters
    if (startDate) {
      query = query.gte('menu_schedule.scheduled_date', startDate)
    }
    if (endDate) {
      query = query.lte('menu_schedule.scheduled_date', endDate)
    }

    // Apply status filter
    if (status && status !== 'all') {
      query = query.eq('status', status)
    }

    // Order by date descending
    query = query.order('booked_at', { ascending: false })

    const { data: bookings, error } = await query

    if (error) {
      // Log error but don't leak details to client
      console.error('Error fetching bookings:', error)
      return res.status(500).json({ error: 'Failed to fetch booking history' })
    }

    // Log successful access for admin viewing other users' data
    if (isAdmin && userId && userId !== user.id) {
      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { 
          action: 'VIEW_USER_BOOKING_HISTORY',
          targetUserId: userId 
        }
      })
    }
    
    // Transform the data for the frontend
    const history = bookings?.map((booking: any) => ({
      id: booking.id,
      status: booking.status,
      notes: booking.notes,
      booked_at: booking.booked_at,
      updated_at: booking.updated_at,
      user: booking.profiles,
      meal: booking.menu_schedule?.meal,
      schedule: {
        id: booking.menu_schedule?.id,
        scheduled_date: booking.menu_schedule?.scheduled_date,
        time_slot: booking.menu_schedule?.time_slot,
        price: booking.menu_schedule?.price,
      }
    }))

    return res.status(200).json({ 
      success: true, 
      data: history || [],
      isAdmin 
    })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
