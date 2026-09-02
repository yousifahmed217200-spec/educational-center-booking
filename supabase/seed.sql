-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - SAMPLE / TEST DATA
-- ============================================================================
-- Run this AFTER schema.sql, functions.sql, and rls.sql.
-- Safe to re-run: it clears its own tables first (see reset-sample-data.sql
-- for a standalone version of that clear-out).
--
-- Covers BOTH school types (مدرسة عربي / مدرسة لغات) for every grade, so
-- you can immediately test school-type filtering without hitting empty
-- results on some grade. Includes deliberate test scenarios:
--   - Scenario 3: Chemistry (عربي, Grade 3 Secondary) has a teacher whose
--     only slot is fully booked -> subject must NOT appear.
--   - Scenario 4: Biology (عربي, Grade 3 Secondary) has a teacher with NO
--     slots at all -> subject must NOT appear.
--   - Scenario 5: Omar Khaled has slots for Physics but not for any other
--     subject he might be tempted to also teach -> only shows under Physics.
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

-- ----------------------------------------------------------------------------
-- GRADES (shared across both school types)
-- ----------------------------------------------------------------------------
insert into grades (id, name, display_order, active) values
    ('10000000-0000-0000-0000-000000000001', 'Grade 4 Primary', 1, true),
    ('10000000-0000-0000-0000-000000000002', 'Grade 5 Primary', 2, true),
    ('10000000-0000-0000-0000-000000000003', 'Grade 6 Primary', 3, true),
    ('10000000-0000-0000-0000-000000000004', 'Grade 1 Preparatory', 4, true),
    ('10000000-0000-0000-0000-000000000005', 'Grade 2 Preparatory', 5, true),
    ('10000000-0000-0000-0000-000000000006', 'Grade 3 Preparatory', 6, true),
    ('10000000-0000-0000-0000-000000000007', 'Grade 1 Secondary', 7, true),
    ('10000000-0000-0000-0000-000000000008', 'Grade 2 Secondary', 8, true),
    ('10000000-0000-0000-0000-000000000009', 'Grade 3 Secondary', 9, true);

-- ----------------------------------------------------------------------------
-- SUBJECTS (global catalog)
-- ----------------------------------------------------------------------------
insert into subjects (id, name, description, active) values
    ('20000000-0000-0000-0000-000000000001', 'Mathematics', 'Core mathematics curriculum', true),
    ('20000000-0000-0000-0000-000000000002', 'Physics', 'Physics fundamentals and problem solving', true),
    ('20000000-0000-0000-0000-000000000003', 'Chemistry', 'Chemistry theory and lab concepts', true),
    ('20000000-0000-0000-0000-000000000004', 'Biology', 'Biology and life sciences', true),
    ('20000000-0000-0000-0000-000000000005', 'Arabic', 'Arabic language and literature', true),
    ('20000000-0000-0000-0000-000000000006', 'English', 'English language skills', true),
    ('20000000-0000-0000-0000-000000000007', 'French', 'French language skills', true),
    ('20000000-0000-0000-0000-000000000008', 'Social Studies', 'History and geography', true);

-- ----------------------------------------------------------------------------
-- SUBJECT_GRADES: Math/Physics/Chemistry/Biology/English offered for BOTH
-- school types (school_type = NULL) across the secondary grades; Arabic is
-- عربي-only; French is لغات-only; Social Studies for younger grades (both).
-- ----------------------------------------------------------------------------
do $$
declare
    g record;
