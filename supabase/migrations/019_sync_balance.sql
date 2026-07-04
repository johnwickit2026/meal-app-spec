-- Make profiles.balance always mirror user_balances.balance
CREATE OR REPLACE FUNCTION sync_profile_balance()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE profiles 
  SET balance = NEW.balance 
  WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_profile_balance ON user_balances;
CREATE TRIGGER trg_sync_profile_balance
  AFTER INSERT OR UPDATE ON user_balances
  FOR EACH ROW EXECUTE FUNCTION sync_profile_balance();

-- Backfill existing profiles.balance from user_balances
UPDATE profiles p
SET balance = ub.balance
FROM user_balances ub
WHERE ub.user_id = p.id;
