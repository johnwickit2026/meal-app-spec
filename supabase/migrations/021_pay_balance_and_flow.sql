-- =====================================================================
-- Migration 021: Pay-with-balance RPC, payment_method column,
-- student order approval flow, and expanded notification types
-- =====================================================================

-- ── B8: Deduct balance RPC (used by /api/bookings-pay-balance) ─────────
CREATE OR REPLACE FUNCTION deduct_user_balance(
  p_user_id uuid, 
  p_amount numeric
) RETURNS void AS $$
BEGIN
  UPDATE user_balances 
  SET balance = balance - p_amount,
      total_consumed = total_consumed + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;
  
  UPDATE profiles
  SET balance = balance - p_amount
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── B7 / B8: Track how a bill was paid ─────────────────────────────────
ALTER TABLE payments
ADD COLUMN IF NOT EXISTS payment_method text;

-- ── B10: Student orders need a 'confirmed' state (admin approval) ──────
ALTER TABLE student_orders DROP CONSTRAINT IF EXISTS student_orders_status_check;
ALTER TABLE student_orders ADD CONSTRAINT student_orders_status_check
  CHECK (status IN ('pending', 'confirmed', 'paid', 'cancelled', 'delivered'));

-- ── B7 / B8 / B10: Expand allowed notification types ───────────────────
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
    'pay_later',
    'order_confirmed',
    'order_rejected'
  ));