begin
    for g in select id from grades where name in ('Grade 1 Secondary', 'Grade 2 Secondary', 'Grade 3 Secondary')
    loop
        insert into subject_grades (subject_id, grade_id, school_type) values
            ('20000000-0000-0000-0000-000000000001', g.id, null), -- Math, both
            ('20000000-0000-0000-0000-000000000002', g.id, null), -- Physics, both
            ('20000000-0000-0000-0000-000000000003', g.id, null), -- Chemistry, both
            ('20000000-0000-0000-0000-000000000004', g.id, null), -- Biology, both
            ('20000000-0000-0000-0000-000000000005', g.id, 'arabic'),    -- Arabic, عربي only
            ('20000000-0000-0000-0000-000000000006', g.id, null), -- English, both
            ('20000000-0000-0000-0000-000000000007', g.id, 'languages'); -- French, لغات only
    end loop;

    for g in select id from grades where name in ('Grade 1 Preparatory', 'Grade 2 Preparatory', 'Grade 3 Preparatory')
    loop
        insert into subject_grades (subject_id, grade_id, school_type) values
            ('20000000-0000-0000-0000-000000000001', g.id, null),
            ('20000000-0000-0000-0000-000000000005', g.id, 'arabic'),
            ('20000000-0000-0000-0000-000000000006', g.id, null),
            ('20000000-0000-0000-0000-000000000007', g.id, 'languages'),
            ('20000000-0000-0000-0000-000000000008', g.id, null);
    end loop;

    for g in select id from grades where name in ('Grade 4 Primary', 'Grade 5 Primary', 'Grade 6 Primary')
    loop
        insert into subject_grades (subject_id, grade_id, school_type) values
            ('20000000-0000-0000-0000-000000000001', g.id, null),
            ('20000000-0000-0000-0000-000000000005', g.id, 'arabic'),
            ('20000000-0000-0000-0000-000000000006', g.id, null);
    end loop;
end $$;

-- ----------------------------------------------------------------------------
-- TEACHERS
-- ----------------------------------------------------------------------------
insert into teachers (id, full_name, title, active) values
    -- عربي-school teachers
    ('30000000-0000-0000-0000-000000000001', 'Ahmed Hassan', 'Mathematics Teacher', true),
    ('30000000-0000-0000-0000-000000000002', 'Mohamed Ali', 'Mathematics Teacher', true),
    ('30000000-0000-0000-0000-000000000003', 'Omar Khaled', 'Physics Teacher', true),
    ('30000000-0000-0000-0000-000000000004', 'Sara Mahmoud', 'Chemistry Teacher', true),
    ('30000000-0000-0000-0000-000000000005', 'Mahmoud Ibrahim', 'Arabic Teacher', true),
    ('30000000-0000-0000-0000-000000000006', 'Heba Magdy', 'Biology Teacher', true), -- no slots (Scenario 4)
    -- لغات-school teachers
    ('30000000-0000-0000-0000-000000000007', 'Mariam Ahmed', 'Mathematics Teacher', true),
    ('30000000-0000-0000-0000-000000000008', 'Youssef Hassan', 'Physics Teacher', true),
    ('30000000-0000-0000-0000-000000000009', 'Sara Adel', 'Chemistry Teacher', true),
    ('30000000-0000-0000-0000-00000000000a', 'Nour Mohamed', 'English Teacher', true),
    ('30000000-0000-0000-0000-00000000000b', 'Karim Nabil', 'French Teacher', true),
    -- shared across both (English is offered to both school types)
    ('30000000-0000-0000-0000-00000000000c', 'Dina Samir', 'English Teacher', true);

