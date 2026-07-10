import { useEffect, useState } from 'react'
import { Search, Shield, ShieldOff, UserX, UserCheck, Users, DollarSign, AlertTriangle, Crown, UtensilsCrossed, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Select, Badge, CardSkeleton, TableSkeleton } from '../../components/ui'
import { ConfirmDialog, Modal } from '../../components/ui/Modal'
import { supabase } from '../../lib/supabaseClient'
import type { Profile } from '../../types'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { useAuthStore } from '../../store'

const MAX_APPROVED_USERS = parseInt(import.meta.env.VITE_MAX_APPROVED_USERS || '0', 10)

interface ProfileWithDue extends Profile {
  due_amount?: number
  balance?: number
}

export function UserManagementPage() {
  const [users, setUsers] = useState<ProfileWithDue[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null)
  const [actionType, setActionType] = useState<'promote' | 'promote_food' | 'promote_finance' | 'demote' | 'deactivate' | 'activate' | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [balanceModalOpen, setBalanceModalOpen] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositNote, setDepositNote] = useState('')
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<Profile | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const { profile: _adminProfile } = useAuthStore()

  const currentMonth = format(new Date(), 'yyyy-MM')

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      // Fetch unpaid dues for this month
      const { data: payments } = await supabase
        .from('payments')
        .select('user_id, amount, status')
        .eq('month', currentMonth)
        .eq('status', 'unpaid')

      const usersWithDue = (data || []).map((user) => {
        const unpaidPayment = payments?.find((p) => p.user_id === user.id)
        return { ...user, due_amount: unpaidPayment?.amount || 0 }
      })

      setUsers(usersWithDue)
    } catch (error) {
      console.error('Error fetching users:', error)
      toast.error('Failed to load users')
    } finally {
      setIsLoading(false)
    }
  }

  const activeUsersCount = users.filter((u) => u.is_active).length
  const isAtLimit = MAX_APPROVED_USERS > 0 && activeUsersCount >= MAX_APPROVED_USERS

  const handleAction = async () => {
    if (!selectedUser || !actionType) return

    // Check approval limit when activating a user
    if (actionType === 'activate' && isAtLimit) {
      toast.error(`Cannot activate: Maximum limit of ${MAX_APPROVED_USERS} approved users reached`)
      setSelectedUser(null)
      setActionType(null)
      return
    }

    setIsProcessing(true)
    try {
      let updateData: Partial<Profile> = {}

      switch (actionType) {
        case 'promote':
          updateData = { role: 'admin' }
          break
        case 'promote_food':
          updateData = { role: 'food_editor' }
          break
        case 'promote_finance':
          updateData = { role: 'finance_editor' }
          break
        case 'demote':
          updateData = { role: 'employee' }
          break
        case 'deactivate':
          updateData = { is_active: false }
          break
        case 'activate':
          updateData = { is_active: true }
          break
      }

      const { error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', selectedUser.id)

      if (error) throw error

      toast.success('User updated successfully')
      fetchUsers()
    } catch (error) {
      toast.error('Failed to update user')
    } finally {
      setIsProcessing(false)
      setSelectedUser(null)
      setActionType(null)
    }
  }

  const handleAddBalance = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedUser || !depositAmount) return
    const amount = Number(depositAmount)
    if (isNaN(amount) || amount <= 0) return

    const previousBalance = (selectedUser as ProfileWithDue).balance ?? 0
    const optimisticBalance = previousBalance + amount
    const userId = selectedUser.id

    // Optimistic UI: close modal immediately, update balance locally, toast success.
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, balance: optimisticBalance } : u))
    )
    setBalanceModalOpen(false)
    setDepositAmount('')
    setDepositNote('')
    setSelectedUser(null)
    toast.success(`Successfully added ৳${amount} to ${selectedUser.full_name}'s balance.`)

    setIsProcessing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const response = await fetch('/api/admin/users/balance', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          userId,
          amount,
          note: depositNote
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to add balance')
      }

      // Reconcile with server response.
      const serverBalance = result.data?.newBalance
      if (typeof serverBalance === 'number') {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, balance: serverBalance } : u))
        )
      } else {
        // Server didn't return a balance; refresh the list to be safe.
        fetchUsers()
      }
    } catch (err: any) {
      // Roll back optimistic balance on failure and reopen the modal so the
      // admin can retry without losing context.
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, balance: previousBalance } : u))
      )
      setSelectedUser(selectedUser)
      setBalanceModalOpen(true)
      toast.error('Failed to add balance: ' + err.message)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!userToDelete) return
    setIsDeleting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const response = await fetch('/api/admin/users/delete', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId: userToDelete.id })
      })

      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete user')
      }

      toast.success(result.message || 'User deleted')
      setIsDeleteModalOpen(false)
      setUserToDelete(null)
      fetchUsers()
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete user')
    } finally {
      setIsDeleting(false)
    }
  }

  const getActionMessage = () => {
    if (!selectedUser || !actionType) return ''
    const name = selectedUser.full_name

    switch (actionType) {
      case 'promote':
        return `Are you sure you want to promote ${name} to Admin? They will have full access to manage the system.`
      case 'promote_food':
        return `Are you sure you want to promote ${name} to Food Editor? They will be able to manage meals and schedules.`
      case 'promote_finance':
        return `Are you sure you want to promote ${name} to Finance Editor? They will be able to manage payments and pricing.`
      case 'demote':
        return `Are you sure you want to demote ${name} to employee? They will lose admin privileges.`
      case 'deactivate':
        return `Are you sure you want to deactivate ${name}'s account? They will no longer be able to log in.`
      case 'activate':
        if (isAtLimit) {
          return `⚠️ WARNING: You have reached the maximum limit of ${MAX_APPROVED_USERS} approved users. You cannot activate ${name} until you deactivate another user or increase the limit.`
        }
        return `Are you sure you want to activate ${name}'s account? They will be able to log in.`
      default:
        return ''
    }
  }

  const getActionTitle = () => {
    switch (actionType) {
      case 'promote': return 'Promote to Admin'
      case 'promote_food': return 'Promote to Food Editor'
      case 'promote_finance': return 'Promote to Finance Editor'
      case 'demote': return 'Demote to Employee'
      case 'deactivate': return 'Deactivate Account'
      case 'activate': return 'Approve & Activate Account'
      default: return ''
    }
  }

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return (
          <Badge variant="warning">
            <span className="flex items-center gap-1">
              <Crown className="h-3 w-3" /> Admin
            </span>
          </Badge>
        )
      case 'food_editor':
        return (
          <Badge variant="success">
            <span className="flex items-center gap-1">
              <UtensilsCrossed className="h-3 w-3" /> Food Editor
            </span>
          </Badge>
        )
      case 'finance_editor':
        return (
          <Badge variant="primary">
            <span className="flex items-center gap-1">
              <Wallet className="h-3 w-3" /> Finance Editor
            </span>
          </Badge>
        )
      default:
        return <Badge variant="default">Employee</Badge>
    }
  }

  const filteredUsers = users.filter((user) => {
    if (roleFilter !== 'all' && user.role !== roleFilter) return false
    if (statusFilter === 'active' && !user.is_active) return false
    if (statusFilter === 'inactive' && user.is_active) return false
    if (statusFilter === 'pending' && user.is_active) return false
    if (departmentFilter !== 'all' && user.department !== departmentFilter) return false

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesName = user.full_name?.toLowerCase().includes(query)
      const matchesEmail = user.email?.toLowerCase().includes(query)
      const matchesDept = user.department?.toLowerCase().includes(query)
      if (!matchesName && !matchesEmail && !matchesDept) return false
    }

    return true
  })

  const pendingCount = users.filter((u) => !u.is_active).length

  const isInitialLoading = isLoading && users.length === 0

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        {/* Header Skeleton */}
        <div>
          <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-gray-200 rounded animate-pulse" />
        </div>

        {/* Limit Warning Skeleton */}
        <CardSkeleton />

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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <p className="text-gray-500">Manage user accounts, permissions and billing dues</p>
      </div>

      {/* Limit Warning Banner */}
      {MAX_APPROVED_USERS > 0 && (
        <Card className={isAtLimit ? 'border-red-300 bg-red-50' : activeUsersCount >= MAX_APPROVED_USERS - 5 ? 'border-amber-300 bg-amber-50' : ''}>
          <CardContent className="flex items-center gap-3 py-4">
            <AlertTriangle className={`h-5 w-5 ${isAtLimit ? 'text-red-600' : activeUsersCount >= MAX_APPROVED_USERS - 5 ? 'text-amber-600' : 'text-gray-500'}`} />
            <div className="flex-1">
              <p className={`font-medium ${isAtLimit ? 'text-red-800' : activeUsersCount >= MAX_APPROVED_USERS - 5 ? 'text-amber-800' : 'text-gray-700'}`}>
                Account Limit: {activeUsersCount} / {MAX_APPROVED_USERS} approved users
              </p>
              {isAtLimit && (
                <p className="text-sm text-red-600 mt-1">
                  Maximum limit reached. Deactivate existing users before approving new ones.
                </p>
              )}
              {!isAtLimit && activeUsersCount >= MAX_APPROVED_USERS - 5 && (
                <p className="text-sm text-amber-600 mt-1">
                  Approaching limit. Only {MAX_APPROVED_USERS - activeUsersCount} slots remaining.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Users className="h-6 w-6 text-primary-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{users.length}</p>
              <p className="text-sm text-gray-500 leading-tight">Total Users</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-purple-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Shield className="h-6 w-6 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {users.filter((u) => ['admin', 'food_editor', 'finance_editor'].includes(u.role)).length}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Admins</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <UserCheck className="h-6 w-6 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">
                {users.filter((u) => u.is_active).length}
              </p>
              <p className="text-sm text-gray-500 leading-tight">Active Users</p>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[104px]">
          <CardContent className="flex items-center gap-4 py-4 h-full">
            <div className="h-12 w-12 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <UserX className="h-6 w-6 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{pendingCount}</p>
              <p className="text-sm text-gray-500 leading-tight">Pending Approval</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search by name, email, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full"
              />
            </div>
            <Select
              options={[
                { value: 'all', label: 'All Departments' },
                { value: 'School', label: 'School' },
                { value: 'Educare', label: 'Educare' },
              ]}
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-48"
            />
            <Select
              options={[
                { value: 'all', label: 'All Roles' },
                { value: 'admin', label: 'Admin' },
                { value: 'food_editor', label: 'Food Editor' },
                { value: 'finance_editor', label: 'Finance Editor' },
                { value: 'employee', label: 'Employee' },
              ]}
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-48"
            />
            <Select
              options={[
                { value: 'all', label: 'All Status' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'pending', label: 'Pending Approval' },
              ]}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-48"
            />
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Users ({filteredUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Search className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Department</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Role</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Due (This Month)</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">Joined</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{user.full_name}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                        {user.phone && <p className="text-xs text-gray-500">{user.phone}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{user.department || '-'}</td>
                      <td className="px-4 py-3">
                        {getRoleBadge(user.role)}
                      </td>
                      <td className="px-4 py-3">
                        {user.is_active ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-200">Deactivated</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.due_amount && user.due_amount > 0 ? (
                          <span className="flex items-center gap-1 text-red-600 font-medium">
                            <DollarSign className="h-4 w-4" />
                            ৳{user.due_amount.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-gray-500 text-sm">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 text-sm">
                        {format(new Date(user.created_at), 'MMM d, yyyy')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {user.role === 'employee' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Add Balance"
                                onClick={() => { setSelectedUser(user); setBalanceModalOpen(true); }}
                              >
                                <Wallet className="h-4 w-4 text-emerald-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Promote to Admin"
                                onClick={() => { setSelectedUser(user); setActionType('promote') }}
                              >
                                <Crown className="h-4 w-4 text-amber-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Promote to Food Editor"
                                onClick={() => { setSelectedUser(user); setActionType('promote_food') }}
                              >
                                <UtensilsCrossed className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Promote to Finance Editor"
                                onClick={() => { setSelectedUser(user); setActionType('promote_finance') }}
                              >
                                <Wallet className="h-4 w-4 text-blue-600" />
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Demote to Employee"
                              onClick={() => { setSelectedUser(user); setActionType('demote') }}
                            >
                              <ShieldOff className="h-4 w-4 text-gray-600" />
                            </Button>
                          )}

                          {user.is_active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedUser(user); setActionType('deactivate') }}
                            >
                              <UserX className="h-4 w-4 text-amber-500" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedUser(user); setActionType('activate') }}
                            >
                              <UserCheck className="h-4 w-4 text-green-500" />
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => { setUserToDelete(user); setIsDeleteModalOpen(true); }}
                            title="Delete Account"
                          >
                            Delete Account
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

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!selectedUser && !!actionType}
        onClose={() => { setSelectedUser(null); setActionType(null) }}
        onConfirm={handleAction}
        title={getActionTitle()}
        message={getActionMessage()}
        confirmText={getActionTitle()}
        variant={actionType === 'deactivate' ? 'danger' : 'primary'}
        isLoading={isProcessing}
      />

      <Modal
        isOpen={balanceModalOpen}
        onClose={() => { setBalanceModalOpen(false); setSelectedUser(null); setDepositAmount(''); setDepositNote(''); }}
        title="Add Balance"
      >
        <form onSubmit={handleAddBalance} className="space-y-4">
          <p className="text-sm text-gray-600">
            Add balance for <strong>{selectedUser?.full_name}</strong>.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Deposit Amount (৳)
            </label>
            <Input
              type="number"
              min="1"
              required
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Note (Optional)
            </label>
            <Input
              type="text"
              value={depositNote}
              onChange={(e) => setDepositNote(e.target.value)}
              placeholder="e.g. Monthly stipend"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setBalanceModalOpen(false); setSelectedUser(null); setDepositAmount(''); setDepositNote(''); }}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isProcessing || !depositAmount}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isProcessing ? 'Adding...' : 'Add Balance'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => !isDeleting && setIsDeleteModalOpen(false)}
        title="Delete Account"
      >
        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to permanently delete {userToDelete?.full_name}'s account? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteAccount}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete Permanently'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default UserManagementPage
