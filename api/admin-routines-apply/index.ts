import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'
import { addDays, parseISO, format, differenceInDays } from 'date-fns'

let supabase: SupabaseClient<any, any, any>
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())
type UserRole = 'employee' | 'admin' | 'food_editor' | 'finance_editor'

async function verifyTokenWithRole(token: string): Promise<{ user: any, role: UserRole } | null> {
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return { user, role: profile?.role as UserRole }
}

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

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()

  const rateLimitKey = `admin_routines_apply:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' })
  const token = authHeader.split('Bearer ')[1]

  try {
    const auth = await verifyTokenWithRole(token)
    if (!auth || !canManageMeals(auth.role)) return res.status(403).json({ error: 'Forbidden' })
    
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const { routineId, startDate, endDate, applyTo } = req.body
    if (!routineId || !startDate || !endDate || !applyTo) {
      return res.status(400).json({ error: 'Missing required parameters' })
    }

    // 1. Fetch routine and items
    const { data: routine, error: routineError } = await supabase
      .from('meal_routines')
      .select('*, items:meal_routine_items(*)')
      .eq('id', routineId)
      .single()

    if (routineError || !routine) throw new Error('Routine not found')

    const start = parseISO(startDate)
    const end = parseISO(endDate)
    const totalDays = differenceInDays(end, start)

    if (totalDays < 0 || totalDays > 365) {
      return res.status(400).json({ error: 'Invalid date range. Maximum 1 year.' })
    }

    const employeeSchedulesToInsert = []
    const studentSchedulesToInsert = []

    // 2. Iterate dates
    for (let i = 0; i <= totalDays; i++) {
      const currentDate = addDays(start, i)
      const dayOfWeek = currentDate.getDay() // 0-6
      const dayOfMonth = currentDate.getDate() // 1-31
      const dateString = format(currentDate, 'yyyy-MM-dd')

      // Find matching items for this date
      const matchingItems = routine.items.filter((item: any) => {
        if (routine.routine_type === 'weekly') return item.day_of_week === dayOfWeek
        if (routine.routine_type === 'monthly') return item.day_of_month === dayOfMonth
        return false
      })

      for (const item of matchingItems) {
        // Build employee schedule if requested
        if ((applyTo === 'employee' || applyTo === 'both') && (item.meal_type === 'employee' || item.meal_type === 'both')) {
          employeeSchedulesToInsert.push({
            meal_id: item.meal_id,
            scheduled_date: dateString,
            time_slot: item.time_slot,
            capacity: item.capacity || 10,
            is_available: true,
            booking_time_limit: item.ordering_deadline_hours || 1,
            ordering_deadline_hours: item.ordering_deadline_hours || 1,
            price: item.price || null,
            routine_id: routineId
          })
        }

        // Build student schedule if requested
        if ((applyTo === 'student' || applyTo === 'both') && (item.meal_type === 'student' || item.meal_type === 'both')) {
          studentSchedulesToInsert.push({
            meal_id: item.meal_id,
            scheduled_date: dateString,
            time_slot: item.time_slot,
            capacity: item.capacity || 10,
            price: item.price || 0,
            is_available: true,
            ordering_deadline_hours: item.ordering_deadline_hours || 1,
            routine_id: routineId
          })
        }
      }
    }

    let createdEmployeeCount = 0
    let createdStudentCount = 0

    // 3. Insert and skip duplicates
    // Using simple upsert approach where unique constraint is handled, or checking existence
    // Supabase JS doesn't have an easy INSERT IGNORE. The easiest way is to insert them one by one or fetch existing dates.
    // For bulk, let's fetch existing dates for the range and filter them out in memory.

    // Employee
    if (employeeSchedulesToInsert.length > 0) {
      const { data: existingEmployeeMeals } = await supabase
        .from('menu_schedules')
        .select('meal_id, scheduled_date')
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)

      const existingSet = new Set(existingEmployeeMeals?.map(m => `${m.meal_id}_${m.scheduled_date}`) || [])
      const newEmployeeMeals = employeeSchedulesToInsert.filter(m => !existingSet.has(`${m.meal_id}_${m.scheduled_date}`))

      if (newEmployeeMeals.length > 0) {
        const { error } = await supabase.from('menu_schedules').insert(newEmployeeMeals)
        if (error) console.error('Error inserting employee meals:', error)
        else createdEmployeeCount = newEmployeeMeals.length
      }
    }

    // Student
    if (studentSchedulesToInsert.length > 0) {
      const { data: existingStudentMeals } = await supabase
        .from('student_tiffin_menu')
        .select('meal_id, scheduled_date')
        .gte('scheduled_date', startDate)
        .lte('scheduled_date', endDate)

      const existingSet = new Set(existingStudentMeals?.map(m => `${m.meal_id}_${m.scheduled_date}`) || [])
      const newStudentMeals = studentSchedulesToInsert.filter(m => !existingSet.has(`${m.meal_id}_${m.scheduled_date}`))

      if (newStudentMeals.length > 0) {
        const { error } = await supabase.from('student_tiffin_menu').insert(newStudentMeals)
        if (error) console.error('Error inserting student meals:', error)
        else createdStudentCount = newStudentMeals.length
      }
    }

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: auth.user.id,
      email: maskEmail(auth.user.email || ''),
      severity: 'INFO',
      details: { action: 'ROUTINE_APPLIED', routineId, startDate, endDate, applyTo, createdEmployeeCount, createdStudentCount }
    })

    return res.status(200).json({ 
      success: true, 
      created: {
        employee: createdEmployeeCount,
        student: createdStudentCount
      }
    })

  } catch (error: any) {
    console.error('Routine Apply API error:', error)
    return res.status(500).json({ error: error.message || 'Internal server error' })
  }
}
