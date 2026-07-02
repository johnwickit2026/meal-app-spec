import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { clearCache } from '../_cache.js'
import { createMealSchema, updateMealSchema, deleteMealSchema, validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

// Columns that can be set/updated on meals
const ALLOWED_MEAL_FIELDS = ['name', 'description', 'meal_type', 'dietary_tags', 'image_url', 'is_active', 'price'] as const

type UserRole = 'employee' | 'admin' | 'food_editor' | 'finance_editor'

// Verify token and return user with role
async function verifyTokenWithRole(token: string): Promise<{ user: any, role: UserRole } | null> {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('Profile query error in verifyTokenWithRole:', profileError)
    return null
  }

  return { user, role: profile?.role as UserRole }
}

// Check if role can manage meals (admin or food_editor)
function canManageMeals(role: UserRole): boolean {
  return ['admin', 'food_editor'].includes(role)
}

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Rate limiting check for admin operations
  const rateLimitKey = `admin_meals:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Admin meals rate limit exceeded', path: req.url }
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
      details: { reason: 'Missing or invalid authorization header', path: req.url }
    })
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    // Verify user has meal management permission
    const auth = await verifyTokenWithRole(token)
    if (!auth || !canManageMeals(auth.role)) {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: auth?.user?.id,
        email: maskEmail(auth?.user?.email || ''),
        severity: 'WARNING',
        details: { reason: 'Insufficient permissions for meal management', role: auth?.role }
      })
      return res.status(403).json({ error: 'Forbidden: Meal management access required' })
    }

    const { user, role } = auth

    // GET - List all meals (including inactive)
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('meals')
        .select('id, name, description, meal_type, image_url, price, is_active, created_at')
        .order('meal_type', { ascending: true })
        .order('name', { ascending: true })

      if (error) throw error

      return res.status(200).json(data)
    }

    // POST - Create a new meal
    if (req.method === 'POST') {
      // Validate input
      const validation = validateInput(createMealSchema, req.body)
      if (!validation.success) {
        return res.status(400).json({ 
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const { name, description, meal_type, dietary_tags, image_url } = validation.data

      const mealData: Record<string, unknown> = {
        name,
        description: description || null,
        meal_type: meal_type || 'lunch',
        dietary_tags: dietary_tags || null,
        image_url: image_url || null,
        is_active: true,
      }

      const { data, error } = await supabase
        .from('meals')
        .insert(mealData)
        .select()
        .single()

      if (error) throw error

      // Invalidate meals cache after create
      clearCache('meals:active')

      // Log admin action
      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { 
          action: 'MEAL_CREATED',
          mealId: data.id,
          mealName: name
        }
      })

      return res.status(201).json(data)
    }

    // PUT/PATCH - Update an existing meal
    if (req.method === 'PUT' || req.method === 'PATCH') {
      // Validate input
      const validation = validateInput(updateMealSchema, req.body)
      if (!validation.success) {
        return res.status(400).json({ 
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const { id, ...rawFields } = validation.data

      // Whitelist only allowed updatable fields
      const updateFields: Record<string, unknown> = {}
      for (const key of ALLOWED_MEAL_FIELDS) {
        if (key in rawFields) {
          updateFields[key] = rawFields[key]
        }
      }

      if (Object.keys(updateFields).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' })
      }

      const { data, error } = await supabase
        .from('meals')
        .update(updateFields)
        .eq('id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      if (!data) {
        return res.status(404).json({ error: 'Meal not found' })
      }

      // Invalidate meals cache after update
      clearCache('meals:active')

      // Log admin action
      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { 
          action: 'MEAL_UPDATED',
          mealId: id,
          updatedFields: Object.keys(updateFields)
        }
      })

      return res.status(200).json(data)
    }

    // DELETE - Soft delete (deactivate) a meal
    if (req.method === 'DELETE') {
      const rawId = req.body?.id ?? req.query?.id
      
      // Validate input
      const validation = validateInput(deleteMealSchema, { id: rawId })
      if (!validation.success) {
        return res.status(400).json({ 
          error: 'Invalid input',
          details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        })
      }

      const { id } = validation.data

      const { data, error } = await supabase
        .from('meals')
        .update({ is_active: false })
        .eq('id', id)
        .select()
        .maybeSingle()

      if (error) throw error

      if (!data) {
        return res.status(404).json({ error: 'Meal not found' })
      }

      // Invalidate meals cache after delete (soft delete changes is_active status)
      clearCache('meals:active')

      // Log admin action
      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { 
          action: 'MEAL_DELETED',
          mealId: id
        }
      })

      return res.status(200).json(data)
    }

    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method }
    })
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    // Log error but don't leak details to client
    console.error('Meals management error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
