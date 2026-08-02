import { useEffect, useState } from 'react'
import { format, addDays, subDays } from 'date-fns'
import { ChevronLeft, ChevronRight, UtensilsCrossed } from 'lucide-react'
import { useAuthStore, useMenuStore, useBookingStore } from '../../store'
import { Card, Button, Select, CardSkeleton } from '../../components/ui'
import { useTranslation } from '../../hooks/useTranslation'
import { MealCard } from '../../components/employee'
import { Modal } from '../../components/ui/Modal'
import { formatTime } from '../../lib/utils'
import toast from 'react-hot-toast'

export function MenuPage() {
  const { user } = useAuthStore()
  const { schedules, fetchSchedules, isLoading } = useMenuStore()
  const { createBooking, bookings, fetchUserBookings } = useBookingStore()
  const { t } = useTranslation()
  
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [mealTypeFilter, setMealTypeFilter] = useState<string>('all')
  const [timeFilter, setTimeFilter] = useState<string>('all')
  const [bookingScheduleId, setBookingScheduleId] = useState<string | null>(null)
  const [bookingQuantity, setBookingQuantity] = useState<number>(1)
  const [isBooking, setIsBooking] = useState(false)

  const formattedDate = format(selectedDate, 'yyyy-MM-dd')

  useEffect(() => {
    fetchSchedules(formattedDate)
    if (user) {
      fetchUserBookings(user.id)
    }
  }, [formattedDate, fetchSchedules, user, fetchUserBookings])

  const handlePrevDay = () => setSelectedDate(subDays(selectedDate, 1))
  const handleNextDay = () => setSelectedDate(addDays(selectedDate, 1))
  const handleToday = () => setSelectedDate(new Date())

  const handleBookMeal = async () => {
    if (!bookingScheduleId || !user) return

    setIsBooking(true)
    const result = await createBooking(bookingScheduleId, user.id, undefined, bookingQuantity)
    
    if (result.error) {
      toast.error(result.error.message)
    } else {
      toast.success(`Booked ${bookingQuantity} portion${bookingQuantity > 1 ? 's' : ''} successfully!`)
      fetchSchedules(formattedDate)
    }
    
    setIsBooking(false)
    setBookingScheduleId(null)
    setBookingQuantity(1)
  }

  const handleCloseBooking = () => {
    setBookingScheduleId(null)
    setBookingQuantity(1)
  }

  // Get selected schedule details for the dialog
  const selectedSchedule = schedules.find(s => s.id === bookingScheduleId)

  const timeOptions = Array.from(new Set(schedules.map((s) => s.time_slot))).sort()

  const filteredSchedules = schedules.filter((schedule) => {
    const matchesType = mealTypeFilter === 'all' || schedule.meal?.meal_type === mealTypeFilter
    const matchesTime = timeFilter === 'all' || schedule.time_slot === timeFilter
    return matchesType && matchesTime
  })

  const breakfastSchedules = filteredSchedules.filter((s) => s.meal?.meal_type === 'breakfast')
  const lunchSchedules = filteredSchedules.filter((s) => s.meal?.meal_type === 'lunch')
  const afternoonSnackSchedules = filteredSchedules.filter((s) => s.meal?.meal_type === 'afternoon_snack')
  const eveningSnackSchedules = filteredSchedules.filter((s) => s.meal?.meal_type === 'evening_snack')
  const dinnerSchedules = filteredSchedules.filter((s) => s.meal?.meal_type === 'dinner')

  // Check if user has booking at specific time slot
  const getUserBookingAtSlot = (date: string, timeSlot: string) => {
    return bookings.find(
      (b) =>
        b.menu_schedule?.scheduled_date === date &&
        b.menu_schedule?.time_slot === timeSlot &&
        (b.status === 'pending' || b.status === 'confirmed')
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('menu')}</h1>
          <p className="text-gray-500">Browse and book your meals</p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select
            options={[
              { value: 'all', label: t('all') },
              { value: 'breakfast', label: t('breakfast') },
              { value: 'lunch', label: t('lunch') },
              { value: 'afternoon_snack', label: t('Afternoon snack') },
              { value: 'evening_snack', label: t('Evening snack') },
              { value: 'dinner', label: t('dinner') },
            ]}
            value={mealTypeFilter}
            onChange={(e) => setMealTypeFilter(e.target.value)}
            className="w-40"
          />
          <Select
            options={[
              { value: 'all', label: 'All times' },
              ...timeOptions.map((tm) => ({ value: tm, label: formatTime(tm) })),
            ]}
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* Date Navigation */}
      <Card>
        <div className="flex items-center justify-between p-4">
          <Button variant="ghost" onClick={handlePrevDay}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <div className="text-center">
            <h2 className="text-lg font-semibold text-gray-900">
              {format(selectedDate, 'EEEE, MMMM d, yyyy')}
            </h2>
            {format(selectedDate, 'yyyy-MM-dd') !== format(new Date(), 'yyyy-MM-dd') && (
              <button
                onClick={handleToday}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                {t('todayMenu')}
              </button>
            )}
          </div>

          <Button variant="ghost" onClick={handleNextDay}>
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </Card>

      {/* Menu Content */}
      {isLoading && schedules.length === 0 ? (
        <div className="space-y-8">
          {/* Breakfast Section Skeleton */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'breakfast') && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌅</span> Breakfast
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </section>
          )}
          {/* Lunch Section Skeleton */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'lunch') && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">☀️</span> Lunch
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </section>
          )}
          {/* Afternoon Snack Section Skeleton */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'afternoon_snack') && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🍵</span> Afternoon Snack
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </section>
          )}
          {/* Evening Snack Section Skeleton */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'evening_snack') && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌆</span> Evening Snack
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </section>
          )}
          {/* Dinner Section Skeleton */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'dinner') && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌙</span> Dinner
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </section>
          )}
        </div>
      ) : filteredSchedules.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <UtensilsCrossed className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">{t('noMealsAvailable')}</h3>
            <p className="text-gray-500 mt-1">
              {t('noMealsScheduled')}
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Breakfast Section */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'breakfast') && breakfastSchedules.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌅</span> Breakfast
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {breakfastSchedules.map((schedule) => {
                  const existingBooking = getUserBookingAtSlot(
                    schedule.scheduled_date,
                    schedule.time_slot
                  )
                  return (
                    <MealCard
                      key={schedule.id}
                      schedule={schedule}
                      onBook={(id) => setBookingScheduleId(id)}
                      userHasBooking={!!existingBooking}
                      userBookingQuantity={existingBooking?.quantity || 1}
                      orderingDeadlineHours={schedule.ordering_deadline_hours || 1}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Lunch Section */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'lunch') && lunchSchedules.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">☀️</span> Lunch
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {lunchSchedules.map((schedule) => {
                  const existingBooking = getUserBookingAtSlot(
                    schedule.scheduled_date,
                    schedule.time_slot
                  )
                  return (
                    <MealCard
                      key={schedule.id}
                      schedule={schedule}
                      onBook={(id) => setBookingScheduleId(id)}
                      userHasBooking={!!existingBooking}
                      userBookingQuantity={existingBooking?.quantity || 1}
                      orderingDeadlineHours={schedule.ordering_deadline_hours || 1}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Afternoon Snack Section */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'afternoon_snack') && afternoonSnackSchedules.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🍵</span> Afternoon Snack
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {afternoonSnackSchedules.map((schedule) => {
                  const existingBooking = getUserBookingAtSlot(
                    schedule.scheduled_date,
                    schedule.time_slot
                  )
                  return (
                    <MealCard
                      key={schedule.id}
                      schedule={schedule}
                      onBook={(id) => setBookingScheduleId(id)}
                      userHasBooking={!!existingBooking}
                      userBookingQuantity={existingBooking?.quantity || 1}
                      orderingDeadlineHours={schedule.ordering_deadline_hours || 1}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Evening Snack Section */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'evening_snack') && eveningSnackSchedules.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌆</span> Evening Snack
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {eveningSnackSchedules.map((schedule) => {
                  const existingBooking = getUserBookingAtSlot(
                    schedule.scheduled_date,
                    schedule.time_slot
                  )
                  return (
                    <MealCard
                      key={schedule.id}
                      schedule={schedule}
                      onBook={(id) => setBookingScheduleId(id)}
                      userHasBooking={!!existingBooking}
                      userBookingQuantity={existingBooking?.quantity || 1}
                      orderingDeadlineHours={schedule.ordering_deadline_hours || 1}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Dinner Section */}
          {(mealTypeFilter === 'all' || mealTypeFilter === 'dinner') && dinnerSchedules.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <span className="text-2xl">🌙</span> Dinner
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {dinnerSchedules.map((schedule) => {
                  const existingBooking = getUserBookingAtSlot(
                    schedule.scheduled_date,
                    schedule.time_slot
                  )
                  return (
                    <MealCard
                      key={schedule.id}
                      schedule={schedule}
                      onBook={(id) => setBookingScheduleId(id)}
                      userHasBooking={!!existingBooking}
                      userBookingQuantity={existingBooking?.quantity || 1}
                      orderingDeadlineHours={schedule.ordering_deadline_hours || 1}
                    />
                  )
                })}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Booking Confirmation Dialog with Quantity Selector */}
      <Modal
        isOpen={!!bookingScheduleId}
        onClose={handleCloseBooking}
        title={t('confirmBooking')}
        size="sm"
      >
        <div className="px-6 py-4 space-y-4">
          {/* Meal Info */}
          {selectedSchedule && (
            <div className="bg-primary-50 rounded-lg p-3">
              <p className="font-medium text-gray-900">{selectedSchedule.meal?.name}</p>
              <p className="text-sm text-gray-500">
                {selectedSchedule.scheduled_date} · {formatTime(selectedSchedule.time_slot)}
              </p>
            </div>
          )}

          {/* Quantity Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('quantity') || 'Quantity'}
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setBookingQuantity(Math.max(1, bookingQuantity - 1))}
                disabled={bookingQuantity <= 1 || isBooking}
                className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                -
              </button>
              <span className="w-12 text-center font-semibold text-lg">{bookingQuantity}</span>
              <button
                onClick={() => setBookingQuantity(Math.min(selectedSchedule?.remaining_capacity || 1, bookingQuantity + 1))}
                disabled={bookingQuantity >= (selectedSchedule?.remaining_capacity || 1) || isBooking}
                className="w-10 h-10 rounded-lg border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {selectedSchedule?.remaining_capacity !== undefined && (
                <>Available: {selectedSchedule.remaining_capacity} spots</>
              )}
            </p>
          </div>

          {/* Price Preview */}
          {selectedSchedule && (
            <div className="flex justify-between items-center pt-2 border-t border-gray-200">
              <span className="text-sm text-gray-600">{t('total') || 'Total'}</span>
              <span className="font-semibold text-primary-700">
                ৳{((selectedSchedule.price ?? selectedSchedule.meal?.price ?? 0) * bookingQuantity)}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button
            onClick={handleCloseBooking}
            disabled={isBooking}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            {t('cancel')}
          </button>
          <button
            onClick={handleBookMeal}
            disabled={isBooking}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-primary-600 hover:bg-primary-700 disabled:opacity-50"
          >
            {isBooking ? 'Booking...' : t('book')}
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default MenuPage
