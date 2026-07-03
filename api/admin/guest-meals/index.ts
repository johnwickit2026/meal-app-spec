import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../../_netlify_shim.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../../_security.js'

let supabase: SupabaseClient<any, any, any>
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

async function verifyTokenWithAdmin(token: string) {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'admin' ? { user } : null
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

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const rateLimitKey = `admin_guest_meals:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.split('Bearer ')[1]

  try {
    const auth = await verifyTokenWithAdmin(token)
    if (!auth) return res.status(403).json({ error: 'Forbidden. Admin access required.' })

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('guest_meals')
        .select(`
          *,
          meal:meals(name, price),
          creator:profiles!guest_meals_created_by_fkey(full_name)
        `)
        .order('meal_date', { ascending: false })
      
      if (error) throw error
      return res.status(200).json(data)
    }

    if (req.method === 'POST') {
      const { guest_name, department, meal_id, menu_schedule_id, quantity, meal_date, time_slot, notes } = req.body
      if (!guest_name || !department || !meal_date || !time_slot) {
        return res.status(400).json({ error: 'Missing required fields' })
      }

      const { data, error } = await supabase
        .from('guest_meals')
        .insert({
          created_by: auth.user.id,
          guest_name,
          department,
          meal_id,
          menu_schedule_id,
          quantity: quantity || 1,
          meal_date,
          time_slot,
          notes
        })
        .select()
        .single()
      
      if (error) throw error

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: auth.user.id,
        severity: 'INFO',
        details: { action: 'GUEST_MEAL_CREATED', guestMealId: data.id }
      })

      return res.status(201).json({ success: true, data })
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || req.query
      if (!id) return res.status(400).json({ error: 'Missing ID' })

      const { error } = await supabase.from('guest_meals').delete().eq('id', id)
      if (error) throw error

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: auth.user.id,
        severity: 'INFO',
        details: { action: 'GUEST_MEAL_DELETED', guestMealId: id }
      })

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error: any) {
    console.error('Guest meal API error:', error)
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
}
