import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

/** Returns a YYYY-MM-DD string for today in UTC */
function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Returns a YYYY-MM-DD string for tomorrow in UTC */
function getTomorrowDate(): string {
  const tomorrow = new Date()
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  return tomorrow.toISOString().slice(0, 10)
}

/** Validates a YYYY-MM-DD string */
function isValidDate(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(str) && !isNaN(Date.parse(str))
}

/**
 * Compute the ordering deadline for a tiffin item.
 * The deadline is `deadlineHours` hours before the time_slot on the scheduled_date.
 * time_slot is expected as "HH:MM" or "HH:MM:SS" (24-hour UTC).
 */
function computeDeadline(scheduledDate: string, timeSlot: string, deadlineHours: number): Date {
  // time_slot is free-form admin text (up to 50 chars), so it may not always be "HH:MM".
  // Extract the leading HH:MM if present; otherwise fall back to midnight so we never
  // construct an Invalid Date (which throws on toISOString()).
  const match = /^(\d{1,2}):(\d{2})/.exec((timeSlot || '').trim())
  let hh = match ? Number(match[1]) : 0
  let mm = match ? Number(match[2]) : 0
  if (!Number.isFinite(hh) || hh < 0 || hh > 23) hh = 0
  if (!Number.isFinite(mm) || mm < 0 || mm > 59) mm = 0

  const mealTime = new Date(`${scheduledDate}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
  const safeMealTime = Number.isNaN(mealTime.getTime())
    ? new Date(`${scheduledDate}T00:00:00Z`)
    : mealTime
  const deadline = new Date(safeMealTime.getTime() - deadlineHours * 60 * 60 * 1000)
  return Number.isNaN(deadline.getTime()) ? new Date() : deadline
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `student_menu:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.api)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Student menu rate limit exceeded', resetTime: rateLimitResult.resetTime },
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

    // Verify role is 'student'
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
        details: { reason: 'Student role required', role: profile.role },
      })
      return res.status(403).json({ error: 'Forbidden: Student access required' })
    }

    // ── Date range resolution ──────────────────────────────────────────────────
    // If a ?date=YYYY-MM-DD query param is provided, fetch only that single date.
    // Otherwise, default to fetching both today AND tomorrow.
    const today = getTodayDate()
    const tomorrow = getTomorrowDate()

    let fromDate: string
    let toDate: string
    let singleDateMode = false

    const dateParam = req.query?.date
    if (dateParam && typeof dateParam === 'string' && isValidDate(dateParam)) {
      fromDate = dateParam
      toDate = dateParam
      singleDateMode = true
    } else {
      fromDate = today
      toDate = tomorrow
    }

    // ── Supabase query ─────────────────────────────────────────────────────────
    const { data: menuItems, error: menuError } = await supabase
      .from('student_tiffin_menu')
      .select(`
        *,
        meal:meals (
          id,
          name,
          description,
          meal_type,
          dietary_tags,
          image_url
        )
      `)
      .gte('scheduled_date', fromDate)
      .lte('scheduled_date', toDate)
      .eq('is_available', true)
      .order('scheduled_date', { ascending: true })
      .order('time_slot', { ascending: true })

    if (menuError) throw menuError

    const now = new Date()

    // ── Group by date → time_slot, with deadline awareness ────────────────────
    // Structure: { [date]: { [time_slot]: TiffinMenuItem[] } }
    const byDate: Record<string, Record<string, typeof menuItems>> = {}

    for (const item of menuItems || []) {
      const date = item.scheduled_date as string
      const slot = item.time_slot as string
      const deadlineHours: number = (item.ordering_deadline_hours as number) ?? 1

      const deadline = computeDeadline(date, slot, deadlineHours)
      const deadlinePassed = now > deadline

      // Augment the item with deadline metadata for the client
      const enriched = {
        ...item,
        deadline_passed: deadlinePassed,
        deadline_at: deadline.toISOString(),
      }

      if (!byDate[date]) byDate[date] = {}
      if (!byDate[date][slot]) byDate[date][slot] = []
      byDate[date][slot].push(enriched as any)
    }

    // ── Build a summary per date ───────────────────────────────────────────────
    // Each date entry carries: { slots: { [slot]: items[] }, total_items, has_open_slots }
    const datesResult: Record<string, {
      slots: Record<string, typeof menuItems>
      total_items: number
      has_open_slots: boolean
      label: 'today' | 'tomorrow' | 'other'
    }> = {}

    for (const [date, slots] of Object.entries(byDate)) {
      let totalItems = 0
      let hasOpen = false
      for (const items of Object.values(slots)) {
        totalItems += items.length
        if (items.some((it: any) => !it.deadline_passed)) hasOpen = true
      }

      let label: 'today' | 'tomorrow' | 'other' = 'other'
      if (date === today) label = 'today'
      else if (date === tomorrow) label = 'tomorrow'

      datesResult[date] = {
        slots,
        total_items: totalItems,
        has_open_slots: hasOpen,
        label,
      }
    }

    const totalItems = Object.values(datesResult).reduce((acc, d) => acc + d.total_items, 0)

    return res.status(200).json({
      // Legacy field kept for backwards-compat with old clients
      date: singleDateMode ? fromDate : today,
      // New grouped structure
      dates: datesResult,
      today,
      tomorrow,
      total_items: totalItems,
    })
  } catch (error) {
    const detail = (error as any)?.message ?? String(error)
    console.error('Student menu fetch error:', error)
    return res.status(500).json({ error: 'Internal server error', detail })
  }
}
