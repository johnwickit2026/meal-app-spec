import { useState, useEffect } from 'react'
import { Plus, Calendar as CalendarIcon, Repeat, Play, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Modal, Select, Badge } from '../../components/ui'
import { supabase } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'
import type { MealRoutine, MealRoutineItem, Meal } from '../../types/database'

interface RoutineWithItems extends MealRoutine {
  items: (MealRoutineItem & { meal: Pick<Meal, 'name' | 'meal_type'> })[]
}

export default function MealRoutinePage() {
  const [routines, setRoutines] = useState<RoutineWithItems[]>([])
  const [meals, setMeals] = useState<Meal[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newRoutine, setNewRoutine] = useState({ name: '', description: '', routine_type: 'weekly' })
  const [newItems, setNewItems] = useState<Partial<MealRoutineItem>[]>([])

  // Apply Modal State
  const [isApplyOpen, setIsApplyOpen] = useState(false)
  const [selectedRoutine, setSelectedRoutine] = useState<RoutineWithItems | null>(null)
  const [applyForm, setApplyForm] = useState({ startDate: '', endDate: '', applyTo: 'both' })

  useEffect(() => {
    fetchRoutines()
    fetchMeals()
  }, [])

  const fetchRoutines = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/admin/routines', {
        headers: { 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch routines')
      const data = await response.json()
      setRoutines(data)
    } catch (error) {
      console.error(error)
      toast.error('Failed to load routines')
    } finally {
      setIsLoading(false)
    }
  }

  const fetchMeals = async () => {
    const { data } = await supabase.from('meals').select('*').eq('is_active', true)
    if (data) setMeals(data)
  }

  const handleCreateRoutine = async () => {
    if (!newRoutine.name) return toast.error('Routine name is required')
    
    try {
      const response = await fetch('/api/admin/routines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          name: newRoutine.name,
          description: newRoutine.description,
          routine_type: newRoutine.routine_type,
          items: newItems
        })
      })

      if (!response.ok) throw new Error('Failed to create routine')
      toast.success('Routine created successfully')
      setIsCreateOpen(false)
      setNewRoutine({ name: '', description: '', routine_type: 'weekly' })
      setNewItems([])
      fetchRoutines()
    } catch (error) {
      console.error(error)
      toast.error('Failed to create routine')
    }
  }

  const handleApplyRoutine = async () => {
    if (!selectedRoutine) return
    if (!applyForm.startDate || !applyForm.endDate) return toast.error('Start and end dates are required')

    try {
      const response = await fetch('/api/admin/routines/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({
          routineId: selectedRoutine.id,
          startDate: applyForm.startDate,
          endDate: applyForm.endDate,
          applyTo: applyForm.applyTo
        })
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Failed to apply routine')
      
      toast.success(`Successfully scheduled ${data.created?.employee || 0} employee meals and ${data.created?.student || 0} student meals`)
      setIsApplyOpen(false)
    } catch (error: any) {
      console.error(error)
      toast.error(error.message || 'Failed to apply routine')
    }
  }

  const addRoutineItem = (dayValue: number) => {
    const defaultTimeSlot = '12:00'
    setNewItems(prev => [
      ...prev,
      {
        meal_id: meals[0]?.id || '',
        day_of_week: newRoutine.routine_type === 'weekly' ? dayValue : undefined,
        day_of_month: newRoutine.routine_type === 'monthly' ? dayValue : undefined,
        time_slot: defaultTimeSlot,
        capacity: 10,
        ordering_deadline_hours: 1,
        meal_type: 'both',
        price: meals[0]?.price || 0
      }
    ])
  }

  const removeRoutineItem = (index: number) => {
    setNewItems(prev => prev.filter((_, i) => i !== index))
  }

  const updateRoutineItem = (index: number, field: string, value: any) => {
    setNewItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      if (field === 'meal_id') {
        const meal = meals.find(m => m.id === value)
        if (meal) updated[index].price = meal.price
      }
      return updated
    })
  }

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <div className="max-w-7xl mx-auto space-y-6 px-3 sm:px-4 lg:px-0">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meal Routines</h1>
          <p className="text-gray-500">Manage bulk meal schedules for weeks or months</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Create Routine
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {routines.map(routine => (
          <Card key={routine.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 border-b border-gray-100">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg">{routine.name}</CardTitle>
                  <p className="text-sm text-gray-500 line-clamp-1">{routine.description}</p>
                </div>
                <Badge variant={routine.routine_type === 'weekly' ? 'primary' : 'default'} className="capitalize">
                  {routine.routine_type}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center text-sm text-gray-600 gap-2">
                <CalendarIcon className="h-4 w-4" />
                {routine.items?.length || 0} meals configured
              </div>
              
              <div className="pt-2 flex gap-2">
                <Button 
                  variant="primary" 
                  className="flex-1 flex justify-center items-center gap-2"
                  onClick={() => { setSelectedRoutine(routine); setIsApplyOpen(true); }}
                >
                  <Play className="h-4 w-4" /> Apply Routine
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {routines.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <Repeat className="h-12 w-12 mx-auto text-gray-300 mb-3" />
            <p>No routines created yet.</p>
          </div>
        )}
      </div>

      {/* CREATE ROUTINE MODAL */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create Meal Routine" size="xl">
        <div className="space-y-6 px-4 sm:px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Routine Name</label>
              <Input value={newRoutine.name} onChange={e => setNewRoutine({...newRoutine, name: e.target.value})} placeholder="e.g., Summer Menu Plan" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Routine Type</label>
              <Select value={newRoutine.routine_type} onChange={e => { setNewRoutine({...newRoutine, routine_type: e.target.value}); setNewItems([]); }}>
                <option value="weekly">Weekly (Sunday to Saturday)</option>
                <option value="monthly">Monthly (1st to 31st)</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <Input value={newRoutine.description} onChange={e => setNewRoutine({...newRoutine, description: e.target.value})} placeholder="Optional details..." />
          </div>

          <div className="pt-4 border-t border-gray-200">
            <h3 className="font-semibold text-lg mb-4">Configure Meals</h3>
            
            {newRoutine.routine_type === 'weekly' ? (
              <div className="grid grid-cols-1 gap-6">
                {daysOfWeek.map((day, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-3">
                      <h4 className="font-medium text-gray-700">{day}</h4>
                      <Button variant="outline" size="sm" onClick={() => addRoutineItem(idx)}><Plus className="h-3 w-3 mr-1"/> Add Meal</Button>
                    </div>
                    <div className="space-y-3">
                      {newItems.map((item, itemIdx) => item.day_of_week === idx && (
                        <div key={itemIdx} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-3 rounded shadow-sm border border-gray-100">
                          <Select className="flex-1 w-full sm:w-auto" value={item.meal_id} onChange={e => updateRoutineItem(itemIdx, 'meal_id', e.target.value)}>
                            {meals.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </Select>
                          <div className="flex gap-2">
                            <Input type="time" className="flex-1 sm:w-32" value={item.time_slot} onChange={e => updateRoutineItem(itemIdx, 'time_slot', e.target.value)} />
                            <Select className="flex-1 sm:w-32" value={item.meal_type ?? 'both'} onChange={e => updateRoutineItem(itemIdx, 'meal_type', e.target.value)}>
                              <option value="both">Both</option>
                              <option value="employee">Employee</option>
                              <option value="student">Student</option>
                            </Select>
                            <Button variant="ghost" onClick={() => removeRoutineItem(itemIdx)} className="text-red-500 hover:bg-red-50 p-2 shrink-0"><Trash2 className="h-4 w-4"/></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 sm:gap-2">
                {Array.from({ length: 31 }).map((_, idx) => (
                  <div key={idx} className="p-1.5 sm:p-2 bg-gray-50 rounded border border-gray-200 text-center relative group min-h-[52px] sm:min-h-[60px] flex flex-col justify-between">
                    <span className="text-xs font-semibold text-gray-500">{idx + 1}</span>
                    <button 
                      onClick={() => addRoutineItem(idx + 1)}
                      className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/5 rounded transition-opacity"
                    >
                      <Plus className="h-4 w-4 text-primary-600" />
                    </button>
                    {newItems.filter(i => i.day_of_month === idx + 1).length > 0 && (
                      <div className="text-[10px] bg-primary-100 text-primary-700 rounded px-1 mt-1">
                        {newItems.filter(i => i.day_of_month === idx + 1).length} meals
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {newRoutine.routine_type === 'monthly' && newItems.length > 0 && (
              <div className="mt-6 space-y-3">
                <h4 className="font-medium text-gray-700">Monthly Meals Configured</h4>
                {newItems.map((item, itemIdx) => (
                  <div key={itemIdx} className="flex flex-col sm:flex-row sm:items-center gap-2 bg-white p-3 rounded shadow-sm border border-gray-200">
                    <div className="w-full sm:w-16 font-semibold text-gray-700 text-sm">Day {item.day_of_month}</div>
                    <Select className="flex-1 w-full sm:w-auto" value={item.meal_id} onChange={e => updateRoutineItem(itemIdx, 'meal_id', e.target.value)}>
                      {meals.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                    <div className="flex gap-2">
                      <Input type="time" className="flex-1 sm:w-32" value={item.time_slot} onChange={e => updateRoutineItem(itemIdx, 'time_slot', e.target.value)} />
                      <Select className="flex-1 sm:w-32" value={item.meal_type ?? 'both'} onChange={e => updateRoutineItem(itemIdx, 'meal_type', e.target.value)}>
                        <option value="both">Both</option>
                        <option value="employee">Employee</option>
                        <option value="student">Student</option>
                      </Select>
                      <Button variant="ghost" onClick={() => removeRoutineItem(itemIdx)} className="text-red-500 hover:bg-red-50 p-2 shrink-0"><Trash2 className="h-4 w-4"/></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-6 px-4 sm:px-0 pb-1">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateRoutine} disabled={newItems.length === 0}>Save Routine</Button>
          </div>
        </div>
      </Modal>

      {/* APPLY ROUTINE MODAL */}
      <Modal isOpen={isApplyOpen} onClose={() => setIsApplyOpen(false)} title="Apply Meal Routine" size="md">
        {selectedRoutine && (
          <div className="space-y-5 px-4 sm:px-6 py-4">
            <div className="p-3 bg-primary-50 text-primary-900 rounded-lg">
              <p className="font-medium">Applying: {selectedRoutine.name}</p>
              <p className="text-sm opacity-80">{selectedRoutine.items?.length || 0} meals configured</p>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Start Date</label>
                  <Input type="date" value={applyForm.startDate} onChange={e => setApplyForm({...applyForm, startDate: e.target.value})} />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">End Date</label>
                  <Input type="date" value={applyForm.endDate} onChange={e => setApplyForm({...applyForm, endDate: e.target.value})} />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Apply To Audience</label>
                <Select value={applyForm.applyTo} onChange={e => setApplyForm({...applyForm, applyTo: e.target.value})}>
                  <option value="both">Both Employees & Students</option>
                  <option value="employee">Employees Only</option>
                  <option value="student">Students Only</option>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="outline" onClick={() => setIsApplyOpen(false)}>Cancel</Button>
              <Button onClick={handleApplyRoutine} className="flex items-center gap-2">
                <Play className="h-4 w-4" /> Generate Schedule
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
