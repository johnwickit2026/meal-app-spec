import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../../_netlify_shim.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { validateInput, maskEmail } from '../../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../../_security.js'

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

// Updatable fields whitelist
const ALLOWED_UPDATE_FIELDS = ['meal_id', 'scheduled_date', 'time_slot', 'capacity', 'price', 'is_available'] as const

const updateTiffinMenuSchema = z.object({
  meal_id: z.string().uuid().optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be YYYY-MM-DD' }).optional(),
  time_slot: z.string().min(1).max(50).optional(),
  capacity: z.number().int().min(1).max(1000).optional(),
  price: z.number().nonnegative().max(100000).optional(),
  is_available: z.boolean().optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided to update' }
)

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
  res.setHeader('Access-Control-Allow-Methods', 'PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'PUT' && req.method !== 'DELETE') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `admin_student_menu_item:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Admin student menu item rate limit exceeded', resetTime: rateLimitResult.resetTime },
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

    const { user } = auth

    // Resolve the tiffin menu item ID from the dynamic route segment [id]
    // Vercel passes path params via req.query for file-system routes
    const itemId = req.query.id as string | undefined

    if (!itemId) {
      return res.status(400).json({ error: 'Missing tiffin menu item id in URL' })
    }

    // Validate it's a UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(itemId)) {
      return res.status(400).json({ error: 'Invalid tiffin menu item id format' })
    }

    // ─── PUT: Update a tiffin menu item ────────────────────────────────────────
    if (req.method === 'PUT') {
      const validation = validateInput(updateTiffinMenuSchema, req.body)
      if (!validation.success) {
        return res.status(400).json({
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        })
      }

      // Build a safe update object from whitelisted fields
      const rawFields = validation.data
      const updateFields: Record<string, unknown> = {}
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (key in rawFields && rawFields[key as keyof typeof rawFields] !== undefined) {
          updateFields[key] = rawFields[key as keyof typeof rawFields]
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' })
      }

      const { data: updatedItem, error: updateError } = await supabase
        .from('student_tiffin_menu')
        .update(updateFields)
        .eq('id', itemId)
        .select()
        .maybeSingle()

      if (updateError) throw updateError

      if (!updatedItem) {
        return res.status(404).json({ error: 'Tiffin menu item not found' })
      }

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: {
          action: 'TIFFIN_MENU_UPDATED',
          itemId,
          updatedFields: Object.keys(updateFields),
        },
      })

      return res.status(200).json(updatedItem)
    }

    // ─── DELETE: Remove a tiffin menu item ─────────────────────────────────────
    if (req.method === 'DELETE') {
      // Prevent deletion if there are non-cancelled orders referencing this item
      const { count: activeOrderCount, error: countError } = await supabase
        .from('student_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tiffin_menu_id', itemId)
        .not('status', 'eq', 'cancelled')

      if (countError) throw countError

      if (activeOrderCount && activeOrderCount > 0) {
        return res.status(409).json({
          error: `Cannot delete: ${activeOrderCount} active order(s) reference this menu item. Cancel or deliver them first.`,
        })
      }

      const { data: deletedItem, error: deleteError } = await supabase
        .from('student_tiffin_menu')
        .delete()
        .eq('id', itemId)
        .select()
        .maybeSingle()

      if (deleteError) throw deleteError

      if (!deletedItem) {
        return res.status(404).json({ error: 'Tiffin menu item not found' })
      }

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: {
          action: 'TIFFIN_MENU_DELETED',
          itemId,
        },
      })

      return res.status(200).json({ message: 'Tiffin menu item deleted successfully', item: deletedItem })
    }
  } catch (error) {
    console.error('Admin student menu item error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
