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
} from 'lucide-react'
import { useStudentStore } from '../../store/studentStore'
import type { TiffinMenuItem } from '../../store/studentStore'
import { Card, CardContent, Button, Badge, CardSkeleton } from '../../components/ui'
import toast from 'react-hot-toast'

// ─── Meal Card ────────────────────────────────────────────────────────────────

interface TiffinCardProps {
  item: TiffinMenuItem
  isOrdered: boolean
  onOrder: () => void
  isOrdering: boolean
}

function TiffinCard({ item, isOrdered, onOrder, isOrdering }: TiffinCardProps) {
  const { meal } = item
  const capacityLeft = item.capacity // We could subtract booked count if the API returned it

  return (
    <Card
      className={`transition-all duration-200 ${
        isOrdered ? 'border-green-300 bg-green-50/50' : 'hover:border-amber-300 hover:shadow-md'
      }`}
    >
      <CardContent className="p-5">
        {/* Meal type chip + time slot */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
              <Clock className="h-3 w-3" />
              {item.time_slot}
            </span>
            {meal?.meal_type && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 capitalize">
                {meal.meal_type.replace('_', ' ')}
              </span>
            )}
          </div>
          {isOrdered && (
            <Badge variant="confirmed">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Ordered
            </Badge>
          )}
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
        {isOrdered ? (
          <div className="mt-2 text-center py-2 rounded-lg bg-green-100 text-green-700 text-sm font-medium">
            ✓ Already ordered for this slot
          </div>
        ) : (
          <Button
            onClick={onOrder}
            disabled={isOrdering}
            className="mt-2 w-full bg-amber-500 hover:bg-amber-600 text-white border-0 disabled:opacity-60"
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
        )}
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentMenuPage() {
  const navigate = useNavigate()
  const { menu, menuDate, isLoadingMenu, fetchMenu, upcomingOrders, fetchOrders, createOrder } =
    useStudentStore()

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

  const timeSlots = Object.keys(menu).sort()
  const totalItems = timeSlots.reduce((acc, slot) => acc + menu[slot].length, 0)

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

  // ── Skeleton ──
  if (isLoadingMenu) {
    return (
      <div className="space-y-6">
        <div className="h-20 bg-amber-50 rounded-2xl animate-pulse border border-amber-100" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <UtensilsCrossed className="h-6 w-6" />
              Tomorrow's Tiffin Menu
            </h1>
            {menuDate && <p className="text-amber-100 text-sm mt-0.5">{menuDate}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{totalItems}</p>
            <p className="text-xs text-amber-200">items available</p>
          </div>
        </div>
      </div>

      {/* Deadline notice */}
      <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
        <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <p className="text-sm text-amber-800">
          <span className="font-bold">Order deadline: midnight tonight.</span>{' '}
          All orders are for tomorrow only. Payment required to confirm.
        </p>
      </div>

      {/* Menu content */}
      {totalItems === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <UtensilsCrossed className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 text-lg font-medium">No menu available for tomorrow</p>
            <p className="text-gray-400 text-sm mt-1">Check back later or contact your admin.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {timeSlots.map((slot) => (
            <div key={slot}>
              {/* Time slot heading */}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center gap-2 bg-amber-100 text-amber-700 px-3 py-1.5 rounded-lg">
                  <Clock className="h-4 w-4" />
                  <span className="font-semibold text-sm">{slot}</span>
                </div>
                <div className="flex-1 h-px bg-amber-100" />
                <span className="text-xs text-gray-400">{menu[slot].length} item{menu[slot].length !== 1 ? 's' : ''}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {menu[slot].map((item) => (
                  <TiffinCard
                    key={item.id}
                    item={item}
                    isOrdered={orderedIds.has(item.id)}
                    onOrder={() => handleOrder(item)}
                    isOrdering={orderingId === item.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default StudentMenuPage
