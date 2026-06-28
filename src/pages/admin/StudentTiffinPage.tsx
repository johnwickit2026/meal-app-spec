import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Edit,
  Trash2,
  GraduationCap,
  ShoppingBag,
  DollarSign,
  Package,
  Calendar,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  Modal,
  TableSkeleton,
  Toggle,
} from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import { format, addDays } from 'date-fns'
import toast from 'react-hot-toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Meal {
  id: string
  name: string
  meal_type: string
  price: number
}

interface TiffinMenuItem {
  id: string
  meal_id: string
  scheduled_date: string
  time_slot: string
  capacity: number
  price: number
  is_available: boolean
  created_at: string
  meal: Meal | null
}

interface TiffinMenuItemWithOrders extends TiffinMenuItem {
  orders_count: number
}

interface OrderStats {
  totalOrders: number
  totalRevenue: number
  pendingDeliveries: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIME_SLOTS = [
  { value: '07:00', label: '7:00 AM (Breakfast)' },
  { value: '08:00', label: '8:00 AM' },
  { value: '09:00', label: '9:00 AM' },
  { value: '12:00', label: '12:00 PM (Lunch)' },
  { value: '13:00', label: '1:00 PM' },
  { value: '15:00', label: '3:00 PM (Snack)' },
  { value: '17:00', label: '5:00 PM (Evening)' },
  { value: '19:00', label: '7:00 PM (Dinner)' },
]

const tomorrow = () => format(addDays(new Date(), 1), 'yyyy-MM-dd')
const today    = () => format(new Date(), 'yyyy-MM-dd')

// ─── Empty form state ─────────────────────────────────────────────────────────

function emptyForm() {
  return {
    meal_id:        '',
    scheduled_date: tomorrow(),
    time_slot:      '',
    capacity:       20,
    price:          0,
    is_available:   true,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function StudentTiffinPage() {
  // ── Data ──
  const [meals, setMeals] = useState<Meal[]>([])
  const [menuItems, setMenuItems] = useState<TiffinMenuItemWithOrders[]>([])
  const [stats, setStats] = useState<OrderStats>({ totalOrders: 0, totalRevenue: 0, pendingDeliveries: 0 })

  // ── UI state ──
  const [isLoading, setIsLoading] = useState(true)
  const [isStatsLoading, setIsStatsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isTogglingId, setIsTogglingId] = useState<string | null>(null)

  // ── Filter ──
  const [dateFilter, setDateFilter] = useState<string>(tomorrow())

  // ── Modal ──
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<TiffinMenuItemWithOrders | null>(null)
  const [form, setForm] = useState(emptyForm())

  // ─── Fetch helpers ─────────────────────────────────────────────────────────

  const fetchMeals = useCallback(async () => {
    const { data } = await supabase
      .from('meals')
      .select('id, name, meal_type, price')
      .eq('is_active', true)
      .order('name')
    if (data) setMeals(data as Meal[])
  }, [])

  const fetchMenuItems = useCallback(async (date: string) => {
    setIsLoading(true)
    try {
      // Fetch menu items for the selected date with a count of related orders
      const { data, error } = await supabase
        .from('student_tiffin_menu')
        .select(`
          *,
          meal:meals (id, name, meal_type, price),
          orders:student_orders (id)
        `)
        .eq('scheduled_date', date)
        .order('time_slot')

      if (error) throw error

      // Flatten order count
      const withCounts: TiffinMenuItemWithOrders[] = (data ?? []).map((item: any) => ({
        ...item,
        meal: item.meal ?? null,
        orders_count: Array.isArray(item.orders) ? item.orders.length : 0,
      }))

      setMenuItems(withCounts)
    } catch (err: any) {
      console.error('fetchMenuItems error:', err)
      toast.error('Failed to load tiffin menu')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    setIsStatsLoading(true)
    try {
      const todayStr = today()

      // Get tiffin menu ids for today's date
      const { data: todayMenuIds } = await supabase
        .from('student_tiffin_menu')
        .select('id')
        .eq('scheduled_date', todayStr)

      const menuIds = (todayMenuIds ?? []).map((r: any) => r.id)

      if (menuIds.length === 0) {
        setStats({ totalOrders: 0, totalRevenue: 0, pendingDeliveries: 0 })
        return
      }

      const { data: orders } = await supabase
        .from('student_orders')
        .select('id, status, total_amount')
        .in('tiffin_menu_id', menuIds)

      const ordersArr = orders ?? []
      const totalOrders = ordersArr.length
      const totalRevenue = ordersArr
        .filter((o: any) => o.status === 'paid' || o.status === 'delivered')
        .reduce((sum: number, o: any) => sum + Number(o.total_amount), 0)
      const pendingDeliveries = ordersArr.filter((o: any) => o.status === 'paid').length

      setStats({ totalOrders, totalRevenue, pendingDeliveries })
    } catch (err) {
      console.error('fetchStats error:', err)
    } finally {
      setIsStatsLoading(false)
    }
  }, [])

  // ─── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchMeals()
    fetchStats()
  }, [fetchMeals, fetchStats])

  useEffect(() => {
    fetchMenuItems(dateFilter)
  }, [dateFilter, fetchMenuItems])

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  const openCreateModal = () => {
    setEditingItem(null)
    setForm({ ...emptyForm(), scheduled_date: dateFilter })
    setIsModalOpen(true)
  }

  const openEditModal = (item: TiffinMenuItemWithOrders) => {
    setEditingItem(item)
    setForm({
      meal_id:        item.meal_id,
      scheduled_date: item.scheduled_date,
      time_slot:      item.time_slot,
      capacity:       item.capacity,
      price:          Number(item.price),
      is_available:   item.is_available,
    })
    setIsModalOpen(true)
  }

  const closeModal = () => {
    if (isSubmitting) return
    setIsModalOpen(false)
    setEditingItem(null)
    setForm(emptyForm())
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.meal_id || !form.time_slot) {
      toast.error('Please fill in all required fields')
      return
    }
    if (form.scheduled_date < tomorrow()) {
      toast.error('Scheduled date must be tomorrow or later')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        meal_id:        form.meal_id,
        scheduled_date: form.scheduled_date,
        time_slot:      form.time_slot,
        capacity:       Number(form.capacity),
        price:          Number(form.price),
        is_available:   form.is_available,
      }

      if (editingItem) {
        const { error } = await supabase
          .from('student_tiffin_menu')
          .update(payload)
          .eq('id', editingItem.id)
        if (error) throw error
        toast.success('Tiffin item updated')
      } else {
        const { error } = await supabase
          .from('student_tiffin_menu')
          .insert(payload)
        if (error) throw error
        toast.success('Tiffin item created')
      }

      closeModal()
      fetchMenuItems(dateFilter)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save tiffin item')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (item: TiffinMenuItemWithOrders) => {
    if (item.orders_count > 0) {
      toast.error(`Cannot delete — this item has ${item.orders_count} active order(s)`)
      return
    }
    if (!confirm(`Delete "${item.meal?.name ?? 'this item'}"? This cannot be undone.`)) return

    try {
      const { error } = await supabase
        .from('student_tiffin_menu')
        .delete()
        .eq('id', item.id)
      if (error) throw error
      toast.success('Tiffin item deleted')
      fetchMenuItems(dateFilter)
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete item')
    }
  }

  const handleToggleAvailable = async (item: TiffinMenuItemWithOrders) => {
    setIsTogglingId(item.id)
    try {
      const { error } = await supabase
        .from('student_tiffin_menu')
        .update({ is_available: !item.is_available })
        .eq('id', item.id)
      if (error) throw error
      // Optimistic update
      setMenuItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, is_available: !item.is_available } : m))
      )
    } catch (err: any) {
      toast.error('Failed to update availability')
    } finally {
      setIsTogglingId(null)
    }
  }

  // ─── Computed ─────────────────────────────────────────────────────────────

  const isInitialLoading = isLoading && menuItems.length === 0

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GraduationCap className="h-7 w-7 text-amber-500" />
            Student Tiffin Management
          </h1>
          <p className="text-gray-500 mt-0.5">
            Manage tomorrow's tiffin menu for students. Orders close at midnight.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button
            variant="secondary"
            onClick={() => { fetchMenuItems(dateFilter); fetchStats() }}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Tiffin Item
          </Button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total orders today */}
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <ShoppingBag className="h-6 w-6 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {isStatsLoading ? <Loader2 className="h-5 w-5 animate-spin text-gray-400" /> : stats.totalOrders}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Total Orders Today</p>
            </div>
          </CardContent>
        </Card>

        {/* Revenue today */}
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <DollarSign className="h-6 w-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {isStatsLoading ? '…' : `৳${stats.totalRevenue.toFixed(0)}`}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Revenue Today (BDT)</p>
            </div>
          </CardContent>
        </Card>

        {/* Pending deliveries */}
        <Card className={`h-[104px] ${stats.pendingDeliveries > 0 ? 'border-orange-200' : ''}`}>
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 ${stats.pendingDeliveries > 0 ? 'bg-orange-100' : 'bg-blue-100'}`}>
              <Package className={`h-6 w-6 ${stats.pendingDeliveries > 0 ? 'text-orange-600' : 'text-blue-600'}`} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {isStatsLoading ? '…' : stats.pendingDeliveries}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Pending Deliveries</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Date filter ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">Viewing menu for:</span>
            </div>
            <Input
              type="date"
              value={dateFilter}
              min={tomorrow()}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-44"
            />
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDateFilter(tomorrow())}
                className={dateFilter === tomorrow() ? 'bg-amber-50 text-amber-700' : ''}
              >
                Tomorrow
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDateFilter(format(addDays(new Date(), 2), 'yyyy-MM-dd'))}
              >
                Day After
              </Button>
            </div>
            {menuItems.length > 0 && (
              <span className="ml-auto text-sm text-gray-500">
                {menuItems.length} item{menuItems.length !== 1 ? 's' : ''} scheduled
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Menu table ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-amber-500" />
            Tiffin Schedule — {format(new Date(dateFilter + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
          </CardTitle>
          <Button size="sm" onClick={openCreateModal}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </CardHeader>

        <CardContent>
          {isInitialLoading ? (
            <TableSkeleton rows={5} />
          ) : menuItems.length === 0 ? (
            <div className="text-center py-16">
              <GraduationCap className="h-14 w-14 mx-auto mb-4 text-gray-300" />
              <p className="text-gray-500 font-medium">No tiffin items scheduled for this date</p>
              <p className="text-gray-400 text-sm mt-1">Click "Add Tiffin Item" to create the first one.</p>
              <Button className="mt-4" onClick={openCreateModal}>
                <Plus className="h-4 w-4 mr-2" />
                Add Tiffin Item
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Meal</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Time Slot</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Price (BDT)</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Capacity</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Orders</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Available</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {menuItems.map((item) => {
                    const ordersFill = item.capacity > 0
                      ? Math.min(100, Math.round((item.orders_count / item.capacity) * 100))
                      : 0
                    const isFull = item.orders_count >= item.capacity

                    return (
                      <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                        {/* Meal */}
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{item.meal?.name ?? '—'}</p>
                          <p className="text-xs text-gray-500 capitalize">
                            {item.meal?.meal_type?.replace('_', ' ') ?? ''}
                          </p>
                        </td>

                        {/* Time slot */}
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-sm text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">
                            {item.time_slot}
                          </span>
                        </td>

                        {/* Price */}
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          ৳{Number(item.price).toFixed(0)}
                        </td>

                        {/* Capacity + fill bar */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-700">{item.capacity}</span>
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isFull ? 'bg-red-500' : ordersFill > 70 ? 'bg-amber-500' : 'bg-green-500'
                                }`}
                                style={{ width: `${ordersFill}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Orders count */}
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center justify-center min-w-[2rem] h-8 px-2 rounded-full text-sm font-semibold ${
                              isFull
                                ? 'bg-red-100 text-red-700'
                                : item.orders_count > 0
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {item.orders_count}
                          </span>
                          {isFull && (
                            <span className="ml-2 text-xs text-red-600 font-medium">Full</span>
                          )}
                        </td>

                        {/* Available toggle */}
                        <td className="px-4 py-3">
                          {isTogglingId === item.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                          ) : (
                            <Toggle
                              checked={item.is_available}
                              onChange={() => handleToggleAvailable(item)}
                              aria-label={`Toggle availability for ${item.meal?.name}`}
                            />
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditModal(item)}
                              title="Edit item"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDelete(item)}
                              title={item.orders_count > 0 ? `${item.orders_count} order(s) — cannot delete` : 'Delete item'}
                              disabled={item.orders_count > 0}
                              className={item.orders_count > 0 ? 'opacity-40 cursor-not-allowed' : ''}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add / Edit Modal ── */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingItem ? 'Edit Tiffin Item' : 'Add Tiffin Item'}
        size="md"
      >
        <form onSubmit={handleSave}>
          <div className="px-6 py-4 space-y-4">

            {/* Meal selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Meal <span className="text-red-500">*</span>
              </label>
              <Select
                options={[
                  { value: '', label: 'Select a meal…' },
                  ...meals.map((m) => ({
                    value: m.id,
                    label: `${m.name} (${m.meal_type.replace('_', ' ')}) — ৳${m.price}`,
                  })),
                ]}
                value={form.meal_id}
                onChange={(e) => {
                  const meal = meals.find((m) => m.id === e.target.value)
                  setForm((f) => ({
                    ...f,
                    meal_id: e.target.value,
                    // Auto-fill price from meal if not yet set
                    price: f.price === 0 && meal ? meal.price : f.price,
                  }))
                }}
                required
              />
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <Input
                type="date"
                value={form.scheduled_date}
                min={tomorrow()}
                onChange={(e) => setForm((f) => ({ ...f, scheduled_date: e.target.value }))}
                required
              />
              <p className="text-xs text-gray-500 mt-1">Must be tomorrow or later (students order 1 day ahead)</p>
            </div>

            {/* Time slot */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Time Slot <span className="text-red-500">*</span>
              </label>
              <Select
                options={[
                  { value: '', label: 'Select time slot…' },
                  ...TIME_SLOTS,
                ]}
                value={form.time_slot}
                onChange={(e) => setForm((f) => ({ ...f, time_slot: e.target.value }))}
                required
              />
            </div>

            {/* Capacity + Price side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Capacity <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={form.capacity}
                  onChange={(e) => setForm((f) => ({ ...f, capacity: Number(e.target.value) }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price (৳ BDT) <span className="text-red-500">*</span>
                </label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                  required
                />
              </div>
            </div>

            {/* Available toggle */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
              <Toggle
                checked={form.is_available}
                onChange={(e) => setForm((f) => ({ ...f, is_available: e.target.checked }))}
                label="Available for ordering"
                description="Students can only order available items"
              />
            </div>

            {/* Live summary */}
            {form.meal_id && form.time_slot && (
              <div className="text-sm text-gray-500 p-3 bg-amber-50 rounded-lg border border-amber-100">
                <span className="font-medium text-amber-700">
                  {meals.find((m) => m.id === form.meal_id)?.name ?? ''}
                </span>
                {' · '}
                {form.time_slot}
                {' · '}
                ৳{form.price}
                {' · '}
                {form.capacity} slots
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <Button type="button" variant="secondary" onClick={closeModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : editingItem ? (
                'Update Item'
              ) : (
                'Create Item'
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default StudentTiffinPage
