import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../../_security.js'
import { maskEmail } from '../../_validation.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `student_orders_list:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Student orders list rate limit exceeded', resetTime: rateLimitResult.resetTime },
    })
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000),
    })
  }

  // JWT auth
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
      severity: 'WARNING',
      details: { reason: 'Missing or invalid authorization header' },
    })
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      logSecurityEvent('UNAUTHORIZED_ACCESS', req, {
        severity: 'WARNING',
        details: { reason: 'Invalid token', error: authError?.message },
      })
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Enforce student role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Profile not found' })
    }
    if (profile.role !== 'student') {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'WARNING',
        details: { reason: 'Student role required', role: profile.role },
      })
      return res.status(403).json({ error: 'Forbidden: Student access required' })
    }

    const today = getTodayDate()

    // Fetch all orders for the student, joined with tiffin menu and meal details
    const { data: orders, error: ordersError } = await supabase
      .from('student_orders')
      .select(`
        id,
        student_id,
        tiffin_menu_id,
        status,
        quantity,
        total_amount,
        order_date,
        meal_date,
        created_at,
        updated_at,
        tiffin_menu:student_tiffin_menu (
          id,
          scheduled_date,
          time_slot,
          price,
          is_available,
          meal:meals (
            id,
            name,
            description,
            meal_type,
            dietary_tags,
            image_url
          )
        ),
        payment:student_payments (
          id,
          status,
          amount,
          currency,
          tran_id,
          created_at
        )
      `)
      .eq('student_id', user.id)
      .order('created_at', { ascending: false })

    if (ordersError) throw ordersError

    // Split into upcoming (meal_date >= today, non-delivered) and past
    const upcoming = (orders || []).filter(
      (o: any) => o.meal_date >= today && o.status !== 'delivered' && o.status !== 'cancelled'
    )
    const past = (orders || []).filter(
      (o: any) => o.meal_date < today || o.status === 'delivered' || o.status === 'cancelled'
    )

    return res.status(200).json({
      upcoming,
      past,
      total: orders?.length ?? 0,
    })
  } catch (error) {
    console.error('Student orders list error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
