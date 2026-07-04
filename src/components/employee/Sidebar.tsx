import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  UtensilsCrossed, 
  CalendarDays, 
  Users, 
  FileBarChart,
  CreditCard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  UserCircle,
  History,
  GraduationCap,
  Repeat,
  Settings,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuthStore, useUIStore } from '../../store'
import { LanguageSelector } from '../ui/LanguageSelector'
import { useTranslation } from '../../hooks/useTranslation'
import { cn } from '../../lib/utils'
import { canManageMeals, canManageFinance, canManageUsers, canViewReports, canViewAllBookings } from '../../lib/roles'

interface SidebarProps {
  isAdmin?: boolean
}

export function Sidebar({ isAdmin = false }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const { signOut, profile } = useAuthStore()
  const { isMobileMenuOpen, closeMobileMenu } = useUIStore()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  // Close mobile menu when route changes
  useEffect(() => {
    closeMobileMenu()
  }, [location.pathname, closeMobileMenu])

  const handleSignOut = () => {
    // Navigate immediately for instant feedback, then sign out
    navigate('/login')
    // Use setTimeout to allow navigation to start before async cleanup
    setTimeout(() => signOut(), 0)
  }

  const employeeLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { to: '/menu', icon: UtensilsCrossed, label: t('menu') },
    { to: '/bookings', icon: CalendarDays, label: t('bookings') },
    { to: '/meal-history', icon: History, label: t('mealHistory') },
    { to: '/profile', icon: UserCircle, label: t('profile') },
  ]

  // Build admin links based on role permissions
  const getAdminLinks = () => {
    const links = [{ to: '/admin', icon: LayoutDashboard, label: t('dashboard') }]
    
    if (canManageMeals(profile)) {
      links.push({ to: '/admin/menu', icon: UtensilsCrossed, label: t('menu') })
    }
    
    if (canViewAllBookings(profile)) {
      links.push({ to: '/admin/bookings', icon: CalendarDays, label: t('bookings') })
    }
    
    if (canManageUsers(profile)) {
      links.push({ to: '/admin/users', icon: Users, label: t('users') })
    }
    
    if (canManageFinance(profile)) {
      links.push({ to: '/admin/payments', icon: CreditCard, label: t('payments') })
    }
    
    if (canViewReports(profile)) {
      links.push({ to: '/admin/reports', icon: FileBarChart, label: t('reports') })
    }
    
    // Meal History is available to all admins
    links.push({ to: '/admin/meal-history', icon: History, label: t('mealHistory') })
    
    // Student Tiffin Management — admins and food editors
    if (canManageMeals(profile)) {
      links.push({ to: '/admin/student-tiffin', icon: GraduationCap, label: 'Student Tiffin' })
      links.push({ to: '/admin/routines', icon: Repeat, label: 'Meal Routines' })
    }
    
    links.push({ to: '/admin/settings', icon: Settings, label: 'Settings' })
    
    return links
  }

  const adminLinks = getAdminLinks()

  const links = isAdmin ? adminLinks : employeeLinks

  return (
    <>
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={closeMobileMenu}
        />
      )}
      
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen bg-white border-r border-gray-200 transition-all duration-300 z-40',
          'lg:translate-x-0',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
          isCollapsed ? 'lg:w-16 w-64' : 'w-64'
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-8 w-8 text-primary-600" />
              <span className="font-bold text-gray-900">MealPlanner</span>
            </div>
          )}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="hidden lg:flex p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )
              }
            >
              <link.icon className="h-5 w-5 flex-shrink-0" />
              {!isCollapsed && <span className="font-medium">{link.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Language & Sign Out */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-gray-200 space-y-2">
          {/* Language Selector */}
          <div className={cn('flex', isCollapsed ? 'justify-center' : 'justify-start')}>
            <LanguageSelector variant="compact" />
          </div>
          {/* Sign Out Button */}
          <button
            onClick={handleSignOut}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg w-full',
              'text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors'
            )}
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span className="font-medium">{t('signOut')}</span>}
          </button>
        </div>
      </aside>
    </>
  )
}
