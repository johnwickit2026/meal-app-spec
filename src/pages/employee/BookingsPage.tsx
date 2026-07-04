import { useEffect, useState } from 'react'
import { CalendarDays, Calendar, Clock, User, Utensils, CreditCard } from 'lucide-react'
import { useAuthStore, useBookingStore, useSettingsStore } from '../../store'
import { Card, CardContent, Select, CardSkeleton, Button } from '../../components/ui'
import { BookingCard } from '../../components/employee'
import { useTranslation } from '../../hooks/useTranslation'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import type { BookingWithDetails } from '../../types'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabaseClient'

export function BookingsPage() {
  const { user } = useAuthStore()
  const { bookings, fetchUserBookings, cancelBooking, isLoading } = useBookingStore()
  const { cancellationTimeLimit, fetchSettings } = useSettingsStore()
  const { t } = useTranslation()
  
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [cancellingBookingId, setCancellingBookingId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [viewingBooking, setViewingBooking] = useState<BookingWithDetails | null>(null)

  const [payNowModalOpen, setPayNowModalOpen] = useState(false)
  const [isSubmittingPayNow, setIsSubmittingPayNow] = useState(false)

  const [userBalance, setUserBalance] = useState(0)
  const [isPayingBalance, setIsPayingBalance] = useState(false)
  const [payLaterModalOpen, setPayLaterModalOpen] = useState(false)
  const [isSubmittingPayLater, setIsSubmittingPayLater] = useState(false)

  useEffect(() => {
    if (user) {
      fetchUserBookings(user.id, true) // Force refresh to get latest bookings
      fetchSettings()
      fetchBalance(user.id)
    }
  }, [user, fetchUserBookings, fetchSettings])

  const fetchBalance = async (userId: string) => {
    const { data } = await supabase
      .from('user_balances')
      .select('balance')
      .eq('user_id', userId)
      .single()
    setUserBalance(data?.balance ?? 0)
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

  const handleSubmitCashRequest = async () => {
    if (!user || monthlyTotal <= 0) return
    setIsSubmittingPayNow(true)
    try {
      // 1. Insert the cash payment request
      const { error } = await supabase.from('cash_payment_requests').insert({
        user_id: user.id,
        amount: monthlyTotal,
      })
      if (error) throw error

      // 2. Notify every admin user so the bell lights up immediately
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      if (admins && admins.length > 0) {
        // Resolve the submitter's display name from their profile
        const { data: submitterProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single()

        const senderName = submitterProfile?.full_name || user.email || 'An employee'
        const notifMessage = `${senderName} submitted a cash payment request for ৳${monthlyTotal.toFixed(0)}. Please review in Payments.`

        await supabase.from('notifications').insert(
          admins.map((admin) => ({
            user_id: admin.id,
            type: 'cash_request' as const,
            message: notifMessage,
            is_read: false,
          }))
        )
      }

      toast.success('Payment request submitted. Admin will confirm.')
      setPayNowModalOpen(false)
    } catch (err: any) {
      toast.error('Failed to submit request: ' + err.message)
    } finally {
      setIsSubmittingPayNow(false)
    }
  }

  const handlePayWithBalance = async () => {
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    setIsPayingBalance(true)
    try {
      const response = await fetch('/api/bookings-pay-balance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: monthlyTotal })
      })
      const result = await response.json()
      if (result.success) {
        toast.success('Paid with balance successfully!')
        if (typeof result.newBalance === 'number') setUserBalance(result.newBalance)
      } else {
        toast.error(result.error || 'Payment failed')
      }
    } catch (err: any) {
      toast.error('Payment failed: ' + err.message)
    } finally {
      setIsPayingBalance(false)
    }
  }

  const handlePayLater = async () => {
    if (!user || monthlyTotal <= 0) return
    setIsSubmittingPayLater(true)
    try {
      const month = new Date().toISOString().slice(0, 7) // 'YYYY-MM'

      // Record an unpaid bill flagged as pay_later
      const { error } = await supabase.from('payments').upsert({
        user_id: user.id,
        month,
        amount: monthlyTotal,
        status: 'unpaid',
        payment_method: 'pay_later',
      }, { onConflict: 'user_id,month' })
      if (error) throw error

      // Notify every admin
      const { data: admins } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')

      if (admins && admins.length > 0) {
        const { data: submitterProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', user.id)
          .single()
        const senderName = submitterProfile?.full_name || user.email || 'An employee'
        await supabase.from('notifications').insert(
          admins.map((admin) => ({
            user_id: admin.id,
            type: 'pay_later' as const,
            message: `${senderName} chose to pay later for ৳${monthlyTotal.toFixed(0)}. Bill is due at end of month.`,
            is_read: false,
          }))
        )
      }

      toast.success('Your bill will be due at the end of the month.')
      setPayLaterModalOpen(false)
    } catch (err: any) {
      toast.error('Failed to submit: ' + err.message)
    } finally {
      setIsSubmittingPayLater(false)
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

      {/* Monthly Cost Summary */}
      {monthlyTotal > 0 && (
        <div className="bg-primary-50 border border-primary-200 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-primary-700">{t('monthlyTotal')}</p>
            <p className="text-xs text-primary-500">{t('confirmedBookings')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-2xl font-bold text-primary-700">৳{monthlyTotal.toFixed(0)}</p>
            {userBalance > 0 && (
              <Button
                variant="success"
                onClick={handlePayWithBalance}
                isLoading={isPayingBalance}
                disabled={isPayingBalance || userBalance < monthlyTotal}
              >
                Pay with Balance (৳{userBalance.toFixed(0)})
              </Button>
            )}
            <Button variant="primary" onClick={() => setPayNowModalOpen(true)}>
              Pay Now (Cash)
            </Button>
            <Button variant="outline" onClick={() => setPayLaterModalOpen(true)}>
              Pay Later
            </Button>
          </div>
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

      {/* Pay Now (Cash) Modal */}
      <ConfirmDialog
        isOpen={payNowModalOpen}
        onClose={() => setPayNowModalOpen(false)}
        onConfirm={handleSubmitCashRequest}
        title="Submit Cash Payment Request"
        message={
          <div className="space-y-2">
            <p className="text-gray-600 text-sm">
              Submit a cash payment request for <strong>৳{monthlyTotal.toFixed(0)}</strong>? Admin will confirm receipt.
            </p>
          </div>
        }
        confirmText="Submit Request"
        variant="primary"
        isLoading={isSubmittingPayNow}
      />

      {/* Pay Later Modal */}
      <ConfirmDialog
        isOpen={payLaterModalOpen}
        onClose={() => setPayLaterModalOpen(false)}
        onConfirm={handlePayLater}
        title="Pay Later"
        message={
          <div className="space-y-2">
            <p className="text-gray-600 text-sm">
              Your bill of <strong>৳{monthlyTotal.toFixed(0)}</strong> will be due at end of month. Admin will follow up for payment.
            </p>
          </div>
        }
        confirmText="Confirm Pay Later"
        variant="primary"
        isLoading={isSubmittingPayLater}
      />
    </div>
  )
}

export default BookingsPage
