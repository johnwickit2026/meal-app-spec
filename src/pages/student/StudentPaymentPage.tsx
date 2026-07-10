import { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import {
  CreditCard,
  ShoppingBag,
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  ExternalLink,
  Globe,
  Banknote,
} from 'lucide-react'
import { useStudentStore } from '../../store/studentStore'

import type { StudentOrder } from '../../store/studentStore'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '../../components/ui'
import toast from 'react-hot-toast'

// ─── Return-URL handler ───────────────────────────────────────────────────────
// SSLCommerz redirects to /student/payment?status=success|fail|cancel&order_id=...

function PaymentReturnBanner({ status }: { status: string }) {
  if (status === 'success') {
    return (
      <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
        <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
        <div>
          <p className="font-semibold text-green-800">Payment Successful!</p>
          <p className="text-sm text-green-700">Your tiffin order has been confirmed and paid.</p>
        </div>
      </div>
    )
  }
  if (status === 'fail') {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
        <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
        <div>
          <p className="font-semibold text-red-800">Payment Failed</p>
          <p className="text-sm text-red-700">Your payment could not be processed. Your balance was not charged. Please try again.</p>
        </div>
      </div>
    )
  }
  if (status === 'cancel') {
    return (
      <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
        <AlertCircle className="h-6 w-6 text-yellow-600 flex-shrink-0" />
        <div>
          <p className="font-semibold text-yellow-800">Payment Cancelled</p>
          <p className="text-sm text-yellow-700">You cancelled the payment. Your balance was not charged.</p>
        </div>
      </div>
    )
  }
  return null
}

function StatusSyncingBanner() {
  return (
    <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
      <Loader2 className="h-6 w-6 text-blue-600 animate-spin flex-shrink-0" />
      <div>
        <p className="font-semibold text-blue-800">Verifying Payment...</p>
        <p className="text-sm text-blue-700">Please wait while we confirm with the payment gateway.</p>
      </div>
    </div>
  )
}

// ─── Order Summary Card ───────────────────────────────────────────────────────

