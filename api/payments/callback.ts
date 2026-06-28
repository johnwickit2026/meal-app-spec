import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security'

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

const SSLCOMMERZ_VALIDATE_URL =
  'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin
  const clientIP = getClientIP(req)

  // CORS — SSLCommerz posts from its servers, so we must be permissive here
  res.setHeader('Access-Control-Allow-Origin', origin && allowedOrigins.includes(origin) ? origin : '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'Invalid method on payment callback', method: req.method },
    })
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `payment_callback:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    logSecurityEvent('RATE_LIMIT_EXCEEDED', req, {
      severity: 'WARNING',
      details: { reason: 'Payment callback rate limit exceeded', resetTime: rateLimitResult.resetTime },
    })
    return res.status(429).json({ error: 'Too many requests.' })
  }

  try {
    // SSLCommerz IPN posts form fields in the body
    const body = req.body as Record<string, string>
    const { val_id, tran_id, status: ipnStatus } = body

    if (!val_id || !tran_id) {
      logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
        severity: 'WARNING',
        details: { reason: 'SSLCommerz callback missing val_id or tran_id', body },
      })
      return res.status(400).json({ error: 'Missing val_id or tran_id in callback' })
    }

    // Look up our payment record by tran_id
    const { data: payment, error: paymentFetchError } = await supabase
      .from('student_payments')
      .select('id, order_id, student_id, status, amount')
      .eq('tran_id', tran_id)
      .single()

    if (paymentFetchError || !payment) {
      logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
        severity: 'WARNING',
        details: { reason: 'No payment record for tran_id', tran_id },
      })
      return res.status(404).json({ error: 'Payment record not found' })
    }

    // Ignore duplicate callbacks for already-processed payments
    if (payment.status === 'success') {
      return res.status(200).json({ message: 'Payment already processed' })
    }

    // Validate the transaction with SSLCommerz
    const validateUrl = new URL(SSLCOMMERZ_VALIDATE_URL)
    validateUrl.searchParams.set('val_id', val_id)
    validateUrl.searchParams.set('store_id', sslStoreId!)
    validateUrl.searchParams.set('store_passwd', sslStorePassword!)
    validateUrl.searchParams.set('format', 'json')

    const validateResponse = await fetch(validateUrl.toString())
    if (!validateResponse.ok) {
      console.error('SSLCommerz validation API error:', validateResponse.status)
      return res.status(502).json({ error: 'Payment validation service unavailable' })
    }

    const validateData = await validateResponse.json() as {
      status: string
      tran_id: string
      amount: string
      val_id: string
      [key: string]: unknown
    }

    // Determine the final status
    const isValid =
      validateData.status === 'VALID' &&
      validateData.tran_id === tran_id &&
      parseFloat(validateData.amount) >= parseFloat(String(payment.amount))

    const finalStatus: 'success' | 'failed' | 'cancelled' =
      isValid
        ? 'success'
        : ipnStatus === 'CANCELLED'
        ? 'cancelled'
        : 'failed'

    // Update payment record
    const { error: paymentUpdateError } = await supabase
      .from('student_payments')
      .update({
        val_id,
        status: finalStatus,
        payment_data: validateData,
      })
      .eq('id', payment.id)

    if (paymentUpdateError) throw paymentUpdateError

    // If payment succeeded, update the linked order
    if (finalStatus === 'success') {
      const { error: orderUpdateError } = await supabase
        .from('student_orders')
        .update({ status: 'paid' })
        .eq('id', payment.order_id)

      if (orderUpdateError) throw orderUpdateError

      logSecurityEvent('ADMIN_ACTION', req, {
        userId: payment.student_id,
        severity: 'INFO',
        details: {
          action: 'PAYMENT_SUCCESS',
          orderId: payment.order_id,
          paymentId: payment.id,
          tranId: tran_id,
          valId: val_id,
        },
      })
    } else {
      logSecurityEvent('ADMIN_ACTION', req, {
        userId: payment.student_id,
        severity: 'WARNING',
        details: {
          action: 'PAYMENT_FAILED',
          orderId: payment.order_id,
          paymentId: payment.id,
          tranId: tran_id,
          finalStatus,
          ipnStatus,
        },
      })
    }

    return res.status(200).json({
      success: finalStatus === 'success',
      status: finalStatus,
      order_id: payment.order_id,
    })
  } catch (error) {
    console.error('Payment callback error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
