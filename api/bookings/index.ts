import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',')

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
  // Handle CORS
  const origin = req.headers.origin
  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0])
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  // Verify JWT token
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const token = authHeader.split('Bearer ')[1]

  try {
    // Verify the token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    if (req.method === 'GET') {
      // Fetch user's bookings with specific columns
      const { data, error } = await supabase
        .from('bookings')
        .select(`
          id,
          user_id,
          menu_schedule_id,
          status,
          notes,
          quantity,
          booked_at,
          updated_at,
          menu_schedule:menu_schedules (
            id,
            meal_id,
            scheduled_date,
            time_slot,
            capacity,
            is_available,
            booking_time_limit,
            price,
            created_at,
            meal:meals (
              id,
              name,
              description,
              meal_type,
              image_url,
              price,
              is_active,
              created_at
            )
          )
        `)
        .eq('user_id', user.id)
        .order('booked_at', { ascending: false })

      if (error) throw error

      return res.status(200).json(data)
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
