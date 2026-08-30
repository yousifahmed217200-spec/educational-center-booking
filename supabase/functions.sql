-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - DATABASE FUNCTIONS
-- ============================================================================
-- Run this AFTER schema.sql and BEFORE rls.sql.
-- ============================================================================

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

    cleaned := regexp_replace(raw, '[\s\-\(\)]', '', 'g');

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
-- available_grades(): all active grades. Grades are NOT filtered by school
-- type -- the same grade list applies to both مدرسة عربي and مدرسة لغات;
-- only subjects/teachers/slots differ by school type.
-- ----------------------------------------------------------------------------
create or replace function available_grades()
returns table (id uuid, name text, display_order integer)
language sql
security definer
stable
set search_path = public
as $$
    select id, name, display_order
    from grades
    where active = true
    order by display_order;
$$;

-- ----------------------------------------------------------------------------
-- available_subjects_for_grade(): returns ONLY subjects that are actually
-- bookable for a given grade + school_type combination. A subject appears
-- only if: (1) linked via subject_grades with matching/NULL school_type,
-- (2) at least one active teacher_subjects assignment exists for this exact
-- grade+school_type+subject, (3) that teacher has an active slot, and
-- (4) that slot has remaining capacity > 0. teacher_count = number of
-- DISTINCT teachers meeting ALL of the above (used for the "X مدرسين
-- متاحين" badge -- not simply every teacher ever assigned).
-- ----------------------------------------------------------------------------
create or replace function available_subjects_for_grade(
    p_grade_id uuid,
    p_school_type text
)
returns table (
    id uuid,
    name text,
    description text,
    teacher_count integer
)
language sql
security definer
stable
set search_path = public
as $$
    with bookable_teachers as (
        select distinct ts.subject_id, ts.teacher_id
        from teacher_subjects ts
        join teachers t on t.id = ts.teacher_id and t.active = true
        where ts.grade_id = p_grade_id
          and ts.school_type = p_school_type
          and ts.active = true
          and exists (
              select 1
              from lesson_slots ls
              left join (
                  select ri.slot_id, count(*) as confirmed_count
                  from reservation_items ri
                  join reservations r on r.id = ri.reservation_id
                  where r.status = 'confirmed'
                  group by ri.slot_id
              ) rc on rc.slot_id = ls.id
              where ls.teacher_subject_id = ts.id
                and ls.active = true
                and (ls.capacity - coalesce(rc.confirmed_count, 0)) > 0
          )
    )
    select
        sub.id,
        sub.name,
        sub.description,
        count(bt.teacher_id)::integer as teacher_count
    from subject_grades sg
    join subjects sub on sub.id = sg.subject_id and sub.active = true
    left join bookable_teachers bt on bt.subject_id = sub.id
    where sg.grade_id = p_grade_id
      and sg.active = true
      and (sg.school_type is null or sg.school_type = p_school_type)
    group by sub.id, sub.name, sub.description
    having count(bt.teacher_id) > 0
    order by sub.name;
$$;

-- ----------------------------------------------------------------------------
-- available_teachers_for_subject(): teachers who satisfy ALL of: active,
-- assigned to this exact grade+school_type+subject (active assignment),
-- AND have at least one active slot with remaining capacity.
-- ----------------------------------------------------------------------------
create or replace function available_teachers_for_subject(
    p_grade_id uuid,
    p_school_type text,
    p_subject_id uuid
)
returns table (id uuid, full_name text, title text)
language sql
security definer
stable
set search_path = public
as $$
    select distinct t.id, t.full_name, t.title
    from teacher_subjects ts
    join teachers t on t.id = ts.teacher_id and t.active = true
    where ts.grade_id = p_grade_id
      and ts.school_type = p_school_type
      and ts.subject_id = p_subject_id
      and ts.active = true
      and exists (
          select 1
          from lesson_slots ls
          left join (
              select ri.slot_id, count(*) as confirmed_count
              from reservation_items ri
              join reservations r on r.id = ri.reservation_id
              where r.status = 'confirmed'
              group by ri.slot_id
          ) rc on rc.slot_id = ls.id
          where ls.teacher_subject_id = ts.id
            and ls.active = true
            and (ls.capacity - coalesce(rc.confirmed_count, 0)) > 0
      )
    order by t.full_name;
$$;

-- ----------------------------------------------------------------------------
-- available_slots(): returns lesson slots for a grade+school_type+subject+
-- teacher with remaining seats computed live, EXCLUDING full slots.
-- ----------------------------------------------------------------------------
create or replace function available_slots(
    p_grade_id uuid,
    p_school_type text,
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
      and ls.school_type = p_school_type
      and ls.subject_id = p_subject_id
      and ls.teacher_id = p_teacher_id
      and ls.active = true
      and (ls.capacity - coalesce(counts.confirmed_count, 0)) > 0
    order by ls.day_of_week, ls.start_time;
$$;

-- ----------------------------------------------------------------------------
-- create_reservation(): THE core booking transaction. NO age field anywhere.
-- p_school_type is validated and enforced against grade/subject/teacher/slot
-- at every step, so a tampered frontend request cannot mix school types.
-- ----------------------------------------------------------------------------
create or replace function create_reservation(
    p_student jsonb,
    p_grade_id uuid,
    p_school_type text,
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
        select id into v_existing_reservation_id
        from reservations
        where idempotency_key = p_idempotency_key;

        if v_existing_reservation_id is not null then
            return get_reservation_confirmation(v_existing_reservation_id);
        end if;
    end if;

    if p_school_type is null or p_school_type not in ('arabic', 'languages') then
        raise exception 'INVALID_SCHOOL_TYPE: school type must be arabic or languages';
    end if;

    if not exists (select 1 from grades where id = p_grade_id and active = true) then
        raise exception 'INVALID_GRADE: selected grade is not available';
    end if;

    v_full_name := trim(p_student->>'full_name');
    v_parent_name := trim(p_student->>'parent_name');
    v_gender := p_student->>'gender';
    v_email := nullif(trim(p_student->>'email'), '');

    if v_full_name is null or char_length(v_full_name) < 3 then
        raise exception 'INVALID_NAME: full name must be at least 3 characters';
    end if;
    if v_parent_name is null or char_length(v_parent_name) < 3 then
        raise exception 'INVALID_PARENT_NAME: parent name must be at least 3 characters';
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

    insert into students (full_name, mobile, gender, parent_name, parent_mobile, email)
    values (v_full_name, v_mobile, v_gender, v_parent_name, v_parent_mobile, v_email)
    returning id into v_student_id;

    v_reservation_code := generate_reservation_code();

    insert into reservations (reservation_code, student_id, grade_id, school_type, status, idempotency_key)
    values (v_reservation_code, v_student_id, p_grade_id, p_school_type, 'confirmed', p_idempotency_key)
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
               ls.school_type, ls.day_of_week, ls.start_time, ls.end_time
        into v_slot
        from lesson_slots ls
        where ls.id = v_slot_id
        for update;

        if v_slot.id is null or v_slot.active = false then
            raise exception 'SLOT_UNAVAILABLE: the selected lesson slot is no longer available';
        end if;

        if v_slot.grade_id <> p_grade_id
           or v_slot.school_type <> p_school_type
           or v_slot.subject_id <> v_subject_id
           or v_slot.teacher_id <> v_teacher_id then
            raise exception 'SLOT_MISMATCH: slot does not match the selected grade/school type/subject/teacher';
        end if;

        if not exists (
            select 1 from teacher_subjects ts
            where ts.teacher_id = v_teacher_id
              and ts.subject_id = v_subject_id
              and ts.grade_id = p_grade_id
              and ts.school_type = p_school_type
              and ts.active = true
        ) then
            raise exception 'INVALID_TEACHER_ASSIGNMENT: teacher is not assigned to this subject/grade/school type';
        end if;

        if not exists (
            select 1 from subject_grades sg
            where sg.subject_id = v_subject_id
              and sg.grade_id = p_grade_id
              and sg.active = true
              and (sg.school_type is null or sg.school_type = p_school_type)
        ) then
            raise exception 'SUBJECT_NOT_IN_GRADE: subject is not offered for this grade/school type';
        end if;

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
        raise;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_reservation_confirmation(): full JSON payload for a reservation.
-- Includes school_type; NO age field.
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
        'school_type', r.school_type,
        'status', r.status,
        'created_at', r.created_at,
        'student', jsonb_build_object(
            'full_name', s.full_name,
            'mobile', s.mobile,
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

grant execute on function is_admin() to anon, authenticated;
grant execute on function normalize_egyptian_mobile(text) to anon, authenticated;
grant execute on function available_grades() to anon, authenticated;
grant execute on function available_subjects_for_grade(uuid, text) to anon, authenticated;
grant execute on function available_teachers_for_subject(uuid, text, uuid) to anon, authenticated;
grant execute on function available_slots(uuid, text, uuid, uuid) to anon, authenticated;
grant execute on function create_reservation(jsonb, uuid, text, jsonb, text) to anon, authenticated;
grant execute on function get_reservation_confirmation(uuid) to anon, authenticated;
