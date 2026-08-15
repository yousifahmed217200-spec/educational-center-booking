-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - DATABASE FUNCTIONS
-- ============================================================================
-- Run this AFTER schema.sql and BEFORE rls.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- is_admin(): checks if the currently authenticated user (auth.uid()) is
-- present in admin_users. Used everywhere in RLS policies instead of trusting
-- any client-supplied flag.
-- ----------------------------------------------------------------------------
create or replace function is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from admin_users where id = auth.uid()
    );
$$;

-- ----------------------------------------------------------------------------
-- normalize_egyptian_mobile(text): validates & normalizes an Egyptian mobile
-- number to the canonical 11-digit local form: 01XXXXXXXXX
-- Accepts: 010/011/012/015 + 8 digits, optionally prefixed with +20, 0020, or 20.
-- Raises an exception if the number is invalid - this is the BACKEND
-- enforcement point; the frontend check is only for UX.
-- ----------------------------------------------------------------------------
create or replace function normalize_egyptian_mobile(raw text)
returns text
language plpgsql
immutable
as $$
declare
    cleaned text;
    local_number text;
begin
    if raw is null then
        raise exception 'Mobile number is required';
    end if;

    -- strip spaces, dashes, parentheses
    cleaned := regexp_replace(raw, '[\s\-\(\)]', '', 'g');

    -- normalize different international prefixes to local form
    if cleaned like '+20%' then
        local_number := '0' || substring(cleaned from 4);
    elsif cleaned like '0020%' then
        local_number := '0' || substring(cleaned from 5);
    elsif cleaned like '20%' and length(cleaned) = 12 then
        local_number := '0' || substring(cleaned from 3);
    else
        local_number := cleaned;
    end if;

    if local_number !~ '^01[0125][0-9]{8}$' then
        raise exception 'Invalid Egyptian mobile number: %', raw;
    end if;

    return local_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- generate_reservation_code(): produces EDU-YYYYMMDD-XXXXX using a DB
-- sequence, guaranteeing uniqueness even under concurrent inserts.
-- ----------------------------------------------------------------------------
create or replace function generate_reservation_code()
returns text
language plpgsql
as $$
declare
    seq_val bigint;
    today_str text;
