import { useState, useEffect } from 'react'
import { format, parseISO } from 'date-fns'
import { 
  UtensilsCrossed, 
  Calendar, 
  Clock, 
  DollarSign,
  User,
  Users,
  Filter, 
  Download,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { Card, CardContent, Button, Input, Select, Badge } from '../components/ui'
import { useTranslation } from '../hooks/useTranslation'
import toast from 'react-hot-toast'

interface MealHistoryItem {
  id: string
  status: 'pending' | 'confirmed' | 'denied' | 'cancelled'
  notes: string | null
  booked_at: string
  updated_at: string
  user?: {
    id: string
    full_name: string
    email: string
    department: string | null
  }
  meal: {
    id: string
    name: string
    description: string | null
    meal_type: string
    image_url: string | null
  }
  schedule: {
    id: string
    scheduled_date: string
    time_slot: string
    price: number | null
  }
}

interface GuestMealItem {
  id: string
  guest_name: string
  department: string
  meal_date: string
  time_slot: string
  quantity: number
  notes: string | null
  status: string
  created_at: string
  meal: { name: string, price: number | null } | null
  creator: { full_name: string } | null
}

export function MealHistoryPage() {
  const { t, language } = useTranslation()
  const [history, setHistory] = useState<MealHistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'regular' | 'guest'>('regular')
  const [guestHistory, setGuestHistory] = useState<GuestMealItem[]>([])
  const [isGuestLoading, setIsGuestLoading] = useState(false)
  const itemsPerPage = 10
  
  // Currency symbol based on language
  const currencySymbol = language === 'bn' ? t('currencyBDT') : t('currency')

  useEffect(() => {
    fetchHistory()
  }, [startDate, endDate, statusFilter])

  const fetchHistory = async () => {
    setIsLoading(true)
    try {
      const { data: session } = await supabase.auth.getSession()
      if (!session.session) {
        toast.error(t('signInFailed'))
        return
      }

      const params = new URLSearchParams()
      if (startDate) params.append('startDate', startDate)
      if (endDate) params.append('endDate', endDate)
      if (statusFilter !== 'all') params.append('status', statusFilter)

      const response = await fetch(`/api/bookings/history?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${session.session.access_token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch meal history')
      }

      const result = await response.json()
      setHistory(result.data || [])
      setIsAdmin(result.isAdmin)
      
      if (result.isAdmin) {
        fetchGuestHistory(session.session.access_token)
      }
    } catch (error) {
      console.error('Error fetching history:', error)
      toast.error(t('error'))
    } finally {
      setIsLoading(false)
    }
  }

  const fetchGuestHistory = async (token: string) => {
    setIsGuestLoading(true)
    try {
      const response = await fetch('/api/admin/guest-meals', {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (response.ok) {
        const data = await response.json()
        setGuestHistory(data || [])
      }
    } catch (err) {
      console.error('Failed to fetch guest meals', err)
    } finally {
      setIsGuestLoading(false)
    }
  }

  const removeGuestMeal = async (id: string) => {
    if (!window.confirm('Are you sure you want to remove this guest meal?')) return
    try {
      const { data: session } = await supabase.auth.getSession()
      const response = await fetch(`/api/admin/guest-meals?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.session?.access_token}` }
      })
      if (response.ok) {
        toast.success('Guest meal removed')
        setGuestHistory(prev => prev.filter(g => g.id !== id))
      } else {
        toast.error('Failed to remove guest meal')
      }
    } catch (err) {
      toast.error('Failed to remove guest meal')
    }
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; labelKey: string }> = {
      confirmed: { variant: 'success', labelKey: 'confirmed' },
      pending: { variant: 'warning', labelKey: 'pending' },
      denied: { variant: 'danger', labelKey: 'denied' },
      cancelled: { variant: 'default', labelKey: 'cancelled' }
    }
    const config = variants[status] || { variant: 'default', labelKey: status }
    return <Badge variant={config.variant}>{t(config.labelKey)}</Badge>
  }

  const filteredHistory = history.filter(item => {
    if (searchQuery && isAdmin) {
      const query = searchQuery.toLowerCase()
      return (
        item.user?.full_name?.toLowerCase().includes(query) ||
        item.user?.email?.toLowerCase().includes(query) ||
        item.meal?.name?.toLowerCase().includes(query)
      )
    }
    return true
  })

  const paginatedHistory = filteredHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )

  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage)

  const totalSpent = filteredHistory
    .filter(item => item.status === 'confirmed')
    .reduce((sum, item) => sum + (item.schedule?.price || 0), 0)

  const totalMeals = filteredHistory.filter(item => item.status === 'confirmed').length

  const handleExport = () => {
    const csv = [
      [t('date'), t('time'), t('meal'), t('user'), t('department2'), t('status'), t('price2')].join(','),
      ...filteredHistory.map(item => [
        item.schedule?.scheduled_date,
        item.schedule?.time_slot,
        item.meal?.name,
        item.user?.full_name || t('you'),
        item.user?.department || '-',
        item.status,
        item.schedule?.price || 0
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `meal-history-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('exportCSV'))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('mealHistory')}</h1>
          <p className="text-gray-600 mt-1">
            {isAdmin ? t('viewAllMealHistory') : t('viewOwnMealHistory')}
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} className="flex items-center gap-2">
          <Download className="h-4 w-4" />
          {t('exportCSV')}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <UtensilsCrossed className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{totalMeals}</p>
              <p className="text-sm text-gray-500">{t('totalMeals')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{currencySymbol}{totalSpent.toFixed(2)}</p>
              <p className="text-sm text-gray-500">{t('totalSpent')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="h-12 w-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Calendar className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{filteredHistory.length}</p>
              <p className="text-sm text-gray-500">{t('totalBookings')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => { setActiveTab('regular'); setCurrentPage(1); }}
          className={`py-3 px-6 text-sm font-medium border-b-2 ${
            activeTab === 'regular'
              ? 'border-primary-600 text-primary-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          {isAdmin ? 'Regular Bookings' : 'My Bookings'}
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab('guest')}
            className={`py-3 px-6 text-sm font-medium border-b-2 ${
              activeTab === 'guest'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Guest Meals
          </button>
        )}
      </div>

      {/* Filters */}
      {activeTab === 'regular' && (
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex gap-2 items-center">
              <Filter className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">{t('filters')}:</span>
            </div>
            
            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('from')}</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('to')}</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500 block mb-1">{t('status')}</label>
              <Select
                options={[
                  { value: 'all', label: t('allStatus') },
                  { value: 'confirmed', label: t('confirmed') },
                  { value: 'pending', label: t('pending') },
                  { value: 'denied', label: t('denied') },
                  { value: 'cancelled', label: t('cancelled') }
                ]}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-40"
              />
            </div>

            {isAdmin && (
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-gray-500 block mb-1">{t('search')}</label>
                <Input
                  type="text"
                  placeholder={t('search')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      )}

      {/* History Table */}
      {activeTab === 'regular' ? (
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary-600 border-t-transparent rounded-full mx-auto" />
              <p className="mt-2 text-gray-600">{t('loading')}</p>
            </div>
          ) : paginatedHistory.length === 0 ? (
            <div className="p-8 text-center">
              <UtensilsCrossed className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">{t('noMealHistory')}</p>
              <p className="text-sm text-gray-500 mt-1">
                {startDate || endDate || statusFilter !== 'all' 
                  ? t('tryAdjustingFilters')
                  : isAdmin ? t('noBookingsInSystem') : t('noBookingsYet')}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">{t('date')} & {t('time')}</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">{t('meal')}</th>
                      {isAdmin && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">{t('user')}</th>
                      )}
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">{t('status')}</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">{t('price2')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-gray-500" />
                            <span className="text-sm text-gray-900">
                              {item.schedule?.scheduled_date 
                                ? format(parseISO(item.schedule.scheduled_date), 'MMM d, yyyy')
                                : '-'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <Clock className="h-4 w-4 text-gray-500" />
                            <span className="text-sm text-gray-600">
                              {item.schedule?.time_slot}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            {item.meal?.image_url ? (
                              <img 
                                src={item.meal.image_url} 
                                alt={item.meal.name}
                                className="h-10 w-10 rounded-lg object-cover"
                              />
                            ) : (
                              <div className="h-10 w-10 bg-gray-100 rounded-lg flex items-center justify-center">
                                <UtensilsCrossed className="h-5 w-5 text-gray-500" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {item.meal?.name || t('unknown')}
                              </p>
                              <p className="text-xs text-gray-500">
                                {item.meal?.meal_type}
                              </p>
                            </div>
                          </div>
                        </td>
                        {isAdmin && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-gray-500" />
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {item.user?.full_name || t('unknown')}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {item.user?.department || t('noDepartment')}
                                </p>
                              </div>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3">
                          {getStatusBadge(item.status)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <p className="text-sm font-medium text-gray-900">
                            {currencySymbol}{item.schedule?.price?.toFixed(2) || '0.00'}
                          </p>
                          <p className="text-xs text-gray-500">
                            {format(parseISO(item.booked_at), 'MMM d, HH:mm')}
                          </p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
                  <p className="text-sm text-gray-600">
                    {t('showing')} {(currentPage - 1) * itemsPerPage + 1} {t('to2')} {Math.min(currentPage * itemsPerPage, filteredHistory.length)} {t('of')} {filteredHistory.length}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
      ) : (
      <Card>
        <CardContent className="p-0">
          {isGuestLoading ? (
            <div className="p-8 text-center text-gray-500">Loading guest meals...</div>
          ) : guestHistory.length === 0 ? (
            <div className="p-8 text-center">
              <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">No guest meals recorded yet.</p>
              <p className="text-sm text-gray-500 mt-1">Add guest meals from Booking Management.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Guest Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Department</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Meal</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Date & Time</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Qty</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600">Added By</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {guestHistory.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{item.guest_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{item.department}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.meal?.name || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.meal_date && format(parseISO(item.meal_date), 'MMM d, yyyy')} <br/>
                        <span className="text-xs text-gray-400">{item.time_slot}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">{item.quantity}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {item.creator?.full_name || '-'}
                        {item.notes && <div className="text-xs text-gray-400 mt-1">Note: {item.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="danger" size="sm" onClick={() => removeGuestMeal(item.id)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  )
}

export default MealHistoryPage
