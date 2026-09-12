-- ============================================================================
-- RESET RLS POLICIES
-- ============================================================================
-- Run this BEFORE re-running rls.sql if you get "policy ... already exists"
-- errors. It drops every policy this project creates (on every table it
-- touches) so rls.sql can recreate them cleanly. Safe to run even if some
-- policies don't exist yet -- "if exists" makes each drop a no-op in that
-- case rather than an error.
-- ============================================================================

drop policy if exists "public can read center settings" on center_settings;
drop policy if exists "admins can update center settings" on center_settings;

drop policy if exists "public can read active grades" on grades;
drop policy if exists "admins manage grades" on grades;
drop policy if exists "admins update grades" on grades;
drop policy if exists "admins delete grades" on grades;

drop policy if exists "public can read active subjects" on subjects;
drop policy if exists "admins manage subjects insert" on subjects;
drop policy if exists "admins manage subjects update" on subjects;
drop policy if exists "admins manage subjects delete" on subjects;

drop policy if exists "public can read active subject_grades" on subject_grades;
drop policy if exists "admins manage subject_grades insert" on subject_grades;
drop policy if exists "admins manage subject_grades update" on subject_grades;
drop policy if exists "admins manage subject_grades delete" on subject_grades;

drop policy if exists "public can read active teachers" on teachers;
drop policy if exists "admins manage teachers insert" on teachers;
drop policy if exists "admins manage teachers update" on teachers;
drop policy if exists "admins manage teachers delete" on teachers;

drop policy if exists "public can read active teacher_subjects" on teacher_subjects;
drop policy if exists "admins manage teacher_subjects insert" on teacher_subjects;
drop policy if exists "admins manage teacher_subjects update" on teacher_subjects;
drop policy if exists "admins manage teacher_subjects delete" on teacher_subjects;

drop policy if exists "public can read active lesson_slots" on lesson_slots;
drop policy if exists "admins manage lesson_slots insert" on lesson_slots;
drop policy if exists "admins manage lesson_slots update" on lesson_slots;
drop policy if exists "admins manage lesson_slots delete" on lesson_slots;

drop policy if exists "admins can read students" on students;
drop policy if exists "admins can update students" on students;

drop policy if exists "admins can read reservations" on reservations;
drop policy if exists "admins can update reservations" on reservations;
drop policy if exists "admins can delete reservations" on reservations;

drop policy if exists "admins can read reservation_items" on reservation_items;

drop policy if exists "admins can read admin_users" on admin_users;
