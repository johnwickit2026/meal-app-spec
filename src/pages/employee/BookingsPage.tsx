import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Calendar, Clock, User, Utensils, CreditCard, Globe, CheckCircle2, Loader2, Wallet } from 'lucide-react'
import { useAuthStore, useBookingStore, useSettingsStore } from '../../store'
import { Card, CardContent, Select, CardSkeleton, Button } from '../../components/ui'
import { BookingCard } from '../../components/employee'
import { useTranslation } from '../../hooks/useTranslation'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import type { BookingWithDetails } from '../../types'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabaseClient'

type PaymentStatus = 'paid' | 'pending' | 'unpaid'

export function BookingsPage() {
  const { user } = useAuthStore()
  const { bookings, fetchUserBookings, cancelBooking, isLoading } = useBookingStore()
  const { cancellationTimeLimit, fetchSettings } = useSettingsStore()
  const { t } = useTranslation()
  
  const [searchParams] = useSearchParams()
  const paymentReturnStatus = searchParams.get('payment_status') // success | fail | cancel

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [viewingBooking, setViewingBooking] = useState<BookingWithDetails | null>(null)

  const [onlineModalOpen, setOnlineModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [userBalance, setUserBalance] = useState(0)
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid')
  const [isLoadingPaymentStatus, setIsLoadingPaymentStatus] = useState(true)
  const [pendingAmount, setPendingAmount] = useState<number | null>(null)

  // Syncing banner state for return from SSLCommerz
  const [isSyncingPayment, setIsSyncingPayment] = useState(false)

  useEffect(() => {
    if (user) {
      fetchUserBookings(user.id, true)
      fetchSettings()
      fetchBalance(user.id)
      fetchPaymentStatus(user.id)
    }
  }, [user, fetchUserBookings, fetchSettings])

  // Handle payment return from SSLCommerz
  useEffect(() => {
    if (!paymentReturnStatus || !user) return

    if (paymentReturnStatus === 'success') {
      setIsSyncingPayment(true)
      toast.success('Payment received! Verifying...')
      // Poll for status update (IPN may take a moment)
      const interval = setInterval(() => {
        fetchPaymentStatus(user.id).then(status => {
          if (status === 'paid') {
            setIsSyncingPayment(false)
            toast.success('Payment confirmed!')
            fetchBalance(user.id)
            clearInterval(interval)
          }
        })
      }, 3000)
      // Stop polling after 30s
      setTimeout(() => { clearInterval(interval); setIsSyncingPayment(false) }, 30000)
      return () => clearInterval(interval)
    } else if (paymentReturnStatus === 'fail') {
      toast.error('Payment failed. Please try again.')
    } else if (paymentReturnStatus === 'cancel') {
      toast('Payment cancelled. Your balance was not charged.')
    }
  }, [paymentReturnStatus, user])

  const fetchBalance = async (userId: string) => {
    const { data } = await supabase
      .from('user_balances')
      .select('balance')
      .eq('user_id', userId)
      .single()
    setUserBalance(data?.balance ?? 0)
  }

  const fetchPaymentStatus = async (userId: string): Promise<PaymentStatus> => {
    setIsLoadingPaymentStatus(true)
    const currentMonth = new Date().toISOString().slice(0, 7)
    try {
      // Check payments table for this month
      const { data: paymentRow } = await supabase
        .from('payments')
        .select('status, amount')
        .eq('user_id', userId)
        .eq('month', currentMonth)
        .maybeSingle()

      if (paymentRow?.status === 'paid') {
        setPaymentStatus('paid')
        setPendingAmount(null)
        return 'paid'
      }

      // Check pending cash requests for this month
      const { data: cashReqs } = await supabase
        .from('cash_payment_requests')
        .select('amount, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)

      if (cashReqs && cashReqs.length > 0) {
        setPaymentStatus('pending')
        setPendingAmount(cashReqs[0].amount)
        return 'pending'
      }

      setPaymentStatus('unpaid')
      setPendingAmount(null)
      return 'unpaid'
    } catch (err) {
      console.error('Error fetching payment status:', err)
      setPaymentStatus('unpaid')
      return 'unpaid'
    } finally {
      setIsLoadingPaymentStatus(false)
    }
  }

  // Calculate monthly total cost of confirmed bookings (accounting for quantity)
  const currentMonth = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
  const monthlyTotal = bookings
    .filter((b) => {
      const bookingMonth = b.booked_at?.slice(0, 7)
      return b.status === 'confirmed' && bookingMonth === currentMonth
    })
    .reduce((sum, b) => {
      const price = (b.menu_schedule?.meal as any)?.price || 0
      const quantity = b.quantity || 1
      return sum + (price * quantity)
    }, 0)

  // Auto-apply balance computation
  const amountFromBalance = Math.min(userBalance, monthlyTotal)
  const remainder = monthlyTotal - amountFromBalance

  // ── Fully covered by balance ──────────────────────────────────────────
  const handlePayFullyWithBalance = async () => {
    if (!user || monthlyTotal <= 0) return
    setIsSubmitting(true)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      const response = await fetch('/api/bookings-pay-balance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: monthlyTotal,
          balanceDeductAmount: amountFromBalance
        })
      })
      const result = await response.json()
      if (result.success) {
        toast.success('Paid with balance successfully!')
        if (typeof result.newBalance === 'number') setUserBalance(result.newBalance)
        setPaymentStatus('paid')
      } else {
        toast.error(result.error || 'Payment failed')
      }
    } catch (err: any) {
      toast.error('Payment failed: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Pay Online (SSLCommerz) ───────────────────────────────────────────
  const handlePayOnline = async () => {
    if (!user || monthlyTotal <= 0) return
    setIsSubmitting(true)
    try {
      if (remainder <= 0) {
        // Fully covered by balance — settle immediately
        await handlePayFullyWithBalance()
        setOnlineModalOpen(false)
        return
      }

      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      const response = await fetch('/api/bookings/initiate-payment', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: remainder,
          balanceAmount: amountFromBalance
        })
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Failed to initiate payment')
      }
      if (result.payment_url) {
        // Redirect to SSLCommerz gateway
        window.location.href = result.payment_url
        return // Don't reset isSubmitting — page will navigate away
      }
    } catch (err: any) {
      toast.error('Failed to initiate online payment: ' + err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelBooking = async () => {
    if (!cancellingBookingId) return
    setIsCancelling(true)
    try {
      const { error } = await cancelBooking(cancellingBookingId)
      if (error) throw error
      toast.success(t('bookingCancelled') || 'Booking cancelled successfully')
      setCancellingBookingId(null)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel booking')
    } finally {
      setIsCancelling(false)
    }
  }

  const isInitialLoading = isLoading && bookings.length === 0

  const filteredBookings = bookings.filter((booking) => {
    if (statusFilter === 'all') return true
    return booking.status === statusFilter
  })

  const now = new Date()
  const upcomingBookings = filteredBookings
    .filter((b) => new Date(b.menu_schedule?.scheduled_date || 0) >= now || b.status === 'pending')
    .sort((a, b) => new Date(a.menu_schedule?.scheduled_date || 0).getTime() - new Date(b.menu_schedule?.scheduled_date || 0).getTime())
    
  const pastBookings = filteredBookings
    .filter((b) => new Date(b.menu_schedule?.scheduled_date || 0) < now && b.status !== 'pending')
    .sort((a, b) => new Date(b.menu_schedule?.scheduled_date || 0).getTime() - new Date(a.menu_schedule?.scheduled_date || 0).getTime())

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const balanceSummaryText = amountFromBalance > 0 && monthlyTotal > 0
    ? `৳${amountFromBalance.toFixed(0)} balance applied — you pay ৳${remainder.toFixed(0)}`
    : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('bookings')}</h1>
          <p className="text-gray-500">Manage your meal reservations</p>
        </div>

        {/* Filters */}
        <Select
          options={[
            { value: 'all', label: t('all') },
            { value: 'pending', label: t('pending') },
            { value: 'confirmed', label: t('confirmed') },
            { value: 'denied', label: t('denied') },
            { value: 'cancelled', label: t('cancelled') },
          ]}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-40"
        />
      </div>

      {/* Payment Syncing Banner (return from SSLCommerz) */}
      {isSyncingPayment && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
          <Loader2 className="h-6 w-6 text-blue-600 animate-spin flex-shrink-0" />
          <div>
            <p className="font-semibold text-blue-800">Verifying Payment...</p>
            <p className="text-sm text-blue-700">Please wait while we confirm with the payment gateway.</p>
          </div>
        </div>
      )}

      {/* Payment Return Status Banners */}
      {paymentReturnStatus === 'success' && !isSyncingPayment && paymentStatus === 'paid' && (
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
          <CheckCircle2 className="h-6 w-6 text-green-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-green-800">Payment Confirmed!</p>
            <p className="text-sm text-green-700">Your meal payment has been processed successfully.</p>
          </div>
        </div>
      )}
      {paymentReturnStatus === 'fail' && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <CreditCard className="h-6 w-6 text-red-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-red-800">Payment Failed</p>
            <p className="text-sm text-red-700">Your payment could not be processed. Your balance was not charged. Please try again.</p>
          </div>
        </div>
      )}
      {paymentReturnStatus === 'cancel' && (
        <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
          <CreditCard className="h-6 w-6 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800">Payment Cancelled</p>
            <p className="text-sm text-yellow-700">You cancelled the payment. Your balance was not charged.</p>
          </div>
        </div>
      )}

      {/* Monthly Cost Summary + Payment Options */}
      {monthlyTotal > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary-700">{t('monthlyTotal')}</p>
              <p className="text-xs text-primary-500">{t('confirmedBookings')}</p>
            </div>
            <p className="text-2xl font-bold text-primary-700">৳{monthlyTotal.toFixed(0)}</p>
          </div>

          {/* Balance summary line */}
          {balanceSummaryText && paymentStatus === 'unpaid' && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <Wallet className="h-4 w-4 flex-shrink-0" />
              <span>{balanceSummaryText}</span>
            </div>
          )}

          {/* Payment Status Indicators */}
          {paymentStatus === 'paid' && (
            <div className="flex items-center gap-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>This month's bill is paid ✓</span>
            </div>
          )}

          {paymentStatus === 'pending' && (
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Clock className="h-4 w-4 flex-shrink-0" />
              <span>Pending admin confirmation{pendingAmount ? ` (৳${pendingAmount.toFixed(0)})` : ''}</span>
            </div>
          )}

          {/* Three Payment Buttons — only show when unpaid */}
          {paymentStatus === 'unpaid' && !isLoadingPaymentStatus && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {/* Option 1: Pay with Balance */}
              {userBalance > 0 && (
                <Button
                  variant="primary"
                  onClick={() => {
                    if (remainder <= 0) { handlePayFullyWithBalance(); return }
                    handlePayFullyWithBalance()
                  }}
                  disabled={isSubmitting || userBalance < monthlyTotal}
                  isLoading={isSubmitting}
                  className="flex items-center gap-2"
                >
                  <Wallet className="h-4 w-4" />
                  Pay with Balance (৳{userBalance.toFixed(0)})
                </Button>
              )}
              {/* Option 2: Pay Now (SSLCommerz) */}
              <Button
                variant="outline"
                onClick={() => {
                  if (remainder <= 0) { handlePayFullyWithBalance(); return }
                  setOnlineModalOpen(true)
                }}
                disabled={isSubmitting}
                className="flex items-center gap-2 text-primary-700 border-primary-300 hover:bg-primary-50"
              >
                <Globe className="h-4 w-4" />
                Pay Now (Online)
              </Button>
              {/* Option 3: Pay Later */}
              <Button
                variant="ghost"
                onClick={() => {
                  toast.success('You can pay later. Your due amount is shown above.')
                }}
                className="flex items-center gap-2 text-amber-700 hover:bg-amber-50"
              >
                <Clock className="h-4 w-4" />
                Pay Later
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Active Bookings */}
      {upcomingBookings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            {t('upcomingBookings')} ({upcomingBookings.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcomingBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onCancel={(id) => setCancellingBookingId(id)}
                onView={(b) => setViewingBooking(b)}
                cancellationTimeLimit={cancellationTimeLimit}
              />
            ))}
          </div>
        </section>
      )}

      {/* Past Bookings */}
      {pastBookings.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            {t('pastBookings')} ({pastBookings.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pastBookings.map((booking) => (
              <BookingCard 
                key={booking.id} 
                booking={booking} 
                onView={(b) => setViewingBooking(b)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {filteredBookings.length === 0 && (
        <Card>
          <CardContent className="text-center py-12">
            <CalendarDays className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">{t('noBookings')}</h3>
            <p className="text-gray-500 mt-1">
              {statusFilter === 'all'
                ? t('noBookingsMsg')
                : `${t('noBookings')} - ${statusFilter}`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Return / Cancel Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!cancellingBookingId}
        onClose={() => setCancellingBookingId(null)}
        onConfirm={handleCancelBooking}
        title={t('returnMeal')}
        message={
          <div className="space-y-2">
            <p className="text-gray-600 text-sm">
              {t('returnMealMsg')}
            </p>
          </div>
        }
        confirmText={t('returnMeal')}
        variant="danger"
        isLoading={isCancelling}
      />

      {/* View Booking Details Modal */}
      {viewingBooking && (
        <Modal
          isOpen={!!viewingBooking}
          onClose={() => setViewingBooking(null)}
          title={t('bookingDetails')}
          size="md"
        >
          <div className="p-6 space-y-6">
            {/* Meal Info */}
            <div className="flex items-start gap-4">
              {viewingBooking.menu_schedule.meal.image_url ? (
                <img 
                  src={viewingBooking.menu_schedule.meal.image_url} 
                  alt={viewingBooking.menu_schedule.meal.name}
                  className="w-24 h-24 rounded-lg object-cover"
                />
              ) : (
                <div className="w-24 h-24 rounded-lg bg-primary-100 flex items-center justify-center">
                  <Utensils className="h-10 w-10 text-primary-400" />
                </div>
              )}
              <div className="flex-1">
                <span className="text-xs font-medium text-primary-600 uppercase tracking-wide">
                  {t(viewingBooking.menu_schedule.meal.meal_type)}
                </span>
                <h3 className="font-semibold text-gray-900 text-lg flex items-center gap-2">
                  {viewingBooking.menu_schedule.meal.name}
                  {(viewingBooking.quantity || 1) > 1 && (
                    <span className="text-sm font-normal text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
                      ×{viewingBooking.quantity}
                    </span>
                  )}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {viewingBooking.menu_schedule.meal.description}
                </p>
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">{t('date')}:</span>
                <span className="font-medium">
                  {new Date(viewingBooking.menu_schedule.scheduled_date).toLocaleDateString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">{t('time')}:</span>
                <span className="font-medium">{viewingBooking.menu_schedule.time_slot}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">{t('price')}:</span>
                <span className="font-medium">
                  ৳{((viewingBooking.menu_schedule.price || viewingBooking.menu_schedule.meal.price || 0) * (viewingBooking.quantity || 1))}
                  {(viewingBooking.quantity || 1) > 1 && (
                    <span className="text-gray-500 text-xs ml-1">
                      (৳{viewingBooking.menu_schedule.price || viewingBooking.menu_schedule.meal.price || 0} × {viewingBooking.quantity})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-gray-600">{t('status')}:</span>
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  viewingBooking.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                  viewingBooking.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                  viewingBooking.status === 'cancelled' ? 'bg-gray-100 text-gray-600' :
                  'bg-red-100 text-red-700'
                }`}>
                  {t(viewingBooking.status)}
                </span>
              </div>
            </div>

            {/* Booked At */}
            <div className="pt-4 border-t border-gray-200">
              <p className="text-sm text-gray-500">
                {t('bookedOn')} {new Date(viewingBooking.booked_at).toLocaleString()}
              </p>
            </div>

            {/* Close Button */}
            <Button 
              variant="secondary" 
              className="w-full"
              onClick={() => setViewingBooking(null)}
            >
              {t('close')}
            </Button>
          </div>
        </Modal>
      )}



      {/* Pay Online Modal */}
      <ConfirmDialog
        isOpen={onlineModalOpen}
        onClose={() => setOnlineModalOpen(false)}
        onConfirm={handlePayOnline}
        title="Pay Now (Online)"
        message={
          <div className="space-y-3">
            {amountFromBalance > 0 && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
                <Wallet className="h-4 w-4 flex-shrink-0" />
                <span>৳{amountFromBalance.toFixed(0)} will be applied from your balance</span>
              </div>
            )}
            <p className="text-gray-600 text-sm">
              You will be redirected to SSLCommerz to pay <strong>৳{remainder.toFixed(0)}</strong> online.
            </p>
            <p className="text-xs text-gray-400">
              Your balance will only be deducted after a successful payment. bKash · Nagad · Cards accepted.
            </p>
          </div>
        }
        confirmText="Proceed to Payment"
        variant="primary"
        isLoading={isSubmitting}
      />
    </div>
  )
}

export default BookingsPage
