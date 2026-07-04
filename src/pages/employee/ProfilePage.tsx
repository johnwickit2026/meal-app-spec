import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Mail, Phone, Building2, Lock, Save, Wallet, History } from 'lucide-react'
import { useAuthStore } from '../../store'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, ImageUpload, Select } from '../../components/ui'
import { Modal } from '../../components/ui/Modal'
import { format } from 'date-fns'
import { useTranslation } from '../../hooks/useTranslation'
import { supabase } from '../../lib/supabaseClient'
import toast from 'react-hot-toast'

const profileSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional().or(z.literal('')),
  department: z.string().optional().or(z.literal('')),
  avatar_url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})

const emailSchema = z.object({
  newEmail: z.string().email('Please enter a valid email'),
})

const passwordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(6),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

type ProfileForm = z.infer<typeof profileSchema>
type EmailForm = z.infer<typeof emailSchema>
type PasswordForm = z.infer<typeof passwordSchema>

export function ProfilePage() {
  const { profile, user, updateProfile } = useAuthStore()
  const { t } = useTranslation()
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [isSavingEmail, setIsSavingEmail] = useState(false)
  const [isSavingPassword, setIsSavingPassword] = useState(false)

  // Balance & Cash Request state
  const [transactions, setTransactions] = useState<any[]>([])
  const [cashRequestModalOpen, setCashRequestModalOpen] = useState(false)
  const [requestAmount, setRequestAmount] = useState('')
  const [requestNotes, setRequestNotes] = useState('')
  const [isRequestingCash, setIsRequestingCash] = useState(false)

  useEffect(() => {
    if (user?.id) {
      fetchTransactions()
    }
  }, [user?.id])

  const fetchTransactions = async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('advance_payments')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
    
    if (!error && data) {
      setTransactions(data)
    }
  }

  const handleCashRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || !requestAmount) return
    
    const amount = Number(requestAmount)
    if (isNaN(amount) || amount <= 0) return

    setIsRequestingCash(true)
    try {
      const { error } = await supabase
        .from('cash_payment_requests')
        .insert({
          user_id: user.id,
          amount,
          notes: requestNotes
        })
      
      if (error) throw error
      
      toast.success('Cash request submitted successfully.')
      setCashRequestModalOpen(false)
      setRequestAmount('')
      setRequestNotes('')
    } catch (err: any) {
      toast.error('Failed to submit cash request: ' + err.message)
    } finally {
      setIsRequestingCash(false)
    }
  }

  const profileForm = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: profile?.full_name || '',
      phone: profile?.phone || '',
      department: profile?.department || '',
      avatar_url: profile?.avatar_url || '',
    },
  })

  const emailForm = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      newEmail: user?.email || '',
    },
  })

  const passwordForm = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
  })

  const onSaveProfile = async (data: ProfileForm) => {
    setIsSavingProfile(true)
    const result = await updateProfile({
      full_name: data.full_name,
      phone: data.phone || null,
      department: data.department || null,
      avatar_url: data.avatar_url || null,
    })

    if (result.error) {
      console.error('Profile update error:', result.error)
      toast.error(`Failed to update profile: ${result.error.message}`)
    } else {
      toast.success(t('profileUpdated'))
    }
    setIsSavingProfile(false)
  }

  const onSaveEmail = async (data: EmailForm) => {
    setIsSavingEmail(true)
    const { error } = await supabase.auth.updateUser({ email: data.newEmail })
    
    if (error) {
      toast.error(`${t('updateFailed')}: ${error.message}`)
    } else {
      toast.success(t('emailUpdated'))
    }
    setIsSavingEmail(false)
  }

  const onSavePassword = async (data: PasswordForm) => {
    setIsSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: data.newPassword })
    
    if (error) {
      toast.error(`${t('updateFailed')}: ${error.message}`)
    } else {
      toast.success(t('passwordUpdated'))
      passwordForm.reset()
    }
    setIsSavingPassword(false)
  }

  const avatarUrl = profileForm.watch('avatar_url') || profile?.avatar_url

  return (
    <div className="space-y-6 max-w-2xl mx-auto lg:mx-0">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('profile')}</h1>
        <p className="text-gray-500">Manage your personal information and account settings</p>
      </div>

      {/* Avatar Card with Upload */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <ImageUpload
              currentUrl={avatarUrl}
              onUpload={(url) => profileForm.setValue('avatar_url', url)}
              userId={user?.id || ''}
            />
            <div className="text-center sm:text-left">
              <p className="font-semibold text-gray-900 text-lg">{profile?.full_name}</p>
              <p className="text-gray-500 text-sm">{user?.email}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                profile?.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-primary-100 text-primary-700'
              }`}>
                {profile?.role === 'admin' ? t('admin') : t('employee')}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" /> My Balance
          </CardTitle>
          <Button onClick={() => setCashRequestModalOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            Request Cash
          </Button>
        </CardHeader>
        <CardContent>
          <div className="bg-emerald-50 rounded-xl p-6 mb-6 text-center border border-emerald-100">
            <p className="text-emerald-800 text-sm font-medium mb-1">Current Balance</p>
            <p className="text-4xl font-bold text-emerald-600">
              ৳{Number(profile?.balance ?? 0).toFixed(0)}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-medium text-gray-900 flex items-center gap-2">
              <History className="h-4 w-4" /> Recent Transactions
            </h3>
            {transactions.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No recent transactions</p>
            ) : (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900 capitalize">{tx.type.replace('_', ' ')}</p>
                      <p className="text-xs text-gray-500">{format(new Date(tx.created_at), 'MMM d, yyyy h:mm a')}</p>
                      {tx.description && <p className="text-xs text-gray-400 mt-0.5">{tx.description}</p>}
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-bold ${Number(tx.amount) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {Number(tx.amount) > 0 ? '+' : ''}{Number(tx.amount).toFixed(0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Profile Info Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" /> {t('personalInfo')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="relative">
                <Input
                  label={t('fullName')}
                  placeholder="Jane Doe"
                  error={profileForm.formState.errors.full_name?.message}
                  {...profileForm.register('full_name')}
                />
                <User className="absolute right-3 top-9 h-4 w-4 text-gray-500" />
              </div>
              <div className="relative">
                <Input
                  label={t('phone')}
                  placeholder="+880 1XX XXX XXXX"
                  error={profileForm.formState.errors.phone?.message}
                  {...profileForm.register('phone')}
                />
                <Phone className="absolute right-3 top-9 h-4 w-4 text-gray-500" />
              </div>
            </div>

            <div className="relative">
              <Select
                  label={t('department')}
                  options={[
                    { value: '',        label: t('selectDepartment') },
                    { value: 'School',  label: 'School' },
                    { value: 'Educare', label: 'Educare' },
                  ]}
                  error={profileForm.formState.errors.department?.message}
                  {...profileForm.register('department')}
                />
              <Building2 className="absolute right-3 top-9 h-4 w-4 text-gray-500" />
            </div>

            {/* Hidden avatar_url field - updated by ImageUpload */}
            <input type="hidden" {...profileForm.register('avatar_url')} />

            {/* Current Email (read-only display) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('currentEmail')}</label>
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-500">
                <Mail className="h-4 w-4 text-gray-500" />
                <span className="text-sm">{user?.email}</span>
              </div>
            </div>

            <Button type="submit" isLoading={isSavingProfile} className="flex items-center gap-2">
              <Save className="h-4 w-4" /> {t('saveChanges')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Email Change */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> {t('changeEmail')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={emailForm.handleSubmit(onSaveEmail)} className="space-y-4">
            <Input
              label={t('newEmail')}
              type="email"
              placeholder="newemail@example.com"
              error={emailForm.formState.errors.newEmail?.message}
              {...emailForm.register('newEmail')}
            />
            <p className="text-sm text-gray-500">
              You'll receive a confirmation email at the new address to verify the change.
            </p>
            <Button type="submit" variant="secondary" isLoading={isSavingEmail} className="flex items-center gap-2">
              <Mail className="h-4 w-4" /> {t('updateEmail')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" /> {t('changePassword')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={passwordForm.handleSubmit(onSavePassword)} className="space-y-4">
            <Input
              label={t('newPassword')}
              type="password"
              placeholder="••••••••"
              error={passwordForm.formState.errors.newPassword?.message}
              {...passwordForm.register('newPassword')}
            />
            <Input
              label={t('confirmNewPassword')}
              type="password"
              placeholder="••••••••"
              error={passwordForm.formState.errors.confirmPassword?.message}
              {...passwordForm.register('confirmPassword')}
            />
            <Button type="submit" variant="secondary" isLoading={isSavingPassword} className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> {t('updatePassword')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Modal
        isOpen={cashRequestModalOpen}
        onClose={() => !isRequestingCash && setCashRequestModalOpen(false)}
        title="Request Cash"
      >
        <form onSubmit={handleCashRequest} className="space-y-4">
          <p className="text-sm text-gray-600">
            Submit a request for cash payment. This request will be reviewed by administrators.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount (৳)
            </label>
            <Input
              type="number"
              min="1"
              required
              value={requestAmount}
              onChange={(e) => setRequestAmount(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes (Optional)
            </label>
            <Input
              type="text"
              value={requestNotes}
              onChange={(e) => setRequestNotes(e.target.value)}
              placeholder="Reason for request..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setCashRequestModalOpen(false)}
              disabled={isRequestingCash}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isRequestingCash || !requestAmount}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isRequestingCash ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

export default ProfilePage
