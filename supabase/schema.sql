-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - DATABASE SCHEMA
-- ============================================================================
-- Run this FIRST in the Supabase SQL Editor.
--
-- ARCHITECTURE / RELATIONSHIPS (school_type is now an independent filter,
-- orthogonal to grade -- the SAME grade, e.g. "Grade 3 Secondary", exists
-- once and applies to BOTH school types; school_type only determines which
-- SUBJECTS/TEACHERS/SLOTS are reachable for that grade):
--
--   grades (school-type-agnostic; no track/school_type column)
--     │
--     ▼ (subject_grades: grade_id + subject_id + optional school_type
--         restriction -- NULL = offered for BOTH school types)
--   subjects
--     │
--     ▼ (teacher_subjects: teacher_id + subject_id + grade_id + REQUIRED
--         school_type -- a teacher's assignment is always for exactly ONE
--         school type, never ambiguous)
--   teachers
--     │
--     ▼ (lesson_slots: tied to one teacher_subjects row; school_type is
--         denormalized onto the slot too, copied from the assignment, so
--         every slot query and the final booking-transaction check can
--         filter/verify school_type directly without an extra join)
--   slots
--
--   students ──< reservations >── grades   (+ reservations.school_type)
--   reservations ──< reservation_items >── (subject, teacher, slot)
--
-- Capacity is NEVER stored as a mutable counter. It is always computed as:
--     capacity - count(reservation_items where reservation.status = 'confirmed')
-- This is enforced inside the create_reservation() function using row locking,
-- see functions.sql.
--
-- NOTE ON STUDENT AGE: there is intentionally NO age/date-of-birth column
-- anywhere in this schema. The frontend does not collect it.
-- ============================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ----------------------------------------------------------------------------
-- CENTER CONFIGURATION (single-row settings table so the center name etc.
-- is configurable from the DB instead of hardcoded in the frontend)
-- ----------------------------------------------------------------------------
create table if not exists center_settings (
    id smallint primary key default 1,
    center_name text not null default 'Bright Path Educational Center',
    center_tagline text not null default 'Book your lessons easily and choose the subjects, teachers and schedules that suit you.',
    admin_notification_email text not null default 'yousif.ahmed217@gmail.com',
    timezone text not null default 'Africa/Cairo',
    constraint center_settings_singleton check (id = 1)
);

