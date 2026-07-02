import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CalendarDays,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Users,
  UtensilsCrossed,
  Banknote,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, StatusBadge, CardSkeleton } from '../../components/ui'
import { useBookingStore, useAuthStore } from '../../store'
import { supabase } from '../../lib/supabaseClient'
import { canManageBookings } from '../../lib/roles'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

interface DashboardStats {
  totalBookingsToday: number
  pendingApprovals: number
  confirmedToday: number
  cancelledToday: number
  totalUsers: number
  activeMeals: number
}

interface MealBoardSlot {
  id: string
  meal_name: string
  time_slot: string
  capacity: number
  booking_count: number
  guest_count: number
}

export function AdminDashboardPage() {
  const navigate = useNavigate()
  const { bookings, fetchAllBookings, updateBookingStatus, isLoading } = useBookingStore()
  const { profile } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [mealBoard, setMealBoard] = useState<MealBoardSlot[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [pendingCashCount, setPendingCashCount] = useState(0)
  const canApproveBookings = canManageBookings(profile)

  const today = format(new Date(), 'yyyy-MM-dd')

  // ── Pending cash requests: initial fetch + Realtime subscription ────────────
  useEffect(() => {
    const fetchCashCount = async () => {
      const { count } = await supabase
        .from('cash_payment_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
      setPendingCashCount(count ?? 0)
    }
    fetchCashCount()

    // Subscribe to live INSERT events on cash_payment_requests
    const channel = supabase
      .channel('dashboard_cash_requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cash_payment_requests' },
        () => { setPendingCashCount((c) => c + 1) }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cash_payment_requests' },
        // Re-fetch count whenever a request is confirmed/rejected
        () => { fetchCashCount() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  useEffect(() => {
    fetchAllBookings()
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      // Fetch various counts
      const [bookingsResult, usersResult, mealsResult, schedulesResult, guestMealsResult] = await Promise.all([
        supabase
          .from('bookings')
          .select('status, quantity, menu_schedule_id, menu_schedule:menu_schedules!inner(scheduled_date)')
          .eq('menu_schedule.scheduled_date', today),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('meals').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('menu_schedules').select('id, time_slot, capacity, meal:meals(name)').eq('scheduled_date', today).order('time_slot'),
        supabase.from('guest_meals').select('menu_schedule_id, quantity, status').eq('meal_date', today)
      ])

      const todayBookings = (bookingsResult.data || []) as any[]
      const todayGuestMeals = (guestMealsResult.data || []) as any[]
      const todaySchedules = (schedulesResult.data || []) as any[]

      // Calculate meal board
      const board = todaySchedules.map(sch => {
        const schBookings = todayBookings.filter(b => b.menu_schedule_id === sch.id && b.status === 'confirmed')
        const schGuestMeals = todayGuestMeals.filter(g => g.menu_schedule_id === sch.id && g.status === 'confirmed')

        const bookingCount = schBookings.reduce((sum, b) => sum + (b.quantity || 1), 0)
        const guestCount = schGuestMeals.reduce((sum, g) => sum + (g.quantity || 1), 0)

        return {
          id: sch.id,
          meal_name: sch.meal?.name || 'Unknown',
          time_slot: sch.time_slot,
          capacity: sch.capacity,
          booking_count: bookingCount,
          guest_count: guestCount
        }
      })
      setMealBoard(board)

      setStats({
        totalBookingsToday: todayBookings.length,
        pendingApprovals: todayBookings.filter((b) => b.status === 'pending').length,
        confirmedToday: todayBookings.filter((b) => b.status === 'confirmed').length,
        cancelledToday: todayBookings.filter((b) => b.status === 'cancelled').length,
        totalUsers: usersResult.count || 0,
        activeMeals: mealsResult.count || 0,
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoadingStats(false)
    }
  }

  const handleApprove = async (bookingId: string) => {
    const result = await updateBookingStatus(bookingId, 'confirmed')
    if (result.error) {
      toast.error('Failed to approve booking')
    } else {
      toast.success('Booking approved')
      fetchStats()
    }
  }

  const handleDeny = async (bookingId: string) => {
    const result = await updateBookingStatus(bookingId, 'denied')
    if (result.error) {
      toast.error('Failed to deny booking')
    } else {
      toast.success('Booking denied')
      fetchStats()
    }
  }

  const pendingBookings = bookings.filter((b) => b.status === 'pending')

  if (loadingStats) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Additional Stats Skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Pending Approvals Skeleton */}
        <CardSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <p className="text-gray-500">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <CalendarDays className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalBookingsToday}</p>
              <p className="text-sm text-gray-500">Total Today</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-yellow-100 rounded-xl flex items-center justify-center">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.pendingApprovals}</p>
              <p className="text-sm text-gray-500">Pending Approval</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.confirmedToday}</p>
              <p className="text-sm text-gray-500">Confirmed</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-red-100 rounded-xl flex items-center justify-center">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.cancelledToday}</p>
              <p className="text-sm text-gray-500">Cancelled</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Cash Requests — live counter card */}
      <button
        onClick={() => navigate('/admin/payments')}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 rounded-xl"
        aria-label="View pending cash payment requests"
      >
        <Card className={`transition-all duration-200 hover:shadow-md border-2 ${
          pendingCashCount > 0 ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200'
        }`}>
          <CardContent className="flex items-center gap-4 py-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
              pendingCashCount > 0 ? 'bg-emerald-100' : 'bg-gray-100'
            }`}>
              <Banknote className={`h-6 w-6 ${
                pendingCashCount > 0 ? 'text-emerald-600' : 'text-gray-400'
              }`} />
            </div>
            <div className="flex-1">
              <p className={`text-2xl font-bold ${
                pendingCashCount > 0 ? 'text-emerald-700' : 'text-gray-900'
              }`}>{pendingCashCount}</p>
              <p className="text-sm text-gray-500">Pending Cash Requests</p>
            </div>
            {pendingCashCount > 0 && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full animate-pulse">
                Action needed
              </span>
            )}
          </CardContent>
        </Card>
      </button>

      {/* Additional Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Users className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.totalUsers}</p>
              <p className="text-sm text-gray-500">Total Users</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-orange-100 rounded-xl flex items-center justify-center">
              <UtensilsCrossed className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats?.activeMeals}</p>
              <p className="text-sm text-gray-500">Active Meals</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's Meal Board */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-blue-500" />
            Today's Meal Board
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mealBoard.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <p>No meals scheduled for today.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {mealBoard.map(slot => (
                <div key={slot.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50 flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-gray-900">{slot.meal_name}</h3>
                    <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {slot.time_slot}
                    </span>
                  </div>
                  <div className="mt-2 text-sm">
                    <div className="flex justify-between text-gray-600 mb-1">
                      <span>Bookings:</span>
                      <span className="font-medium text-gray-900">{slot.booking_count} / {slot.capacity}</span>
                    </div>
                    {slot.guest_count > 0 && (
                      <div className="flex justify-between text-purple-600 mb-1">
                        <span>Guest Meals:</span>
                        <span className="font-medium">+{slot.guest_count} guests</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-200 mt-2">
                      <span>Total Expected:</span>
                      <span>{slot.booking_count + slot.guest_count}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Pending Approvals ({pendingBookings.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && bookings.length === 0 ? (
            <div className="space-y-3">
              <div className="h-12 bg-gray-200 rounded animate-pulse" />
              <div className="h-12 bg-gray-200 rounded animate-pulse" />
              <div className="h-12 bg-gray-200 rounded animate-pulse" />
            </div>
          ) : pendingBookings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-300" />
              <p>No pending bookings to review</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Meal</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Time</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingBookings.slice(0, 10).map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{booking.profile?.full_name || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{booking.profile?.department}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{booking.menu_schedule?.meal?.name}</p>
                        <p className="text-sm text-gray-500 capitalize">{booking.menu_schedule?.meal?.meal_type}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {booking.menu_schedule?.scheduled_date &&
                          format(new Date(booking.menu_schedule.scheduled_date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {booking.menu_schedule?.time_slot}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={booking.status} />
                      </td>
                      <td className="px-4 py-3">
                        {canApproveBookings ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => handleApprove(booking.id)}
                            >
                              Approve
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleDeny(booking.id)}
                            >
                              Deny
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">View only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default AdminDashboardPage
