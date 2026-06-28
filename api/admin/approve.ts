import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { approveBookingSchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

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

function canManageBookings(role: UserRole): boolean {
  return role === 'admin'
}

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

  // Rate limiting check for sensitive admin operations
  const rateLimitKey = `admin_approve:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Booking approval rate limit exceeded' }
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
    // Verify user can manage bookings
    const auth = await verifyTokenWithRole(token)
    if (!auth || !canManageBookings(auth.role)) {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: auth?.user?.id,
        email: maskEmail(auth?.user?.email || ''),
        severity: 'WARNING',
        details: { reason: 'Insufficient permissions for booking approval', role: auth?.role }
      })
      return res.status(403).json({ error: 'Forbidden: Booking management access required' })
    }

    const { user } = auth

    // Validate input
    const validation = validateInput(approveBookingSchema, req.body)
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

    // Get booking
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, user_id')
      .eq('id', booking_id)
      .single()

    if (bookingError || !booking) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    // Update booking status to confirmed
    const { data: updatedBooking, error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', booking_id)
      .select()
      .single()

    if (updateError) throw updateError

    // Create notification for the user
    await supabase.from('notifications').insert({
      user_id: booking.user_id,
      type: 'booking_confirmed',
      message: `Your meal booking has been confirmed!`,
    })

    // Log admin action
    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: { 
        action: 'BOOKING_APPROVED',
        bookingId: booking_id,
        targetUserId: booking.user_id
      }
    })

    return res.status(200).json(updatedBooking)
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Booking approval error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
