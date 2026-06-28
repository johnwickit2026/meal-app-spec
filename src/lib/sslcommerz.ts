/**
 * SSLCommerz payment gateway helper
 *
 * Used exclusively in Vercel serverless functions (api/).
 * Never import this file in browser/client code.
 *
 * Docs: https://developer.sslcommerz.com/doc/v4/
 */

// ─── Environment ──────────────────────────────────────────────────────────────

// Allow `process` reference to compile under Vite's client types (no @types/node)
declare const process: { env: Record<string, string | undefined> } | undefined

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env: Record<string, string | undefined> = typeof process !== 'undefined' ? (process as any).env : (import.meta as any).env

const STORE_ID       = _env.SSLCOMMERZ_STORE_ID       ?? ''
const STORE_PASSWORD = _env.SSLCOMMERZ_STORE_PASSWORD ?? ''
const IS_LIVE        = _env.SSLCOMMERZ_IS_LIVE === 'true'
const APP_URL        = _env.VITE_APP_URL               ?? 'http://localhost:5173'

// Gateway base URLs
const SANDBOX_BASE  = 'https://sandbox.sslcommerz.com'
const LIVE_BASE     = 'https://securepay.sslcommerz.com'
const GATEWAY_BASE  = IS_LIVE ? LIVE_BASE : SANDBOX_BASE

export const SSLCOMMERZ_INITIATE_URL = `${GATEWAY_BASE}/gwprocess/v4/api.php`
export const SSLCOMMERZ_VALIDATE_URL = `${GATEWAY_BASE}/validator/api/validationserverAPI.php`

// ─── Types ────────────────────────────────────────────────────────────────────

/** Payload sent to SSLCommerz initiation endpoint */
export interface SSLCommerzInitiateRequest {
  // Required credentials
  store_id:       string
  store_passwd:   string

  // Transaction
  total_amount:   number
  currency:       string     // 'BDT'
  tran_id:        string     // Unique transaction ID from your system

  // Redirect URLs — SSLCommerz POSTs/redirects the customer here after payment
  success_url:    string
  fail_url:       string
  cancel_url:     string

  // IPN (Instant Payment Notification) — server-to-server callback
  ipn_url:        string

  // Customer info (all required by SSLCommerz)
  cus_name:       string
  cus_email:      string
  cus_add1:       string
  cus_city:       string
  cus_country:    string
  cus_phone:      string

  // Shipping info (required fields — use SAME for digital goods)
  ship_name:      string
  ship_add1:      string
  ship_city:      string
  ship_country:   string

  // Product info
  product_name:   string
  product_category: string
  product_profile:  string   // 'general' | 'physical-goods' | 'non-physical-goods'

  // Optional extra fields passed through unchanged
  value_a?:       string
  value_b?:       string
  value_c?:       string
  value_d?:       string
}

/** Response from SSLCommerz initiation endpoint */
export interface SSLCommerzInitiateResponse {
  status:            'SUCCESS' | 'FAILED'
  failedreason?:     string
  sessionkey?:       string
  gw?:               Record<string, unknown>
  redirectGatewayURL?: string
  redirectGatewayURLFailed?: string
  GatewayPageURL?:   string    // The URL to redirect the customer to
  storeBanner?:      string
  storeLogo?:        string
  desc?:             unknown[]
  is_direct_pay_enable?: string
}

/** Body POSTed by SSLCommerz to your IPN / success / fail / cancel URL */
export interface SSLCommerzIPNPayload {
  val_id:           string
  tran_id:          string
  amount:           string
  store_amount?:    string
  card_type?:       string
  card_no?:         string
  bank_tran_id?:    string
  status:           'VALID' | 'VALIDATED' | 'INVALID_TRANSACTION' | 'FAILED' | 'CANCELLED' | 'UNATTEMPTED' | 'EXPIRED'
  tran_date?:       string
  error?:           string
  currency:         string
  card_issuer?:     string
  card_brand?:      string
  card_issuer_country?: string
  card_issuer_country_code?: string
  store_id:         string
  verify_sign:      string
  verify_key:       string
  verify_sign_sha2: string
  currency_type?:   string
  currency_amount?: string
  currency_rate?:   string
  base_fair?:       string
  value_a?:         string
  value_b?:         string
  value_c?:         string
  value_d?:         string
  risk_level?:      string
  risk_title?:      string
}

/** Response from the SSLCommerz validation endpoint */
export interface SSLCommerzValidationResponse {
  status:           'VALID' | 'VALIDATED' | 'INVALID_TRANSACTION' | 'FAILED'
  tran_id:          string
  val_id:           string
  amount:           string
  currency:         string
  bank_tran_id?:    string
  card_no?:         string
  card_issuer?:     string
  store_amount?:    string
  [key: string]:    unknown
}

