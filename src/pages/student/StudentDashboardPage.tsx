import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  UtensilsCrossed,
  ShoppingBag,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Package,
  GraduationCap,
  CalendarDays,
} from 'lucide-react'
import { format } from 'date-fns'
import { useAuthStore } from '../../store'
import { useStudentStore } from '../../store/studentStore'
import { Card, CardContent, CardHeader, CardTitle, Button, CardSkeleton, Badge } from '../../components/ui'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending:   { label: 'Pending Payment', variant: 'pending'   as const, icon: Clock },
  paid:      { label: 'Paid',            variant: 'confirmed' as const, icon: CheckCircle2 },
  cancelled: { label: 'Cancelled',       variant: 'cancelled' as const, icon: AlertCircle },
  delivered: { label: 'Delivered',       variant: 'success'   as const, icon: Package },
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function StudentDashboardPage() {
  const { profile } = useAuthStore()
  const { upcomingOrders, pastOrders, isLoadingOrders, fetchOrders, menu, isLoadingMenu, fetchMenu, menuDate } =
    useStudentStore()

  useEffect(() => {
    fetchOrders()
    fetchMenu()
  }, [fetchOrders, fetchMenu])

  const isInitialLoading = isLoadingOrders && upcomingOrders.length === 0

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-6 h-32 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  const nextOrder = upcomingOrders[0] ?? null
  const tomorrowSlots = Object.values(menu).flat().length
  const paidCount  = [...upcomingOrders, ...pastOrders].filter((o) => o.status === 'paid').length
  const totalCount = upcomingOrders.length + pastOrders.length

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-6 text-white relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -right-4 -bottom-8 h-24 w-24 rounded-full bg-white/10" />

        <div className="flex items-center justify-between relative">
          <div>
            <h1 className="text-2xl font-bold">
              Welcome, {profile?.full_name?.split(' ')[0]}!
            </h1>
            <p className="mt-1 text-amber-100">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
            <div className="mt-3 flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-amber-200" />
              <span className="text-sm text-amber-100 font-medium">Student Tiffin Portal</span>
            </div>
          </div>
          <div className="h-16 w-16 rounded-full bg-white/20 border-2 border-white/30 flex items-center justify-center">
            <span className="text-2xl font-bold text-white">
              {profile?.full_name?.charAt(0)?.toUpperCase() || 'S'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick deadline notice */}
      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <Clock className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <p className="text-sm text-amber-800 font-medium">
          Order deadline: <span className="font-bold">midnight tonight</span> for tomorrow's tiffin
          {menuDate && <span className="text-amber-600"> ({menuDate})</span>}
        </p>
        <Link to="/student/menu" className="ml-auto flex-shrink-0">
          <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white border-0">
            Order Now
          </Button>
        </Link>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Upcoming orders */}
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="h-6 w-6 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{upcomingOrders.length || '—'}</p>
              <p className="text-sm text-gray-500 leading-tight">Upcoming Orders</p>
            </div>
          </CardContent>
        </Card>

        {/* Tomorrow's menu slots */}
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-orange-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <UtensilsCrossed className="h-6 w-6 text-orange-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {isLoadingMenu ? '…' : tomorrowSlots || '—'}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Menu Items Tomorrow</p>
            </div>
          </CardContent>
        </Card>

        {/* Paid orders */}
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{paidCount || '—'}</p>
              <p className="text-sm text-gray-500 leading-tight">Paid Orders (Total: {totalCount})</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Order / Next Meal */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-amber-500" />
              Next Meal
            </CardTitle>
            <Link to="/student/orders">
              <Button variant="ghost" size="sm">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {nextOrder ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {nextOrder.tiffin_menu?.meal?.name ?? 'Tiffin'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {nextOrder.meal_date} · {nextOrder.tiffin_menu?.time_slot}
                    </p>
                  </div>
                  <Badge
                    variant={STATUS_CONFIG[nextOrder.status]?.variant ?? 'default'}
                  >
                    {STATUS_CONFIG[nextOrder.status]?.label ?? nextOrder.status}
                  </Badge>
                </div>

                <div className="flex items-center justify-between p-3 bg-amber-50 rounded-lg">
                  <span className="text-sm text-gray-600">Total</span>
                  <span className="font-bold text-amber-700">
                    ৳{Number(nextOrder.total_amount).toFixed(0)}
                  </span>
                </div>

                {nextOrder.status === 'pending' && (
                  <Link to={`/student/payment?order_id=${nextOrder.id}`} className="block">
                    <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0">
                      Complete Payment
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-4">No upcoming orders</p>
                <Link to="/student/menu">
                  <Button className="bg-amber-500 hover:bg-amber-600 text-white border-0" size="sm">
                    Browse Tomorrow's Menu
                  </Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order history summary */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-amber-500" />
              Order History
            </CardTitle>
            <Link to="/student/orders">
              <Button variant="ghost" size="sm">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {pastOrders.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No past orders yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pastOrders.slice(0, 4).map((order) => {
                  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.cancelled
                  return (
                    <div
                      key={order.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-100 hover:border-amber-200 transition-colors"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {order.tiffin_menu?.meal?.name ?? 'Tiffin'}
                        </p>
                        <p className="text-xs text-gray-500">{order.meal_date}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">
                          ৳{Number(order.total_amount).toFixed(0)}
                        </span>
                        <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default StudentDashboardPage