-- ----------------------------------------------------------------------------
-- TEACHER_SUBJECTS for Grade 3 Secondary, both school types
-- ----------------------------------------------------------------------------
insert into teacher_subjects (id, teacher_id, subject_id, grade_id, school_type, active) values
    -- === مدرسة عربي — Grade 3 Secondary ===
    ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Ahmed Hassan, Math
    ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Mohamed Ali, Math
    ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Omar Khaled, Physics
    ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Sara Mahmoud, Chemistry (slot will be FULL -> Scenario 3)
    ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Mahmoud Ibrahim, Arabic
    ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Heba Magdy, Biology (NO slots -> Scenario 4)
    ('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-00000000000c', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000009', 'arabic', true), -- Dina Samir, English (عربي)

    -- === مدرسة لغات — Grade 3 Secondary ===
    ('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009', 'languages', true), -- Mariam Ahmed, Math
    ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000009', 'languages', true), -- Youssef Hassan, Physics
    ('4000000a-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000009', 'languages', true), -- Sara Adel, Chemistry
    ('4000000a-0000-0000-0000-000000000002', '30000000-0000-0000-0000-00000000000a', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000009', 'languages', true), -- Nour Mohamed, English
    ('4000000a-0000-0000-0000-000000000003', '30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000009', 'languages', true); -- Karim Nabil, French

-- ----------------------------------------------------------------------------
-- TEACHER_SUBJECTS for Grade 2 Secondary and Grade 1 Secondary, both school
-- types (reusing several of the same teachers where realistic, so there is
-- more than one grade to test against, not just Grade 3 Secondary).
-- ----------------------------------------------------------------------------
insert into teacher_subjects (id, teacher_id, subject_id, grade_id, school_type, active) values
    -- Grade 2 Secondary — عربي
    ('40000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000008', 'arabic', true),
    ('40000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000008', 'arabic', true),
    ('40000000-0000-0000-0000-00000000000c', '30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000008', 'arabic', true),
    ('40000000-0000-0000-0000-00000000000d', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000008', 'arabic', true),
    -- Grade 2 Secondary — لغات
    ('40000000-0000-0000-0000-00000000000e', '30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000008', 'languages', true),
    ('40000000-0000-0000-0000-00000000000f', '30000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000008', 'languages', true),
    ('40000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000008', 'languages', true),

    -- Grade 1 Secondary — عربي
    ('40000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'arabic', true),
    ('40000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000007', 'arabic', true),
    -- Grade 1 Secondary — لغات
    ('40000000-0000-0000-0000-000000000013', '30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'languages', true),
    ('40000000-0000-0000-0000-000000000014', '30000000-0000-0000-0000-00000000000b', '20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'languages', true);

-- ----------------------------------------------------------------------------
-- LESSON_SLOTS: deliberately varied schedules per teacher. school_type is
-- copied from the parent teacher_subjects row.
-- ----------------------------------------------------------------------------
insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, school_type, day_of_week, start_time, end_time, capacity)
select ts.id, ts.grade_id, ts.subject_id, ts.teacher_id, ts.school_type, v.day, v.start_t, v.end_t, v.cap
from teacher_subjects ts
join (values
    -- Ahmed Hassan — Math — عربي — Grade 3 Secondary: Sat 4pm, Mon 5pm, Wed 6pm
    ('40000000-0000-0000-0000-000000000001'::uuid, 6, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-000000000001'::uuid, 1, '17:00'::time, '18:00'::time, 5),
    ('40000000-0000-0000-0000-000000000001'::uuid, 3, '18:00'::time, '19:00'::time, 5),
    -- Mohamed Ali — Math — عربي — Grade 3 Secondary: Sun 3pm, Tue 5pm
    ('40000000-0000-0000-0000-000000000002'::uuid, 0, '15:00'::time, '16:00'::time, 5),
    ('40000000-0000-0000-0000-000000000002'::uuid, 2, '17:00'::time, '18:00'::time, 5),
    -- Omar Khaled — Physics — عربي — Grade 3 Secondary (Scenario 5: only Physics, no other subject)
    ('40000000-0000-0000-0000-000000000003'::uuid, 1, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-000000000003'::uuid, 3, '18:00'::time, '19:00'::time, 5),
    -- Sara Mahmoud — Chemistry — عربي — Grade 3 Secondary: ONE slot, will be filled to capacity below (Scenario 3)
    ('40000000-0000-0000-0000-000000000004'::uuid, 6, '15:00'::time, '16:00'::time, 2),
    -- Mahmoud Ibrahim — Arabic — عربي — Grade 3 Secondary
    ('40000000-0000-0000-0000-000000000005'::uuid, 0, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-000000000005'::uuid, 4, '17:00'::time, '18:00'::time, 5),
    -- Heba Magdy — Biology — عربي — Grade 3 Secondary: intentionally NO slots (Scenario 4) -- omitted entirely
    -- Dina Samir — English — عربي — Grade 3 Secondary
    ('40000000-0000-0000-0000-000000000007'::uuid, 2, '16:00'::time, '17:00'::time, 5),

    -- Mariam Ahmed — Math — لغات — Grade 3 Secondary: Sun 3pm, Tue 5pm, Thu 6pm
    ('40000000-0000-0000-0000-000000000008'::uuid, 0, '15:00'::time, '16:00'::time, 5),
    ('40000000-0000-0000-0000-000000000008'::uuid, 2, '17:00'::time, '18:00'::time, 5),
    ('40000000-0000-0000-0000-000000000008'::uuid, 4, '18:00'::time, '19:00'::time, 5),
    -- Youssef Hassan — Physics — لغات — Grade 3 Secondary
    ('40000000-0000-0000-0000-000000000009'::uuid, 2, '17:00'::time, '18:00'::time, 5),
    ('40000000-0000-0000-0000-000000000009'::uuid, 5, '16:00'::time, '17:00'::time, 5),
    -- Sara Adel — Chemistry — لغات — Grade 3 Secondary
    ('4000000a-0000-0000-0000-000000000001'::uuid, 1, '15:00'::time, '16:00'::time, 5),
    -- Nour Mohamed — English — لغات — Grade 3 Secondary
    ('4000000a-0000-0000-0000-000000000002'::uuid, 3, '16:00'::time, '17:00'::time, 5),
    ('4000000a-0000-0000-0000-000000000002'::uuid, 6, '17:00'::time, '18:00'::time, 5),
    -- Karim Nabil — French — لغات — Grade 3 Secondary
    ('4000000a-0000-0000-0000-000000000003'::uuid, 4, '16:00'::time, '17:00'::time, 5),

    -- Grade 2 Secondary — عربي
    ('40000000-0000-0000-0000-00000000000a'::uuid, 6, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-00000000000b'::uuid, 1, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-00000000000c'::uuid, 2, '17:00'::time, '18:00'::time, 5),
    ('40000000-0000-0000-0000-00000000000d'::uuid, 0, '16:00'::time, '17:00'::time, 5),
    -- Grade 2 Secondary — لغات
    ('40000000-0000-0000-0000-00000000000e'::uuid, 0, '16:00'::time, '17:00'::time, 5),
    ('40000000-0000-0000-0000-00000000000f'::uuid, 1, '17:00'::time, '18:00'::time, 5),
    ('40000000-0000-0000-0000-000000000010'::uuid, 3, '16:00'::time, '17:00'::time, 5),

    -- Grade 1 Secondary — عربي
    ('40000000-0000-0000-0000-000000000011'::uuid, 6, '15:00'::time, '16:00'::time, 5),
    ('40000000-0000-0000-0000-000000000012'::uuid, 2, '15:00'::time, '16:00'::time, 5),
    -- Grade 1 Secondary — لغات
    ('40000000-0000-0000-0000-000000000013'::uuid, 0, '15:00'::time, '16:00'::time, 5),
    ('40000000-0000-0000-0000-000000000014'::uuid, 4, '15:00'::time, '16:00'::time, 5)
) as v(ts_id, day, start_t, end_t, cap) on v.ts_id = ts.id;

-- ----------------------------------------------------------------------------
-- Scenario 3 setup: fill Sara Mahmoud's Chemistry slot (capacity 2) to
-- capacity with 2 sample confirmed reservations, so Chemistry drops out of
-- the available-subjects list for مدرسة عربي / Grade 3 Secondary.
-- ----------------------------------------------------------------------------
do $$
declare
    v_slot_id uuid;
    v_grade_id uuid := '10000000-0000-0000-0000-000000000009';
    v_student_id uuid;
    v_reservation_id uuid;
    i int;
begin
    select id into v_slot_id from lesson_slots
    where teacher_subject_id = '40000000-0000-0000-0000-000000000004' limit 1;

    for i in 1..2 loop
        insert into students (full_name, mobile, gender, parent_name, parent_mobile, email)
        values ('Test Student ' || i, '0100000010' || i, 'male', 'Test Parent', '0100000020' || i, null)
        returning id into v_student_id;

        insert into reservations (reservation_code, student_id, grade_id, school_type, status, idempotency_key)
        values (generate_reservation_code(), v_student_id, v_grade_id, 'arabic', 'confirmed', 'seed-chem-full-' || i)
        returning id into v_reservation_id;

        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (v_reservation_id, '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004', v_slot_id);
    end loop;
end $$;
