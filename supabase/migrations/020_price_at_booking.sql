-- Add price snapshot to bookings
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS price_at_booking DECIMAL(10,2);

-- Add price snapshot to student_orders  
ALTER TABLE student_orders
ADD COLUMN IF NOT EXISTS price_at_booking DECIMAL(10,2);

-- Backfill existing bookings with current meal price
UPDATE bookings b
SET price_at_booking = ms.price
FROM menu_schedules ms
WHERE b.menu_schedule_id = ms.id
AND b.price_at_booking IS NULL;

-- Backfill student orders
UPDATE student_orders so
SET price_at_booking = stm.price
FROM student_tiffin_menu stm
WHERE so.tiffin_menu_id = stm.id
AND so.price_at_booking IS NULL;
