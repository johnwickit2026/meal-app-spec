import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, RATE_LIMITS, getClientIP, logSecurityEvent } from '../_security.js'
import { maskEmail } from '../_validation.js'

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())

export const handler: Handler = async (event: HandlerEvent) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
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

  // Handle CORS
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0])
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Rate limiting
  const rateLimitKey = `pay_balance:${clientIP}`
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.sensitive)
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' })
  }

  // Verify JWT token
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = authHeader.split('Bearer ')[1]

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }

    const amount = Number(req.body?.amount)
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' })
    }

    // Get user's current balance
    const { data: balanceRow, error: balanceError } = await supabase
      .from('user_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single()

    if (balanceError || !balanceRow) {
      return res.status(400).json({ error: 'No balance found for this account' })
    }

    const currentBalance = Number(balanceRow.balance)
    if (currentBalance < amount) {
      return res.status(400).json({ error: 'Insufficient balance' })
    }

    // Deduct amount via RPC
    const { error: rpcError } = await supabase.rpc('deduct_user_balance', {
      p_user_id: user.id,
      p_amount: amount,
    })
    if (rpcError) throw rpcError

    // Mark current month bill as paid
    const currentMonth = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
    const { data: matchingBill } = await supabase
      .from('payments')
      .select('id')
      .eq('user_id', user.id)
      .ilike('month', `${currentMonth}%`)
      .eq('status', 'unpaid')
      .single()

    if (matchingBill) {
      await supabase
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          payment_method: 'balance',
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchingBill.id)
    }

    // Send confirmation notification to user
    await supabase.from('notifications').insert({
      user_id: user.id,
      type: 'payment_confirmed',
      message: `Your payment of ৳${amount.toFixed(0)} was made using your account balance. Your bill is now marked as paid.`,
    })

    logSecurityEvent('ADMIN_ACTION', req, {
      userId: user.id,
      email: maskEmail(user.email || ''),
      severity: 'INFO',
      details: { action: 'PAY_WITH_BALANCE', amount },
    })

    const newBalance = currentBalance - amount
    return res.status(200).json({ success: true, newBalance })
  } catch (error: any) {
    console.error('Pay with balance error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}
