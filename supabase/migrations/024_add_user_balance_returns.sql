-- Make add_user_balance RETURN the resulting balance so callers avoid a
-- separate follow-up SELECT round trip (latency reduction).
--
-- CREATE OR REPLACE cannot change a function's return type (void -> numeric),
-- so the old signature is dropped first. No DB objects depend on this function.
DROP FUNCTION IF EXISTS add_user_balance(uuid, numeric, uuid);

CREATE OR REPLACE FUNCTION add_user_balance(p_user_id uuid, p_amount numeric, p_admin_id uuid)
RETURNS numeric AS $$
DECLARE
  v_balance numeric(10,2);
BEGIN
  -- Atomic upsert; the ON CONFLICT locks only the single target row
  -- (fast: user_balances has a UNIQUE(user_id) index).
  INSERT INTO user_balances (user_id, balance, total_deposits)
  VALUES (p_user_id, p_amount, p_amount)
  ON CONFLICT (user_id) DO UPDATE
    SET balance = user_balances.balance + p_amount,
        total_deposits = user_balances.total_deposits + p_amount,
        updated_at = NOW();

  INSERT INTO advance_payments (user_id, amount, type, description, created_by)
  VALUES (p_user_id, p_amount, 'deposit', 'Admin deposit', p_admin_id);

  -- Return the stored balance (indexed lookup on user_id) so it stays
  -- consistent with any AFTER-INSERT balance triggers.
  SELECT balance INTO v_balance FROM user_balances WHERE user_id = p_user_id;
  RETURN v_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
