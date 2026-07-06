-- Migration 022: Link scheduled meals back to their originating routine
-- Enables cascading delete and edit-sync between a routine and the calendar
-- meals (menu_schedules / student_tiffin_menu) that were generated from it.

-- Employee schedules
ALTER TABLE menu_schedules
  ADD COLUMN IF NOT EXISTS routine_id UUID REFERENCES meal_routines(id) ON DELETE SET NULL;

-- Student tiffin menu
ALTER TABLE student_tiffin_menu
  ADD COLUMN IF NOT EXISTS routine_id UUID REFERENCES meal_routines(id) ON DELETE SET NULL;

-- Indexes for fast lookup of a routine's generated schedules
CREATE INDEX IF NOT EXISTS idx_menu_schedules_routine_id ON menu_schedules(routine_id);
CREATE INDEX IF NOT EXISTS idx_tiffin_menu_routine_id ON student_tiffin_menu(routine_id);
