import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

const SSLCOMMERZ_VALIDATE_URL =
  'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php'

export const handler: Handler = async (event: HandlerEvent) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const sslStoreId = process.env.SSLCOMMERZ_STORE_ID
  const sslStorePassword = process.env.SSLCOMMERZ_STORE_PASSWORD

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
  if (!sslStoreId || !sslStorePassword) {
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

    // ── Route by tran_id prefix ─────────────────────────────────────────
    const isEmployeePayment = tran_id.startsWith('EMP-')

    if (isEmployeePayment) {
      return await handleEmployeeCallback(supabase, req, res, { val_id, tran_id, ipnStatus, sslStoreId: sslStoreId!, sslStorePassword: sslStorePassword! })
    }

    // ── Student payment flow (STU- prefix, original logic) ──────────────
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

      // Fetch student info and meal info for notifications
      const { data: orderDetails } = await supabase
        .from('student_orders')
        .select(`
          meal_date,
          student:profiles!student_orders_student_id_fkey(full_name),
          tiffin_menu:student_tiffin_menu!student_orders_tiffin_menu_id_fkey(
            meal:meals!student_tiffin_menu_meal_id_fkey(name)
          )
        `)
        .eq('id', payment.order_id)
        .single()

      const studentName = (orderDetails?.student as any)?.full_name || 'Student'
      const mealName = (orderDetails?.tiffin_menu as any)?.meal?.name || 'Meal'
      const mealDate = orderDetails?.meal_date || ''

      // Insert student notification
      await supabase.from('notifications').insert({
        user_id: payment.student_id,
        type: 'payment_success',
        message: `Your payment for ${mealName} was successful. Order confirmed.`
      })

      // Fetch admins to notify them
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      if (admins && admins.length > 0) {
        const adminNotifications = admins.map(a => ({
          user_id: a.id,
          type: 'new_payment',
          message: `${studentName} has paid BDT ${payment.amount} for ${mealName} on ${mealDate}.`
        }))
        await supabase.from('notifications').insert(adminNotifications)
      }

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

// ── Employee payment callback handler ─────────────────────────────────────────
async function handleEmployeeCallback(
  supabase: any,
  req: any,
  res: any,
  opts: { val_id: string; tran_id: string; ipnStatus: string; sslStoreId: string; sslStorePassword: string }
) {
  const { val_id, tran_id, ipnStatus, sslStoreId, sslStorePassword } = opts

  // Look up in the employee payments table by sslcommerz_tran_id
  const { data: payment, error: fetchErr } = await supabase
    .from('payments')
    .select('id, user_id, amount, status, balance_applied, month')
    .eq('sslcommerz_tran_id', tran_id)
    .single()

  if (fetchErr || !payment) {
    logSecurityEvent('SUSPICIOUS_ACTIVITY', req, {
      severity: 'WARNING',
      details: { reason: 'No employee payment record for tran_id', tran_id },
    })
    return res.status(404).json({ error: 'Payment record not found' })
  }

  // Already processed
  if (payment.status === 'paid') {
    return res.status(200).json({ message: 'Payment already processed' })
  }

  // Validate with SSLCommerz
  const validateUrl = new URL(SSLCOMMERZ_VALIDATE_URL)
  validateUrl.searchParams.set('val_id', val_id)
  validateUrl.searchParams.set('store_id', sslStoreId)
  validateUrl.searchParams.set('store_passwd', sslStorePassword)
  validateUrl.searchParams.set('format', 'json')

  const validateResponse = await fetch(validateUrl.toString())
  if (!validateResponse.ok) {
    console.error('SSLCommerz validation API error:', validateResponse.status)
    return res.status(502).json({ error: 'Payment validation service unavailable' })
  }

  const validateData = await validateResponse.json() as {
    status: string; tran_id: string; amount: string; val_id: string; [key: string]: unknown
  }

  // The SSLCommerz amount should match the online portion (total - balance_applied)
  const onlineAmount = Number(payment.amount) - Number(payment.balance_applied || 0)
  const isValid =
    validateData.status === 'VALID' &&
    validateData.tran_id === tran_id &&
    parseFloat(validateData.amount) >= onlineAmount

  const finalStatus: 'paid' | 'unpaid' = isValid ? 'paid' : 'unpaid'

  // Update payment record
  const { error: updateErr } = await supabase
    .from('payments')
    .update({
      status: finalStatus,
      paid_at: finalStatus === 'paid' ? new Date().toISOString() : null,
      payment_data: validateData,
    })
    .eq('id', payment.id)

  if (updateErr) throw updateErr

  if (finalStatus === 'paid') {
    // Deduct balance ONLY on successful payment (refund safety)
    const balApplied = Number(payment.balance_applied || 0)
    if (balApplied > 0) {
      const { error: rpcErr } = await supabase.rpc('deduct_user_balance', {
        p_user_id: payment.user_id,
        p_amount: balApplied,
      })
      if (rpcErr) console.error('Balance deduction failed (payment succeeded):', rpcErr)
    }

    // Fetch employee name for notifications
    const { data: empProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', payment.user_id)
      .single()

    const empName = empProfile?.full_name || 'Employee'

    // Notify employee
    await supabase.from('notifications').insert({
      user_id: payment.user_id,
      type: 'payment_confirmed',
      message: `Your online payment of ৳${onlineAmount} for ${payment.month} was successful.${balApplied > 0 ? ` ৳${balApplied} was also deducted from your balance.` : ''}`
    })

    // Notify admins
    const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin')
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map((a: any) => ({
          user_id: a.id,
          type: 'new_payment',
          message: `${empName} paid ৳${payment.amount} (online: ৳${onlineAmount}, balance: ৳${balApplied}) for ${payment.month}.`
        }))
      )
    }

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: payment.user_id,
      severity: 'INFO',
      details: { action: 'EMP_PAYMENT_SUCCESS', tranId: tran_id, valId: val_id, amount: payment.amount, balanceApplied: balApplied },
    })
  } else {
    logSecurityEvent('ADMIN_ACTION', req, {
      userId: payment.user_id,
      severity: 'WARNING',
      details: { action: 'EMP_PAYMENT_FAILED', tranId: tran_id, finalStatus, ipnStatus },
    })
  }

  return res.status(200).json({
    success: finalStatus === 'paid',
    status: finalStatus,
  })
}

