import { useEffect, useState } from 'react'
import { Download, Search, CheckCircle, XCircle, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Select, StatusBadge, TableSkeleton, Modal } from '../../components/ui'
import { useBookingStore, useAuthStore } from '../../store'
import { supabase } from '../../lib/supabaseClient'
import { format } from 'date-fns'
import toast from 'react-hot-toast'

export function BookingManagementPage() {
  const { user } = useAuthStore()
  const { bookings, fetchAllBookings, updateBookingStatus, isLoading, createManualBooking } = useBookingStore()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Manual Order Modal state
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [activeUsers, setActiveUsers] = useState<any[]>([])
  const [todaySchedules, setTodaySchedules] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedSchedule, setSelectedSchedule] = useState('')
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Guest Meal Modal state
  const [isGuestModalOpen, setIsGuestModalOpen] = useState(false)
  const [guestForm, setGuestForm] = useState({
    guest_name: '',
    department: 'School',
    meal_date: new Date().toISOString().split('T')[0],
    menu_schedule_id: '',
    quantity: 1,
    notes: ''
  })
  const [isSubmittingGuest, setIsSubmittingGuest] = useState(false)

  useEffect(() => {
    fetchAllBookings()
  }, [])

  const fetchSchedulesForDate = async (date: string) => {
    const { data } = await supabase
      .from('menu_schedules')
      .select('id, scheduled_date, time_slot, capacity, meal:meals(id, name)')
      .eq('scheduled_date', date)
      .eq('is_available', true)
      .order('time_slot')
    setTodaySchedules(data || [])
  }

  const openManualModal = async () => {
    setIsModalOpen(true)
    const today = new Date().toISOString().split('T')[0]
    setSelectedDate(today)
    setSelectedSchedule('')
    // Fetch users and schedules
    try {
      const { data: usersData } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('is_active', true)
        .eq('role', 'employee')
        .order('full_name')

      if (usersData) setActiveUsers(usersData)
      await fetchSchedulesForDate(today)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load data for manual order')
    }
  }

  const openGuestModal = async () => {
    setIsGuestModalOpen(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      setGuestForm(prev => ({ ...prev, meal_date: today, menu_schedule_id: '' }))
      await fetchSchedulesForDate(today)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load schedules for guest meal')
    }
  }

  const handleGuestMealSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!guestForm.guest_name || !guestForm.menu_schedule_id) return toast.error('Required fields missing')

    setIsSubmittingGuest(true)
    try {
      const schedule = todaySchedules.find(s => s.id === guestForm.menu_schedule_id)
      if (!schedule) throw new Error('Schedule not found')

      const payload = {
        guest_name: guestForm.guest_name,
        department: guestForm.department,
        meal_id: schedule.meal?.id,
        menu_schedule_id: schedule.id,
        meal_date: schedule.scheduled_date,
        time_slot: schedule.time_slot,
        quantity: guestForm.quantity,
        notes: guestForm.notes
      }

      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/admin/guest-meals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to add guest meal')

      toast.success(`Guest meal added for ${guestForm.guest_name}`)
      setIsGuestModalOpen(false)
      setGuestForm({ ...guestForm, guest_name: '', notes: '', quantity: 1 })
    } catch (error: any) {
      toast.error(error.message || 'Failed to add guest meal')
    } finally {
      setIsSubmittingGuest(false)
    }
  }

  const handleManualOrder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser || !selectedSchedule || !user) return

    setIsSubmitting(true)
    const result = await createManualBooking(selectedSchedule, selectedUser, notes, quantity, user.id)
    setIsSubmitting(false)

    if (result.error) {
      toast.error(result.error.message || 'Failed to create manual order')
    } else {
      toast.success('Manual order created successfully')
      setIsModalOpen(false)
      // reset fields
      setSelectedUser('')
      setSelectedSchedule('')
      setQuantity(1)
      setNotes('')
    }
  }

  const handleApprove = async (bookingId: string) => {
    const result = await updateBookingStatus(bookingId, 'confirmed')
    if (result.error) {
      toast.error('Failed to approve booking')
    } else {
      toast.success('Booking approved')
    }
  }

  const handleDeny = async (bookingId: string) => {
    const result = await updateBookingStatus(bookingId, 'denied')
    if (result.error) {
      toast.error('Failed to deny booking')
    } else {
      toast.success('Booking denied')
    }
  }

  const handleBulkApprove = async () => {
    const pendingBookings = filteredBookings.filter((b) => b.status === 'pending')
    if (pendingBookings.length === 0) {
      toast.error('No pending bookings to approve')
      return
    }

    for (const booking of pendingBookings) {
      await updateBookingStatus(booking.id, 'confirmed')
    }
    toast.success(`${pendingBookings.length} bookings approved`)
  }

  const exportToCSV = () => {
    const headers = ['User', 'Email', 'Department', 'Meal', 'Quantity', 'Date', 'Time', 'Status', 'Booked At']
    const rows = filteredBookings.map((b) => [
      b.profile?.full_name || 'Unknown',
      b.profile?.email || '',
      b.profile?.department || '',
      b.menu_schedule?.meal?.name || '',
      b.quantity || 1,
      b.menu_schedule?.scheduled_date || '',
      b.menu_schedule?.time_slot || '',
      b.status,
      new Date(b.booked_at).toLocaleString(),
    ])

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Exported to CSV')
  }

  const filteredBookings = bookings.filter((booking) => {
    // Status filter
    if (statusFilter !== 'all' && booking.status !== statusFilter) return false

    // Date filter
    if (dateFilter && booking.menu_schedule?.scheduled_date !== dateFilter) return false

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesUser = booking.profile?.full_name?.toLowerCase().includes(query)
      const matchesMeal = booking.menu_schedule?.meal?.name?.toLowerCase().includes(query)
      const matchesDept = booking.profile?.department?.toLowerCase().includes(query)
      if (!matchesUser && !matchesMeal && !matchesDept) return false
    }

    return true
  })

  const pendingCount = filteredBookings.filter((b) => b.status === 'pending').length

  const isInitialLoading = isLoading && bookings.length === 0

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Controls Skeleton */}
        <div className="flex gap-4">
          <div className="h-10 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-48 bg-gray-200 rounded animate-pulse" />
          <div className="h-10 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Table Skeleton */}
        <Card>
          <TableSkeleton rows={8} />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Booking Management</h1>
          <p className="text-gray-500">Manage all meal bookings</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={openGuestModal} className="border-purple-200 text-purple-700 hover:bg-purple-50">
            <Plus className="h-4 w-4 mr-2" />
            Add Guest Meal
          </Button>
          <Button variant="primary" onClick={openManualModal}>
            <Plus className="h-4 w-4 mr-2" />
            Manual Order
          </Button>
          {pendingCount > 0 && (
            <Button variant="success" onClick={handleBulkApprove}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Approve All Pending ({pendingCount})
            </Button>
          )}
          <Button variant="secondary" onClick={exportToCSV}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by user, meal, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <Select
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'pending', label: 'Pending' },
                { value: 'confirmed', label: 'Confirmed' },
                { value: 'denied', label: 'Denied' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-40"
            />
            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-40"
            />
            {(statusFilter !== 'all' || dateFilter || searchQuery) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setStatusFilter('all')
                  setDateFilter('')
                  setSearchQuery('')
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bookings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Bookings ({filteredBookings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredBookings.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No bookings found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Meal</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Qty</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Time</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Booked At</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBookings.map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{booking.profile?.full_name || 'Unknown'}</p>
                        <p className="text-sm text-gray-500">{booking.profile?.department}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{booking.menu_schedule?.meal?.name}</p>
                        <p className="text-sm text-gray-500 capitalize">{booking.menu_schedule?.meal?.meal_type}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-700 font-semibold text-sm">
                          {booking.quantity || 1}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {booking.menu_schedule?.scheduled_date &&
                          format(new Date(booking.menu_schedule.scheduled_date), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{booking.menu_schedule?.time_slot}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={booking.status} />
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">
                        {format(new Date(booking.booked_at), 'MMM d, h:mm a')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {booking.status === 'pending' && (
                            <>
                              <Button variant="success" size="sm" onClick={() => handleApprove(booking.id)}>
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button variant="danger" size="sm" onClick={() => handleDeny(booking.id)}>
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => !isSubmitting && setIsModalOpen(false)}
        title="Create Manual Order"
      >
        <form onSubmit={handleManualOrder} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User</label>
            <Select
              options={[
                { value: '', label: 'Select a user...' },
                ...activeUsers.map(u => ({ value: u.id, label: `${u.full_name} (${u.email})` }))
              ]}
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              required
              className="w-full"
            />
          </div>

          <div>
            <Input
              type="date"
              label="Select Date"
              value={selectedDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => {
                setSelectedDate(e.target.value)
                setSelectedSchedule('')
                fetchSchedulesForDate(e.target.value)
              }}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Menu Schedule</label>
            <Select
              options={[
                { value: '', label: 'Select a schedule...' },
                ...todaySchedules.map(s => ({ 
                  value: s.id, 
                  label: `${s.meal?.name || 'Meal'} at ${s.time_slot} (Cap: ${s.capacity})` 
                }))
              ]}
              value={selectedSchedule}
              onChange={(e) => setSelectedSchedule(e.target.value)}
              required
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <Input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
              required
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any special requests..."
              className="w-full"
            />
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !selectedUser || !selectedSchedule}
            >
              {isSubmitting ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isGuestModalOpen}
        onClose={() => !isSubmittingGuest && setIsGuestModalOpen(false)}
        title="Add Guest Meal"
      >
        <form onSubmit={handleGuestMealSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name</label>
            <Input
              value={guestForm.guest_name}
              onChange={(e) => setGuestForm({ ...guestForm, guest_name: e.target.value })}
              required
              placeholder="e.g. John Doe (Visitor)"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <Select
              options={[
                { value: 'School', label: 'School' },
                { value: 'Educare', label: 'Educare' }
              ]}
              value={guestForm.department}
              onChange={(e) => setGuestForm({ ...guestForm, department: e.target.value })}
              className="w-full"
            />
          </div>

          <div>
            <Input
              type="date"
              label="Select Date"
              value={guestForm.meal_date}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => {
                setGuestForm(prev => ({ ...prev, meal_date: e.target.value, menu_schedule_id: '' }))
                fetchSchedulesForDate(e.target.value)
              }}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Menu Schedule</label>
            <Select
              options={[
                { value: '', label: 'Select a schedule...' },
                ...todaySchedules.map(s => ({ 
                  value: s.id, 
                  label: `${s.meal?.name || 'Meal'} at ${s.time_slot}` 
                }))
              ]}
              value={guestForm.menu_schedule_id}
              onChange={(e) => setGuestForm({ ...guestForm, menu_schedule_id: e.target.value })}
              required
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
            <Input
              type="number"
              min="1"
              value={guestForm.quantity}
              onChange={(e) => setGuestForm({ ...guestForm, quantity: Number(e.target.value) || 1 })}
              required
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">Guest meals ignore capacity limits.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (Optional)</label>
            <Input
              value={guestForm.notes}
              onChange={(e) => setGuestForm({ ...guestForm, notes: e.target.value })}
              placeholder="e.g. VIP guest"
              className="w-full"
            />
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsGuestModalOpen(false)}
              disabled={isSubmittingGuest}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmittingGuest || !guestForm.guest_name || !guestForm.menu_schedule_id}
            >
              {isSubmittingGuest ? 'Confirming...' : 'Confirm Guest Meal'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default BookingManagementPage
