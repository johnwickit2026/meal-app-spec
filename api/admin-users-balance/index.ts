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

    const { data: profile } = await supabaseAdmin.from('profiles')
      .select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return { statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'Forbidden' }) }

    const body = event.body ? JSON.parse(event.body) : {}
    const { userId, amount, note } = body

    if (!userId || !amount || Number(amount) <= 0) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, error: 'userId and valid amount required' }) }
    }

    const { data: userProfile, error: fetchErr } = await supabaseAdmin
      .from('profiles').select('balance').eq('id', userId).single()
    if (fetchErr) throw fetchErr

    const newBalance = (userProfile?.balance || 0) + parseFloat(amount)

    const { error: updateErr } = await supabaseAdmin
      .from('profiles').update({ balance: newBalance }).eq('id', userId)
    if (updateErr) throw updateErr

    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      type: 'balance_added',
      message: `BDT ${amount} has been added to your account balance.${note ? ' Note: ' + note : ''}`
    })

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'Balance updated',
        data: { newBalance } }) }

  } catch (err: any) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }) }
  }
}
