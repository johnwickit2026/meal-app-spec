import { useEffect, useState } from 'react'
import { Plus, Edit, Trash2, Calendar, UtensilsCrossed } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Select, Loading, Modal, MealImageUpload } from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import type { Meal, MenuSchedule } from '../../types'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { formatTime } from '../../lib/utils'
import toast from 'react-hot-toast'

const mealSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  description: z.string().optional(),
  meal_type: z.enum(['breakfast', 'lunch', 'afternoon_snack', 'evening_snack', 'dinner']),
  image_url: z.string().url().optional().or(z.literal('')),
  price: z.number().min(0, 'Price must be 0 or more').default(0),
})

type MealForm = z.infer<typeof mealSchema>
type ScheduleFormInput = { meal_id: string; scheduled_date: string; time_slot: string; capacity: number; ordering_deadline_hours: number; price: number | null }

export function MenuManagementPage() {
  const [meals, setMeals] = useState<Meal[]>([])
  const [schedules, setSchedules] = useState<(MenuSchedule & { meal: Meal })[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isMealModalOpen, setIsMealModalOpen] = useState(false)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null)
  const [editingSchedule, setEditingSchedule] = useState<(MenuSchedule & { meal: Meal }) | null>(null)
  const [activeTab, setActiveTab] = useState<'meals' | 'schedules'>('meals')
  const [timeFilter, setTimeFilter] = useState<string>('all')

  const mealForm = useForm({
    resolver: zodResolver(mealSchema),
    defaultValues: { meal_type: 'lunch', price: 0 },
  })

  const scheduleForm = useForm<ScheduleFormInput>({
    defaultValues: { capacity: 10, ordering_deadline_hours: 1, price: null },
  })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [mealsResult, schedulesResult] = await Promise.all([
        supabase.from('meals').select('*').order('name'),
        supabase
          .from('menu_schedules')
          .select('*, meal:meals(*)')
          .gte('scheduled_date', format(new Date(), 'yyyy-MM-dd'))
          .order('scheduled_date')
          .order('time_slot'),
      ])

      if (mealsResult.data) setMeals(mealsResult.data as Meal[])
      if (schedulesResult.data) setSchedules(schedulesResult.data as (MenuSchedule & { meal: Meal })[])
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateMeal = async (data: MealForm) => {
    try {
      const { error } = await supabase.from('meals').insert({
        name: data.name,
        description: data.description || null,
        meal_type: data.meal_type,
        image_url: data.image_url || null,
        price: data.price || 0,
      })

      if (error) throw error

      toast.success('Meal created successfully')
      setIsMealModalOpen(false)
      mealForm.reset()
      fetchData()
    } catch (error) {
      toast.error('Failed to create meal')
    }
  }

  const handleUpdateMeal = async (data: MealForm) => {
    if (!editingMeal) return

    try {
      const { error } = await supabase
        .from('meals')
        .update({
          name: data.name,
          description: data.description || null,
          meal_type: data.meal_type,
          image_url: data.image_url || null,
          price: data.price || 0,
        })
        .eq('id', editingMeal.id)

      if (error) throw error

      toast.success('Meal updated successfully')
      setIsMealModalOpen(false)
      setEditingMeal(null)
      mealForm.reset()
      fetchData()
    } catch (error) {
      toast.error('Failed to update meal')
    }
  }

  const handleDeleteMeal = async (id: string) => {
    if (!confirm('Are you sure you want to delete this meal?')) return

    try {
      const { error } = await supabase.from('meals').delete().eq('id', id)
      if (error) throw error
      toast.success('Meal deleted')
      fetchData()
    } catch (error) {
      toast.error('Failed to delete meal')
    }
  }

  const handleCreateSchedule = async (data: ScheduleFormInput) => {
    try {
      const { error } = await supabase.from('menu_schedules').insert({
        meal_id: data.meal_id,
        scheduled_date: data.scheduled_date,
        time_slot: data.time_slot,
        capacity: data.capacity,
        ordering_deadline_hours: data.ordering_deadline_hours ?? 1,
        price: data.price,
      })

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      toast.success('Schedule created successfully')
      setIsScheduleModalOpen(false)
      scheduleForm.reset()
      fetchData()
    } catch (error) {
      console.error('Error creating schedule:', error)
      toast.error('Failed to create schedule')
    }
  }

  const handleUpdateSchedule = async (data: ScheduleFormInput) => {
    if (!editingSchedule) return

    try {
      const { error } = await supabase
        .from('menu_schedules')
        .update({
          meal_id: data.meal_id,
          scheduled_date: data.scheduled_date,
          time_slot: data.time_slot,
          capacity: data.capacity,
          ordering_deadline_hours: data.ordering_deadline_hours ?? 1,
          price: data.price,
        })
        .eq('id', editingSchedule.id)

      if (error) throw error

      toast.success('Schedule updated successfully')
      setIsScheduleModalOpen(false)
      setEditingSchedule(null)
      scheduleForm.reset()
      fetchData()
    } catch (error) {
      toast.error('Failed to update schedule')
    }
  }

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return

    try {
      const { error } = await supabase.from('menu_schedules').delete().eq('id', id)
      if (error) throw error
      toast.success('Schedule deleted')
      fetchData()
    } catch (error) {
      toast.error('Failed to delete schedule')
    }
  }

  const openEditMeal = (meal: Meal) => {
    setEditingMeal(meal)
    mealForm.reset({
      name: meal.name,
      description: meal.description || '',
      meal_type: meal.meal_type,
      image_url: meal.image_url || '',
      price: meal.price || 0,
    })
    setIsMealModalOpen(true)
  }

  const openEditSchedule = (schedule: MenuSchedule & { meal: Meal }) => {
    setEditingSchedule(schedule)
    scheduleForm.reset({
      meal_id: schedule.meal_id,
      scheduled_date: schedule.scheduled_date,
      time_slot: schedule.time_slot,
      capacity: schedule.capacity,
      ordering_deadline_hours: schedule.ordering_deadline_hours ?? 1,
      price: schedule.price,
    })
    setIsScheduleModalOpen(true)
  }

  if (isLoading) {
    return <Loading fullScreen text="Loading menu data..." />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Menu Management</h1>
          <p className="text-gray-500">Manage meals and schedules</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('meals')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'meals'
              ? 'text-primary-600 border-primary-600'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          }`}
        >
          Meals
        </button>
        <button
          onClick={() => setActiveTab('schedules')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'schedules'
              ? 'text-primary-600 border-primary-600'
              : 'text-gray-500 border-transparent hover:text-gray-700'
          }`}
        >
          Schedules
        </button>
      </div>

      {/* Meals Tab */}
      {activeTab === 'meals' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Meals</CardTitle>
            <Button
              onClick={() => {
                setEditingMeal(null)
                mealForm.reset({ meal_type: 'lunch', price: 0 })
                setIsMealModalOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Meal
            </Button>
          </CardHeader>
          <CardContent>
            {meals.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <UtensilsCrossed className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No meals found. Create your first meal!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Name</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Type</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Price</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {meals.map((meal) => (
                      <tr key={meal.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 flex items-center gap-3">
                          {meal.image_url ? (
                            <img 
                              src={meal.image_url} 
                              alt={meal.name} 
                              className="h-10 w-10 rounded-md object-cover flex-shrink-0"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-md bg-gray-100 flex items-center justify-center flex-shrink-0">
                              <UtensilsCrossed className="h-5 w-5 text-gray-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{meal.name}</p>
                            {meal.description && (
                              <p className="text-sm text-gray-500 truncate max-w-xs">{meal.description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 capitalize text-gray-600">{meal.meal_type}</td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {meal.price > 0 ? `৳${meal.price}` : <span className="text-gray-500">Free</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              meal.is_active
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {meal.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditMeal(meal)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteMeal(meal.id)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
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
      )}

      {/* Schedules Tab */}
      {activeTab === 'schedules' && (
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle>Upcoming Schedules</CardTitle>
            <div className="flex items-center gap-2">
              <Select
                className="w-40"
                value={timeFilter}
                onChange={(e) => setTimeFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All times' },
                  ...Array.from(new Set(schedules.map((s) => s.time_slot)))
                    .sort()
                    .map((t) => ({ value: t, label: formatTime(t) })),
                ]}
              />
              <Button onClick={() => {
                setEditingSchedule(null)
                scheduleForm.reset({ capacity: 10, ordering_deadline_hours: 1, price: null })
                setIsScheduleModalOpen(true)
              }}>
                <Plus className="h-4 w-4 mr-2" />
                Add Schedule
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {schedules.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p>No schedules found. Create your first schedule!</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Meal</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Time</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Capacity</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Price</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {schedules
                      .filter((s) => timeFilter === 'all' || s.time_slot === timeFilter)
                      .map((schedule) => (
                      <tr key={schedule.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{schedule.meal?.name}</p>
                          <p className="text-sm text-gray-500 capitalize">{schedule.meal?.meal_type}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {format(new Date(schedule.scheduled_date), 'MMM d, yyyy')}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatTime(schedule.time_slot)}</td>
                        <td className="px-4 py-3 text-gray-600">{schedule.capacity}</td>
                        <td className="px-4 py-3 text-gray-600">
                          {schedule.price ? `৳${schedule.price}` : (schedule.meal?.price ? `৳${schedule.meal.price}` : 'Free')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditSchedule(schedule)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDeleteSchedule(schedule.id)}>
                              <Trash2 className="h-4 w-4 text-red-500" />
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
      )}

      {/* Meal Modal */}
      <Modal
        isOpen={isMealModalOpen}
        onClose={() => {
          setIsMealModalOpen(false)
          setEditingMeal(null)
        }}
        title={editingMeal ? 'Edit Meal' : 'Create Meal'}
        size="md"
      >
        <form onSubmit={mealForm.handleSubmit(editingMeal ? handleUpdateMeal : handleCreateMeal)}>
          <div className="px-6 py-4 space-y-4">
            <Input
              label="Meal Name"
              error={mealForm.formState.errors.name?.message}
              {...mealForm.register('name')}
            />
            <Input
              label="Description"
              error={mealForm.formState.errors.description?.message}
              {...mealForm.register('description')}
            />
            <div className="grid grid-cols-2 gap-4">
              <Select
                label="Meal Type"
                options={[
                  { value: 'breakfast', label: 'Breakfast' },
                  { value: 'lunch', label: 'Lunch' },
                  { value: 'afternoon_snack', label: 'Afternoon Snack' },
                  { value: 'evening_snack', label: 'Evening Snack' },
                  { value: 'dinner', label: 'Dinner' },
                ]}
                {...mealForm.register('meal_type')}
              />
              <Input
                label="Price (৳)"
                type="number"
                min={0}
                step={0.01}
                placeholder="0"
                error={mealForm.formState.errors.price?.message}
                {...mealForm.register('price', { valueAsNumber: true })}
              />
            </div>
            <MealImageUpload
              currentUrl={mealForm.watch('image_url')}
              onUpload={(url) => mealForm.setValue('image_url', url, { shouldValidate: true, shouldDirty: true })}
            />
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <Button type="button" variant="secondary" onClick={() => setIsMealModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{editingMeal ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      {/* Schedule Modal */}
      <Modal
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false)
          setEditingSchedule(null)
        }}
        title={editingSchedule ? 'Edit Schedule' : 'Create Schedule'}
        size="md"
      >
        <form onSubmit={scheduleForm.handleSubmit(editingSchedule ? handleUpdateSchedule : handleCreateSchedule)}>
          <div className="px-6 py-4 space-y-4">
            <Select
              label="Meal"
              options={[
                { value: '', label: 'Select a meal' },
                ...meals.map((m) => ({ value: m.id, label: `${m.name} (${m.meal_type})` })),
              ]}
              error={scheduleForm.formState.errors.meal_id?.message}
              {...scheduleForm.register('meal_id')}
            />
            <Input
              label="Date"
              type="date"
              min={format(new Date(), 'yyyy-MM-dd')}
              error={scheduleForm.formState.errors.scheduled_date?.message}
              {...scheduleForm.register('scheduled_date')}
            />
            <Input
              label="Time Slot"
              type="time"
              error={scheduleForm.formState.errors.time_slot?.message}
              {...scheduleForm.register('time_slot')}
            />
            <Input
              label="Capacity"
              type="number"
              min={1}
              error={scheduleForm.formState.errors.capacity?.message}
              {...scheduleForm.register('capacity', { valueAsNumber: true })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Order deadline (hours before meal)"
                type="number"
                min={0}
                placeholder="1"
                error={scheduleForm.formState.errors.ordering_deadline_hours?.message}
                {...scheduleForm.register('ordering_deadline_hours', { valueAsNumber: true })}
              />
              <Input
                label="Price (৳) - Optional"
                type="number"
                min={0}
                step={0.01}
                placeholder="Use meal default"
                error={scheduleForm.formState.errors.price?.message}
                {...scheduleForm.register('price', { 
                  valueAsNumber: true,
                  setValueAs: (v) => v === '' ? null : parseFloat(v)
                })}
              />
            </div>
            <div className="text-sm text-gray-500">
              e.g. Enter {scheduleForm.watch('ordering_deadline_hours') || 1} to close orders {scheduleForm.watch('ordering_deadline_hours') || 1} hours before meal time.
              {scheduleForm.watch('price') ? ` • Custom price: ৳${scheduleForm.watch('price')}` : ' • Uses meal default price'}
            </div>
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <Button type="button" variant="secondary" onClick={() => setIsScheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">{editingSchedule ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default MenuManagementPage
