import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

/** Returns today's date as YYYY-MM-DD in UTC */
function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Returns tomorrow's date as YYYY-MM-DD in UTC */
function getTomorrowDate(): string {
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
}

// Validation schema for creating a student order
const createOrderSchema = z.object({
  tiffin_menu_id: z.string().uuid({ message: 'Invalid tiffin_menu_id UUID' }),
  quantity: z.number().int().min(1).max(10).default(1),
})

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

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { req, res } = createReqRes(event)
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting (sensitive — prevents order spam)
  const rateLimitKey = `student_order_create:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Student order creation rate limit exceeded', resetTime: rateLimitResult.resetTime },
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
    // Resolve effective role: DB trigger may write 'employee' even when user signed up as 'student'.
    // Mirror the frontend resolveProfileRole logic by checking user metadata as fallback.
    const metadataRole = user.user_metadata?.role
    const effectiveRole =
      profile.role === 'employee' && metadataRole === 'student' ? 'student' : profile.role
    if (effectiveRole !== 'student') {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'WARNING',
        details: { reason: 'Student role required for ordering', role: profile.role },
      })
      return res.status(403).json({ error: 'Forbidden: Student access required' })
    }

    // Validate body
    const validation = validateInput(createOrderSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const { tiffin_menu_id, quantity } = validation.data
    const today = getTodayDate()
    const tomorrow = getTomorrowDate()

    // Fetch the tiffin menu item
    const { data: menuItem, error: menuError } = await supabase
      .from('student_tiffin_menu')
      .select('*')
      .eq('id', tiffin_menu_id)
      .single()

    if (menuError || !menuItem) {
      return res.status(404).json({ error: 'Tiffin menu item not found' })
    }

    // Validate: must be available
    if (!menuItem.is_available) {
      return res.status(409).json({ error: 'This menu item is not available for ordering' })
    }

    // Check ordering deadline
    const match = menuItem.time_slot.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i)
    let hours = 23
    let minutes = 59
    if (match) {
      hours = parseInt(match[1], 10)
      minutes = parseInt(match[2], 10)
      const ampm = match[3]?.toUpperCase()
      if (ampm === 'PM' && hours < 12) hours += 12
      if (ampm === 'AM' && hours === 12) hours = 0
    }
    const mealDateStr = `${menuItem.scheduled_date}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00+06:00`
    const mealDate = new Date(mealDateStr)
    const deadline = new Date(mealDate.getTime() - (menuItem.ordering_deadline_hours || 1) * 60 * 60 * 1000)
    
    if (new Date() > deadline) {
      return res.status(400).json({ error: "Ordering deadline has passed for this meal" })
    }

    // Parallel checks: existing order + capacity
    const [
      { data: existingOrder, error: existingError },
      { count: bookedCount, error: countError },
    ] = await Promise.all([
      // Check duplicate order
      supabase
        .from('student_orders')
        .select('id')
        .eq('student_id', user.id)
        .eq('tiffin_menu_id', tiffin_menu_id)
        .not('status', 'eq', 'cancelled')
        .maybeSingle(),
      // Check capacity (count non-cancelled orders)
      supabase
        .from('student_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tiffin_menu_id', tiffin_menu_id)
        .not('status', 'eq', 'cancelled'),
    ])

    if (existingError) throw existingError
    if (countError) throw countError

    if (existingOrder) {
      return res.status(409).json({ error: 'You already have an active order for this menu item' })
    }

    const totalQuantityBooked = (bookedCount ?? 0) + quantity
    if (totalQuantityBooked > menuItem.capacity) {
      const remaining = menuItem.capacity - (bookedCount ?? 0)
      return res.status(409).json({
        error: `Not enough capacity. Only ${remaining} slot(s) remaining for this item.`,
      })
    }

    const totalAmount = parseFloat(menuItem.price) * quantity

    // Create the order
    const { data: newOrder, error: createError } = await supabase
      .from('student_orders')
      .insert({
        student_id: user.id,
        tiffin_menu_id,
        status: 'pending',
        quantity,
        total_amount: totalAmount,
        order_date: today,
        meal_date: tomorrow,
        price_at_booking: menuItem.price ?? null,
      })
      .select()
      .single()

    if (createError) throw createError

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: {
        action: 'STUDENT_ORDER_CREATED',
        orderId: newOrder.id,
        tiffinMenuId: tiffin_menu_id,
        quantity,
        totalAmount,
      },
    })

    // Return the new order with a payment initiation URL
    return res.status(201).json({
      order: newOrder,
      payment_initiation_url: `/api/payments/initiate`,
    })
  } catch (error) {
    console.error('Student order creation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
