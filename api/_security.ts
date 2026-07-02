/** Minimal request shape compatible with both the Vercel req shim and Netlify HandlerEvent */
interface RequestLike {
  headers: Record<string, string | string[] | undefined>
  url?: string
  method?: string
}

// ============================================
// RATE LIMITING
// ============================================

interface RateLimitEntry {
  count: number
  resetTime: number
  blocked: boolean
}

// In-memory store for rate limiting (per-instance only)
const rateLimitStore = new Map<string, RateLimitEntry>()

interface RateLimitConfig {
  windowMs: number      // Time window in milliseconds
  maxRequests: number   // Max requests per window
  blockDuration?: number // How long to block after exceeding (ms)
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  blockDuration: 60 * 60 * 1000, // 1 hour block
}

// Specific configs for different endpoints
export const RATE_LIMITS = {
  auth: { windowMs: 15 * 60 * 1000, maxRequests: 5, blockDuration: 60 * 60 * 1000 }, // 5 attempts per 15 min
  sensitive: { windowMs: 60 * 1000, maxRequests: 10 }, // 10 per minute for sensitive ops
  api: { windowMs: 15 * 60 * 1000, maxRequests: 100 }, // 100 per 15 min general API
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetTime: number
  blocked: boolean
}

/**
 * Check if request should be rate limited
 * @param identifier - Unique identifier (IP + endpoint or user ID)
 * @param config - Rate limit configuration
 */
export function checkRateLimit(identifier: string, config: RateLimitConfig = DEFAULT_CONFIG): RateLimitResult {
  const now = Date.now()
  const entry = rateLimitStore.get(identifier)

  // Clean up expired entries periodically
  if (Math.random() < 0.01) { // 1% chance to clean up on each check
    cleanupExpiredEntries(now)
  }

  // If blocked, check if block has expired
  if (entry?.blocked) {
    if (now < entry.resetTime) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
        blocked: true,
      }
    }
    // Block expired, reset
    rateLimitStore.delete(identifier)
  }

  // No entry or expired window
  if (!entry || now > entry.resetTime) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + config.windowMs,
      blocked: false,
    }
    rateLimitStore.set(identifier, newEntry)
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: newEntry.resetTime,
      blocked: false,
    }
  }

  // Entry exists and is within window
  if (entry.count >= config.maxRequests) {
    // Block the identifier
    const blockDuration = config.blockDuration || config.windowMs
    entry.blocked = true
    entry.resetTime = now + blockDuration
    rateLimitStore.set(identifier, entry)

    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
      blocked: true,
    }
  }

  // Increment counter
  entry.count++
  rateLimitStore.set(identifier, entry)

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetTime: entry.resetTime,
    blocked: false,
  }
}

function cleanupExpiredEntries(now: number): void {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

/**
 * Get client IP from request
 */
export function getClientIP(req: RequestLike): string {
  const forwarded = req.headers['x-forwarded-for']
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0].trim() 
    : 'unknown' // socket not available in serverless environments
  return ip
}

// ============================================
// SECURITY HEADERS
// ============================================

export interface SecurityHeaders {
  'X-Content-Type-Options': string
  'X-Frame-Options': string
  'X-XSS-Protection': string
  'Referrer-Policy': string
  'Permissions-Policy': string
  'Strict-Transport-Security'?: string
  'Content-Security-Policy'?: string
}

export function getSecurityHeaders(isProduction: boolean = false): SecurityHeaders {
  const headers: SecurityHeaders = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  }

  if (isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
    headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https://*.supabase.co;"
  }

  return headers
}

// ============================================
// SECURITY LOGGING
// ============================================

type SecurityEventType = 
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_RESET_REQUEST'
  | 'PASSWORD_RESET_SUCCESS'
  | 'UNAUTHORIZED_ACCESS'
  | 'FORBIDDEN_ACCESS'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SUSPICIOUS_ACTIVITY'
  | 'ADMIN_ACTION'

interface SecurityLogEntry {
  timestamp: string
  event: SecurityEventType
  severity: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
  userId?: string
  email?: string
  ip: string
  userAgent?: string
  path?: string
  method?: string
  details?: Record<string, unknown>
  requestId?: string
}

// In-memory log buffer (last 1000 entries)
const logBuffer: SecurityLogEntry[] = []
const MAX_LOG_BUFFER = 1000

/**
 * Log security event
 */
export function logSecurityEvent(
  event: SecurityEventType,
  req: RequestLike,
  options: {
    userId?: string
    email?: string
    severity?: SecurityLogEntry['severity']
    details?: Record<string, unknown>
    requestId?: string
  } = {}
): void {
  const entry: SecurityLogEntry = {
    timestamp: new Date().toISOString(),
    event,
    severity: options.severity || 'INFO',
    userId: options.userId,
    email: options.email ? maskEmail(options.email) : undefined,
    ip: getClientIP(req),
    userAgent: req.headers['user-agent'] as string | undefined,
    path: req.url,
    method: req.method,
    details: redactSensitiveData(options.details),
    requestId: options.requestId,
  }

  // Add to buffer
  logBuffer.push(entry)
  if (logBuffer.length > MAX_LOG_BUFFER) {
    logBuffer.shift()
  }

  // Also log to console for visibility (in production, send to logging service)
  const logMessage = `[SECURITY] ${entry.severity} | ${event} | IP: ${entry.ip}${entry.email ? ` | User: ${entry.email}` : ''}${entry.path ? ` | Path: ${entry.path}` : ''}`
  
  if (entry.severity === 'CRITICAL' || entry.severity === 'ERROR') {
    console.error(logMessage, entry)
  } else if (entry.severity === 'WARNING') {
    console.warn(logMessage, entry)
  } else {
    console.log(logMessage)
  }
}

/**
 * Get recent security logs (for monitoring)
 */
export function getSecurityLogs(limit: number = 100): SecurityLogEntry[] {
  return logBuffer.slice(-limit)
}

/**
 * Redact sensitive data from log details
 */
function redactSensitiveData(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) return undefined

  const redacted: Record<string, unknown> = {}
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'credit_card', 'ssn', 'auth']

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase()
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      redacted[key] = '[REDACTED]'
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

/**
 * Mask email for logging
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  const maskedLocal = local.length > 2 
    ? local[0] + '*'.repeat(Math.min(local.length - 2, 5)) + local.slice(-1)
    : '*'.repeat(local.length)
  return `${maskedLocal}@${domain}`
}

// ============================================
// REQUEST ID GENERATION
// ============================================

/**
 * Generate unique request ID for tracing
 */
export function generateRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`
}

// ============================================
// CORS SECURITY
// ============================================

/**
 * Strict CORS validation - rejects unknown origins
 */
export function validateCorsOrigin(origin: string | undefined, allowedOrigins: string[]): { valid: boolean; origin: string | null } {
  if (!origin) {
    return { valid: false, origin: null }
  }
  
  if (allowedOrigins.includes(origin)) {
    return { valid: true, origin }
  }
  
  return { valid: false, origin: null }
}

/**
 * Get CORS headers with strict validation
 */
export function getSecureCorsHeaders(reqOrigin: string | undefined, allowedOrigins: string[]): Record<string, string> | null {
  const { valid, origin } = validateCorsOrigin(reqOrigin, allowedOrigins)
  
  if (!valid) {
    return null
  }

  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  }
}
