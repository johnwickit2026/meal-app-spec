import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ShoppingBag,
  Clock,
  CheckCircle2,
  XCircle,
  Package,
  CreditCard,
  Hash,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { useStudentStore } from '../../store/studentStore'
import type { StudentOrder } from '../../store/studentStore'
import { Card, CardContent, Button, Badge, CardSkeleton } from '../../components/ui'
import { ConfirmDialog } from '../../components/ui/Modal'
import toast from 'react-hot-toast'

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  StudentOrder['status'],
  { label: string; variant: 'pending' | 'confirmed' | 'cancelled' | 'success'; Icon: React.ElementType; color: string }
> = {
  pending:   { label: 'Awaiting Approval', variant: 'pending',   Icon: Clock,         color: 'text-yellow-600' },
  confirmed: { label: 'Confirmed — Pay Now', variant: 'confirmed', Icon: CheckCircle2, color: 'text-amber-600'  },
  paid:      { label: 'Paid',              variant: 'confirmed', Icon: CheckCircle2,  color: 'text-green-600'  },
  cancelled: { label: 'Cancelled',         variant: 'cancelled', Icon: XCircle,       color: 'text-gray-500'   },
  delivered: { label: 'Delivered',         variant: 'success',   Icon: Package,       color: 'text-blue-600'   },
}

// ─── Order Row ────────────────────────────────────────────────────────────────

interface OrderRowProps {
  order: StudentOrder
  onCancel: (id: string) => void
  cancelling: boolean
}

function OrderRow({ order, onCancel, cancelling }: OrderRowProps) {
  const [expanded, setExpanded] = useState(false)
  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.cancelled
  const payment = order.payment

  const paymentStatusConfig = {
    pending:   { label: 'Pending',   color: 'text-yellow-600 bg-yellow-50' },
    success:   { label: 'Success',   color: 'text-green-600 bg-green-50'   },
    failed:    { label: 'Failed',    color: 'text-red-600 bg-red-50'       },
    cancelled: { label: 'Cancelled', color: 'text-gray-500 bg-gray-50'     },
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden hover:border-amber-200 transition-colors">
      {/* Main row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            order.status === 'pending' ? 'bg-yellow-50' :
            order.status === 'paid'    ? 'bg-green-50'  :
            order.status === 'delivered' ? 'bg-blue-50' : 'bg-gray-50'
          }`}>
            <cfg.Icon className={`h-5 w-5 ${cfg.color}`} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">
              {order.tiffin_menu?.meal?.name ?? 'Tiffin Order'}
            </p>
            <p className="text-xs text-gray-500">
              {order.tiffin_menu?.time_slot} · Meal date: {order.meal_date}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <div className="text-right hidden sm:block">
            <p className="font-bold text-gray-900">৳{Number(order.total_amount).toFixed(0)}</p>
            <p className="text-xs text-gray-400">Qty: {order.quantity}</p>
          </div>
          <Badge variant={cfg.variant}>{cfg.label}</Badge>
          {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 p-4 space-y-4">
          {/* Amount row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 bg-white rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Total Amount</p>
              <p className="font-bold text-amber-600 text-lg">৳{Number(order.total_amount).toFixed(0)}</p>
            </div>
            <div className="p-3 bg-white rounded-lg border border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Ordered On</p>
              <p className="font-medium text-gray-900 text-sm">{order.order_date}</p>
            </div>
          </div>

          {/* Payment info */}
          {payment ? (
            <div className="p-3 bg-white rounded-lg border border-gray-100 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold text-gray-700">Payment Details</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Status</span>
                <Badge
                  variant={
                    payment.status === 'success'  ? 'confirmed' :
                    payment.status === 'failed'   ? 'danger'    :
                    payment.status === 'cancelled' ? 'cancelled' : 'pending'
                  }
                >
                  {paymentStatusConfig[payment.status]?.label ?? payment.status}
                </Badge>
              </div>
              {payment.tran_id && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Hash className="h-3 w-3" /> Transaction ID
                  </span>
                  <code className="text-xs bg-gray-100 px-2 py-0.5 rounded font-mono text-gray-700">
                    {payment.tran_id}
                  </code>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Amount Paid</span>
                <span className="text-xs font-bold text-gray-900">
                  ৳{Number(payment.amount).toFixed(0)} {payment.currency}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 rounded-lg border border-yellow-100">
              <AlertCircle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
              <p className="text-xs text-yellow-700">No payment record yet.</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {order.status === 'pending' && (
              <>
                <Link to={`/student/payment?order_id=${order.id}`} className="flex-1">
                  <Button className="w-full bg-amber-500 hover:bg-amber-600 text-white border-0" size="sm">
                    <CreditCard className="h-4 w-4 mr-2" />
                    Pay Now
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.stopPropagation(); onCancel(order.id) }}
                  disabled={cancelling}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cancel'}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentOrdersPage() {
  const { upcomingOrders, pastOrders, isLoadingOrders, fetchOrders, cancelOrder } = useStudentStore()
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleConfirmCancel = async () => {
    if (!confirmCancelId) return
    setIsCancelling(true)
    const { error } = await cancelOrder(confirmCancelId)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Order cancelled successfully')
    }
    setIsCancelling(false)
    setConfirmCancelId(null)
  }

  const isInitialLoading = isLoadingOrders && upcomingOrders.length === 0 && pastOrders.length === 0

  if (isInitialLoading) {
    return (
      <div className="space-y-4">
        <div className="h-16 bg-amber-50 rounded-xl animate-pulse" />
        {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShoppingBag className="h-7 w-7 text-amber-500" />
          My Orders
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">
          Track all your tiffin orders and payment statuses
        </p>
      </div>

      {/* Upcoming orders */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-amber-500" />
          Upcoming ({upcomingOrders.length})
        </h2>

        {upcomingOrders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 mb-4">No upcoming orders</p>
              <Link to="/student/menu">
                <Button className="bg-amber-500 hover:bg-amber-600 text-white border-0" size="sm">
                  Browse Tomorrow's Menu
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {upcomingOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onCancel={setConfirmCancelId}
                cancelling={isCancelling && confirmCancelId === order.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* Past orders */}
      {pastOrders.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-gray-400" />
            Past Orders ({pastOrders.length})
          </h2>
          <div className="space-y-3">
            {pastOrders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                onCancel={setConfirmCancelId}
                cancelling={isCancelling && confirmCancelId === order.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Cancel confirm dialog */}
      <ConfirmDialog
        isOpen={!!confirmCancelId}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This action cannot be undone."
        confirmText={isCancelling ? 'Cancelling…' : 'Yes, Cancel Order'}
        cancelText="Keep Order"
        variant="danger"
        isLoading={isCancelling}
        onConfirm={handleConfirmCancel}
        onClose={() => setConfirmCancelId(null)}
      />
    </div>
  )
}

export default StudentOrdersPage
