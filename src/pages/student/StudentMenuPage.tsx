import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  UtensilsCrossed,
  Clock,
  Users,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ShoppingCart,
  CalendarDays,
  Lock,
} from 'lucide-react'
import { useStudentStore } from '../../store/studentStore'
import type { TiffinMenuItem, StudentMenuGrouped } from '../../store/studentStore'
import { Card, CardContent, Button, Badge } from '../../components/ui'
import toast from 'react-hot-toast'
import { getMealDeadline, formatTime } from '../../lib/utils'

// ─── Meal Card ────────────────────────────────────────────────────────────────

interface TiffinCardProps {
  item: TiffinMenuItem
  isOrdered: boolean
  onOrder: () => void
  isOrdering: boolean
}

function TiffinCard({ item, isOrdered, onOrder, isOrdering }: TiffinCardProps) {
  const { meal, scheduled_date, time_slot, ordering_deadline_hours } = item
  const capacityLeft = item.capacity

  // Use the deadline_passed flag from the API if available; otherwise compute locally.
  const deadline = getMealDeadline(scheduled_date, time_slot, ordering_deadline_hours || 1)
  const isPastDeadline = item.deadline_passed ?? (new Date() > deadline)

  const deadlineStr = deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <Card
      className={`transition-all duration-200 ${
        isPastDeadline
          ? 'opacity-60 border-gray-200 bg-gray-50/50'
          : isOrdered
          ? 'border-green-300 bg-green-50/50'
          : 'hover:border-amber-300 hover:shadow-md'
      }`}
    >
      <CardContent className="p-5">
        {/* Meal type chip + time slot + closed badge */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Badge className="gap-1 bg-amber-100 text-amber-700">
              <Clock className="h-3 w-3" />
              {formatTime(item.time_slot)}
            </Badge>
            {meal?.meal_type && (
              <Badge variant="default" className="capitalize">
                {meal.meal_type.replace('_', ' ')}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isPastDeadline && (
              <Badge variant="cancelled" className="gap-1">
                <Lock className="h-3 w-3" />
                Closed
              </Badge>
            )}
            {isOrdered && !isPastDeadline && (
              <Badge variant="confirmed">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ordered
              </Badge>
            )}
          </div>
        </div>

        {/* Meal name & description */}
        <h3 className="text-base font-bold text-gray-900 mb-1">{meal?.name ?? 'Tiffin'}</h3>
        {meal?.description && (
          <p className="text-sm text-gray-500 mb-3 line-clamp-2">{meal.description}</p>
        )}

        {/* Dietary tags */}
        {meal?.dietary_tags && meal.dietary_tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {meal.dietary_tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Price + capacity row */}
        <div className="flex items-center justify-between py-3 border-t border-gray-100">
          <div>
            <span className="text-xl font-bold text-amber-600">৳{Number(item.price).toFixed(0)}</span>
            <span className="text-xs text-gray-400 ml-1">BDT</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Users className="h-3.5 w-3.5" />
            <span>{capacityLeft} slots</span>
          </div>
        </div>

        {/* Action */}
        {isPastDeadline ? (
          <div className="mt-2 text-center py-2 rounded-lg bg-gray-100 text-gray-500 text-sm font-medium">
            Ordering window closed at {deadlineStr}
          </div>
        ) : isOrdered ? (
          <div className="mt-2 text-center py-2 rounded-lg bg-green-100 text-green-700 text-sm font-medium">
            ✓ Already ordered for this slot
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-xs text-center text-amber-600 mb-2">
              Orders close at {deadlineStr}
            </p>
            <Button
              onClick={onOrder}
              disabled={isOrdering}
              className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0 disabled:opacity-60"
            >
              {isOrdering ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Placing Order…
                </>
              ) : (
                <>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Order &amp; Pay
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section (Today / Tomorrow) ───────────────────────────────────────────────

interface MenuSectionProps {
  title: string
  subtitle: string
  accentClass: string
  slots: StudentMenuGrouped
  orderedIds: Set<string>
  orderingId: string | null
  onOrder: (item: TiffinMenuItem) => void
  emptyMessage: string
}

function MenuSection({
  title,
  subtitle,
  accentClass,
  slots,
  orderedIds,
  orderingId,
  onOrder,
  emptyMessage,
}: MenuSectionProps) {
  const timeSlots = Object.keys(slots).sort()
  const totalItems = timeSlots.reduce((acc, s) => acc + slots[s].length, 0)

  return (
    <section>
      {/* Section header */}
      <div className={`flex items-center justify-between rounded-xl px-4 py-3 mb-4 ${accentClass}`}>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          <div>
            <h2 className="font-bold text-base leading-tight">{title}</h2>
            <p className="text-xs opacity-75">{subtitle}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold">{totalItems}</p>
          <p className="text-xs opacity-75">item{totalItems !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {totalItems === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <UtensilsCrossed className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">{emptyMessage}</p>
            <p className="text-gray-400 text-sm mt-1">Check back later or contact your admin.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {timeSlots.map((slot) => (
            <div key={slot}>
              {/* Time slot heading */}
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg">
                  <Clock className="h-4 w-4" />
                  <span className="font-semibold text-sm">{slot}</span>
                </div>
                <div className="flex-1 h-px bg-amber-100" />
                <span className="text-xs text-gray-400">
                  {slots[slot].length} item{slots[slot].length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {slots[slot].map((item) => (
                  <TiffinCard
                    key={item.id}
                    item={item}
                    isOrdered={orderedIds.has(item.id)}
                    onOrder={() => onOrder(item)}
                    isOrdering={orderingId === item.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentMenuPage() {
  const navigate = useNavigate()
  const {
    menuToday,
    menuTomorrow,
    today,
    tomorrow,
    isLoadingMenu,
    menuError,
    fetchMenu,
    upcomingOrders,
    fetchOrders,
    createOrder,
  } = useStudentStore()

  const [orderingId, setOrderingId] = useState<string | null>(null)

  useEffect(() => {
    fetchMenu()
    fetchOrders()
  }, [fetchMenu, fetchOrders])

  // Build a set of already-ordered tiffin_menu_ids (non-cancelled)
  const orderedIds = new Set(
    upcomingOrders
      .filter((o) => o.status !== 'cancelled')
      .map((o) => o.tiffin_menu_id)
  )

  const totalItems =
    Object.values(menuToday).reduce((a, s) => a + s.length, 0) +
    Object.values(menuTomorrow).reduce((a, s) => a + s.length, 0)

  const handleOrder = async (item: TiffinMenuItem) => {
    setOrderingId(item.id)
    const { error, order } = await createOrder(item.id, 1)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Order placed! Complete your payment now.')
      if (order?.id) {
        navigate(`/student/payment?order_id=${order.id}`)
      }
    }
    setOrderingId(null)
  }

  // Debug
  useEffect(() => {
    console.log('StudentMenuPage — menuToday:', menuToday, 'menuTomorrow:', menuTomorrow)
  }, [menuToday, menuTomorrow])

  // ── Skeleton ──
  if (isLoadingMenu) {
    return (
      <div className="space-y-6">
        <div className="h-20 bg-amber-50 rounded-2xl animate-pulse border border-amber-100" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="animate-pulse bg-gray-200 rounded-lg h-32 w-full" />
          <div className="animate-pulse bg-gray-200 rounded-lg h-32 w-full" />
          <div className="animate-pulse bg-gray-200 rounded-lg h-32 w-full" />
        </div>
      </div>
    )
  }

  // ── Error state ──
  if (menuError) {
    return (
      <div className="space-y-6">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-10 text-center">
            <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
            <p className="text-red-700 font-medium">
              Failed to load menu. Please refresh the page or contact support.
            </p>
            <Button
              onClick={() => fetchMenu()}
              className="mt-4 bg-red-600 hover:bg-red-700 text-white border-0"
              size="sm"
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-6 w-6" />
              Tiffin Menu
            </h1>
            <p className="text-amber-100 text-sm mt-0.5">Today &amp; Tomorrow's availability</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{totalItems}</p>
            <p className="text-xs text-amber-200">items available</p>
          </div>
        </div>
      </div>

      {/* Info notice */}
      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <p className="text-sm text-amber-800">
          <span className="font-bold">Same-day orders are accepted</span> until the ordering deadline
          shown on each card. Payment is required to confirm your order.
        </p>
      </div>

      {/* ── Today's & Tomorrow's Sections (or unified empty state) ── */}
      {totalItems === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UtensilsCrossed className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">
              No tiffin has been scheduled yet. Check back later or contact admin.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <MenuSection
            title="Today's Tiffin"
            subtitle={today ?? ''}
            accentClass="bg-orange-100 text-orange-800"
            slots={menuToday}
            orderedIds={orderedIds}
            orderingId={orderingId}
            onOrder={handleOrder}
            emptyMessage="No tiffin scheduled for today"
          />

          <MenuSection
            title="Tomorrow's Tiffin"
            subtitle={tomorrow ?? ''}
            accentClass="bg-amber-100 text-amber-800"
            slots={menuTomorrow}
            orderedIds={orderedIds}
            orderingId={orderingId}
            onOrder={handleOrder}
            emptyMessage="No tiffin scheduled for tomorrow"
          />
        </>
      )}
    </div>
  )
}

export default StudentMenuPage
