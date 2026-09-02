-- ============================================================================
-- RESET SAMPLE DATA
-- ============================================================================
-- Run this ONCE in the Supabase SQL Editor to remove ALL the sample/seed
-- data (grades, subjects, teachers, assignments, slots, students, and
-- reservations) so you can start entering your real data from a clean
-- slate via the admin panel.
--
-- SAFE / NOT TOUCHED by this script:
--   - center_settings   (your center name, admin email, etc.)
--   - admin_users       (your admin login access)
--
-- Deletes are ordered to respect foreign keys (children before parents).
-- ============================================================================

delete from reservation_items;
delete from reservations;
delete from students;
delete from lesson_slots;
delete from teacher_subjects;
delete from subject_grades;
delete from teachers;
delete from subjects;
delete from grades;

alter sequence reservation_code_seq restart with 1;

-- ============================================================================
-- Done. Next steps (grades are NOT school-type-specific anymore -- the SAME
-- grade list applies to both مدرسة عربي and مدرسة لغات; school type only
-- affects which subjects/teachers/slots show up):
--   1. Open admin.html and log in.
--   2. Add your grades (no school-type choice needed here).
--   3. Add subjects, then link each to grades -- for each grade you link,
--      choose "Both school types", "Arabic school only", or "Languages
--      school only" for that subject.
--   4. Add teachers.
--   5. Add teacher assignments -- pick Grade, then School Type, then
--      Subject (filtered to subjects linked to that grade+school type),
--      then Teacher.
--   6. Add lesson slots for each assignment.
-- ============================================================================
