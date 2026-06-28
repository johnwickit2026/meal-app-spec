import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { validateInput, maskEmail } from '../_validation.js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const sslStoreId = process.env.SSLCOMMERZ_STORE_ID
const sslStorePassword = process.env.SSLCOMMERZ_STORE_PASSWORD

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
}
if (!sslStoreId || !sslStorePassword) {
  throw new Error('Missing required environment variables: SSLCOMMERZ_STORE_ID, SSLCOMMERZ_STORE_PASSWORD')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

const SSLCOMMERZ_INITIATE_URL = 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php'

// Validation schema
const initiatePaymentSchema = z.object({
  order_id: z.string().uuid({ message: 'Invalid order_id UUID' }),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
  const rateLimitKey = `payment_initiate:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Payment initiation rate limit exceeded', resetTime: rateLimitResult.resetTime },
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

    // Enforce student role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      return res.status(401).json({ error: 'Profile not found' })
    }
    if (profile.role !== 'student') {
      logSecurityEvent('FORBIDDEN_ACCESS', req, {
        userId: user.id,
        email: maskEmail(user.email || ''),
        severity: 'WARNING',
        details: { reason: 'Student role required for payment', role: profile.role },
      })
      return res.status(403).json({ error: 'Forbidden: Student access required' })
    }

    // Validate body
    const validation = validateInput(initiatePaymentSchema, req.body)
    if (!validation.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: validation.errors.map((e: { path: (string | number)[]; message: string }) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      })
    }

    const { order_id } = validation.data

    // Fetch the order — must belong to this student and be in 'pending' status
    const { data: order, error: orderError } = await supabase
      .from('student_orders')
      .select('id, student_id, total_amount, status, meal_date')
      .eq('id', order_id)
      .eq('student_id', user.id)
      .single()

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' })
    }
    if (order.status !== 'pending') {
      return res.status(409).json({
        error: `Order is already in '${order.status}' status and cannot be paid`,
      })
    }

    // Check if an active payment already exists for this order
    const { data: existingPayment } = await supabase
      .from('student_payments')
      .select('id, status, sslcommerz_session_key')
      .eq('order_id', order_id)
      .in('status', ['pending', 'success'])
      .maybeSingle()

    if (existingPayment?.status === 'success') {
      return res.status(409).json({ error: 'This order has already been paid' })
    }

    // Generate a unique transaction ID
    const tranId = `STU-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    // Build SSLCommerz form payload
    const sslPayload = new URLSearchParams({
      store_id: sslStoreId!,
      store_passwd: sslStorePassword!,
      total_amount: String(order.total_amount),
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${allowedOrigins[0]}/payment/success`,
      fail_url: `${allowedOrigins[0]}/payment/fail`,
      cancel_url: `${allowedOrigins[0]}/payment/cancel`,
      ipn_url: `${process.env.VERCEL_URL || allowedOrigins[0]}/api/payments/callback`,
      cus_name: profile.full_name || 'Student',
      cus_email: profile.email || user.email || '',
      cus_phone: '01XXXXXXXXX',      // placeholder — extend profile with phone if needed
      cus_add1: 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: `Tiffin Order - ${order.meal_date}`,
      product_category: 'Food',
      product_profile: 'general',
      num_of_item: '1',
      product_amount: String(order.total_amount),
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

    const sessionKey: string = sslData.sessionkey ?? ''

    // Upsert payment record — if retrying, update the existing pending row
    const paymentRecord = {
      order_id,
      student_id: user.id,
      sslcommerz_session_key: sessionKey,
      tran_id: tranId,
      amount: order.total_amount,
      currency: 'BDT',
      status: 'pending',
      payment_data: sslData,
    }

    const { error: paymentError } = existingPayment
      ? await supabase
          .from('student_payments')
          .update({ sslcommerz_session_key: sessionKey, tran_id: tranId, payment_data: sslData })
          .eq('id', existingPayment.id)
      : await supabase.from('student_payments').insert(paymentRecord)

    if (paymentError) throw paymentError

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: {
        action: 'PAYMENT_INITIATED',
        orderId: order_id,
        tranId,
        amount: order.total_amount,
      },
    })

    return res.status(200).json({
      payment_url: sslData.GatewayPageURL,
      tran_id: tranId,
      session_key: sessionKey,
    })
  } catch (error) {
    console.error('Payment initiation error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
