import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { getCache, setCache } from '../_cache.js'
import { scheduleQuerySchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

const CACHE_TTL = 60 // 60 seconds

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
  const rateLimitKey = `schedule:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Schedule view rate limit exceeded' }
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

    // Validate query parameters
    const validation = validateInput(scheduleQuerySchema, { date: req.query.date })
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      })
    }

    const { date } = validation.data

    // Check cache for non-user-specific schedule data
    const cacheKey = `schedules:${date}`
    const cached = getCache(cacheKey)
    if (cached) {
      return res.status(200).json(cached)
    }

    // Fetch menu schedules for the given date with meal details (specific columns)
    const { data: schedules, error } = await supabase
      .from('menu_schedules')
      .select(`
        id,
        meal_id,
        scheduled_date,
        time_slot,
        capacity,
        is_available,
        booking_time_limit,
        price,
        created_at,
        meal:meals (
          id,
          name,
          description,
          meal_type,
          image_url,
          price,
          is_active
        )
      `)
      .eq('scheduled_date', date)
      .eq('is_available', true)
      .order('time_slot', { ascending: true })

    if (error) throw error

    // Get booking counts for all schedules in a single query (N+1 fix)
    const scheduleIds = (schedules || []).map((s: any) => s.id)
    let countMap = new Map<string, number>()

    if (scheduleIds.length > 0) {
      const { data: bookingCounts, error: countError } = await supabase
        .from('bookings')
        .select('menu_schedule_id, status')
        .in('menu_schedule_id', scheduleIds)
        .in('status', ['pending', 'confirmed'])

      if (countError) throw countError

      // Aggregate counts in memory
      for (const booking of bookingCounts || []) {
        const current = countMap.get(booking.menu_schedule_id) || 0
        countMap.set(booking.menu_schedule_id, current + 1)
      }
    }

    const schedulesWithCounts = (schedules || []).map((schedule: any) => ({
      ...schedule,
      booking_count: countMap.get(schedule.id) || 0,
      remaining_capacity: schedule.capacity - (countMap.get(schedule.id) || 0),
    }))

    // Cache the result
    setCache(cacheKey, schedulesWithCounts, CACHE_TTL)

    // Log successful access
    if (user?.email) {
      logSecurityEvent('LOGIN_SUCCESS', req, {
        userId: user.id,
        email: maskEmail(user.email),
        severity: 'INFO',
        details: { action: 'SCHEDULE_VIEWED', date }
      })
    }

    return res.status(200).json(schedulesWithCounts)
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Schedule view error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
