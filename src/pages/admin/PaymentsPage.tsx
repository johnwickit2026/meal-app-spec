import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CreditCard, CheckCircle, Clock, TrendingUp, Users, DollarSign, ChevronLeft, ChevronRight, RefreshCw, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Loading } from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import type { Profile } from '../../types'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store'

interface UserBill {
  profile: Profile
  payment: {
    id?: string
    amount: number
    meal_count: number
    status: 'paid' | 'unpaid' | 'refunded'
    paid_at?: string | null
  } | null
  calculated_amount: number
  calculated_meal_count: number
}

export function PaymentsPage() {
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [bills, setBills] = useState<UserBill[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [cashRequests, setCashRequests] = useState<any[]>([])
  const { profile: adminProfile } = useAuthStore()

  const fetchCashRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('cash_payment_requests')
        .select(`*, profile:profiles!cash_payment_requests_user_id_fkey(id, full_name, email)`)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error
      setCashRequests(data || [])
    } catch (error) {
      console.error('Error fetching cash requests:', error)
    }
  }

  useEffect(() => {
    fetchBills()
    fetchCashRequests()
  }, [selectedMonth])

  // ── Realtime: new/updated cash requests appear without manual refresh ────────
  useEffect(() => {
    const channel = supabase
      .channel('payments_cash_requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cash_payment_requests' },
        () => { fetchCashRequests() }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cash_payment_requests' },
        () => { fetchCashRequests() }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchBills = async () => {
    setIsLoading(true)
    try {
      // Get all active employees
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'employee')
        .eq('is_active', true)
        .order('full_name')

      if (profilesError) throw profilesError

      // Get existing payments for this month
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('month', selectedMonth)

      if (paymentsError) throw paymentsError

      // Get confirmed bookings for this month to calculate amounts
      const startDate = `${selectedMonth}-01`
      const [year, month] = selectedMonth.split('-').map(Number)
      const endDate = format(new Date(year, month, 0), 'yyyy-MM-dd')

      const { data: bookings, error: bookingsError } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules (
            scheduled_date,
            meal:meals (price)
          )
        `)
        .eq('status', 'confirmed')
        .gte('menu_schedule.scheduled_date', startDate)
        .lte('menu_schedule.scheduled_date', endDate)

      if (bookingsError) throw bookingsError

      // Build bills for each user
      const userBills: UserBill[] = (profiles || []).map((profile) => {
        const existingPayment = payments?.find((p) => p.user_id === profile.id)

        // Calculate from confirmed bookings this month (accounting for quantity)
        const userBookings = (bookings || []).filter((b) => b.user_id === profile.id)
        const calculated_meal_count = userBookings.reduce((sum, b) => sum + (b.quantity || 1), 0)
        const calculated_amount = userBookings.reduce((sum, b) => {
          const price = (b.menu_schedule as any)?.meal?.price || 0
          const quantity = b.quantity || 1
          return sum + (price * quantity)
        }, 0)

        return {
          profile,
          payment: existingPayment ? {
            id: existingPayment.id,
            amount: existingPayment.amount,
            meal_count: existingPayment.meal_count,
            status: existingPayment.status,
            paid_at: existingPayment.paid_at,
          } : null,
          calculated_amount,
          calculated_meal_count,
        }
      })

      setBills(userBills)
    } catch (error) {
      console.error('Error fetching bills:', error)
      toast.error('Failed to load payment data')
    } finally {
      setIsLoading(false)
    }
  }

  const generateBills = async () => {
    setIsGenerating(true)
    try {
      const toGenerate = bills.filter((b) => !b.payment && b.calculated_meal_count > 0)

      if (toGenerate.length === 0) {
        toast('No new bills to generate', { icon: 'ℹ️' })
        return
      }

      const inserts = toGenerate.map((b) => ({
        user_id: b.profile.id,
        month: selectedMonth,
        amount: b.calculated_amount,
        meal_count: b.calculated_meal_count,
        status: 'unpaid' as const,
      }))

      const { error } = await supabase.from('payments').insert(inserts)
      if (error) throw error

      toast.success(`Generated ${inserts.length} bill(s)`)
      fetchBills()
    } catch (error) {
      toast.error('Failed to generate bills')
    } finally {
      setIsGenerating(false)
    }
  }

  const markAsPaid = async (bill: UserBill) => {
    if (!bill.payment?.id) return
    setProcessingId(bill.payment.id)
    try {
      const { error } = await supabase
        .from('payments')
        .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', bill.payment.id)

      if (error) throw error
      toast.success(`Marked ${bill.profile.full_name} as paid`)
      fetchBills()
    } catch (error) {
      toast.error('Failed to update payment')
    } finally {
      setProcessingId(null)
    }
  }

  const markAsUnpaid = async (bill: UserBill) => {
    if (!bill.payment?.id) return
    setProcessingId(bill.payment.id)
    try {
      const { error } = await supabase
        .from('payments')
        .update({ status: 'unpaid', paid_at: null, updated_at: new Date().toISOString() })
        .eq('id', bill.payment.id)

      if (error) throw error
      toast.success('Marked as unpaid')
      fetchBills()
    } catch (error) {
      toast.error('Failed to update payment')
    } finally {
      setProcessingId(null)
    }
  }

  const handleConfirmRequest = async (request: any) => {
    if (!adminProfile) return
    try {
      // Update request status
      const { error: reqError } = await supabase
        .from('cash_payment_requests')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
          confirmed_by: adminProfile.id
        })
        .eq('id', request.id)
      if (reqError) throw reqError

      // Credit the confirmed cash amount to the user's balance. Uses the admin
      // balance endpoint (service-role add_user_balance) which writes to
      // user_balances, so the change is pushed live to the user via realtime.
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const balanceRes = await fetch('/api/admin/users/balance', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: request.user_id,
          amount: request.amount,
          note: 'Cash payment confirmed'
        })
      })
      const balanceResult = await balanceRes.json().catch(() => ({}))
      if (!balanceRes.ok) {
        throw new Error(balanceResult.error || 'Failed to credit balance')
      }

      // Find the matching unpaid bill for this user for the current month
      const currentMonth = format(new Date(), 'yyyy-MM')
      const { data: matchingBill } = await supabase
        .from('payments')
        .select('id')
        .eq('user_id', request.user_id)
        .ilike('month', `${currentMonth}%`)
        .eq('status', 'unpaid')
        .single()

      if (matchingBill) {
        await supabase
          .from('payments')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            payment_method: 'cash',
            updated_at: new Date().toISOString()
          })
          .eq('id', matchingBill.id)
      }

      // Notify the employee that their cash payment was confirmed
      await supabase.from('notifications').insert({
        user_id: request.user_id,
        type: 'payment_confirmed',
        message: `Your cash payment of ৳${request.amount} has been confirmed by admin. Your bill is now marked as paid.`
      })

      toast.success('Cash payment confirmed')
      fetchBills()
      fetchCashRequests()
    } catch (err: any) {
      toast.error('Failed to confirm request: ' + err.message)
    }
  }

  const handleRejectRequest = async (id: string) => {
    try {
      const { error } = await supabase
        .from('cash_payment_requests')
        .update({ status: 'rejected' })
        .eq('id', id)
      if (error) throw error
      toast.success('Cash payment rejected')
      fetchCashRequests()
    } catch (err: any) {
      toast.error('Failed to reject request: ' + err.message)
    }
  }

  const prevMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  const nextMonth = () => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setSelectedMonth(format(d, 'yyyy-MM'))
  }

  const totalDue = bills.filter((b) => b.payment?.status === 'unpaid').reduce((s, b) => s + (b.payment?.amount || 0), 0)
  const totalPaid = bills.filter((b) => b.payment?.status === 'paid').reduce((s, b) => s + (b.payment?.amount || 0), 0)
  const unpaidCount = bills.filter((b) => b.payment?.status === 'unpaid').length

  if (isLoading) return <Loading fullScreen text="Loading payments..." />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500">Monthly billing management</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={fetchBills} className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button onClick={generateBills} isLoading={isGenerating} className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Generate Bills
          </Button>
        </div>
      </div>

      {/* Month Selector */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <Button variant="ghost" onClick={prevMonth}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h2 className="text-xl font-bold text-gray-900">
            {format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
          </h2>
          <Button variant="ghost" onClick={nextMonth}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-red-100 rounded-xl flex items-center justify-center">
              <Clock className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">৳{totalDue.toFixed(0)}</p>
              <p className="text-sm text-gray-500">Total Unpaid ({unpaidCount} users)</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">৳{totalPaid.toFixed(0)}</p>
              <p className="text-sm text-gray-500">Total Collected</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-primary-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">৳{(totalDue + totalPaid).toFixed(0)}</p>
              <p className="text-sm text-gray-500">Total Billed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bills Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> User Bills — {format(new Date(selectedMonth + '-01'), 'MMMM yyyy')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bills.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <DollarSign className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No active employees found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Meals</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Paid At</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bills.map((bill) => (
                    <tr key={bill.profile.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{bill.profile.full_name}</p>
                        <p className="text-xs text-gray-500">{bill.profile.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {bill.payment ? bill.payment.meal_count : bill.calculated_meal_count}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        ৳{(bill.payment ? bill.payment.amount : bill.calculated_amount).toFixed(0)}
                      </td>
                      <td className="px-4 py-3">
                        {!bill.payment ? (
                          <Badge variant="default">No Bill Yet</Badge>
                        ) : bill.payment.status === 'paid' ? (
                          <Badge variant="success">Paid</Badge>
                        ) : (
                          <Badge variant="danger">Unpaid</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {bill.payment?.paid_at
                          ? format(new Date(bill.payment.paid_at), 'MMM d, yyyy')
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {bill.payment?.status === 'unpaid' && (
                          <Button
                            size="sm"
                            onClick={() => markAsPaid(bill)}
                            isLoading={processingId === bill.payment?.id}
                            className="flex items-center gap-1 ml-auto"
                          >
                            <CheckCircle className="h-4 w-4" /> Mark Paid
                          </Button>
                        )}
                        {bill.payment?.status === 'paid' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markAsUnpaid(bill)}
                            isLoading={processingId === bill.payment?.id}
                            className="ml-auto text-gray-500"
                          >
                            Undo
                          </Button>
                        )}
                        {!bill.payment && bill.calculated_meal_count === 0 && (
                          <span className="text-xs text-gray-500">No meals this month</span>
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

      {/* Cash Requests Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> Pending Cash Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cashRequests.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <CheckCircle className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No pending cash requests</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Employee</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {cashRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{req.profile?.full_name}</p>
                        <p className="text-xs text-gray-500">{req.profile?.email}</p>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        ৳{req.amount}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {format(new Date(req.created_at), 'MMM d, yyyy h:mm a')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="success" onClick={() => handleConfirmRequest(req)}>
                            <CheckCircle className="h-4 w-4 mr-1" /> Confirm
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => handleRejectRequest(req.id)}>
                            <XCircle className="h-4 w-4 mr-1" /> Reject
                          </Button>
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
    </div>
  )
}

export default PaymentsPage
