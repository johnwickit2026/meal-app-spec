import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const REMEMBER_KEY = 'supabase.auth.rememberMe'
// Browser-session liveness flag. A cookie without max-age/expires is a
// "session cookie": it is shared across all tabs, survives page reloads and
// new-tab opens, and is dropped by the browser when it fully closes. We use it
// only as a lightweight signal to enforce rememberMe=false semantics while the
// real auth token lives in localStorage (so it stays in sync across tabs).
const SESSION_FLAG_COOKIE = 'sb-session-active'

// Whether the current login should persist beyond the browser session.
let isRememberMe = localStorage.getItem(REMEMBER_KEY) === 'true'

function isAuthTokenKey(key: string) {
  return key.includes('auth-token')
}

function hasSessionFlagCookie(): boolean {
  return document.cookie
    .split(';')
    .some((c) => c.trim().startsWith(`${SESSION_FLAG_COOKIE}=`))
}

function setSessionFlagCookie() {
  // No max-age => session cookie (cleared on browser close).
  document.cookie = `${SESSION_FLAG_COOKIE}=1; path=/; SameSite=Lax`
}

function clearSessionFlagCookie() {
  document.cookie = `${SESSION_FLAG_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
}

// localStorage-backed storage adapter.
// Using localStorage lets supabase-js handle cross-tab session sync (via the
// native 'storage' event) and serialize token refresh across tabs (via the
// Web Locks API), which eliminates the refresh-token rotation races and
// missing cross-tab sync that caused intermittent logouts with cookies.
const localStorageAdapter = {
  getItem(key: string): string | null {
    return window.localStorage.getItem(key)
  },
  setItem(key: string, value: string) {
    window.localStorage.setItem(key, value)
    // Keep the browser-session liveness flag in place for non-remember logins
    // whenever the auth token is (re)written (initial sign-in and refreshes).
    if (!isRememberMe && isAuthTokenKey(key)) {
      setSessionFlagCookie()
    }
  },
  removeItem(key: string) {
    window.localStorage.removeItem(key)
    if (isAuthTokenKey(key)) {
      clearSessionFlagCookie()
    }
  },
}

// If a previous session was non-remember and the browser has since been fully
// closed (session flag cookie gone), drop any stale auth token so the user is
// treated as signed out. This preserves "rememberMe=false clears on close"
// while still allowing reloads and new tabs to stay signed in.
function enforceRememberMeOnLoad() {
  if (isRememberMe || hasSessionFlagCookie()) return
  for (let i = window.localStorage.length - 1; i >= 0; i--) {
    const key = window.localStorage.key(i)
    if (key && isAuthTokenKey(key)) {
      window.localStorage.removeItem(key)
    }
  }
}
enforceRememberMeOnLoad()

export function setAuthStorage(rememberMe: boolean) {
  isRememberMe = rememberMe
  if (rememberMe) {
    localStorage.setItem(REMEMBER_KEY, 'true')
    // Persistent login shouldn't be tied to the browser-session flag.
    clearSessionFlagCookie()
  } else {
    localStorage.removeItem(REMEMBER_KEY)
    setSessionFlagCookie()
  }
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: localStorageAdapter,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