begin
    seq_val := nextval('reservation_code_seq');
    today_str := to_char((now() at time zone 'Africa/Cairo'), 'YYYYMMDD');
    return 'EDU-' || today_str || '-' || lpad((seq_val % 100000)::text, 5, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- create_reservation(): THE core booking transaction.
--
-- p_student            jsonb  { full_name, mobile, age, gender, parent_name, parent_mobile, email }
-- p_grade_id           uuid
-- p_items              jsonb  array of { subject_id, teacher_id, slot_id }
-- p_idempotency_key    text   client-generated key; a retry with the same key
--                              returns the SAME reservation instead of creating
--                              a duplicate (handles double-click / retry-on-timeout).
--
-- This function is SECURITY DEFINER so it can write to students/reservations/
-- reservation_items even though the anon role has no direct INSERT rights on
-- those tables (see rls.sql). All validation happens here server-side.
--
-- Concurrency safety: for every slot we `select ... for update` the slot row
-- (via its lesson_slots primary key) which takes a row lock for the duration
-- of the transaction. Combined with a fresh count of reservation_items done
-- AFTER acquiring that lock, two simultaneous requests for the last seat are
-- serialized - the second transaction will see the first one's committed
-- reservation_items (once it proceeds) and correctly reject.
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
    -- ---- Idempotency check: if this exact key was already used, return the
    -- existing reservation instead of creating a duplicate. ----
    if p_idempotency_key is not null then
        select id into v_existing_reservation_id
        from reservations
        where idempotency_key = p_idempotency_key;

        if v_existing_reservation_id is not null then
            return get_reservation_confirmation(v_existing_reservation_id);
        end if;
    end if;

    -- ---- Validate grade ----
    if not exists (select 1 from grades where id = p_grade_id and active = true) then
        raise exception 'INVALID_GRADE: selected grade is not available';
    end if;

    -- ---- Validate & extract student fields ----
    v_full_name := trim(p_student->>'full_name');
    v_parent_name := trim(p_student->>'parent_name');
    v_age := (p_student->>'age')::int;
    v_gender := p_student->>'gender';
    v_email := nullif(trim(p_student->>'email'), '');

    if v_full_name is null or char_length(v_full_name) < 3 then
        raise exception 'INVALID_NAME: full name must be at least 3 characters';
    end if;
    if v_parent_name is null or char_length(v_parent_name) < 3 then
        raise exception 'INVALID_PARENT_NAME: parent name must be at least 3 characters';
    end if;
    if v_age is null or v_age < 3 or v_age > 100 then
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

    -- ---- Validate items array ----
    if p_items is null or jsonb_array_length(p_items) = 0 then
        raise exception 'NO_SUBJECTS_SELECTED: at least one subject/slot must be selected';
    end if;

    -- ---- Insert student ----
    insert into students (full_name, mobile, age, gender, parent_name, parent_mobile, email)
    values (v_full_name, v_mobile, v_age, v_gender, v_parent_name, v_parent_mobile, v_email)
    returning id into v_student_id;

    -- ---- Create the reservation shell first (code generated now) ----
    v_reservation_code := generate_reservation_code();

    insert into reservations (reservation_code, student_id, grade_id, status, idempotency_key)
    values (v_reservation_code, v_student_id, p_grade_id, 'confirmed', p_idempotency_key)
    returning id into v_reservation_id;

    -- ---- Process each requested (subject, teacher, slot) ----
    for v_item in select * from jsonb_array_elements(p_items)
    loop
        v_subject_id := (v_item->>'subject_id')::uuid;
        v_teacher_id := (v_item->>'teacher_id')::uuid;
        v_slot_id := (v_item->>'slot_id')::uuid;

        if v_subject_id = any(v_seen_subjects) then
            raise exception 'DUPLICATE_SUBJECT: subject % selected more than once', v_subject_id;
        end if;
        v_seen_subjects := array_append(v_seen_subjects, v_subject_id);

        -- Lock the slot row for the duration of this transaction. This is
        -- the crux of the anti-overbooking guarantee: concurrent bookers
        -- of the SAME slot will queue here one at a time.
        select ls.id, ls.capacity, ls.active, ls.grade_id, ls.subject_id, ls.teacher_id,
               ls.day_of_week, ls.start_time, ls.end_time
        into v_slot
        from lesson_slots ls
        where ls.id = v_slot_id
        for update;

        if v_slot.id is null or v_slot.active = false then
            raise exception 'SLOT_UNAVAILABLE: the selected lesson slot is no longer available';
        end if;

        -- Verify the slot actually belongs to the requested grade/subject/teacher
        -- combination (defends against a tampered client request).
        if v_slot.grade_id <> p_grade_id
           or v_slot.subject_id <> v_subject_id
           or v_slot.teacher_id <> v_teacher_id then
            raise exception 'SLOT_MISMATCH: slot does not match the selected grade/subject/teacher';
        end if;

        -- Verify the teacher_subject relationship is actually active
        if not exists (
            select 1 from teacher_subjects ts
            where ts.teacher_id = v_teacher_id
              and ts.subject_id = v_subject_id
              and ts.grade_id = p_grade_id
              and ts.active = true
        ) then
            raise exception 'INVALID_TEACHER_ASSIGNMENT: teacher is not assigned to this subject/grade';
        end if;

        -- Verify subject is valid for this grade
        if not exists (
            select 1 from subject_grades sg
            where sg.subject_id = v_subject_id
              and sg.grade_id = p_grade_id
              and sg.active = true
        ) then
            raise exception 'SUBJECT_NOT_IN_GRADE: subject is not offered for this grade';
        end if;

        -- Now that we hold the lock, count CONFIRMED reservations for this slot.
        select count(*) into v_confirmed_count
        from reservation_items ri
        join reservations r on r.id = ri.reservation_id
        where ri.slot_id = v_slot_id
          and r.status = 'confirmed';

        if v_confirmed_count >= v_slot.capacity then
            raise exception 'SLOT_FULL: this lesson slot has just become fully booked';
        end if;

        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (v_reservation_id, v_subject_id, v_teacher_id, v_slot_id);

        v_result_items := v_result_items || jsonb_build_object(
            'subject_id', v_subject_id,
            'teacher_id', v_teacher_id,
            'slot_id', v_slot_id,
            'day_of_week', v_slot.day_of_week,
            'start_time', v_slot.start_time,
            'end_time', v_slot.end_time
        );
    end loop;

    return get_reservation_confirmation(v_reservation_id);
exception
    when others then
        -- Any failure (including SLOT_FULL raised above) rolls back the
        -- ENTIRE transaction automatically - no partial reservation is left
        -- behind. Re-raise so the caller (Edge Function / PostgREST RPC) sees it.
        raise;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_reservation_confirmation(): returns a full, human-friendly JSON
-- payload for a reservation (used both by create_reservation's return value
-- and by the idempotent-replay path).
-- ----------------------------------------------------------------------------
create or replace function get_reservation_confirmation(p_reservation_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
    select jsonb_build_object(
        'reservation_id', r.id,
        'reservation_code', r.reservation_code,
        'status', r.status,
        'created_at', r.created_at,
        'student', jsonb_build_object(
            'full_name', s.full_name,
            'mobile', s.mobile,
            'age', s.age,
            'gender', s.gender,
            'parent_name', s.parent_name,
            'parent_mobile', s.parent_mobile,
            'email', s.email
        ),
        'grade', jsonb_build_object('id', g.id, 'name', g.name),
        'items', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'subject_id', sub.id,
                'subject_name', sub.name,
                'teacher_id', t.id,
                'teacher_name', t.full_name,
                'day_of_week', ls.day_of_week,
                'start_time', ls.start_time,
                'end_time', ls.end_time
            ) order by ls.day_of_week, ls.start_time), '[]'::jsonb)
            from reservation_items ri
            join subjects sub on sub.id = ri.subject_id
            join teachers t on t.id = ri.teacher_id
            join lesson_slots ls on ls.id = ri.slot_id
            where ri.reservation_id = r.id
        )
    )
    from reservations r
    join students s on s.id = r.student_id
    join grades g on g.id = r.grade_id
    where r.id = p_reservation_id;