function OrderSummary({ order }: { order: StudentOrder }) {
  const meal = order.tiffin_menu?.meal
  const menu = order.tiffin_menu

  return (
    <div className="space-y-4">
      {/* Meal info */}
      <div className="flex items-start gap-4 p-4 bg-amber-50 rounded-xl border border-amber-100">
        <div className="h-12 w-12 rounded-xl bg-amber-200 flex items-center justify-center flex-shrink-0">
          <UtensilsCrossed className="h-6 w-6 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-gray-900">{meal?.name ?? 'Tiffin'}</p>
          {meal?.description && (
            <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{meal.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {menu?.time_slot && (
              <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                <Clock className="h-3 w-3" />
                {menu.time_slot}
              </span>
            )}
            <span className="text-xs text-gray-500">Meal date: {order.meal_date}</span>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Unit price</span>
          <span>৳{menu?.price ? Number(menu.price).toFixed(0) : '—'}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Quantity</span>
          <span>× {order.quantity}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Order placed on</span>
          <span>{order.order_date}</span>
        </div>
        <div className="border-t border-dashed border-amber-200 pt-2 flex justify-between font-bold text-base">
          <span className="text-gray-900">Total</span>
          <span className="text-amber-600">৳{Number(order.total_amount).toFixed(0)} BDT</span>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentPaymentPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const orderId   = searchParams.get('order_id')
  const returnStatus = searchParams.get('status') // success | fail | cancel

  const { orders, upcomingOrders, fetchOrders, initiatePayment } = useStudentStore()

  const [isPaying, setIsPaying] = useState(false)
  const hasNotified = useRef(false)

  // Find the order from both upcoming and all orders
  const allOrders = orders.length > 0 ? orders : upcomingOrders
  const order = orderId ? allOrders.find((o) => o.id === orderId) ?? null : null

  useEffect(() => {
    if (!orderId) return

    fetchOrders()

    // Real-time subscription to catch IPN updates quickly
    const channel = supabase
      .channel(`order-${orderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'student_orders', filter: `id=eq.${orderId}` },
        () => {
          fetchOrders()
        }
      )
      .subscribe()

    // Fallback polling just in case realtime misses
    const interval = setInterval(() => {
      fetchOrders()
    }, 5000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [orderId, fetchOrders])

  // Toast notification logic when final status arrives
  useEffect(() => {
    if (!order || hasNotified.current) return

    if (returnStatus === 'success' && order.status === 'paid') {
      toast.success('Payment verified successfully!')
      hasNotified.current = true
    } else if (returnStatus === 'fail' || order.status === 'cancelled') {
      toast.error('Payment failed or cancelled.')
      hasNotified.current = true
    }
  }, [order, returnStatus])

  // ── Pay online (SSLCommerz) ──
  const handlePayOnline = async () => {
    if (!orderId) return
    setIsPaying(true)

    const { error, paymentUrl } = await initiatePayment(orderId)

    if (error) {
      toast.error(error.message)
      setIsPaying(false)
      return
    }

    if (paymentUrl) {
      // Redirect to SSLCommerz payment gateway
      window.location.href = paymentUrl
    }
    // Don't reset isPaying — page will navigate away
  }

  // ── Pay on Campus (cash payment request) ──
  const handlePayOnCampus = async () => {
    if (!orderId || !order) return
    setIsPaying(true)
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser()
      if (!currentUser) throw new Error('Not authenticated')

      // Create a cash payment request for the order
      const { error } = await supabase.from('cash_payment_requests').insert({
        user_id: currentUser.id,
        amount: Number(order.total_amount),
        notes: `Student tiffin order: ${orderId}`,
      })
      if (error) throw error

      // Notify admins
      const [{ data: admins }, { data: submitterProfile }] = await Promise.all([
        supabase.from('profiles').select('id').eq('role', 'admin'),
        supabase.from('profiles').select('full_name').eq('id', currentUser.id).single()
      ])

      const senderName = submitterProfile?.full_name || currentUser.email || 'A student'

      if (admins && admins.length > 0) {
        await supabase.from('notifications').insert(
          admins.map((admin) => ({
            user_id: admin.id,
            type: 'cash_request' as const,
            message: `${senderName} wants to pay ৳${Number(order.total_amount).toFixed(0)} on campus for their tiffin order. Please confirm.`,
            is_read: false,
          }))
        )
      }

      toast.success('Pay on Campus request submitted! Admin will confirm your payment.')
      fetchOrders()
    } catch (err: any) {
      toast.error('Failed to submit request: ' + err.message)
    } finally {
      setIsPaying(false)
    }
  }

  // ── No order_id provided ──
  if (!orderId) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/student/orders')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Orders
        </button>
        <Card>
          <CardContent className="py-16 text-center">
            <ShoppingBag className="h-14 w-14 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No order selected</p>
            <Button
              className="mt-4 bg-amber-500 hover:bg-amber-600 text-white border-0"
              onClick={() => navigate('/student/orders')}
            >
              Go to My Orders
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Back nav */}
      <button
        onClick={() => navigate('/student/orders')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-amber-600 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </button>

      {/* Return URL banner: If we returned from gateway with success but DB is still pending, show syncing banner */}
      {returnStatus === 'success' && order?.status === 'pending' ? (
        <StatusSyncingBanner />
      ) : (
        returnStatus && <PaymentReturnBanner status={returnStatus} />
      )}

      {/* Order summary card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-amber-500" />
            Payment Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {order ? (
            <OrderSummary order={order} />
          ) : (
            <div className="py-8 text-center text-gray-500">
              <Loader2 className="h-8 w-8 animate-spin text-amber-400 mx-auto mb-3" />
              Loading order details…
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pay options */}
      {order && (
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50">
          <CardContent className="p-5 space-y-4">
            {order.status === 'paid' ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <p className="font-semibold text-green-700 text-lg">Already Paid!</p>
                <p className="text-sm text-gray-500 text-center">
                  This order has been paid successfully. Enjoy your tiffin!
                </p>
                <Badge variant="confirmed">
                  {order.payment?.tran_id ? `Txn: ${order.payment.tran_id}` : 'Payment confirmed'}
                </Badge>
              </div>
            ) : order.status === 'cancelled' ? (
              <div className="flex flex-col items-center gap-3 py-4">
                <XCircle className="h-12 w-12 text-gray-400" />
                <p className="font-semibold text-gray-600">Order Cancelled</p>
                <Button
                  className="bg-amber-500 hover:bg-amber-600 text-white border-0"
                  onClick={() => navigate('/student/menu')}
                >
                  Order Again
                </Button>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-600 mb-1">
                    ৳{Number(order.total_amount).toFixed(0)}
                  </p>
                  <p className="text-xs text-gray-500">
                    Amount to pay
                  </p>
                </div>

                {/* Two payment options: Pay Now (SSLCommerz) and Pay on Campus */}
                <div className="space-y-3">
                  <Button
                    onClick={handlePayOnline}
                    disabled={isPaying}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0 h-12 text-base font-semibold shadow-md shadow-amber-200 disabled:opacity-60"
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Connecting to gateway…
                      </>
                    ) : (
                      <>
                        <Globe className="h-5 w-5 mr-2" />
                        Pay Now — ৳{Number(order.total_amount).toFixed(0)}
                      </>
                    )}
                  </Button>

                  {/* SSLCommerz branding note */}
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>You will be redirected to SSLCommerz secure payment gateway</span>
                  </div>

                  <div className="relative flex items-center py-1">
                    <div className="flex-grow border-t border-amber-200"></div>
                    <span className="mx-3 text-xs text-gray-400 font-medium">OR</span>
                    <div className="flex-grow border-t border-amber-200"></div>
                  </div>

                  <Button
                    onClick={handlePayOnCampus}
                    disabled={isPaying}
                    variant="outline"
                    className="w-full h-12 text-base font-semibold text-amber-700 border-amber-300 hover:bg-amber-50 disabled:opacity-60"
                  >
                    {isPaying ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <Banknote className="h-5 w-5 mr-2" />
                        Pay on Campus
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-center text-gray-400">
                    Pay at the campus counter. Admin will confirm your payment.
                  </p>
                </div>

                <p className="text-xs text-center text-gray-400">
                  Secured by SSLCommerz · bKash · Nagad · Cards accepted
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default StudentPaymentPage
