-- migration file: supabase/migrations/026_auto_approve_all_orders.sql
-- Purpose: Auto-approve ALL placed orders (employee meal bookings + student tiffin orders)
-- so they are created directly in the 'confirmed' state without admin approval.

-- 1. Employee meal bookings: always confirm on creation.
--    Rewrites create_booking_atomic to set status = 'confirmed' unconditionally,
--    while keeping the existing capacity / duplicate-slot safety checks intact.
CREATE OR REPLACE FUNCTION create_booking_atomic(
  p_user_id uuid,
  p_menu_schedule_id uuid,
  p_notes text DEFAULT NULL,
  p_quantity int DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_capacity int;
  v_current_count int;
  v_scheduled_date date;
  v_time_slot text;
  v_user_existing_quantity int;
  v_booking_id uuid;
  -- Auto-approve: every booking is confirmed immediately.
  v_status text := 'confirmed';
BEGIN
  -- Validate quantity
  IF p_quantity < 1 OR p_quantity > 10 THEN
    RAISE EXCEPTION 'Quantity must be between 1 and 10';
  END IF;

  -- Lock the schedule row to prevent concurrent capacity checks
  SELECT capacity, scheduled_date, time_slot
  INTO v_capacity, v_scheduled_date, v_time_slot
  FROM menu_schedules
  WHERE id = p_menu_schedule_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule not found';
  END IF;

  -- Check for time slot conflict
  SELECT COALESCE(SUM(quantity), 0) INTO v_user_existing_quantity
  FROM bookings b
  JOIN menu_schedules ms ON ms.id = b.menu_schedule_id
  WHERE b.user_id = p_user_id
    AND b.status IN ('pending', 'confirmed')
    AND ms.scheduled_date = v_scheduled_date
    AND ms.time_slot = v_time_slot;

  IF v_user_existing_quantity > 0 THEN
    RAISE EXCEPTION 'You already have a booking at this time slot with % portion(s). Cancel it first to book again.', v_user_existing_quantity;
  END IF;

  -- Check capacity
  SELECT COALESCE(SUM(quantity), 0) INTO v_current_count
  FROM bookings
  WHERE menu_schedule_id = p_menu_schedule_id
    AND status IN ('pending', 'confirmed');

  IF (v_current_count + p_quantity) > v_capacity THEN
    RAISE EXCEPTION 'Not enough capacity. Only % spots remaining, but you requested %.', (v_capacity - v_current_count), p_quantity;
  END IF;

  -- Create the booking (always confirmed)
  INSERT INTO bookings (user_id, menu_schedule_id, status, notes, quantity)
  VALUES (p_user_id, p_menu_schedule_id, v_status, p_notes, p_quantity)
  RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;

-- 2. Ensure the auto-confirm setting stays enabled (kept for backward compatibility).
INSERT INTO app_settings (key, value, description) VALUES
  ('auto_confirm_enabled', 'true', 'Auto-confirm/approve all placed orders')
ON CONFLICT (key) DO UPDATE SET value = 'true';
