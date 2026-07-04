import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'

let supabase: SupabaseClient<any, any, any>

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

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

  if (profileError) return null

  return { user, role: profile?.role as UserRole }
}

// Check if role can manage meals (admin or food_editor)
function canManageMeals(role: UserRole): boolean {
  return ['admin', 'food_editor'].includes(role)
}

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

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Rate limiting check
  const rateLimitKey = `admin_routines:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  // Verify JWT token
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    const auth = await verifyTokenWithRole(token)
    if (!auth || !canManageMeals(auth.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { user } = auth

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('meal_routines')
        .select(`
          *,
          items:meal_routine_items(
            *,
            meal:meals(name, meal_type)
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      return res.status(200).json(data)
    }

    if (req.method === 'POST') {
      const { name, description, routine_type, items } = req.body

      if (!name || !routine_type || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid input' })
      }

      // 1. Create the routine
      const { data: routine, error: routineError } = await supabase
        .from('meal_routines')
        .insert({
          name,
          description: description || null,
          routine_type,
          is_active: true,
          created_by: user.id
        })
        .select()
        .single()

      if (routineError) throw routineError

      // 2. Insert the items
      const itemsToInsert = items.map(item => ({
        routine_id: routine.id,
        meal_id: item.meal_id,
        day_of_week: item.day_of_week ?? null,
        day_of_month: item.day_of_month ?? null,
        time_slot: item.time_slot,
        capacity: item.capacity || 10,
        ordering_deadline_hours: item.ordering_deadline_hours || 1,
        meal_type: item.meal_type || 'employee',
        price: item.price || null
      }))

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('meal_routine_items')
          .insert(itemsToInsert)

        if (itemsError) throw itemsError
      }

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { action: 'ROUTINE_CREATED', routineId: routine.id, itemsCount: itemsToInsert.length }
      })

      return res.status(201).json({ success: true, routine })
    }

    if (req.method === 'PUT') {
      const { id, name, description, items } = req.body

      if (!id) {
        return res.status(400).json({ error: 'Routine id is required' })
      }
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: 'Invalid input' })
      }

      // 1. Remove existing items for this routine
      const { error: deleteItemsError } = await supabase
        .from('meal_routine_items')
        .delete()
        .eq('routine_id', id)

      if (deleteItemsError) throw deleteItemsError

      // 2. Re-insert new items
      const itemsToInsert = items.map(item => ({
        routine_id: id,
        meal_id: item.meal_id,
        day_of_week: item.day_of_week ?? null,
        day_of_month: item.day_of_month ?? null,
        time_slot: item.time_slot,
        capacity: item.capacity || 10,
        ordering_deadline_hours: item.ordering_deadline_hours || 1,
        meal_type: item.meal_type || 'employee',
        price: item.price || null
      }))

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('meal_routine_items')
          .insert(itemsToInsert)

        if (itemsError) throw itemsError
      }

      // 3. Update routine name and description
      const { data: routine, error: updateError } = await supabase
        .from('meal_routines')
        .update({
          name,
          description: description || null
        })
        .eq('id', id)
        .select()
        .single()

      if (updateError) throw updateError

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { action: 'ROUTINE_UPDATED', routineId: id, itemsCount: itemsToInsert.length }
      })

      return res.status(200).json({ success: true, routine })
    }

    if (req.method === 'DELETE') {
      const { id } = req.body

      if (!id) {
        return res.status(400).json({ error: 'Routine id is required' })
      }

      // 1. Delete routine items
      const { error: itemsError } = await supabase
        .from('meal_routine_items')
        .delete()
        .eq('routine_id', id)

      if (itemsError) throw itemsError

      // 2. Delete the routine
      const { error: routineError } = await supabase
        .from('meal_routines')
        .delete()
        .eq('id', id)

      if (routineError) throw routineError

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'INFO',
        details: { action: 'ROUTINE_DELETED', routineId: id }
      })

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error: any) {
    console.error('Routine API error:', error)
    return res.status(500).json({
      error: 'Internal server error',
      detail: error?.message || String(error),
      code: error?.code,
      hint: error?.hint,
    })
  }
}
