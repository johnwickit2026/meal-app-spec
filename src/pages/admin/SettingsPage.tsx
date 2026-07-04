import { useEffect, useState } from 'react'
import { Clock, RotateCcw, Save, AlertCircle, Wallet, CheckCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Toggle } from '../../components/ui'
import { useSettingsStore, useAuthStore } from '../../store'
import toast from 'react-hot-toast'

export function SettingsPage() {
  const { user } = useAuthStore()
  const { bookingTimeLimit, cancellationTimeLimit, advancePaymentEnabled, autoConfirmEnabled, fetchSettings, updateSetting } = useSettingsStore()
  
  const [bookingLimit, setBookingLimit] = useState<number>(60)
  const [cancellationLimit, setCancellationLimit] = useState<number>(120)
  const [advancePayment, setAdvancePayment] = useState<boolean>(false)
  const [autoConfirm, setAutoConfirm] = useState<boolean>(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    setBookingLimit(bookingTimeLimit)
    setCancellationLimit(cancellationTimeLimit)
    setAdvancePayment(advancePaymentEnabled)
    setAutoConfirm(autoConfirmEnabled)
  }, [bookingTimeLimit, cancellationTimeLimit, advancePaymentEnabled, autoConfirmEnabled])

  const handleSave = async () => {
    setIsSaving(true)
    const results = await Promise.all([
      updateSetting('booking_time_limit', bookingLimit.toString(), user?.id),
      updateSetting('cancellation_time_limit', cancellationLimit.toString(), user?.id),
      updateSetting('advance_payment_enabled', advancePayment.toString(), user?.id),
      updateSetting('auto_confirm_enabled', autoConfirm.toString(), user?.id),
    ])

    const hasError = results.some((r) => r.error)
    if (hasError) {
      toast.error('Failed to save settings')
    } else {
      toast.success('Settings saved successfully')
    }
    setIsSaving(false)
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Configure application settings and time limits</p>
      </div>

      {/* Booking Time Limit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" /> Booking Time Limit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Set how many minutes before meal time users can no longer book. 
            After this time, booking will be closed for that meal.
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                type="number"
                min={0}
                max={1440}
                value={bookingLimit}
                onChange={(e) => setBookingLimit(parseInt(e.target.value) || 0)}
                label="Minutes before meal time"
              />
            </div>
            <div className="text-sm text-gray-500 pt-6">
              = {Math.floor(bookingLimit / 60)}h {bookingLimit % 60}m
            </div>
          </div>
          <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-sm">
              Example: If set to 60 minutes, users cannot book after 11:00 AM for a 12:00 PM meal.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cancellation Time Limit */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" /> Cancellation & Refund Time Limit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Set how many minutes before meal time users can cancel their booking and request a refund.
            After this time, cancellations will not be allowed.
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Input
                type="number"
                min={0}
                max={1440}
                value={cancellationLimit}
                onChange={(e) => setCancellationLimit(parseInt(e.target.value) || 0)}
                label="Minutes before meal time"
              />
            </div>
            <div className="text-sm text-gray-500 pt-6">
              = {Math.floor(cancellationLimit / 60)}h {cancellationLimit % 60}m
            </div>
          </div>
          <div className="flex items-start gap-2 text-amber-600 bg-amber-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-sm">
              Example: If set to 120 minutes, users cannot cancel after 10:00 AM for a 12:00 PM meal.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Advance Payment Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Advance Payment System
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Enable or disable the advance payment feature for users. When enabled, users can 
            deposit money in advance and their balance will be tracked. The due amount will 
            be automatically adjusted against their available balance.
          </p>
          <div className="flex items-center gap-4">
            <Toggle
              checked={advancePayment}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAdvancePayment(e.target.checked)}
              label="Enable Advance Payment"
            />
          </div>
          <div className={`flex items-start gap-2 p-3 rounded-lg ${advancePayment ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-600'}`}>
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <p className="text-sm">
              {advancePayment 
                ? 'Advance payment is enabled. Users will see their balance and can make deposits. Due amounts will be automatically adjusted.'
                : 'Advance payment is disabled. Users will only see monthly bills without balance tracking.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Auto Confirmation Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" /> Auto-Confirm Orders
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Automatically confirm user bookings placed within the time window. When disabled, all bookings
            will require manual admin approval even if placed in time.
          </p>
          <div className="flex items-center gap-4">
            <Toggle
              checked={autoConfirm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAutoConfirm(e.target.checked)}
              label="Auto-confirm orders within time window"
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          isLoading={isSaving}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" /> Save Settings
        </Button>
      </div>
    </div>
  )
}

export default SettingsPage
