import { useEffect, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store'
import { ProtectedRoute } from './components/ProtectedRoute'
import { Layout } from './components/employee'
import { StudentLayout } from './components/student/StudentLayout'
import { PageLoader } from './components/PageLoader'
import { getRoleHomePath } from './lib/roles'

// Auth Pages - lazy loaded
const LoginPage = lazy(() => import('./pages/auth/LoginPage'))
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'))
const ForgotPasswordPage = lazy(() => import('./pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'))

// Employee Pages - lazy loaded
const DashboardPage = lazy(() => import('./pages/employee/DashboardPage'))
const MenuPage = lazy(() => import('./pages/employee/MenuPage'))
const BookingsPage = lazy(() => import('./pages/employee/BookingsPage'))
const ProfilePage = lazy(() => import('./pages/employee/ProfilePage'))

// Admin Pages - lazy loaded (these are heavy with charts/tables)
const AdminDashboardPage    = lazy(() => import('./pages/admin/AdminDashboardPage'))
const MenuManagementPage    = lazy(() => import('./pages/admin/MenuManagementPage'))
const BookingManagementPage = lazy(() => import('./pages/admin/BookingManagementPage'))
const UserManagementPage    = lazy(() => import('./pages/admin/UserManagementPage'))
const ReportsPage           = lazy(() => import('./pages/admin/ReportsPage'))
const PaymentsPage          = lazy(() => import('./pages/admin/PaymentsPage'))
const StudentTiffinPage     = lazy(() => import('./pages/admin/StudentTiffinPage'))
const MealRoutinePage       = lazy(() => import('./pages/admin/MealRoutinePage'))
const SettingsPage          = lazy(() => import('./pages/admin/SettingsPage'))

// Shared Pages - lazy loaded
const MealHistoryPage = lazy(() => import('./pages/MealHistoryPage'))

// Student Pages - lazy loaded
const StudentDashboardPage = lazy(() => import('./pages/student/StudentDashboardPage'))
const StudentMenuPage      = lazy(() => import('./pages/student/StudentMenuPage'))
const StudentOrdersPage    = lazy(() => import('./pages/student/StudentOrdersPage'))
const StudentPaymentPage   = lazy(() => import('./pages/student/StudentPaymentPage'))

// Smart root redirect — sends each role to the right home page
function RootRedirect() {
  const { profile, isInitialized } = useAuthStore()
  if (!isInitialized) return <PageLoader />
  return <Navigate to={getRoleHomePath(profile)} replace />
}

function App() {
  const { initialize } = useAuthStore()

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Employee Routes */}
          <Route
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/bookings" element={<BookingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/meal-history" element={<MealHistoryPage />} />
          </Route>

          {/* Admin Routes - Dashboard and Reports accessible to any admin */}
          <Route
            element={
              <ProtectedRoute requireAnyAdmin>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/reports" element={<ReportsPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Route>

          {/* Menu Management - Food Editors and Main Admins */}
          <Route
            element={
              <ProtectedRoute requireMealManagement>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/menu"           element={<MenuManagementPage />} />
            <Route path="/admin/student-tiffin" element={<StudentTiffinPage />} />
            <Route path="/admin/routines"       element={<MealRoutinePage />} />
          </Route>

          {/* Booking Management - Main Admins and Admins only */}
          <Route
            element={
              <ProtectedRoute requireBookingManagement>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/bookings" element={<BookingManagementPage />} />
          </Route>

          {/* User Management - Main Admins and Admins only */}
          <Route
            element={
              <ProtectedRoute requireUserManagement>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/users" element={<UserManagementPage />} />
          </Route>

          {/* Payments - Finance Editors and Main Admins */}
          <Route
            element={
              <ProtectedRoute requireFinanceManagement>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/payments" element={<PaymentsPage />} />
          </Route>

          {/* Meal History - All authenticated users */}
          <Route
            element={
              <ProtectedRoute>
                <Layout isAdmin />
              </ProtectedRoute>
            }
          >
            <Route path="/admin/meal-history" element={<MealHistoryPage />} />
          </Route>

          {/* Student Routes */}
          <Route
            element={
              <ProtectedRoute requireStudent>
                <StudentLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/student/dashboard" element={<StudentDashboardPage />} />
            <Route path="/student/menu"      element={<StudentMenuPage />} />
            <Route path="/student/orders"    element={<StudentOrdersPage />} />
            <Route path="/student/payment"   element={<StudentPaymentPage />} />
          </Route>

          {/* Redirects */}
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </Suspense>
      
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            borderRadius: '10px',
            background: '#333',
            color: '#fff',
          },
        }}
      />
    </BrowserRouter>
  )
}

export default App

// authorized by 3a7anton