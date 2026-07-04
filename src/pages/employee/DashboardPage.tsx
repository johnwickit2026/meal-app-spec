import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { UtensilsCrossed, CalendarDays, Clock, ArrowRight, DollarSign, AlertCircle, TrendingUp, Wallet } from 'lucide-react'
import { useAuthStore, useBookingStore, useMenuStore, useSettingsStore } from '../../store'
import { Card, CardContent, CardHeader, CardTitle, Button, CardSkeleton } from '../../components/ui'
import { useTranslation } from '../../hooks/useTranslation'
import { BookingCard, MealCard } from '../../components/employee'
import { format, subMonths } from 'date-fns'
import { supabase } from '../../lib/supabaseClient'
import { getOptimizedImageUrl } from '../../lib/utils'
import type { UserBalance } from '../../types'

export function DashboardPage() {
  const { user, profile } = useAuthStore()
  const { bookings, fetchUserBookings, isLoading: bookingsLoading } = useBookingStore()
  const { schedules, fetchSchedules, isLoading: menuLoading } = useMenuStore()
  const { advancePaymentEnabled, fetchSettings } = useSettingsStore()
  const { t } = useTranslation()
  const [dueAmount, setDueAmount] = useState<number | null>(null)
  const [isLoadingDue, setIsLoadingDue] = useState(true)
  const [userBalance, setUserBalance] = useState<UserBalance | null>(null)
  const [isLoadingBalance, setIsLoadingBalance] = useState(true)
  const [adjustedDueAmount, setAdjustedDueAmount] = useState<number | null>(null)
  const [costAnalysis, setCostAnalysis] = useState({
    thisMonth: 0,
    lastMonth: 0,
    averageMealCost: 0,
    totalMeals: 0,
    totalSpent: 0,
  })
  const [isLoadingCost, setIsLoadingCost] = useState(true)

  const today = format(new Date(), 'yyyy-MM-dd')
  const currentMonth = format(new Date(), 'yyyy-MM')

  useEffect(() => {
    if (user) {
      fetchUserBookings(user.id, true) // Force refresh to get latest bookings
      fetchDueAmount(user.id)
      fetchCostAnalysis(user.id)
    }
    fetchSettings()
    fetchSchedules(today)
  }, [user, fetchUserBookings, fetchSchedules, fetchSettings, today])

  const fetchDueAmount = async (userId: string) => {
    setIsLoadingDue(true)
    try {
      // First try to get unpaid payment record
      const { data: paymentData, error: paymentError } = await supabase
        .from('payments')
        .select('amount, status')
        .eq('user_id', userId)
        .eq('month', currentMonth)
        .eq('status', 'unpaid')
        .maybeSingle()

      if (paymentError) throw paymentError

      if (paymentData) {
        setDueAmount(paymentData.amount || 0)
      } else {
        // Calculate from confirmed bookings this month
        const startOfMonth = `${currentMonth}-01T00:00:00`
        const endOfMonth = `${currentMonth}-30T23:59:59`
        
        const { data: bookingsData, error: bookingsError } = await supabase
          .from('bookings')
          .select(`
            *,
            menu_schedule:menu_schedules!inner (
              *,
              meal:meals!inner (*)
            )
          `)
          .eq('user_id', userId)
          .eq('status', 'confirmed')
          .gte('booked_at', startOfMonth)
          .lte('booked_at', endOfMonth)

        if (bookingsError) {
          console.error('Bookings query error:', bookingsError)
          throw bookingsError
        }

        const totalDue = (bookingsData || []).reduce((sum: number, booking: any) => {
          const schedulePrice = booking.menu_schedule?.price
          const mealPrice = booking.menu_schedule?.meal?.price || 0
          const price = schedulePrice ?? mealPrice // Use schedule price if set, otherwise meal price
          const quantity = booking.quantity || 1
          return sum + (price * quantity)
        }, 0)

        setDueAmount(totalDue)
      }
    } catch (error) {
      console.error('Error fetching due amount:', error)
    } finally {
      setIsLoadingDue(false)
    }
  }

  const fetchCostAnalysis = async (userId: string) => {
    setIsLoadingCost(true)
    setIsLoadingBalance(true)
    try {
      // Get this month's confirmed bookings
      const startOfCurrentMonth = `${currentMonth}-01`
      const { data: thisMonthBookings, error: thisMonthError } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules!inner (
            *,
            meal:meals!inner (*)
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('menu_schedule.scheduled_date', startOfCurrentMonth)

      if (thisMonthError) throw thisMonthError

      // Get last month's confirmed bookings
      const lastMonth = format(subMonths(new Date(), 1), 'yyyy-MM')
      const startOfLastMonth = `${lastMonth}-01`
      const endOfLastMonth = format(new Date(new Date().getFullYear(), new Date().getMonth(), 0), 'yyyy-MM-dd')
      
      const { data: lastMonthBookings, error: lastMonthError } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules!inner (
            *,
            meal:meals!inner (*)
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'confirmed')
        .gte('menu_schedule.scheduled_date', startOfLastMonth)
        .lte('menu_schedule.scheduled_date', endOfLastMonth)

      if (lastMonthError) throw lastMonthError

      // Calculate costs
      const calculateCost = (bookingData: any[]) => {
        return (bookingData || []).reduce((sum: number, booking: any) => {
          const schedulePrice = booking.menu_schedule?.price
          const mealPrice = booking.menu_schedule?.meal?.price || 0
          const price = schedulePrice ?? mealPrice
          const quantity = booking.quantity || 1
          return sum + (price * quantity)
        }, 0)
      }

      const thisMonthCost = calculateCost(thisMonthBookings)
      const lastMonthCost = calculateCost(lastMonthBookings)
      
      // Get all-time confirmed bookings
      const { data: allBookings, error: allError } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules!inner (
            *,
            meal:meals!inner (*)
          )
        `)
        .eq('user_id', userId)
        .eq('status', 'confirmed')

      if (allError) throw allError

      const totalSpent = calculateCost(allBookings)
      const totalMeals = (allBookings || []).reduce((sum: number, b: any) => sum + (b.quantity || 1), 0)
      const averageMealCost = totalMeals > 0 ? totalSpent / totalMeals : 0

      setCostAnalysis({
        thisMonth: thisMonthCost,
        lastMonth: lastMonthCost,
        averageMealCost,
        totalMeals,
        totalSpent,
      })

      // Fetch user balance if advance payment is enabled
      if (advancePaymentEnabled) {
        const { data: balanceData, error: balanceError } = await supabase
          .from('user_balances')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle()

        if (balanceError && balanceError.code !== 'PGRST116') throw balanceError

        const typedBalanceData = balanceData as UserBalance | null
        setUserBalance(typedBalanceData)

        // Calculate adjusted due amount
        if (dueAmount !== null && typedBalanceData) {
          const availableBalance = typedBalanceData.balance
          if (availableBalance > 0) {
            // Positive balance offsets the due amount
            const remainingDue = Math.max(0, dueAmount - availableBalance)
            setAdjustedDueAmount(remainingDue)
          } else if (availableBalance < 0) {
            // Negative balance means user already owes money
            // Show it as debt separately, don't add to meal due
            setAdjustedDueAmount(dueAmount)
            // The negative balance is shown separately as debt
          } else {
            setAdjustedDueAmount(dueAmount)
          }
        } else {
          setAdjustedDueAmount(dueAmount)
        }
      } else {
        setAdjustedDueAmount(dueAmount)
      }
    } catch (error) {
      console.error('Error fetching cost analysis:', error)
    } finally {
      setIsLoadingCost(false)
      setIsLoadingBalance(false)
    }
  }

  const upcomingBookings = bookings
    .filter((b) => b.status === 'pending' || b.status === 'confirmed')
    .slice(0, 3)

  const todaysSchedules = schedules.slice(0, 4)

  const isInitialLoading = bookingsLoading && bookings.length === 0 && menuLoading && schedules.length === 0

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        {/* Welcome Header Skeleton */}
        <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl p-6 h-32 animate-pulse" />

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>

        {/* Main Content Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const hasDue = !!(dueAmount && dueAmount > 0)

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t('welcome')}, {profile?.full_name?.split(' ')[0]}!</h1>
            <p className="mt-1 text-primary-100">
              {format(new Date(), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center overflow-hidden border-2 border-white/30">
            {profile?.avatar_url ? (
              <img
                src={getOptimizedImageUrl(profile.avatar_url, 64, 64)}
                alt={profile.full_name || 'User avatar'}
                className="h-full w-full object-cover"
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="text-2xl font-bold text-white">
                {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Due Amount Alert */}
      {hasDue && (
        <Card className="border-red-300 bg-red-50">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-red-100 rounded-xl flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <div className="flex-1">
              <p className="text-lg font-bold text-red-800">
                ৳{dueAmount.toFixed(0)} {t('dueAmount')}
              </p>
              <p className="text-sm text-red-700">
                {t('dueAmountMsg')}
              </p>
            </div>
            <Link to="/bookings">
              <Button variant="primary" size="sm" className="bg-red-600 hover:bg-red-700">
                {t('viewDetails')}
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <CalendarDays className="h-6 w-6 text-primary-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {bookings.filter((b) => b.status === 'confirmed').length || '—'}
              </p>
              <p className="text-sm text-gray-500 leading-tight">{t('confirmedBookings')}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-yellow-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {bookings.filter((b) => b.status === 'pending').length || '—'}
              </p>
              <p className="text-sm text-gray-500 leading-tight">{t('pendingBookings')}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <UtensilsCrossed className="h-6 w-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{todaysSchedules.length || '—'}</p>
              <p className="text-sm text-gray-500 leading-tight">{t('availableToday')}</p>
            </div>
          </CardContent>
        </Card>

        <Card className={`h-[104px] ${hasDue ? 'border-red-200' : ''}`}>
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${hasDue ? 'bg-red-100' : 'bg-blue-100'}`}>
              <DollarSign className={`h-6 w-6 ${hasDue ? 'text-red-600' : 'text-blue-600'}`} />
            </div>
            <div className="min-w-0">
              <p className={`text-2xl font-bold leading-tight ${hasDue ? 'text-red-700' : 'text-gray-900'}`}>
                {isLoadingDue ? '—' : hasDue ? `৳${dueAmount!.toFixed(0)}` : '—'}
              </p>
              <p className="text-sm text-gray-500 leading-tight">{t('dueAmount')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis & Balance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Cost Analysis Card */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary-600" />
              Cost Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">This Month</p>
                <p className="text-xl font-bold text-gray-900">
                  {isLoadingCost ? '...' : `৳${costAnalysis.thisMonth.toFixed(0)}`}
                </p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Last Month</p>
                <p className="text-xl font-bold text-gray-600">
                  {isLoadingCost ? '...' : `৳${costAnalysis.lastMonth.toFixed(0)}`}
                </p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Avg Meal Cost</p>
                <p className="text-xl font-bold text-blue-600">
                  {isLoadingCost ? '...' : `৳${costAnalysis.averageMealCost.toFixed(0)}`}
                </p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Total Meals</p>
                <p className="text-xl font-bold text-green-600">
                  {isLoadingCost ? '...' : costAnalysis.totalMeals}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Total Spent (All Time)</span>
                <span className="text-xl font-bold text-primary-700">
                  {isLoadingCost ? '...' : `৳${costAnalysis.totalSpent.toFixed(0)}`}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Balance Card - Only show if advance payment is enabled */}
        {advancePaymentEnabled && (
          <Card className={userBalance && userBalance.balance >= 0 ? 'border-green-200' : 'border-red-200'}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className={`h-5 w-5 ${userBalance && userBalance.balance >= 0 ? 'text-green-600' : 'text-red-600'}`} />
                My Balance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-500 mb-1">Current Balance</p>
                {isLoadingBalance ? (
                  <p className="text-3xl font-bold">...</p>
                ) : userBalance && userBalance.balance >= 0 ? (
                  <div className="inline-flex flex-col items-center gap-1 mt-1">
                    <span className="text-emerald-600 text-xl font-bold">
                      ৳{(userBalance.balance).toFixed(0)} available
                    </span>
                    <span className="text-xs text-emerald-600 font-medium">Available Balance</span>
                  </div>
                ) : (
                  <div className="inline-flex flex-col items-center gap-1 mt-1">
                    <span className="text-red-600 text-xl font-bold">
                      ৳{Math.abs(userBalance?.balance || 0).toFixed(0)} debt
                    </span>
                    <span className="text-xs text-red-600 font-medium">Account Debt</span>
                  </div>
                )}
              </div>
              
              <div className="pt-2">
                <Link to="/bookings">
                  <Button variant="primary" className="w-full justify-center">
                    Pay Now
                  </Button>
                </Link>
              </div>
              
              {/* Adjusted Due Amount */}
              {adjustedDueAmount !== null && adjustedDueAmount > 0 && (
                <div className="p-3 bg-red-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-red-600">Adjusted Due</span>
                    <span className="font-bold text-red-700">৳{adjustedDueAmount.toFixed(0)}</span>
                  </div>
                  {userBalance && userBalance.balance > 0 && dueAmount && dueAmount > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      Original due: ৳{dueAmount.toFixed(0)} - Balance used: ৳{Math.min(userBalance.balance, dueAmount).toFixed(0)}
                    </p>
                  )}
                </div>
              )}
              
              {adjustedDueAmount !== null && adjustedDueAmount === 0 && userBalance && userBalance.balance > 0 && (
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-700 text-center">
                    Fully covered by your balance!
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                <div>
                  <span className="block text-gray-500">Total Deposits</span>
                  <span className="font-medium text-gray-700">
                    {userBalance ? `৳${userBalance.total_deposits.toFixed(0)}` : '৳0'}
                  </span>
                </div>
                <div>
                  <span className="block text-gray-500">Total Consumed</span>
                  <span className="font-medium text-gray-700">
                    {userBalance ? `৳${userBalance.total_consumed.toFixed(0)}` : '৳0'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Bookings */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('upcomingBookings')}</CardTitle>
            <Link to="/bookings">
              <Button variant="ghost" size="sm">
                {t('viewAll')} <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {upcomingBookings.length === 0 ? (
              <div className="text-center py-8">
                <CalendarDays className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">{t('noUpcomingBookings')}</p>
                <Link to="/menu">
                  <Button variant="primary" size="sm" className="mt-4">
                    {t('browseMenu')}
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {upcomingBookings.map((booking) => (
                  <Link 
                    key={booking.id} 
                    to="/bookings"
                    className="block"
                  >
                    <BookingCard booking={booking} clickable={false} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Today's Menu */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('todayMenu')}</CardTitle>
            <Link to="/menu">
              <Button variant="ghost" size="sm">
                {t('viewAll')} <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {todaysSchedules.length === 0 ? (
              <div className="text-center py-8">
                <UtensilsCrossed className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">{t('noMealsToday')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {todaysSchedules.slice(0, 4).map((schedule) => (
                  <Link 
                    key={schedule.id} 
                    to="/menu"
                    className="block"
                  >
                    <MealCard schedule={schedule} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default DashboardPage
