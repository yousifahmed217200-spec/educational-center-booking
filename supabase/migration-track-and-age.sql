-- ============================================================================
-- MIGRATION: remove required age, add school "track" (Arabic-medium vs
-- Languages-medium) support on grades.
-- Run this once in the Supabase SQL Editor, AFTER the original schema.sql /
-- functions.sql / rls.sql / seed.sql have already been run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) AGE IS NOW OPTIONAL
-- ----------------------------------------------------------------------------
alter table students alter column age drop not null;
-- Note: the existing "age between 3 and 100" check constraint does not need
-- to be dropped — in PostgreSQL a CHECK constraint automatically passes for
-- NULL values, so it only ever fires when an age IS supplied but is invalid.

-- ----------------------------------------------------------------------------
-- 2) SCHOOL TRACK ON GRADES
-- ----------------------------------------------------------------------------
-- track = 'arabic'   -> Arabic-medium school (مدرسة عربي)
-- track = 'languages'-> Languages school (مدرسة لغات)
-- track = NULL       -> shown regardless of track (kept for existing/shared
--                        grades so nothing already seeded disappears).
--
-- Because every subject/teacher/slot is already keyed off grade_id, this one
-- column is enough to make the whole subject -> teacher -> slot chain
-- automatically track-aware: an admin creates separate grade rows per track
-- (e.g. "الصف الأول الثانوي" with track='arabic' and a second row with
-- track='languages'), then assigns different subjects/teachers/slots to each
-- — no other table needs to change.
-- ----------------------------------------------------------------------------
alter table grades add column if not exists track text check (track in ('arabic', 'languages'));
create index if not exists idx_grades_track on grades (track);

