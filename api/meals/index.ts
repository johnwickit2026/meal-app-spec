import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { getCache, setCache } from '../_cache.js'
import { maskEmail } from '../_validation.js'
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
  const rateLimitKey = `meals_list:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Meals list rate limit exceeded' }
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
      return res.status(401).json({ error: 'Invalid token' })
    }

    // Check cache for non-user-specific meal data
    const cacheKey = 'meals:active'
    const cached = getCache(cacheKey)
    if (cached) {
      return res.status(200).json(cached)
    }

    // Fetch all active meals (specific columns)
    const { data, error } = await supabase
      .from('meals')
      .select('id, name, description, meal_type, image_url, price, is_active, created_at')
      .eq('is_active', true)
      .order('meal_type', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    // Cache the result
    setCache(cacheKey, data, CACHE_TTL)

    // Log successful access (low severity since it's a common read operation)
    if (user?.email) {
      logSecurityEvent('LOGIN_SUCCESS', req, {
        userId: user.id,
        email: maskEmail(user.email),
        severity: 'INFO',
        details: { action: 'MEALS_LIST_VIEWED' }
      })
    }

    return res.status(200).json(data)
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Meals list error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
