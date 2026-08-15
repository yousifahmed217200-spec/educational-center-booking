-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - DATABASE SCHEMA
-- ============================================================================
-- Run this FIRST in the Supabase SQL Editor.
--
-- ARCHITECTURE / RELATIONSHIPS:
--
--   grades ──< subject_grades >── subjects
--                                    │
--   teachers ──< teacher_subjects >──┘   (teacher_subjects also references grade_id
--                                          so a teacher can teach a subject only for
--                                          specific grades)
--
--   teacher_subjects ──< lesson_slots   (a slot always belongs to exactly one
--                                         teacher+subject+grade combination)
--
--   students ──< reservations >── grades
--   reservations ──< reservation_items >── (subject, teacher, slot)
--
-- Capacity is NEVER stored as a mutable counter. It is always computed as:
--     capacity - count(reservation_items where reservation.status = 'confirmed')
-- This is enforced inside the create_reservation() function using row locking,
-- see functions.sql.
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
-- GRADES
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
-- SUBJECTS (global catalog; grade-eligibility handled via subject_grades)
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
-- SUBJECT_GRADES: which subjects are offered for which grades
-- ----------------------------------------------------------------------------
create table if not exists subject_grades (
    id uuid primary key default gen_random_uuid(),
    subject_id uuid not null references subjects(id) on delete cascade,
    grade_id uuid not null references grades(id) on delete cascade,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (subject_id, grade_id)
);

create index if not exists idx_subject_grades_grade on subject_grades (grade_id);
create index if not exists idx_subject_grades_subject on subject_grades (subject_id);
create index if not exists idx_subject_grades_active on subject_grades (active);

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
-- for a specific grade. This is the join table that makes the whole
-- Grade -> Subject -> Teacher chain explicit and queryable.
-- ----------------------------------------------------------------------------
create table if not exists teacher_subjects (
    id uuid primary key default gen_random_uuid(),
    teacher_id uuid not null references teachers(id) on delete cascade,
    subject_id uuid not null references subjects(id) on delete cascade,
    grade_id uuid not null references grades(id) on delete cascade,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (teacher_id, subject_id, grade_id)
);

create index if not exists idx_teacher_subjects_teacher on teacher_subjects (teacher_id);
create index if not exists idx_teacher_subjects_subject on teacher_subjects (subject_id);
create index if not exists idx_teacher_subjects_grade on teacher_subjects (grade_id);
create index if not exists idx_teacher_subjects_active on teacher_subjects (active);
-- Composite index: this is THE lookup used every time the frontend loads
-- teachers for a chosen grade+subject.
create index if not exists idx_teacher_subjects_grade_subject on teacher_subjects (grade_id, subject_id) where active = true;

-- ----------------------------------------------------------------------------
-- LESSON_SLOTS: a concrete bookable time slot tied to one
-- teacher_subject combination (which already encodes teacher+subject+grade).
-- ----------------------------------------------------------------------------
create table if not exists lesson_slots (
    id uuid primary key default gen_random_uuid(),
    teacher_subject_id uuid not null references teacher_subjects(id) on delete cascade,
    -- denormalized for simpler queries/filtering & to keep historical accuracy
    grade_id uuid not null references grades(id),
    subject_id uuid not null references subjects(id),
    teacher_id uuid not null references teachers(id),
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
create index if not exists idx_lesson_slots_active on lesson_slots (active);
-- The exact filter combination the booking flow uses (grade+subject+teacher):
create index if not exists idx_lesson_slots_filter on lesson_slots (grade_id, subject_id, teacher_id) where active = true;

-- ----------------------------------------------------------------------------
-- STUDENTS
-- ----------------------------------------------------------------------------
create table if not exists students (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(trim(full_name)) >= 3),
    mobile text not null,          -- normalized to 01XXXXXXXXX (11 digits)
    age integer not null check (age between 3 and 100),
    gender text not null check (gender in ('male', 'female')),
    parent_name text not null check (char_length(trim(parent_name)) >= 3),
    parent_mobile text not null,   -- normalized to 01XXXXXXXXX
    email text,
    created_at timestamptz not null default now()
);

create index if not exists idx_students_mobile on students (mobile);
create index if not exists idx_students_created_at on students (created_at);

-- ----------------------------------------------------------------------------
-- RESERVATIONS
-- ----------------------------------------------------------------------------
create table if not exists reservations (
    id uuid primary key default gen_random_uuid(),
    reservation_code text not null unique, -- e.g. EDU-20260813-00125
    student_id uuid not null references students(id) on delete cascade,
    grade_id uuid not null references grades(id),
    status text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'pending')),
    idempotency_key text unique, -- protects against duplicate double-click submissions
    created_at timestamptz not null default now()
);

create index if not exists idx_reservations_student on reservations (student_id);
create index if not exists idx_reservations_grade on reservations (grade_id);
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
