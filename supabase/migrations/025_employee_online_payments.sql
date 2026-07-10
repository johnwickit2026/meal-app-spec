-- =====================================================================
-- Migration 025: Employee online payments, remove pay_later
-- =====================================================================

-- ── Add columns to payments table for SSLCommerz employee payments ──
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS sslcommerz_tran_id text,
ADD COLUMN IF NOT EXISTS balance_applied numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_data jsonb;

-- Index for fast callback lookup by tran_id
CREATE INDEX IF NOT EXISTS payments_sslcommerz_tran_id_idx ON payments(sslcommerz_tran_id);

-- ── Remove 'pay_later' from allowed notification types ──────────────
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'booking_confirmed',
    'booking_denied',
    'conflict',
    'reminder',
    'cancelled',
    'payment_success',
    'new_payment',
    'payment_pending',
    'cash_request',
    'balance_added',
    'payment_confirmed',
    'order_confirmed',
    'order_rejected',
    'cash_remainder'
  ));
