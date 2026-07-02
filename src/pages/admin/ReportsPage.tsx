import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, Loading, Select, Button } from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import { format, subDays, subMonths } from 'date-fns'
import { FileText, FileSpreadsheet } from 'lucide-react'
import type { PaymentWithProfile } from '../../types'
import { exportToExcel, exportToPDF } from '../../lib/exportUtils'
import toast from 'react-hot-toast'

interface BookingStats {
  date: string
  count: number
}

interface StatusDistribution {
  name: string
  value: number
}

interface DepartmentStats {
  department: string
  count: number
}

interface MealPopularity {
  name: string
  count: number
}

interface EarningsData {
  totalEarnings: number
  monthlyEarnings: number
  yearlyEarnings: number
  monthlyTrend: { month: string; earnings: number }[]
  individualEarnings: { name: string; email: string; amount: number; meals: number }[]
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: '#10B981',
  pending: '#F59E0B',
  denied: '#EF4444',
  cancelled: '#6B7280',
}

type ReportBooking = {
  booked_at: string
  status: string
  quantity?: number
  profile?: { department: string | null }
  menu_schedule?: { scheduled_date: string; meal: { name: string } | null }
}

export function ReportsPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week')
  const [bookingsByDate, setBookingsByDate] = useState<BookingStats[]>([])
  const [statusDistribution, setStatusDistribution] = useState<StatusDistribution[]>([])
  const [departmentStats, setDepartmentStats] = useState<DepartmentStats[]>([])
  const [mealPopularity, setMealPopularity] = useState<MealPopularity[]>([])
  const [earningsData, setEarningsData] = useState<EarningsData>({
    totalEarnings: 0,
    monthlyEarnings: 0,
    yearlyEarnings: 0,
    monthlyTrend: [],
    individualEarnings: [],
  })
  const [earningsTimeRange, setEarningsTimeRange] = useState<'6months' | '1year'>('6months')

  // Export State
  const [exportStartDate, setExportStartDate] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [exportEndDate, setExportEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [exportData, setExportData] = useState<any[]>([])
  const [isGenerating, setIsGenerating] = useState(false)

  useEffect(() => {
    fetchReportData()
    fetchEarningsData()
  }, [timeRange, earningsTimeRange])

  const fetchReportData = async () => {
    setIsLoading(true)
    const endDate = new Date()
    const startDate = timeRange === 'week' ? subDays(endDate, 7) : subDays(endDate, 30)

    try {
      // Fetch all bookings in date range
      const { data: bookings, error } = await supabase
        .from('bookings')
        .select(`
          *,
          menu_schedule:menu_schedules (
            scheduled_date,
            meal:meals (name)
          ),
          profile:profiles (department)
        `)
        .gte('booked_at', startDate.toISOString())
        .lte('booked_at', endDate.toISOString())

      if (error) throw error

      const typedBookings = (bookings || []) as ReportBooking[]

      // Process bookings by date (accounting for quantity)
      const dateMap = new Map<string, number>()
      const days = timeRange === 'week' ? 7 : 30
      for (let i = 0; i < days; i++) {
        const date = format(subDays(endDate, days - 1 - i), 'yyyy-MM-dd')
        dateMap.set(date, 0)
      }

      typedBookings.forEach((booking) => {
        const date = format(new Date(booking.booked_at), 'yyyy-MM-dd')
        if (dateMap.has(date)) {
          dateMap.set(date, (dateMap.get(date) || 0) + (booking.quantity || 1))
        }
      })

      setBookingsByDate(
        Array.from(dateMap.entries()).map(([date, count]) => ({
          date: format(new Date(date), 'MMM d'),
          count,
        }))
      )

      // Process status distribution (accounting for quantity)
      const statusMap = new Map<string, number>()
      typedBookings.forEach((booking) => {
        statusMap.set(booking.status, (statusMap.get(booking.status) || 0) + (booking.quantity || 1))
      })

      setStatusDistribution(
        Array.from(statusMap.entries()).map(([name, value]) => ({
          name: name.charAt(0).toUpperCase() + name.slice(1),
          value,
        }))
      )

      // Process department stats (School vs Educare)
      let schoolCount = 0
      let educareCount = 0
      typedBookings.forEach((booking) => {
        const dept = booking.profile?.department
        if (dept === 'School') schoolCount += (booking.quantity || 1)
        if (dept === 'Educare') educareCount += (booking.quantity || 1)
      })

      setDepartmentStats([
        { department: 'School', count: schoolCount },
        { department: 'Educare', count: educareCount }
      ])

      // Process meal popularity (accounting for quantity)
      const mealMap = new Map<string, number>()
      typedBookings.forEach((booking) => {
        const mealName = booking.menu_schedule?.meal?.name || 'Unknown'
        mealMap.set(mealName, (mealMap.get(mealName) || 0) + (booking.quantity || 1))
      })

      setMealPopularity(
        Array.from(mealMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5)
      )
    } catch (error) {
      console.error('Error fetching report data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchEarningsData = async () => {
    try {
      // Calculate date range
      const endDate = new Date()
      const startDate = earningsTimeRange === '6months' ? subMonths(endDate, 6) : subMonths(endDate, 12)
      const startMonth = format(startDate, 'yyyy-MM')
      const currentMonth = format(endDate, 'yyyy-MM')

      // Fetch all paid payments in date range
      const { data: payments, error } = await supabase
        .from('payments')
        .select(`
          *,
          profile:profiles (full_name, email)
        `)
        .eq('status', 'paid')
        .gte('month', startMonth)
        .lte('month', currentMonth)

      if (error) throw error

      const typedPayments = (payments || []) as PaymentWithProfile[]

      // Calculate total earnings
      const totalEarnings = typedPayments.reduce((sum, p) => sum + (p.amount || 0), 0)

      // Calculate current month earnings
      const monthlyEarnings = typedPayments
        .filter((p) => p.month === currentMonth)
        .reduce((sum, p) => sum + (p.amount || 0), 0)

      // Calculate yearly earnings (last 12 months)
      const yearlyEarnings = totalEarnings

      // Monthly trend data
      const monthMap = new Map<string, number>()
      const months = earningsTimeRange === '6months' ? 6 : 12
      for (let i = 0; i < months; i++) {
        const date = format(subMonths(endDate, months - 1 - i), 'yyyy-MM')
        monthMap.set(date, 0)
      }

      typedPayments.forEach((payment) => {
        const month = payment.month
        if (monthMap.has(month)) {
          monthMap.set(month, (monthMap.get(month) || 0) + (payment.amount || 0))
        }
      })

      const monthlyTrend = Array.from(monthMap.entries()).map(([month, earnings]) => ({
        month: format(new Date(month + '-01'), 'MMM yyyy'),
        earnings,
      }))

      // Individual earnings
      const userMap = new Map<string, { name: string; email: string; amount: number; meals: number }>()
      typedPayments.forEach((payment) => {
        const userId = payment.user_id
        const existing = userMap.get(userId)
        if (existing) {
          existing.amount += payment.amount || 0
          existing.meals += payment.meal_count || 0
        } else {
          userMap.set(userId, {
            name: payment.profile?.full_name || 'Unknown',
            email: payment.profile?.email || '',
            amount: payment.amount || 0,
            meals: payment.meal_count || 0,
          })
        }
      })

      const individualEarnings = Array.from(userMap.values())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10)

      setEarningsData({
        totalEarnings,
        monthlyEarnings,
        yearlyEarnings,
        monthlyTrend,
        individualEarnings,
      })
    } catch (error) {
      console.error('Error fetching earnings data:', error)
    }
  }

  const handleGenerateReport = async () => {
    if (!exportStartDate || !exportEndDate) return toast.error('Please select both dates')
    setIsGenerating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch(`/api/admin/reports/export?startDate=${exportStartDate}&endDate=${exportEndDate}&type=summary`, {
        headers: { 'Authorization': `Bearer ${session?.access_token}` }
      })
      if (!response.ok) throw new Error('Failed to generate report')
      const result = await response.json()
      setExportData(result.data || [])
      toast.success('Report generated! You can now export.')
    } catch (err) {
      console.error(err)
      toast.error('Error generating report')
    } finally {
      setIsGenerating(false)
    }
  }

  const doExportPDF = () => {
    if (!exportData.length) return toast.error('Generate report first')
    exportToPDF(exportData, { filename: `MealReport_${exportStartDate}_to_${exportEndDate}`, title: 'Meal System Summary Report' })
  }

  const doExportExcel = () => {
    if (!exportData.length) return toast.error('Generate report first')
    exportToExcel(exportData, { filename: `MealReport_${exportStartDate}_to_${exportEndDate}` })
  }

  if (isLoading) {
    return <Loading fullScreen text="Loading reports..." />
  }

  return (
    <div className="space-y-6">
      {/* Header and Export Controls */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500">Analytics, insights, and exports</p>
        </div>

        {/* Export Section */}
        <div className="flex flex-wrap items-end gap-3 bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
          <div>
            <label className="text-xs text-gray-500 block mb-1">From</label>
            <input type="date" className="border border-gray-300 rounded px-2 py-1.5 text-sm" value={exportStartDate} onChange={e => setExportStartDate(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">To</label>
            <input type="date" className="border border-gray-300 rounded px-2 py-1.5 text-sm" value={exportEndDate} onChange={e => setExportEndDate(e.target.value)} />
          </div>
          <Button variant="primary" size="sm" onClick={handleGenerateReport} disabled={isGenerating}>
            {isGenerating ? 'Generating...' : 'Generate Report'}
          </Button>
          <Button variant="danger" size="sm" onClick={doExportPDF} disabled={!exportData.length} className="bg-red-500 hover:bg-red-600">
            <FileText className="h-4 w-4 mr-1" /> Export PDF
          </Button>
          <Button variant="success" size="sm" onClick={doExportExcel} disabled={!exportData.length} className="bg-green-600 hover:bg-green-700 text-white border-transparent">
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Export Excel
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Select
          options={[
            { value: 'week', label: 'Last 7 days' },
            { value: 'month', label: 'Last 30 days' },
          ]}
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as 'week' | 'month')}
          className="w-40"
        />
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bookings Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Bookings Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <BarChart data={bookingsByDate}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Booking Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <PieChart>
                  <Pie
                    data={statusDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {statusDistribution.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name.toLowerCase()] || '#6B7280'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Bookings by Department */}
        <Card>
          <CardHeader>
            <CardTitle>Bookings by Department</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <BarChart data={departmentStats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="department" type="category" tick={{ fontSize: 12 }} width={100} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {
                      departmentStats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.department === 'School' ? '#3B82F6' : '#8B5CF6'} />
                      ))
                    }
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Most Popular Meals */}
        <Card>
          <CardHeader>
            <CardTitle>Most Popular Meals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <BarChart data={mealPopularity} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 12 }} width={120} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E7EB',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" fill="#F59E0B" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Earnings Analytics Section */}
      <div className="border-t border-gray-200 pt-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Earnings Analytics</h2>
            <p className="text-gray-500">Revenue and payment insights</p>
          </div>
          <Select
            options={[
              { value: '6months', label: 'Last 6 Months' },
              { value: '1year', label: 'Last 1 Year' },
            ]}
            value={earningsTimeRange}
            onChange={(e) => setEarningsTimeRange(e.target.value as '6months' | '1year')}
            className="w-40"
          />
        </div>

        {/* Earnings Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="py-4">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">Total Earnings</p>
                <p className="text-3xl font-bold text-gray-900">৳{earningsData.totalEarnings.toFixed(0)}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {earningsTimeRange === '6months' ? 'Last 6 months' : 'Last 12 months'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">This Month</p>
                <p className="text-3xl font-bold text-green-600">৳{earningsData.monthlyEarnings.toFixed(0)}</p>
                <p className="text-xs text-gray-500 mt-1">{format(new Date(), 'MMMM yyyy')}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="text-center">
                <p className="text-sm text-gray-500 mb-1">Average Monthly</p>
                <p className="text-3xl font-bold text-blue-600">
                  ৳{earningsData.monthlyTrend.length > 0 
                    ? (earningsData.totalEarnings / earningsData.monthlyTrend.length).toFixed(0) 
                    : 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">Per month average</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monthly Trend Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Earnings Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                  <LineChart data={earningsData.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #E5E7EB',
                        borderRadius: '8px',
                      }}
                      formatter={(value) => [`৳${Number(value).toFixed(0)}`, 'Earnings']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="earnings" 
                      stroke="#10B981" 
                      strokeWidth={2}
                      dot={{ fill: '#10B981', r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Top Users by Spending */}
          <Card>
            <CardHeader>
              <CardTitle>Top Users by Spending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-3 py-2 text-left text-sm font-medium text-gray-500">User</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-500">Meals</th>
                      <th className="px-3 py-2 text-right text-sm font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {earningsData.individualEarnings.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-4 text-center text-gray-500 text-sm">
                          No payment data available
                        </td>
                      </tr>
                    ) : (
                      earningsData.individualEarnings.map((user, index) => (
                        <tr key={index} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900 text-sm">{user.name}</p>
                            <p className="text-xs text-gray-500">{user.email}</p>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{user.meals}</td>
                          <td className="px-3 py-2 text-right font-medium text-green-600">
                            ৳{user.amount.toFixed(0)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Booking Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-3xl font-bold text-gray-900">
                {bookingsByDate.reduce((sum, d) => sum + d.count, 0)}
              </p>
              <p className="text-sm text-gray-500">Total Bookings</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <p className="text-3xl font-bold text-green-600">
                {statusDistribution.find((s) => s.name === 'Confirmed')?.value || 0}
              </p>
              <p className="text-sm text-gray-500">Confirmed</p>
            </div>
            <div className="text-center p-4 bg-yellow-50 rounded-lg">
              <p className="text-3xl font-bold text-yellow-600">
                {statusDistribution.find((s) => s.name === 'Pending')?.value || 0}
              </p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
            <div className="text-center p-4 bg-red-50 rounded-lg">
              <p className="text-3xl font-bold text-red-600">
                {(statusDistribution.find((s) => s.name === 'Cancelled')?.value || 0) +
                  (statusDistribution.find((s) => s.name === 'Denied')?.value || 0)}
              </p>
              <p className="text-sm text-gray-500">Cancelled/Denied</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default ReportsPage