-- ----------------------------------------------------------------------------
-- 3) create_reservation(): age becomes optional; everything else unchanged.
-- This REPLACES the function defined in functions.sql.
-- ----------------------------------------------------------------------------
create or replace function create_reservation(
    p_student jsonb,
    p_grade_id uuid,
    p_items jsonb,
    p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existing_reservation_id uuid;
    v_student_id uuid;
    v_reservation_id uuid;
    v_reservation_code text;
    v_mobile text;
    v_parent_mobile text;
    v_full_name text;
    v_parent_name text;
    v_age int;
    v_gender text;
    v_email text;
    v_item jsonb;
    v_subject_id uuid;
    v_teacher_id uuid;
    v_slot_id uuid;
    v_slot record;
    v_confirmed_count int;
    v_seen_subjects uuid[] := '{}';
    v_result_items jsonb := '[]'::jsonb;
begin
    if p_idempotency_key is not null then
        select id into v_existing_reservation_id from reservations where idempotency_key = p_idempotency_key;
        if v_existing_reservation_id is not null then
            return get_reservation_confirmation(v_existing_reservation_id);
        end if;
    end if;

    if not exists (select 1 from grades where id = p_grade_id and active = true) then
        raise exception 'INVALID_GRADE: selected grade is not available';
    end if;

    v_full_name := trim(p_student->>'full_name');
    v_parent_name := trim(p_student->>'parent_name');
    v_gender := p_student->>'gender';
    v_email := nullif(trim(p_student->>'email'), '');
    -- age is now OPTIONAL: absent/empty -> NULL, no exception raised.
    v_age := nullif(p_student->>'age', '')::int;

    if v_full_name is null or char_length(v_full_name) < 3 then
        raise exception 'INVALID_NAME: full name must be at least 3 characters';
    end if;
    if v_parent_name is null or char_length(v_parent_name) < 3 then
        raise exception 'INVALID_PARENT_NAME: parent name must be at least 3 characters';
    end if;
    if v_age is not null and (v_age < 3 or v_age > 100) then
        raise exception 'INVALID_AGE: age must be between 3 and 100';
    end if;
    if v_gender is null or v_gender not in ('male', 'female') then
        raise exception 'INVALID_GENDER: gender must be male or female';
    end if;
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'INVALID_EMAIL: email address format is invalid';
    end if;

    v_mobile := normalize_egyptian_mobile(p_student->>'mobile');
    v_parent_mobile := normalize_egyptian_mobile(p_student->>'parent_mobile');

    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'NO_SUBJECTS_SELECTED: at least one subject/slot must be selected';
    end if;

    insert into students (full_name, mobile, age, gender, parent_name, parent_mobile, email)
    values (v_full_name, v_mobile, v_age, v_gender, v_parent_name, v_parent_mobile, v_email)
    returning id into v_student_id;

    v_reservation_code := generate_reservation_code();

    insert into reservations (reservation_code, student_id, grade_id, status, idempotency_key)
    values (v_reservation_code, v_student_id, p_grade_id, 'confirmed', p_idempotency_key)
    returning id into v_reservation_id;

    for v_item in select * from jsonb_array_elements(p_items)
    loop
        v_subject_id := (v_item->>'subject_id')::uuid;
        v_teacher_id := (v_item->>'teacher_id')::uuid;
        v_slot_id := (v_item->>'slot_id')::uuid;

        if v_subject_id = any(v_seen_subjects) then
            raise exception 'DUPLICATE_SUBJECT: subject % selected more than once', v_subject_id;
        end if;
        v_seen_subjects := array_append(v_seen_subjects, v_subject_id);

        select ls.id, ls.capacity, ls.active, ls.grade_id, ls.subject_id, ls.teacher_id,
               ls.day_of_week, ls.start_time, ls.end_time
        into v_slot
        from lesson_slots ls
        where ls.id = v_slot_id
        for update;

        if v_slot.id is null or v_slot.active = false then
            raise exception 'SLOT_UNAVAILABLE: the selected lesson slot is no longer available';
        end if;

        if v_slot.grade_id <> p_grade_id or v_slot.subject_id <> v_subject_id or v_slot.teacher_id <> v_teacher_id then
            raise exception 'SLOT_MISMATCH: slot does not match the selected grade/subject/teacher';
        end if;

        if not exists (
            select 1 from teacher_subjects ts
            where ts.teacher_id = v_teacher_id and ts.subject_id = v_subject_id and ts.grade_id = p_grade_id and ts.active = true
        ) then
            raise exception 'INVALID_TEACHER_ASSIGNMENT: teacher is not assigned to this subject/grade';
        end if;

        if not exists (
            select 1 from subject_grades sg
            where sg.subject_id = v_subject_id and sg.grade_id = p_grade_id and sg.active = true
        ) then
            raise exception 'SUBJECT_NOT_IN_GRADE: subject is not offered for this grade';
        end if;

        select count(*) into v_confirmed_count
        from reservation_items ri
        join reservations r on r.id = ri.reservation_id
        where ri.slot_id = v_slot_id and r.status = 'confirmed';

        if v_confirmed_count >= v_slot.capacity then
            raise exception 'SLOT_FULL: this lesson slot has just become fully booked';
        end if;

        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (v_reservation_id, v_subject_id, v_teacher_id, v_slot_id);

        v_result_items := v_result_items || jsonb_build_object(
            'subject_id', v_subject_id, 'teacher_id', v_teacher_id, 'slot_id', v_slot_id,
            'day_of_week', v_slot.day_of_week, 'start_time', v_slot.start_time, 'end_time', v_slot.end_time
        );
    end loop;

    return get_reservation_confirmation(v_reservation_id);
exception
    when others then raise;
end;
$$;

grant execute on function create_reservation(jsonb, uuid, jsonb, text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4) available_grades_for_track(): returns grades valid for a chosen track
-- (or with no track restriction), used by the new "school track" step.
-- ----------------------------------------------------------------------------
create or replace function available_grades_for_track(p_track text)
returns table (id uuid, name text, display_order integer, track text)
language sql
security definer
stable
set search_path = public
as $$
    select id, name, display_order, track
    from grades
    where active = true
      and (track is null or track = p_track)
    order by display_order;
$$;

grant execute on function available_grades_for_track(text) to anon, authenticated;
