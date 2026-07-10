import { create } from 'zustand'
import { supabase, setAuthStorage } from '../lib/supabaseClient'
import { resolveProfileRole } from '../lib/roles'
import type { Profile } from '../types'
import type { User, Session, RealtimeChannel } from '@supabase/supabase-js'

export type ProfileWithBalance = Profile & { balance?: number }

function normalizeProfile(raw: any, user: User | null): ProfileWithBalance {
  const balanceData = Array.isArray(raw.user_balances) ? raw.user_balances[0] : raw.user_balances;
  return {
    ...raw,
    balance: balanceData?.balance ?? 0,
    role: resolveProfileRole(raw.role, user?.user_metadata?.role),
  }
}

interface AuthState {
  user: User | null
  profile: ProfileWithBalance | null
  session: Session | null
  isLoading: boolean
  isInitialized: boolean
  
  // Actions
  initialize: () => Promise<void>
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<{ error: Error | null; pendingApproval?: boolean }>
  signUp: (data: SignUpData) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  fetchProfile: (userId: string) => Promise<void>
  updateProfile: (updates: Partial<Pick<Profile, 'full_name' | 'phone' | 'department' | 'avatar_url'>>) => Promise<{ error: Error | null }>
  sendPasswordResetCode: (email: string) => Promise<{ error: Error | null }>
  verifyCodeAndResetPassword: (email: string, code: string, newPassword: string) => Promise<{ error: Error | null }>
}

interface SignUpData {
  email: string
  password: string
  fullName: string
  phone?: string
  department?: string
  role?: 'employee' | 'student'
  studentId?: string
}

let authSubscription: { unsubscribe: () => void } | null = null

// Realtime subscription for the signed-in user's balance row. Kept at module
// scope so it survives store re-renders and can be torn down on sign-out.
let balanceChannel: RealtimeChannel | null = null
let balanceChannelUserId: string | null = null

function unsubscribeBalance() {
  if (balanceChannel) {
    supabase.removeChannel(balanceChannel)
    balanceChannel = null
    balanceChannelUserId = null
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Subscribe to live INSERT/UPDATE on the current user's user_balances row and
  // reflect the new balance into profile.balance without a re-login/refresh.
  const subscribeBalance = (userId: string) => {
    if (balanceChannel && balanceChannelUserId === userId) return
    unsubscribeBalance()
    balanceChannelUserId = userId
    balanceChannel = supabase
      .channel(`user_balances:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_balances',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as { balance?: number | null } | null
          const nextBalance = newRow?.balance
          if (typeof nextBalance !== 'number') return
          const current = get().profile
          if (current && current.balance !== nextBalance) {
            set({ profile: { ...current, balance: nextBalance } })
          }
        }
      )
      .subscribe()
  }

  return {
  user: null,
  profile: null,
  session: null,
  isLoading: true,
  isInitialized: false,

  initialize: async () => {
    try {
      // Cleanup previous listener to prevent duplicates
      authSubscription?.unsubscribe()

      // Do NOT manually refresh here. autoRefreshToken + the Web Locks-based
      // storage lock let a single tab drive refresh, avoiding refresh-token
      // rotation races across tabs that previously caused false sign-outs.
      const { data: { session } } = await supabase.auth.getSession()

      if (session?.user) {
        set({ user: session.user, session })
        await get().fetchProfile(session.user.id)
        subscribeBalance(session.user.id)
      }

      // Listen for auth changes. Handle events explicitly so that transient
      // null sessions (e.g. mid-refresh, or a failed refresh in another tab)
      // never wipe the local user/profile — only an authoritative SIGNED_OUT
      // clears them.
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
        if (event === 'SIGNED_OUT') {
          unsubscribeBalance()
          set({ user: null, profile: null, session: null })
          return
        }

        if (currentSession?.user) {
          const prevUserId = get().user?.id
          set({ user: currentSession.user, session: currentSession })
          // Only (re)fetch the profile when the user actually changes or we
          // don't have one yet — token refreshes shouldn't churn the profile.
          if (prevUserId !== currentSession.user.id || !get().profile) {
            await get().fetchProfile(currentSession.user.id)
          }
          subscribeBalance(currentSession.user.id)
        }
        // Any other event with a null session is treated as transient and is
        // intentionally ignored to keep sessions stable across tabs.
      })
      authSubscription = subscription
    } catch (error) {
      console.error('Auth initialization error:', error)
    } finally {
      set({ isLoading: false, isInitialized: true })
    }
  },

  signIn: async (email: string, password: string, rememberMe = false) => {
    set({ isLoading: true })
    try {
      // Set storage type based on rememberMe (false = session cookie, true = max-age 30 days)
      setAuthStorage(rememberMe)
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      if (data.user) {
        await get().fetchProfile(data.user.id)
        const profile = get().profile

        // Block inactive (pending approval) users
        if (profile && !profile.is_active) {
          await supabase.auth.signOut()
          unsubscribeBalance()
          set({ user: null, profile: null, session: null })
          return { error: new Error('Your account is pending admin approval.'), pendingApproval: true }
        }

        subscribeBalance(data.user.id)
      }

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    } finally {
      set({ isLoading: false })
    }
  },

  signUp: async (data: SignUpData) => {
    set({ isLoading: true })
    try {
      const { error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
            phone: data.phone || null,
            department: data.department || null,
            role: data.role || 'employee',
            student_id: data.studentId || null,
          },
        },
      })

      if (authError) throw authError

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    } finally {
      set({ isLoading: false })
    }
  },

  signOut: async () => {
    unsubscribeBalance()
    await supabase.auth.signOut()
    set({ user: null, profile: null, session: null })
  },

  fetchProfile: async (userId: string) => {
    try {
      const { data: authData } = await supabase.auth.getUser()
      const user = get().user ?? authData.user ?? get().session?.user ?? null

      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, phone, avatar_url, department, role, dietary_preferences, is_active, created_at, user_balances(balance)')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error

      if (data) {
        set({ profile: normalizeProfile(data, user) })
      } else {
        // Profile doesn't exist yet — may be a trigger timing issue
        await new Promise((r) => setTimeout(r, 1000))
        const { data: retryData, error: retryError } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, avatar_url, department, role, dietary_preferences, is_active, created_at, user_balances(balance)')
          .eq('id', userId)
          .maybeSingle()

        if (retryError) {
          console.error('Profile retry failed:', retryError)
        }
        set({
          profile: retryData ? normalizeProfile(retryData, user) : null,
        })
      }
    } catch (error) {
      console.error('Error fetching profile:', error)
    }
  },

  updateProfile: async (updates) => {
    const { user } = get()
    if (!user) return { error: new Error('Not authenticated') }

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id)

      if (error) throw error

      // Refresh local profile
      await get().fetchProfile(user.id)
      return { error: null }
    } catch (error) {
      return { error: error as Error }
    }
  },

  sendPasswordResetCode: async (email: string) => {
    set({ isLoading: true })
    try {
      // First check if user exists in profiles table
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single()

      if (profileError || !profile) {
        throw new Error('User with this email does not exist')
      }

      // Use Supabase built-in password reset (sends magic link to email)
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) throw error

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    } finally {
      set({ isLoading: false })
    }
  },

  verifyCodeAndResetPassword: async (_email: string, _code: string, newPassword: string) => {
    set({ isLoading: true })
    try {
      // Update password using Supabase (user is already authenticated via magic link)
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (error) throw error

      return { error: null }
    } catch (error) {
      return { error: error as Error }
    } finally {
      set({ isLoading: false })
    }
  },
  }
})
