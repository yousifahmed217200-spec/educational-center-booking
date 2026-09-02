-- ============================================================================
-- REBUILD SCHEMA FOR SCHOOL-TYPE ARCHITECTURE
-- ============================================================================
-- Run this ONLY IF you already have an existing database from a previous
-- version of this project (the one with grades.track and students.age).
-- The school-type change restructures several tables with new required
-- columns and constraints, which is safer to rebuild than to ALTER in place.
--
-- This drops the booking-related tables ONLY. It does NOT touch:
--   - center_settings   (your center name/settings)
--   - admin_users       (your admin login access)
--
-- STEPS:
--   1. Run this file.
--   2. Then run the updated schema.sql (recreates everything fresh).
--   3. Then run the updated functions.sql.
--   4. Then run rls.sql (safe to re-run; policies use CREATE POLICY, so if
--      you get "already exists" errors, that's fine -- it means RLS is
--      already in place; otherwise drop+recreate policies if needed).
--   5. Then run the updated seed.sql for fresh, school-type-aware sample
--      data, OR skip seed.sql and enter your real data via admin.html.
-- ============================================================================

drop table if exists reservation_items cascade;
drop table if exists reservations cascade;
drop table if exists lesson_slots cascade;
drop table if exists teacher_subjects cascade;
drop table if exists subject_grades cascade;
drop table if exists teachers cascade;
drop table if exists subjects cascade;
drop table if exists students cascade;
drop table if exists grades cascade;

-- Function signatures are changing too (new school_type parameters), so
-- drop them here rather than relying on CREATE OR REPLACE, which fails if
-- the parameter list changes.
drop function if exists create_reservation(jsonb, uuid, jsonb, text);
drop function if exists get_reservation_confirmation(uuid);
drop function if exists available_slots(uuid, uuid, uuid);
drop function if exists available_grades_for_track(text);
drop function if exists available_subjects_for_grade_and_school_type(uuid, text);
drop function if exists available_teachers_for_subject(uuid, text, uuid);
