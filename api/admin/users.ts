import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { listUsersQuerySchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

function canManageUsers(role: UserRole): boolean {
  return role === 'admin'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  // Rate limiting check for admin operations
  const rateLimitKey = `admin_users:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'User management rate limit exceeded' }
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
    // Verify user can manage users
    const auth = await verifyTokenWithRole(token)
    if (!auth || !canManageUsers(auth.role)) {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: auth?.user?.id,
        email: maskEmail(auth?.user?.email || ''),
        severity: 'WARNING',
        details: { reason: 'Insufficient permissions for user management', role: auth?.role }
      })
      return res.status(403).json({ error: 'Forbidden: User management access required' })
    }

    const { user } = auth

    // Validate query parameters
    const validation = validateInput(listUsersQuerySchema, {
      limit: req.query.limit,
      offset: req.query.offset,
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

    const { limit, offset } = validation.data

    // Fetch users/profiles with explicit columns, count, and pagination
    const { data, error, count } = await supabase
      .from('profiles')
      .select('id, full_name, email, department, role, dietary_preferences, is_active, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    // Log admin action for user list access
    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: { 
        action: 'LIST_USERS',
        limit,
        offset,
        totalUsers: count
      }
    })

    return res.status(200).json({
      data,
      total: count,
      limit,
      offset,
    })
  } catch (error) {
    // Log error but don't leak details to client
    console.error('User management error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