insert into center_settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- GRADES: school-type-agnostic. The same grade (e.g. "Grade 3 Secondary")
-- is shared across مدرسة عربي and مدرسة لغات -- what differs between the
-- two is which subjects/teachers/slots are reachable, not the grade list.
-- ----------------------------------------------------------------------------
create table if not exists grades (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    display_order integer not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_grades_active on grades (active);

-- ----------------------------------------------------------------------------
-- SUBJECTS (global catalog; grade+school_type-eligibility handled via
-- subject_grades)
-- ----------------------------------------------------------------------------
create table if not exists subjects (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    description text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_subjects_active on subjects (active);

-- ----------------------------------------------------------------------------
-- SUBJECT_GRADES: which subjects are offered for which grades, optionally
-- restricted to one school type. school_type = NULL means "offered for
-- both مدرسة عربي and مدرسة لغات" (e.g. Mathematics, Physics). A row with
-- school_type = 'arabic' means that subject only shows up for طلاب مدرسة
-- عربي at that grade (e.g. Arabic-as-a-subject); 'languages' likewise for
-- مدرسة لغات (e.g. French).
-- ----------------------------------------------------------------------------
create table if not exists subject_grades (
    id uuid primary key default gen_random_uuid(),
    subject_id uuid not null references subjects(id) on delete cascade,
    grade_id uuid not null references grades(id) on delete cascade,
    school_type text check (school_type in ('arabic', 'languages')), -- NULL = both
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (subject_id, grade_id, school_type)
);
create index if not exists idx_subject_grades_grade on subject_grades (grade_id);
create index if not exists idx_subject_grades_subject on subject_grades (subject_id);
create index if not exists idx_subject_grades_active on subject_grades (active);
create index if not exists idx_subject_grades_school_type on subject_grades (school_type);

-- ----------------------------------------------------------------------------
-- TEACHERS
-- ----------------------------------------------------------------------------
create table if not exists teachers (
    id uuid primary key default gen_random_uuid(),
    full_name text not null,
    title text, -- e.g. "Mathematics Teacher"
    bio text,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_teachers_active on teachers (active);

-- ----------------------------------------------------------------------------
-- TEACHER_SUBJECTS: defines that a teacher can teach a specific subject
-- for a specific grade AND a specific school type. school_type here is
-- REQUIRED (never NULL) -- a teacher's assignment always belongs to exactly
-- one school type, e.g. Ahmed Hassan teaches Math for Grade 3 Secondary
-- under مدرسة عربي only; a different assignment row would be needed for
-- him to also teach under مدرسة لغات.
-- ----------------------------------------------------------------------------
create table if not exists teacher_subjects (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references teachers(id) on delete cascade,
    subject_id uuid not null references subjects(id) on delete cascade,
    grade_id uuid not null references grades(id) on delete cascade,
    school_type text not null check (school_type in ('arabic', 'languages')),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (teacher_id, subject_id, grade_id, school_type)
);

create index if not exists idx_teacher_subjects_teacher on teacher_subjects (teacher_id);
create index if not exists idx_teacher_subjects_subject on teacher_subjects (subject_id);
create index if not exists idx_teacher_subjects_grade on teacher_subjects (grade_id);
create index if not exists idx_teacher_subjects_active on teacher_subjects (active);
create index if not exists idx_teacher_subjects_school_type on teacher_subjects (school_type);
-- Composite index: this is THE lookup used every time the frontend loads
-- teachers for a chosen grade+school_type+subject.
create index if not exists idx_teacher_subjects_lookup on teacher_subjects (grade_id, school_type, subject_id) where active = true;

-- ----------------------------------------------------------------------------
-- LESSON_SLOTS: a concrete bookable time slot tied to one
-- teacher_subject combination (which already encodes teacher+subject+grade+
-- school_type). school_type is ALSO denormalized directly onto the slot
-- (copied from the parent teacher_subjects row at insert time) so that:
--   (a) every read query can filter on lesson_slots.school_type directly
--       without an extra join, and
--   (b) the final booking transaction can do a defense-in-depth check that
--       the slot's own school_type matches what the student selected --
--       this is what prevents a tampered frontend request from booking a
--       مدرسة عربي teacher's slot while claiming مدرسة لغات, or vice versa.
-- ----------------------------------------------------------------------------
create table if not exists lesson_slots (
    id uuid primary key default gen_random_uuid(),
    teacher_subject_id uuid not null references teacher_subjects(id) on delete cascade,
    -- denormalized for simpler/faster queries & defense-in-depth validation
    grade_id uuid not null references grades(id),
    subject_id uuid not null references subjects(id),
    teacher_id uuid not null references teachers(id),
    school_type text not null check (school_type in ('arabic', 'languages')),
    day_of_week smallint not null check (day_of_week between 0 and 6), -- 0=Sunday .. 6=Saturday
    start_time time not null,
    end_time time not null,
    capacity integer not null default 5 check (capacity > 0),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    constraint valid_time_range check (end_time > start_time)
);

create index if not exists idx_lesson_slots_teacher_subject on lesson_slots (teacher_subject_id);
create index if not exists idx_lesson_slots_grade on lesson_slots (grade_id);
create index if not exists idx_lesson_slots_subject on lesson_slots (subject_id);
create index if not exists idx_lesson_slots_teacher on lesson_slots (teacher_id);
create index if not exists idx_lesson_slots_school_type on lesson_slots (school_type);
create index if not exists idx_lesson_slots_active on lesson_slots (active);
-- The exact filter combination the booking flow uses:
create index if not exists idx_lesson_slots_filter on lesson_slots (grade_id, school_type, subject_id, teacher_id) where active = true;

-- ----------------------------------------------------------------------------
-- STUDENTS
-- NOTE: intentionally NO age column. Do not re-add one.
-- ----------------------------------------------------------------------------
create table if not exists students (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(trim(full_name)) >= 3),
    mobile text not null,          -- normalized to 01XXXXXXXXX (11 digits)
    gender text not null check (gender in ('male', 'female')),
    parent_name text not null check (char_length(trim(parent_name)) >= 3),
    parent_mobile text not null,   -- normalized to 01XXXXXXXXX
    email text,
    created_at timestamptz not null default now()
);

create index if not exists idx_students_mobile on students (mobile);
create index if not exists idx_students_created_at on students (created_at);

-- ----------------------------------------------------------------------------
-- RESERVATIONS: school_type is captured once at the reservation level
-- (the student picks it once, before subjects) and every item in this
-- reservation must belong to that same school_type -- enforced in
-- create_reservation().
-- ----------------------------------------------------------------------------
create table if not exists reservations (
    id uuid primary key default gen_random_uuid(),
    reservation_code text not null unique, -- e.g. EDU-20260830-00125
    student_id uuid not null references students(id) on delete cascade,
    grade_id uuid not null references grades(id),
    school_type text not null check (school_type in ('arabic', 'languages')),
    status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'pending')),
    idempotency_key text unique, -- protects against duplicate double-click submissions
    created_at timestamptz not null default now()
);

create index if not exists idx_reservations_student on reservations (student_id);
create index if not exists idx_reservations_grade on reservations (grade_id);
create index if not exists idx_reservations_school_type on reservations (school_type);
create index if not exists idx_reservations_status on reservations (status);
create index if not exists idx_reservations_created_at on reservations (created_at);

-- ----------------------------------------------------------------------------
-- RESERVATION_ITEMS: one row per booked (subject, teacher, slot) in a
-- reservation. This is what capacity is computed FROM (never a stored counter).
-- ----------------------------------------------------------------------------
create table if not exists reservation_items (
    id uuid primary key default gen_random_uuid(),
    reservation_id uuid not null references reservations(id) on delete cascade,
    subject_id uuid not null references subjects(id),
    teacher_id uuid not null references teachers(id),
    slot_id uuid not null references lesson_slots(id),
    created_at timestamptz not null default now()
);

create index if not exists idx_reservation_items_reservation on reservation_items (reservation_id);
create index if not exists idx_reservation_items_slot on reservation_items (slot_id);
create index if not exists idx_reservation_items_subject on reservation_items (subject_id);
create index if not exists idx_reservation_items_teacher on reservation_items (teacher_id);

-- A student should not be able to double-book the exact same slot twice
-- across different reservations. (Same reservation duplicate subjects are
-- prevented at the application/RPC level.)
create unique index if not exists idx_unique_active_slot_per_student
    on reservation_items (slot_id, reservation_id);

-- ----------------------------------------------------------------------------
-- ADMIN USERS: maps a Supabase Auth user (auth.users.id) to admin role.
-- Having a dedicated table (rather than trusting a JWT claim) lets us
-- revoke admin access instantly and lets RLS policies check membership.
-- ----------------------------------------------------------------------------
create table if not exists admin_users (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- RESERVATION CODE SEQUENCE (per-day sequence used to build EDU-YYYYMMDD-XXXXX)
-- ----------------------------------------------------------------------------
create sequence if not exists reservation_code_seq;
