import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'

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
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { startDate, endDate, type } = req.query

  try {
    // 1. Fetch Bookings (Employees)
    let bookingsQuery = supabase.from('bookings').select(`
      id, status, quantity, user_id, 
      profile:profiles(department),
      menu_schedule:menu_schedules(price, meal:meals(name))
    `)
    if (startDate) bookingsQuery = bookingsQuery.gte('created_at', `${startDate}T00:00:00Z`)
    if (endDate) bookingsQuery = bookingsQuery.lte('created_at', `${endDate}T23:59:59Z`)
    const { data: bookings } = await bookingsQuery

    // 2. Fetch Student Orders
    let studentOrdersQuery = supabase.from('student_orders').select(`
      id, status, quantity, student_id,
      schedule:student_tiffin_menu(price, meal:meals(name))
    `)
    if (startDate) studentOrdersQuery = studentOrdersQuery.gte('created_at', `${startDate}T00:00:00Z`)
    if (endDate) studentOrdersQuery = studentOrdersQuery.lte('created_at', `${endDate}T23:59:59Z`)
    const { data: studentOrders } = await studentOrdersQuery

    // 3. Fetch Guest Meals
    let guestMealsQuery = supabase.from('guest_meals').select(`
      id, status, quantity, department, meal_date, meal:meals(name)
    `)
    if (startDate) guestMealsQuery = guestMealsQuery.gte('meal_date', startDate)
    if (endDate) guestMealsQuery = guestMealsQuery.lte('meal_date', endDate)
    const { data: guestMeals } = await guestMealsQuery

    // Aggregate Data
    let totalOrders = 0
    let totalRevenueEmployee = 0
    let totalRevenueStudent = 0
    let totalCancellations = 0
    const uniquePersons = new Set<string>()
    const mealPopularity: Record<string, number> = {}
    const deptBreakdown: Record<string, number> = { School: 0, Educare: 0 }

    // Process Bookings
    bookings?.forEach((b: any) => {
      totalOrders += b.quantity || 1
      if (b.user_id) uniquePersons.add(`emp_${b.user_id}`)
      
      if (b.status === 'confirmed') {
        totalRevenueEmployee += (b.menu_schedule?.price || 0) * (b.quantity || 1)
        const dept = b.profile?.department || 'Unknown'
        if (deptBreakdown[dept] !== undefined) deptBreakdown[dept] += (b.quantity || 1)
        
        const mealName = b.menu_schedule?.meal?.name || 'Unknown'
        mealPopularity[mealName] = (mealPopularity[mealName] || 0) + (b.quantity || 1)
      } else if (b.status === 'cancelled') {
        totalCancellations += b.quantity || 1
      }
    })

    // Process Student Orders
    studentOrders?.forEach((so: any) => {
      totalOrders += so.quantity || 1
      if (so.student_id) uniquePersons.add(`stu_${so.student_id}`)
      
      if (so.status === 'paid' || so.status === 'confirmed') {
        totalRevenueStudent += (so.schedule?.price || 0) * (so.quantity || 1)
        
        const mealName = so.schedule?.meal?.name || 'Unknown'
        mealPopularity[mealName] = (mealPopularity[mealName] || 0) + (so.quantity || 1)
      } else if (so.status === 'cancelled') {
        totalCancellations += so.quantity || 1
      }
    })

    // Process Guest Meals
    let totalGuestMeals = 0
    guestMeals?.forEach((gm: any) => {
      totalOrders += gm.quantity || 1
      totalGuestMeals += gm.quantity || 1
      if (gm.status === 'confirmed') {
        const dept = gm.department || 'Unknown'
        if (deptBreakdown[dept] !== undefined) deptBreakdown[dept] += (gm.quantity || 1)
        
        const mealName = gm.meal?.name || 'Unknown'
        mealPopularity[mealName] = (mealPopularity[mealName] || 0) + (gm.quantity || 1)
      } else if (gm.status === 'cancelled') {
        totalCancellations += gm.quantity || 1
      }
    })

    const cancellationRate = totalOrders > 0 ? (totalCancellations / totalOrders) * 100 : 0

    // Prepare popular meals list
    const popularMealsRanked = Object.entries(mealPopularity)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    // Format output
    let reportData: any[] = []

    if (type === 'summary') {
      reportData = [
        { Metric: 'Total Orders', Value: totalOrders },
        { Metric: 'Unique Persons Ordered', Value: uniquePersons.size },
        { Metric: 'Employee Revenue', Value: totalRevenueEmployee },
        { Metric: 'Student Revenue', Value: totalRevenueStudent },
        { Metric: 'Total Revenue', Value: totalRevenueEmployee + totalRevenueStudent },
        { Metric: 'Total Guest Meals', Value: totalGuestMeals },
        { Metric: 'Cancellation Rate (%)', Value: cancellationRate.toFixed(2) },
        { Metric: 'School Dept Bookings', Value: deptBreakdown.School },
        { Metric: 'Educare Dept Bookings', Value: deptBreakdown.Educare }
      ]
    } else if (type === 'meals') {
      reportData = popularMealsRanked.map((m, i) => ({
        Rank: i + 1,
        Meal: m.name,
        Orders: m.count
      }))
    } else {
      // Default combined
      reportData = [
        { Category: 'Total Orders', Value: totalOrders },
        { Category: 'Unique Diners', Value: uniquePersons.size },
        { Category: 'Employee Revenue', Value: totalRevenueEmployee },
        { Category: 'Student Revenue', Value: totalRevenueStudent },
        { Category: 'Guest Meals', Value: totalGuestMeals },
        { Category: 'School Dept', Value: deptBreakdown.School },
        { Category: 'Educare Dept', Value: deptBreakdown.Educare }
      ]
    }

    return res.status(200).json({ data: reportData })
  } catch (err: any) {
    console.error('Export API error:', err)
    return res.status(500).json({ error: err.message })
  }
}
