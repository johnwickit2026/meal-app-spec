import type { Profile } from '../types'

export type UserRole = Profile['role']

// Role hierarchy for employee/admin chain — student is intentionally excluded
// so hasMinimumRole() doesn't leak student access into employee/admin flows
const ROLE_HIERARCHY: Extract<UserRole, 'employee' | 'finance_editor' | 'food_editor' | 'admin'>[] =
  ['employee', 'finance_editor', 'food_editor', 'admin']

/**
 * Check if a user has a specific role
 */
export function hasRole(profile: Profile | null, role: UserRole): boolean {
  if (!profile) return false
  return profile.role === role
}

/**
 * Check if a user is a student
 */
export function isStudent(profile: Profile | null): boolean {
  if (!profile) return false
  return profile.role === 'student'
}

/**
 * Check if a user is any type of admin
 */
export function isAdmin(profile: Profile | null): boolean {
  if (!profile) return false
  return ['admin', 'food_editor', 'finance_editor'].includes(profile.role)
}

/**
 * Check if a user is main admin (has full access)
 */
export function isMainAdmin(profile: Profile | null): boolean {
  if (!profile) return false
  return profile.role === 'admin'
}

/**
 * Check if a user can manage meals (admin or food_editor)
 */
export function canManageMeals(profile: Profile | null): boolean {
  if (!profile) return false
  return ['admin', 'food_editor'].includes(profile.role)
}

/**
 * Check if a user can manage finance/payments (admin or finance_editor)
 */
export function canManageFinance(profile: Profile | null): boolean {
  if (!profile) return false
  return ['admin', 'finance_editor'].includes(profile.role)
}

/**
 * Check if a user can manage users and assign roles (admin only)
 */
export function canManageUsers(profile: Profile | null): boolean {
  if (!profile) return false
  return profile.role === 'admin'
}

/**
 * Check if a user can manage bookings (admin only)
 * Food and finance editors can view but not approve/deny
 */
export function canManageBookings(profile: Profile | null): boolean {
  if (!profile) return false
  return profile.role === 'admin'
}

/**
 * Check if a user can view all bookings (any admin type)
 */
export function canViewAllBookings(profile: Profile | null): boolean {
  if (!profile) return false
  return isAdmin(profile)
}

/**
 * Check if a user can view reports
 */
export function canViewReports(profile: Profile | null): boolean {
  if (!profile) return false
  return isAdmin(profile)
}

/**
 * Check if a user has a role at least as high as the required role
 */
export function hasMinimumRole(profile: Profile | null, requiredRole: UserRole): boolean {
  if (!profile) return false
  // Student is deliberately excluded from the employee/admin hierarchy
  if (profile.role === 'student') return false
  const userRoleIndex = ROLE_HIERARCHY.indexOf(profile.role)
  const requiredRoleIndex = ROLE_HIERARCHY.indexOf(requiredRole as typeof ROLE_HIERARCHY[number])
  return userRoleIndex >= requiredRoleIndex
}

/**
 * Get the role display name
 */
export function getRoleDisplayName(role: UserRole): string {
  const displayNames: Record<UserRole, string> = {
    'employee':        'Employee',
    'admin':           'Admin',
    'food_editor':     'Food Editor',
    'finance_editor':  'Finance Editor',
    'student':         'Student',
  }
  return displayNames[role] || role
}

// ─── Student permission helpers ───────────────────────────────────────────────

/** Students can browse the tiffin menu for tomorrow */
export function canViewStudentMenu(profile: Profile | null): boolean {
  return isStudent(profile)
}

/** Students can create a tiffin order */
export function canCreateStudentOrder(profile: Profile | null): boolean {
  return isStudent(profile)
}

/** Students can initiate SSLCommerz payment */
export function canMakePayment(profile: Profile | null): boolean {
  return isStudent(profile)
}

/**
 * Returns the default landing path for a given role after login.
 * admin/food_editor/finance_editor → /admin
 * employee → /dashboard
 * student  → /student/dashboard
 */
export function getRoleHomePath(profile: Profile | null): string {
  if (!profile) return '/dashboard'
  if (profile.role === 'student') return '/student/dashboard'
  if (isAdmin(profile)) return '/admin'
  return '/dashboard'
}