$$;

-- ----------------------------------------------------------------------------
-- available_slots(): returns lesson slots for a grade+subject+teacher with
-- remaining seats computed live, EXCLUDING slots that are full. This is the
-- function the frontend calls (instead of querying lesson_slots directly)
-- so the "full slots must not appear" rule is enforced server-side, not by
-- frontend filtering.
-- ----------------------------------------------------------------------------
create or replace function available_slots(
    p_grade_id uuid,
    p_subject_id uuid,
    p_teacher_id uuid
)
returns table (
    id uuid,
    day_of_week smallint,
    start_time time,
    end_time time,
    capacity integer,
    remaining integer
)
language sql
security definer
stable
set search_path = public
as $$
    select
        ls.id,
        ls.day_of_week,
        ls.start_time,
        ls.end_time,
        ls.capacity,
        (ls.capacity - coalesce(counts.confirmed_count, 0))::integer as remaining
    from lesson_slots ls
    left join (
        select ri.slot_id, count(*) as confirmed_count
        from reservation_items ri
        join reservations r on r.id = ri.reservation_id
        where r.status = 'confirmed'
        group by ri.slot_id
    ) counts on counts.slot_id = ls.id
    where ls.grade_id = p_grade_id
      and ls.subject_id = p_subject_id
      and ls.teacher_id = p_teacher_id
      and ls.active = true
      and (ls.capacity - coalesce(counts.confirmed_count, 0)) > 0
    order by ls.day_of_week, ls.start_time;
$$;

grant execute on function is_admin() to anon, authenticated;
grant execute on function normalize_egyptian_mobile(text) to anon, authenticated;
grant execute on function create_reservation(jsonb, uuid, jsonb, text) to anon, authenticated;
grant execute on function get_reservation_confirmation(uuid) to anon, authenticated;
grant execute on function available_slots(uuid, uuid, uuid) to anon, authenticated;
