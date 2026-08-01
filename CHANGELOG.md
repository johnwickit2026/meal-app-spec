# 📋 Project Change Log — Office & Student Meal Planner

> **Purpose:** This file is a single-source summary of everything that has been built and changed in this project. Read this instead of digging through the entire codebase to understand the project's history, architecture, and feature evolution.

---

## 1. Project Overview

A full-stack meal-booking platform serving two audiences:

- **Office / Employee portal** — browse daily menus, book meals, manage bookings, receive notifications.
- **Student portal** — student-specific menus, ordering, and online payment (SSLCommerz).
- **Admin panel** — menu/schedule management, booking approval workflow, user & balance management, routines, guest meals, reports, and analytics.

### Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19 + TypeScript + Vite |
| **Styling** | Tailwind CSS |
| **State** | Zustand |
| **DB & Auth** | Supabase (PostgreSQL + Row Level Security) |
| **Forms & Validation** | React Hook Form + Zod |
| **Charts** | Recharts |
| **Serverless API** | Vercel Functions / Netlify Functions (Node.js) |
| **Mobile** | Capacitor (Android) |
| **Payments** | SSLCommerz |
| **Deployment** | Vercel + Netlify |

### Repository Layout

```
meal-plan-main/
├── src/
│   ├── components/        # employee/ui/shared React components
│   ├── pages/             # admin/ auth/ employee/ student/ + MealHistoryPage
│   ├── store/             # Zustand state stores
│   ├── lib/               # Supabase client & utilities
│   ├── hooks/             # custom hooks
│   └── types/             # TypeScript type definitions
├── api/                   # Serverless functions (flattened for Netlify)
├── supabase/
│   ├── migrations/        # 27 sequential SQL migrations (001 → 026 + reset codes)
│   ├── functions/         # Supabase edge functions
│   └── seed.sql           # sample seed data
├── android/               # Capacitor Android wrapper
├── vercel.json            # Vercel config
├── netlify.toml           # Netlify config + API redirects
└── capacitor.config.ts    # Capacitor config
```

---

## 2. Chronological Change History

Derived from git history (commits from **2026-06-19** to **2026-07-11**).

### 🟢 2026-06-19 — Foundation feature drop
- Added **manual order** creation.
- Added **auto-confirm** for bookings.
- Introduced the **balance system**.
- Added **"pay now with cash"** option.
- Added **meal image upload**.

### 🟢 2026-06-24 — Mobile & docs
- Integrated **Capacitor** to ship an **Android** build.
- Updated `README.md`.
- Removed legacy planning docs (`PRD-OfficeMealPlanning.md`, `REVIEW.md`).

### 🟢 2026-06-28 — Student feature + payments
- Added **student ordering** flow.
- Integrated **SSLCommerz payment**.
- Resolved **28 TypeScript build errors** in the student feature.
- Multiple import-hygiene fixes: added `.js` extensions to relative imports; switched `validateInput` to **discriminated union types** to fix `TS2339` type-narrowing errors.

### 🟢 2026-06-29 — Bug sweep
- Fixed **tiffin display**.
- Fixed **delete user**.
- Fixed **add balance**.
- Fixed **dashboard duplicate** entries.

### 🟢 2026-07-02 — API & UX fixes
- Fixed **API proxy** behavior.
- Fixed **cancel booking**.
- Fixed **today's tiffin** view.
- Fixed **cash notifications**.
- Improved **UI badges**.

### 🟢 2026-07-03 — Deployment stabilization (Vercel → Netlify)
- Resolved **all TypeScript build errors** blocking Vercel deployment.
- Fixed **routine meal UI responsiveness** and API 500 handler errors.
- Added **explicit Netlify redirects** for student API routes.
- Made the **student tiffin query resilient** and surfaced API error detail.
- Converted `delete`/`balance` endpoints to the **Netlify handler pattern** + added `toml` redirects.
- Fixed `TS2322` handler return types in `balance.ts` and `delete.ts`.
- Fixed **"Invalid time value" 500 error** in student menu API by robustly parsing `time_slot`.
- Moved **env-var checks inside handlers** to prevent module-load crashes.
- Added **loading skeletons, error states, and improved empty states** for student menu/orders.
- **Meal history:** always-visible tabs with an admin-only **Guest Meals** tab.

### 🟢 2026-07-04 — Netlify structure + routine/balance/booking fixes
- **Flattened nested API handlers** into Netlify-compatible directories; updated redirects and the Vite dev resolver.
- Routine fixes: exposed DB error details, fixed the time input default.
- **Balance:** routed admin deposits through `user_balances` via the `add_user_balance` RPC.
- **Booking:** kept same-day meals bookable until meal time; hardened the time parser.
- **"All 10 baseline issues" fix:** balance sync, routing, settings, price history, payment options.

### 🟢 2026-07-06 — Routine ↔ calendar sync
- Synced routine changes to calendar meals: linked schedules via `routine_id`, with **cascade delete** and **edit-sync**.

### 🟢 2026-07-11 — System update v1
- General **system update v1** (`11-7-2026 05:34`).

