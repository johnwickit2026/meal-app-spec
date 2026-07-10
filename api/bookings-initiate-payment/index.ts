import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

const SSLCOMMERZ_INITIATE_URL = 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'

export const handler: Handler = async (event: HandlerEvent) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const sslStoreId = process.env.SSLCOMMERZ_STORE_ID
  const sslStorePassword = process.env.SSLCOMMERZ_STORE_PASSWORD

  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Server configuration error' })
    }
  }
  if (!sslStoreId || !sslStorePassword) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Server configuration error' })
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

  // Rate limiting (sensitive — payment initiation)
  const rateLimitKey = `emp_payment_initiate:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Employee payment initiation rate limit exceeded', resetTime: rateLimitResult.resetTime },
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

    // Fetch profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Profile not found' })
    }
    if (profile.role !== 'employee') {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'WARNING',
        details: { reason: 'Employee role required for booking payment', role: profile.role },
      })
      return res.status(403).json({ error: 'Forbidden: Employee access required' })
    }

    // Validate body
    const { amount, balanceAmount } = req.body || {}
    const onlineAmount = Number(amount)
    const balApplied = Number(balanceAmount) || 0

    if (!onlineAmount || isNaN(onlineAmount) || onlineAmount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Verify the user's balance is sufficient for the claimed balanceAmount
    if (balApplied > 0) {
      const { data: balRow } = await supabase
        .from('user_balances')
        .select('balance')
        .eq('user_id', user.id)
        .single()

      if (!balRow || Number(balRow.balance) < balApplied) {
        return res.status(400).json({ error: 'Insufficient balance for the claimed amount' })
      }
    }

    const currentMonth = new Date().toISOString().slice(0, 7) // 'YYYY-MM'

    // Generate a unique transaction ID
    const tranId = `EMP-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    // Build SSLCommerz form payload
    const sslPayload = new URLSearchParams({
      store_id: sslStoreId!,
      store_passwd: sslStorePassword!,
      total_amount: String(onlineAmount),
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${allowedOrigins[0]}/bookings?payment_status=success`,
      fail_url: `${allowedOrigins[0]}/bookings?payment_status=fail`,
      cancel_url: `${allowedOrigins[0]}/bookings?payment_status=cancel`,
      ipn_url: `${process.env.VERCEL_URL || allowedOrigins[0]}/api/payments/callback`,
      cus_name: profile.full_name || 'Employee',
      cus_email: profile.email || user.email || '',
      cus_phone: '01XXXXXXXXX',
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: `Monthly Meal Booking — ${currentMonth}`,
      product_category: 'Food',
      product_profile: 'general',
      num_of_item: '1',
      product_amount: String(onlineAmount),
    })

    // Call SSLCommerz initiation API
    const sslResponse = await fetch(SSLCOMMERZ_INITIATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: sslPayload.toString(),
    })

    if (!sslResponse.ok) {
      console.error('SSLCommerz API error:', sslResponse.status, await sslResponse.text())
      return res.status(502).json({ error: 'Payment gateway unavailable. Please try again.' })
    }

    const sslData = await sslResponse.json() as {
      status: string
      GatewayPageURL?: string
      sessionkey?: string
      failedreason?: string
      [key: string]: unknown
    }

    if (sslData.status !== 'SUCCESS' || !sslData.GatewayPageURL) {
      console.error('SSLCommerz initiation failed:', sslData)
      return res.status(502).json({ error: 'Failed to initiate payment. Please try again.' })
    }

    // Upsert payment record for this month
    const totalAmount = onlineAmount + balApplied
    const { error: paymentError } = await supabase
      .from('payments')
      .upsert({
        user_id: user.id,
        month: currentMonth,
        amount: totalAmount,
        status: 'unpaid',
        payment_method: 'online',
        sslcommerz_tran_id: tranId,
        balance_applied: balApplied,
        payment_data: sslData,
      } as any, { onConflict: 'user_id,month' })

    if (paymentError) throw paymentError

    // Notify admins (fire-and-forget)
    const employeeName = profile.full_name || 'Employee'
    ;(async () => {
      try {
        const { data: admins } = await supabase
          .from('profiles')
          .select('id')
          .eq('role', 'admin')
        if (admins && admins.length > 0) {
          const notifications = admins.map((a: any) => ({
            user_id: a.id,
            type: 'payment_pending',
            message: `${employeeName} initiated online payment of ৳${onlineAmount} for ${currentMonth}.`
          }))
          await supabase.from('notifications').insert(notifications)
        }
      } catch (err) {
        console.error('Admin notification error:', err)
      }
    })()

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: {
        action: 'EMP_PAYMENT_INITIATED',
        tranId,
        onlineAmount,
        balanceApplied: balApplied,
      },
    })

    return res.status(200).json({
      payment_url: sslData.GatewayPageURL,
      tran_id: tranId,
    })
  } catch (error) {
    console.error('Employee payment initiation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
