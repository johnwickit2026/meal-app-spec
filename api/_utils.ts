import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getSecurityHeaders, getSecureCorsHeaders } from './_security.js'

let _supabaseAdmin: SupabaseClient<any, any, any> | null = null

// Lazily create the Supabase admin client so a missing env var doesn't crash
// the whole module (and any handler that imports from this file) on load.
export function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing required environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  }

  _supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)
  return _supabaseAdmin
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim())
const isProduction = process.env.NODE_ENV === 'production'

/**
 * Get CORS origin with strict validation
 * @deprecated Use getSecureCorsHeaders from _security.ts instead
 */
export function getCorsOrigin(origin: string | undefined): string {
  if (origin && allowedOrigins.includes(origin)) {
    return origin
  }
  return allowedOrigins[0]
}

export function verifyAuth(authHeader: string | null) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.split('Bearer ')[1]
}

/**
 * Get CORS headers with security improvements
 * @deprecated Use getSecureCorsHeaders from _security.ts for new implementations
 */
export function corsHeaders(origin?: string) {
  // Use secure CORS headers if available
  const secureHeaders = getSecureCorsHeaders(origin, allowedOrigins)
  if (secureHeaders) {
    return secureHeaders
  }

  // Fallback to legacy behavior
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(origin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}

/**
 * Get complete security headers including CORS and security headers
 */
export function getSecurityResponseHeaders(origin?: string): Record<string, string> {
  const cors = corsHeaders(origin)
  const security = getSecurityHeaders(isProduction)
  
  return {
    ...cors,
    ...security,
  }
}

export function errorResponse(message: string, status: number = 400, origin?: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...getSecurityResponseHeaders(origin) },
  })
}

export function successResponse(data: unknown, status: number = 200, origin?: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getSecurityResponseHeaders(origin) },
  })
}

// Role-based verification types
export type UserRole = 'employee' | 'admin' | 'food_editor' | 'finance_editor'

// Verify token and return user with role
export async function verifyTokenWithRole(token: string) {
  const supabaseAdmin = getSupabaseAdmin()
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return null

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('Profile query error:', profileError)
    return null
  }

  return { user, role: profile?.role as UserRole }
}

// Check if role is any type of admin
export function isAdmin(role: UserRole): boolean {
  return ['admin', 'food_editor', 'finance_editor'].includes(role)
}

// Check if role is main admin
export function isMainAdmin(role: UserRole): boolean {
  return role === 'admin'
}

// Check if role can manage meals
export function canManageMeals(role: UserRole): boolean {
  return ['admin', 'food_editor'].includes(role)
}

// Check if role can manage finance/payments
export function canManageFinance(role: UserRole): boolean {
  return ['admin', 'finance_editor'].includes(role)
}

// Check if role can manage users and assign roles (admin only)
export function canManageUsers(role: UserRole): boolean {
  return role === 'admin'
}

// Check if role can manage bookings (admin only)
export function canManageBookings(role: UserRole): boolean {
  return role === 'admin'
}
