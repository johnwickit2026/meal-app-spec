import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { markNotificationReadSchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Rate limiting check
  const rateLimitKey = `notifications:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Notifications rate limit exceeded' }
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

    // GET - Fetch user's notifications
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, user_id, type, message, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      return res.status(200).json({
        notifications: data,
        unread_count: (data || []).filter((n: any) => !n.is_read).length,
      })
    }

    // PATCH - Mark notification(s) as read
    if (req.method === 'PATCH') {
      // Validate input
      const validation = validateInput(markNotificationReadSchema, req.body)
      if (!validation.success) {
        return res.status(400).json({ 
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const { notification_id, mark_all } = validation.data

      if (mark_all) {
        // Mark all notifications as read
        const { error } = await supabase
          .from('notifications')
          .update({ is_read: true })
          .eq('user_id', user.id)
          .eq('is_read', false)

        if (error) throw error

        return res.status(200).json({ message: 'All notifications marked as read' })
      }

      if (!notification_id) {
        return res.status(400).json({ error: 'notification_id or mark_all is required' })
      }

      // Mark single notification as read
      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification_id)
        .eq('user_id', user.id)
        .select()
        .maybeSingle()

      if (error) throw error

      if (!data) {
        return res.status(404).json({ error: 'Notification not found' })
      }

      return res.status(200).json(data)
    }

    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method }
    })
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Notifications error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
