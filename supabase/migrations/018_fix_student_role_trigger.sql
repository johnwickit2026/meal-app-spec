-- Migration 018: Fix handle_new_user trigger to honour 'student' role from signup metadata
-- Previously the trigger hardcoded role = 'employee', requiring the frontend to resolve
-- the correct role from user_metadata. This migration fixes both:
--   1. The trigger so new sign-ups get the correct role in the DB.
--   2. Existing users whose metadata says 'student' but DB has 'employee'.

-- 1. Update the trigger function to read role from raw_user_meta_data when valid
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- Accept 'student' from signup metadata; everything else defaults to 'employee'
  v_role := CASE
    WHEN NEW.raw_user_meta_data->>'role' = 'student' THEN 'student'
    ELSE 'employee'
  END;

  INSERT INTO public.profiles (id, full_name, email, department, dietary_preferences, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    NEW.email,
    NEW.raw_user_meta_data->>'department',
    NULL,
    v_role,
    false  -- Must be approved by admin before logging in
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Fix existing users: if auth.users metadata has role='student' but profiles has 'employee',
--    update profiles to 'student' so API and RLS checks are consistent.
UPDATE public.profiles p
SET role = 'student'
FROM auth.users u
WHERE p.id = u.id
  AND p.role = 'employee'
  AND u.raw_user_meta_data->>'role' = 'student';
