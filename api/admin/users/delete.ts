import type { Handler, HandlerEvent } from '@netlify/functions'
import { createReqRes } from '../../_netlify_shim.js'
import { createClient } from '@supabase/supabase-js'

export const handler: Handler = async (event: HandlerEvent): Promise<any> => {
  const { req, res } = createReqRes(event)

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Content-Type': 'application/json'
    }, body: '' }
  }

  if (event.httpMethod !== 'DELETE') {
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
    const { userId } = body
    if (!userId) return { statusCode: 400, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: 'userId is required' }) }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (error) return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: error.message }) }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, message: 'User deleted successfully' }) }

  } catch (err: any) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, error: err.message }) }
  }
}
