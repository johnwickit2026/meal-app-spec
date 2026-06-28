import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

/** Returns tomorrow's date as a YYYY-MM-DD string in UTC */
function getTomorrowDate(): string {
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
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
  const rateLimitKey = `student_menu:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Student menu rate limit exceeded', resetTime: rateLimitResult.resetTime },
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

    // Verify role is 'student'
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

    const tomorrow = getTomorrowDate()

    // Fetch available tiffin menu items for tomorrow, joined with meal details
    const { data: menuItems, error: menuError } = await supabase
      .from('student_tiffin_menu')
      .select(`
        id,
        meal_id,
        scheduled_date,
        time_slot,
        capacity,
        price,
        is_available,
        created_at,
        meal:meals (
          id,
          name,
          description,
          meal_type,
          dietary_tags,
          image_url
        )
      `)
      .eq('scheduled_date', tomorrow)
      .eq('is_available', true)
      .order('time_slot', { ascending: true })

    if (menuError) throw menuError

    // Group items by time_slot
    const grouped: Record<string, typeof menuItems> = {}
    for (const item of menuItems || []) {
      const slot = item.time_slot as string
      if (!grouped[slot]) grouped[slot] = []
      grouped[slot].push(item)
    }

    return res.status(200).json({
      date: tomorrow,
      menu: grouped,
      total_items: menuItems?.length ?? 0,
    })
  } catch (error) {
    console.error('Student menu fetch error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
