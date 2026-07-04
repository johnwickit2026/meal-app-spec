import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

let supabase: SupabaseClient<any, any, any>

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

type UserRole = 'employee' | 'admin' | 'food_editor' | 'finance_editor' | 'student'

async function verifyAdminToken(token: string): Promise<{ user: any; role: UserRole } | null> {
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

function canManageMeals(role: UserRole): boolean {
  return ['admin', 'food_editor'].includes(role)
}

// Validation schemas
const createTiffinMenuSchema = z.object({
  meal_id: z.string().uuid({ message: 'Invalid meal_id UUID' }),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' }),
  time_slot: z.string().min(1).max(50),
  capacity: z.number().int().min(1).max(1000).default(10),
  price: z.number().nonnegative().max(100000),
  is_available: z.boolean().default(true),
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

  supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { req, res } = createReqRes(event)
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET' && req.method !== 'POST') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `admin_student_menu:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Admin student menu rate limit exceeded', resetTime: rateLimitResult.resetTime },
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
    const auth = await verifyAdminToken(token)
    if (!auth || !canManageMeals(auth.role)) {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: auth?.user?.id,
        email: maskEmail(auth?.user?.email || ''),
        severity: 'WARNING',
        details: { reason: 'Insufficient permissions for tiffin menu management', role: auth?.role },
      })
      return res.status(403).json({ error: 'Forbidden: Meal management access required' })
    }

    const { user, role } = auth

    // ─── GET: List all tiffin menu items ───────────────────────────────────────
    if (req.method === 'GET') {
      const { date } = req.query

      let query = supabase
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
        .order('scheduled_date', { ascending: false })
        .order('time_slot', { ascending: true })

      // Optional date filter via ?date=YYYY-MM-DD
      if (date && typeof date === 'string') {
        query = query.eq('scheduled_date', date)
      }

      const { data, error } = await query
      if (error) throw error

      return res.status(200).json({ items: data, total: data?.length ?? 0 })
    }

    // ─── POST: Create a new tiffin menu item ───────────────────────────────────
    if (req.method === 'POST') {
      const validation = validateInput(createTiffinMenuSchema, req.body)
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        })
      }

      const { meal_id, scheduled_date, time_slot, capacity, price, is_available } = validation.data

      // Verify the meal exists and is active
      const { data: meal, error: mealError } = await supabase
        .from('meals')
        .select('id, name')
        .eq('id', meal_id)
        .eq('is_active', true)
        .single()

      if (mealError || !meal) {
        return res.status(404).json({ error: 'Active meal not found with the given meal_id' })
      }

      const { data: newItem, error: insertError } = await supabase
        .from('student_tiffin_menu')
        .insert({ meal_id, scheduled_date, time_slot, capacity, price, is_available })
        .select()
        .single()

      if (insertError) throw insertError

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: {
          action: 'TIFFIN_MENU_CREATED',
          itemId: newItem.id,
          mealId: meal_id,
          scheduledDate: scheduled_date,
        },
      })

      return res.status(201).json(newItem)
    }
  } catch (error) {
    console.error('Admin student menu error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