// ─── Order data passed from your system ───────────────────────────────────────

export interface StudentOrderData {
  orderId:       string   // student_orders.id (used as tran_id)
  studentName:   string
  studentEmail:  string
  studentPhone:  string
  mealName:      string
  amount:        number   // in BDT, e.g. 120.00
  currency?:     string   // default 'BDT'
}

// ─── initiatePayment ──────────────────────────────────────────────────────────

/**
 * Calls the SSLCommerz initiation API and returns the redirect URL to send
 * the student to, plus the session key to store in student_payments.
 *
 * Throws on network failure or when SSLCommerz returns status !== 'SUCCESS'.
 */
export async function initiatePayment(order: StudentOrderData): Promise<{
  paymentUrl:  string
  sessionKey:  string
  tranId:      string
}> {
  if (!STORE_ID || !STORE_PASSWORD) {
    throw new Error('SSLCommerz credentials are not configured')
  }

  const tranId = order.orderId  // Use order UUID as the unique transaction ID

  const callbackBase = `${APP_URL}/student/payment?order_id=${order.orderId}`
  const ipnUrl       = `${APP_URL}/api/payments/callback`

  const payload: SSLCommerzInitiateRequest = {
    store_id:         STORE_ID,
    store_passwd:     STORE_PASSWORD,

    total_amount:     order.amount,
    currency:         order.currency ?? 'BDT',
    tran_id:          tranId,

    success_url:      `${callbackBase}&status=success`,
    fail_url:         `${callbackBase}&status=fail`,
    cancel_url:       `${callbackBase}&status=cancel`,
    ipn_url:          ipnUrl,

    cus_name:         order.studentName,
    cus_email:        order.studentEmail,
    cus_add1:         'N/A',
    cus_city:         'Dhaka',
    cus_country:      'Bangladesh',
    cus_phone:        order.studentPhone || '01700000000',

    ship_name:        order.studentName,
    ship_add1:        'N/A',
    ship_city:        'Dhaka',
    ship_country:     'Bangladesh',

    product_name:     order.mealName,
    product_category: 'Food',
    product_profile:  'non-physical-goods',

    // Pass order ID through for extra safety in the IPN handler
    value_a:          order.orderId,
  }

  // SSLCommerz expects application/x-www-form-urlencoded
  const body = new URLSearchParams(
    Object.entries(payload).reduce<Record<string, string>>((acc, [k, v]) => {
      if (v !== undefined && v !== null) acc[k] = String(v)
      return acc
    }, {})
  )

  const response = await fetch(SSLCOMMERZ_INITIATE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })

  if (!response.ok) {
    throw new Error(`SSLCommerz initiation HTTP error: ${response.status}`)
  }

  const data: SSLCommerzInitiateResponse = await response.json()

  if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
    throw new Error(data.failedreason ?? 'SSLCommerz initiation failed — no gateway URL returned')
  }

  return {
    paymentUrl: data.GatewayPageURL,
    sessionKey: data.sessionkey ?? '',
    tranId,
  }
}

// ─── validatePayment ──────────────────────────────────────────────────────────

/**
 * Validates a payment using the val_id returned in the IPN/redirect callback.
 * Always call this server-side before marking an order as paid.
 *
 * Returns the full validation response.
 * Throws if the network call fails or the status is not VALID / VALIDATED.
 */
export async function validatePayment(valId: string): Promise<SSLCommerzValidationResponse> {
  if (!STORE_ID || !STORE_PASSWORD) {
    throw new Error('SSLCommerz credentials are not configured')
  }

  const url = new URL(SSLCOMMERZ_VALIDATE_URL)
  url.searchParams.set('val_id',    valId)
  url.searchParams.set('store_id',  STORE_ID)
  url.searchParams.set('store_passwd', STORE_PASSWORD)
  url.searchParams.set('format',    'json')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`SSLCommerz validation HTTP error: ${response.status}`)
  }

  const data: SSLCommerzValidationResponse = await response.json()

  if (data.status !== 'VALID' && data.status !== 'VALIDATED') {
    throw new Error(`Payment validation failed — status: ${data.status}`)
  }

  return data
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the gateway is configured in live mode.
 * Useful for logging / sanity checks in API handlers.
 */
export function isLiveGateway(): boolean {
  return IS_LIVE
}

/**
 * Returns a sanitised summary of the current SSLCommerz config
 * suitable for logging (no passwords).
 */
export function getSSLCommerzConfig() {
  return {
    storeId:     STORE_ID || '(not set)',
    isLive:      IS_LIVE,
    gatewayBase: GATEWAY_BASE,
    appUrl:      APP_URL,
  }
}
