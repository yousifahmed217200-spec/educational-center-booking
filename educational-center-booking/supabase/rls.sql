-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - ROW LEVEL SECURITY
-- ============================================================================
-- Run this AFTER schema.sql and functions.sql.
--
-- PRINCIPLE:
--   - Public (anon) users can READ only the catalog data needed to build the
--     booking flow (active grades/subjects/teachers/relationships) and can
--     read live slot availability only through the available_slots() RPC
--     (which already excludes full slots).
--   - Public (anon) users have NO direct INSERT/UPDATE/DELETE rights on
--     students, reservations, reservation_items, or lesson_slots. All writes
--     go through the SECURITY DEFINER create_reservation() function, which
--     performs full server-side validation and capacity locking.
--   - Admins (rows present in admin_users, backed by Supabase Auth) get full
--     read/write access to everything via is_admin().
-- ============================================================================

alter table center_settings enable row level security;
alter table grades enable row level security;
alter table subjects enable row level security;
alter table subject_grades enable row level security;
alter table teachers enable row level security;
alter table teacher_subjects enable row level security;
alter table lesson_slots enable row level security;
alter table students enable row level security;
alter table reservations enable row level security;
alter table reservation_items enable row level security;
alter table admin_users enable row level security;

-- ----------------------------------------------------------------------------
-- CENTER_SETTINGS: publicly readable (needed for the welcome page name),
-- writable only by admins.
-- ----------------------------------------------------------------------------
create policy "public can read center settings"
    on center_settings for select
    using (true);

create policy "admins can update center settings"
    on center_settings for update
    using (is_admin())
    with check (is_admin());

-- ----------------------------------------------------------------------------
-- GRADES
-- ----------------------------------------------------------------------------
create policy "public can read active grades"
    on grades for select
    using (active = true or is_admin());

create policy "admins manage grades"
    on grades for insert
    with check (is_admin());
create policy "admins update grades"
    on grades for update
    using (is_admin()) with check (is_admin());
create policy "admins delete grades"
    on grades for delete
    using (is_admin());

-- ----------------------------------------------------------------------------
-- SUBJECTS
-- ----------------------------------------------------------------------------
create policy "public can read active subjects"
    on subjects for select
    using (active = true or is_admin());

create policy "admins manage subjects insert"
    on subjects for insert with check (is_admin());
create policy "admins manage subjects update"
    on subjects for update using (is_admin()) with check (is_admin());
create policy "admins manage subjects delete"
    on subjects for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- SUBJECT_GRADES
-- ----------------------------------------------------------------------------
create policy "public can read active subject_grades"
    on subject_grades for select
    using (active = true or is_admin());

create policy "admins manage subject_grades insert"
    on subject_grades for insert with check (is_admin());
create policy "admins manage subject_grades update"
    on subject_grades for update using (is_admin()) with check (is_admin());
create policy "admins manage subject_grades delete"
    on subject_grades for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- TEACHERS
-- ----------------------------------------------------------------------------
create policy "public can read active teachers"
    on teachers for select
    using (active = true or is_admin());

create policy "admins manage teachers insert"
    on teachers for insert with check (is_admin());
create policy "admins manage teachers update"
    on teachers for update using (is_admin()) with check (is_admin());
create policy "admins manage teachers delete"
    on teachers for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- TEACHER_SUBJECTS
-- ----------------------------------------------------------------------------
create policy "public can read active teacher_subjects"
    on teacher_subjects for select
    using (active = true or is_admin());

create policy "admins manage teacher_subjects insert"
    on teacher_subjects for insert with check (is_admin());
create policy "admins manage teacher_subjects update"
    on teacher_subjects for update using (is_admin()) with check (is_admin());
create policy "admins manage teacher_subjects delete"
    on teacher_subjects for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- LESSON_SLOTS: public can read active slots directly too (harmless - the
-- capacity/remaining computation and "hide full slots" logic is enforced by
-- available_slots(); direct reads are still restricted to active=true so
-- disabled slots never leak). No direct writes for anon.
-- ----------------------------------------------------------------------------
create policy "public can read active lesson_slots"
    on lesson_slots for select
    using (active = true or is_admin());

create policy "admins manage lesson_slots insert"
    on lesson_slots for insert with check (is_admin());
create policy "admins manage lesson_slots update"
    on lesson_slots for update using (is_admin()) with check (is_admin());
create policy "admins manage lesson_slots delete"
    on lesson_slots for delete using (is_admin());

-- ----------------------------------------------------------------------------
-- STUDENTS: no direct public access at all. Writes happen only inside the
-- SECURITY DEFINER create_reservation() function. Admins can read for the
-- dashboard.
-- ----------------------------------------------------------------------------
create policy "admins can read students"
    on students for select
    using (is_admin());
-- Intentionally NO insert/update/delete policy for anon/authenticated;
-- only the SECURITY DEFINER function (which bypasses RLS) can write here.
create policy "admins can update students"
    on students for update using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- RESERVATIONS: no direct public read/write. Confirmation data is fetched
-- via get_reservation_confirmation()/create_reservation() return values only.
-- ----------------------------------------------------------------------------
create policy "admins can read reservations"
    on reservations for select
    using (is_admin());
create policy "admins can update reservations"
    on reservations for update using (is_admin()) with check (is_admin());

-- ----------------------------------------------------------------------------
-- RESERVATION_ITEMS: same - admin read only, writes only via the function.
-- ----------------------------------------------------------------------------
create policy "admins can read reservation_items"
    on reservation_items for select
    using (is_admin());

-- ----------------------------------------------------------------------------
-- ADMIN_USERS: an admin can see the admin list; nobody (not even admins,
-- via the API) can insert themselves - new admins must be added manually
-- by an existing admin/owner via the SQL editor for safety.
-- ----------------------------------------------------------------------------
create policy "admins can read admin_users"
    on admin_users for select
    using (is_admin());
