import type { Handler, HandlerEvent } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

export const handler: Handler = async (event: HandlerEvent): Promise<any> => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Content-Type': 'application/json'
    }, body: '' }
  }

  if (event.httpMethod !== 'PATCH') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Method not allowed' }) }
  }

  try {
    const supabaseAdmin = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const token = (event.headers.authorization || '').replace('Bearer ', '')
    if (!token) return { statusCode: 401, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Unauthorized' }) }

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !user) return { statusCode: 401, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Invalid token' }) }

    const body = event.body ? JSON.parse(event.body) : {}
    const { userId, amount, note } = body

    if (!userId || !amount || Number(amount) <= 0) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'userId and valid amount required' }) }
    }

    // Validate admin privilege and credit balance in parallel (independent reads).
    const [profileResult, rpcResult] = await Promise.all([
      supabaseAdmin.from('profiles').select('role').eq('id', user.id).single(),
      supabaseAdmin.rpc('add_user_balance', {
        p_user_id: userId,
        p_amount: parseFloat(amount),
        p_admin_id: user.id
      })
    ])

    const profile = profileResult.data
    if (profile?.role !== 'admin') {
      return { statusCode: 403, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'Forbidden' }) }
    }

    if (rpcResult.error) throw rpcResult.error

    // newBalance comes straight from the RPC return value (no follow-up SELECT).
    const newBalance = rpcResult.data ?? null

    // Fire notification in the background so it never blocks the response.
    ;(async () => {
      try {
        await supabaseAdmin.from('notifications').insert({
          user_id: userId,
          type: 'balance_added',
          message: `BDT ${amount} has been added to your account balance.${note ? ' Note: ' + note : ''}`
        })
      } catch (err) {
        console.error('Balance notification insert failed:', err)
      }
    })()

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Balance updated',
        data: { newBalance } }) }

  } catch (err: any) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }) }
  }
}