### 🟢 2026-08-01 — Auto-approve orders, time formatting/filters, routine deadlines
- **Auto-approve all orders:** employee meal bookings and student tiffin orders are now created directly as `confirmed` (no admin approval step).
  - New migration `026_auto_approve_all_orders.sql` rewrites `create_booking_atomic` to always confirm (capacity/duplicate-slot checks preserved).
  - `student-orders-create` now inserts `status: 'confirmed'` and sends an `order_confirmed` notification.
  - Legacy `bookings-create` endpoint aligned to `confirmed` + confirmation notification.
- **Time display & filtering:** meal times shown consistently as `h:mm AM/PM` via `formatTime`.
  - Admin schedule uses a native time picker; schedules tab gained a **manual time-slot filter**.
  - Employee menu gained a **manual time-slot filter**; student menu time headers formatted.
- **Meal routines:** added per-item **order-deadline (hours)** inputs to both weekly and monthly routine editors.
- Note: a Meal Calendar component was prototyped then dropped per request (not shipped).

---

## 3. Database Migration Timeline

Migrations under `supabase/migrations/` document the schema evolution:

| Migration | Purpose |
|---|---|
| `001_initial_schema.sql` | Base schema (profiles, meals, schedules, bookings) |
| `002_atomic_booking.sql` | Atomic booking transaction logic |
| `003_profile_extras_and_meal_price.sql` | Profile extras + meal pricing |
| `004_payments.sql` | Payments table |
| `005_admin_roles.sql` | Admin role management |
| `006_booking_quantity.sql` | Booking quantity support |
| `007_app_settings.sql` | App-wide settings |
| `008_advance_payments.sql` | Advance payments |
| `009_auto_confirm_bookings.sql` | Auto-confirm bookings |
| `010_balance_and_cash_requests.sql` | Balance & cash request flow |
| `011_student_feature.sql` | Student portal schema |
| `012_manual_meal_times.sql` | Manual meal times |
| `013_payment_notifications.sql` | Payment notifications |
| `014_meal_routines.sql` | Meal routines |
| `015_departments.sql` | Departments |
| `016_guest_meals.sql` | Guest meals |
| `017_add_balance_to_profiles.sql` | Balance column on profiles |
| `018_fix_student_role_trigger.sql` | Fix student role trigger |
| `019_sync_balance.sql` | Balance sync |
| `020_price_at_booking.sql` | Snapshot price at booking time |
| `021_pay_balance_and_flow.sql` | Pay-with-balance flow |
| `022_routine_schedule_link.sql` | Link routines to schedules (`routine_id`) |
| `023_realtime_user_balances.sql` | Realtime user balances |
| `024_add_user_balance_returns.sql` | `add_user_balance` RPC return values |
| `025_employee_online_payments.sql` | Employee online payments |
| `026_auto_approve_all_orders.sql` | Auto-approve all orders (bookings always confirmed) |
| `20240420_create_password_reset_codes.sql` | Password reset codes |

---

## 4. API Surface (Serverless Functions)

Located in `api/` (flattened directories for Netlify compatibility). Shared helpers: `_cache.ts`, `_security.ts`, `_utils.ts`, `_validation.ts`, `_netlify_shim.ts`.

- **Admin:** `admin-approve`, `admin-deny`, `admin-meals`, `admin-users`, `admin-users-balance`, `admin-users-delete`, `admin-routines`, `admin-routines-apply`, `admin-student-menu`, `admin-student-menu-item`, `admin-guest-meals`, `admin-reports-export`
- **Bookings:** `bookings`, `bookings-create`, `bookings-cancel`, `bookings-list`, `bookings-history`, `bookings-pay-balance`, `bookings-initiate-payment`
- **Meals:** `meals`, `meals-schedule`
- **Student:** `student-menu`, `student-orders-create`, `student-orders-list`
- **Payments:** `payments-initiate`, `payments-callback`
- **Notifications:** `notifications`

---

## 5. Key Feature Summary (Current State)

- **Employee portal:** menu browsing, booking with conflict detection, same-day booking until meal time, personal booking management, notifications.
- **Student portal:** dedicated menus, ordering, online payment via SSLCommerz, loading/empty/error states.
- **Admin panel:** menu/schedule CRUD (native time picker + time-slot filter, `h:mm AM/PM` display), auto-approved bookings/orders, user & role management, balance deposits (RPC-based), meal routines (per-item order deadlines) synced to the calendar, guest meals, reports export, analytics charts.
- **Payments & balance:** cash + online payment options, advance payments, balance sync, price-at-booking snapshots.
- **Platform:** deployed on both Vercel and Netlify; Android app via Capacitor.

---

## 6. Notes for Maintainers

- **Deployment portability** drove much of the mid-project churn: API handlers were flattened and given explicit Netlify redirects while preserving Vercel compatibility.
- **Type safety:** a recurring theme was resolving TypeScript build errors — prefer discriminated unions for validation and keep `.js` extensions on relative imports where required by the build.
- **Time handling:** meal time parsing has been hardened repeatedly; be cautious when changing `time_slot` parsing to avoid "Invalid time value" errors.
- **Balance changes** must go through the `add_user_balance` RPC / `user_balances` table rather than writing profiles directly.
