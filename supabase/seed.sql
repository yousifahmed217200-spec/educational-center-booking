-- ============================================================================
-- EDUCATIONAL CENTER BOOKING SYSTEM - SEED / TEST DATA
-- ============================================================================
-- Run this LAST, after schema.sql, functions.sql, rls.sql.
-- Safe to re-run: uses ON CONFLICT DO NOTHING / delete-first blocks.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- GRADES (9)
-- ----------------------------------------------------------------------------
insert into grades (name, display_order, active) values
    ('Grade 4 Primary', 1, true),
    ('Grade 5 Primary', 2, true),
    ('Grade 6 Primary', 3, true),
    ('Grade 1 Preparatory', 4, true),
    ('Grade 2 Preparatory', 5, true),
    ('Grade 3 Preparatory', 6, true),
    ('Grade 1 Secondary', 7, true),
    ('Grade 2 Secondary', 8, true),
    ('Grade 3 Secondary', 9, true)
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- SUBJECTS (10)
-- ----------------------------------------------------------------------------
insert into subjects (name, description, active) values
    ('Mathematics', 'Core mathematics course', true),
    ('Physics', 'Physics fundamentals and problem solving', true),
    ('Chemistry', 'Chemistry theory and lab concepts', true),
    ('Biology', 'Biology and life sciences', true),
    ('English', 'English language and literature', true),
    ('Arabic', 'Arabic language and grammar', true),
    ('French', 'French as a second foreign language', true),
    ('Geology', 'Earth sciences for secondary grades', true),
    ('Computer Science', 'Programming fundamentals and IT skills', true),
    ('Social Studies', 'History and geography', true)
on conflict (name) do nothing;

-- ----------------------------------------------------------------------------
-- TEACHERS (16)
-- ----------------------------------------------------------------------------
insert into teachers (full_name, title, active) values
    ('Ahmed Hassan', 'Mathematics Teacher', true),
    ('Mohamed Ali', 'Mathematics Teacher', true),
    ('Omar Khaled', 'Physics Teacher', true),
    ('Mahmoud Ibrahim', 'Physics Teacher', true),
    ('Sara Mahmoud', 'Chemistry Teacher', true),
    ('Mariam Ahmed', 'Chemistry Teacher', true),
    ('Youssef Hassan', 'Biology Teacher', true),
    ('Nourhan Adel', 'Biology Teacher', true),
    ('Heba Salah', 'English Teacher', true),
    ('Karim Fathy', 'English Teacher', true),
    ('Dina Samir', 'Arabic Teacher', true),
    ('Tarek Nabil', 'Arabic Teacher', true),
    ('Yasmin Farouk', 'French Teacher', true),
    ('Amr Sobhy', 'Computer Science Teacher', true),
    ('Rania Gamal', 'Social Studies Teacher', true),
    ('Islam Fawzy', 'Mathematics Teacher', true)
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- SUBJECT_GRADES: wire up which subjects apply to which grades.
-- Primary: Math, English, Arabic, Science-lite via Biology, Social Studies
-- Preparatory: Math, Physics(intro from Prep2), Chemistry(Prep3), Biology, English, Arabic, French, CS
-- Secondary: full science stack + Geology for Sec3
-- ----------------------------------------------------------------------------
do $$
declare
    g4p uuid; g5p uuid; g6p uuid;
    g1prep uuid; g2prep uuid; g3prep uuid;
    g1sec uuid; g2sec uuid; g3sec uuid;
    s_math uuid; s_phys uuid; s_chem uuid; s_bio uuid; s_eng uuid;
    s_arabic uuid; s_french uuid; s_geo uuid; s_cs uuid; s_social uuid;
begin
    select id into g4p from grades where name = 'Grade 4 Primary';
    select id into g5p from grades where name = 'Grade 5 Primary';
    select id into g6p from grades where name = 'Grade 6 Primary';
    select id into g1prep from grades where name = 'Grade 1 Preparatory';
    select id into g2prep from grades where name = 'Grade 2 Preparatory';
    select id into g3prep from grades where name = 'Grade 3 Preparatory';
    select id into g1sec from grades where name = 'Grade 1 Secondary';
    select id into g2sec from grades where name = 'Grade 2 Secondary';
    select id into g3sec from grades where name = 'Grade 3 Secondary';

    select id into s_math from subjects where name = 'Mathematics';
    select id into s_phys from subjects where name = 'Physics';
    select id into s_chem from subjects where name = 'Chemistry';
    select id into s_bio from subjects where name = 'Biology';
    select id into s_eng from subjects where name = 'English';
    select id into s_arabic from subjects where name = 'Arabic';
    select id into s_french from subjects where name = 'French';
    select id into s_geo from subjects where name = 'Geology';
    select id into s_cs from subjects where name = 'Computer Science';
    select id into s_social from subjects where name = 'Social Studies';

    insert into subject_grades (subject_id, grade_id) values
        -- Primary grades: Math, English, Arabic, Social Studies
        (s_math, g4p), (s_eng, g4p), (s_arabic, g4p), (s_social, g4p),
        (s_math, g5p), (s_eng, g5p), (s_arabic, g5p), (s_social, g5p),
        (s_math, g6p), (s_eng, g6p), (s_arabic, g6p), (s_social, g6p), (s_cs, g6p),
        -- Preparatory grades
        (s_math, g1prep), (s_eng, g1prep), (s_arabic, g1prep), (s_bio, g1prep), (s_social, g1prep), (s_cs, g1prep),
        (s_math, g2prep), (s_eng, g2prep), (s_arabic, g2prep), (s_bio, g2prep), (s_phys, g2prep), (s_french, g2prep), (s_cs, g2prep),
        (s_math, g3prep), (s_eng, g3prep), (s_arabic, g3prep), (s_bio, g3prep), (s_phys, g3prep), (s_chem, g3prep), (s_french, g3prep),
        -- Secondary grades: full science stack
        (s_math, g1sec), (s_phys, g1sec), (s_chem, g1sec), (s_bio, g1sec), (s_eng, g1sec), (s_arabic, g1sec), (s_french, g1sec),
        (s_math, g2sec), (s_phys, g2sec), (s_chem, g2sec), (s_bio, g2sec), (s_eng, g2sec), (s_arabic, g2sec), (s_geo, g2sec),
        (s_math, g3sec), (s_phys, g3sec), (s_chem, g3sec), (s_bio, g3sec), (s_eng, g3sec), (s_arabic, g3sec), (s_geo, g3sec)
    on conflict (subject_id, grade_id) do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- TEACHER_SUBJECTS: assign teachers to subject+grade combinations (22 rows)
-- ----------------------------------------------------------------------------
do $$
declare
    g3sec uuid; g2sec uuid; g1sec uuid; g3prep uuid; g2prep uuid; g1prep uuid; g6p uuid;
    s_math uuid; s_phys uuid; s_chem uuid; s_bio uuid; s_eng uuid; s_arabic uuid; s_cs uuid;
    t_ahmed uuid; t_mohamed uuid; t_omar uuid; t_mahmoud uuid; t_sara uuid; t_mariam uuid;
    t_youssef uuid; t_nourhan uuid; t_heba uuid; t_karim uuid; t_dina uuid; t_tarek uuid;
    t_amr uuid; t_islam uuid;
begin
    select id into g3sec from grades where name = 'Grade 3 Secondary';
    select id into g2sec from grades where name = 'Grade 2 Secondary';
    select id into g1sec from grades where name = 'Grade 1 Secondary';
    select id into g3prep from grades where name = 'Grade 3 Preparatory';
    select id into g2prep from grades where name = 'Grade 2 Preparatory';
    select id into g1prep from grades where name = 'Grade 1 Preparatory';
    select id into g6p from grades where name = 'Grade 6 Primary';

    select id into s_math from subjects where name = 'Mathematics';
    select id into s_phys from subjects where name = 'Physics';
    select id into s_chem from subjects where name = 'Chemistry';
    select id into s_bio from subjects where name = 'Biology';
    select id into s_eng from subjects where name = 'English';
    select id into s_arabic from subjects where name = 'Arabic';
    select id into s_cs from subjects where name = 'Computer Science';

    select id into t_ahmed from teachers where full_name = 'Ahmed Hassan';
    select id into t_mohamed from teachers where full_name = 'Mohamed Ali';
    select id into t_omar from teachers where full_name = 'Omar Khaled';
    select id into t_mahmoud from teachers where full_name = 'Mahmoud Ibrahim';
    select id into t_sara from teachers where full_name = 'Sara Mahmoud';
    select id into t_mariam from teachers where full_name = 'Mariam Ahmed';
    select id into t_youssef from teachers where full_name = 'Youssef Hassan';
    select id into t_nourhan from teachers where full_name = 'Nourhan Adel';
    select id into t_heba from teachers where full_name = 'Heba Salah';
    select id into t_karim from teachers where full_name = 'Karim Fathy';
    select id into t_dina from teachers where full_name = 'Dina Samir';
    select id into t_tarek from teachers where full_name = 'Tarek Nabil';
    select id into t_amr from teachers where full_name = 'Amr Sobhy';
    select id into t_islam from teachers where full_name = 'Islam Fawzy';

    insert into teacher_subjects (teacher_id, subject_id, grade_id) values
        -- Mathematics - Grade 3 Secondary: two teachers (Ahmed, Mohamed)
        (t_ahmed, s_math, g3sec),
        (t_mohamed, s_math, g3sec),
        (t_islam, s_math, g2sec),
        (t_ahmed, s_math, g2sec),
        (t_mohamed, s_math, g1sec),
        -- Physics
        (t_omar, s_phys, g3sec),
        (t_mahmoud, s_phys, g3sec),
        (t_omar, s_phys, g2sec),
        (t_mahmoud, s_phys, g3prep),
        -- Chemistry
        (t_sara, s_chem, g3sec),
        (t_mariam, s_chem, g3sec),
        (t_sara, s_chem, g2sec),
        (t_mariam, s_chem, g3prep),
        -- Biology
        (t_youssef, s_bio, g3sec),
        (t_nourhan, s_bio, g3sec),
        (t_youssef, s_bio, g2sec),
        -- English
        (t_heba, s_eng, g3sec),
        (t_karim, s_eng, g3sec),
        (t_heba, s_eng, g3prep),
        -- Arabic
        (t_dina, s_arabic, g3sec),
        (t_tarek, s_arabic, g3prep),
        -- Computer Science
        (t_amr, s_cs, g6p),
        (t_amr, s_cs, g1prep)
    on conflict (teacher_id, subject_id, grade_id) do nothing;
end $$;

-- ----------------------------------------------------------------------------
-- LESSON_SLOTS: at least 50, with deliberately DIFFERENT schedules per
-- teacher/subject, and a mix of capacity states (available / almost full /
-- full) to exercise the "hide full slots" requirement.
--
-- day_of_week: 0=Sunday 1=Monday 2=Tuesday 3=Wednesday 4=Thursday 5=Friday 6=Saturday
-- ----------------------------------------------------------------------------
do $$
declare
    ts_id uuid;
    g3sec uuid; g2sec uuid; g1sec uuid; g3prep uuid;
    s_math uuid; s_phys uuid; s_chem uuid; s_bio uuid; s_eng uuid; s_arabic uuid;
    t_ahmed uuid; t_mohamed uuid; t_omar uuid; t_mahmoud uuid; t_sara uuid; t_mariam uuid;
    t_youssef uuid; t_nourhan uuid; t_heba uuid; t_karim uuid; t_dina uuid; t_islam uuid;
begin
    select id into g3sec from grades where name = 'Grade 3 Secondary';
    select id into g2sec from grades where name = 'Grade 2 Secondary';
    select id into g1sec from grades where name = 'Grade 1 Secondary';
    select id into g3prep from grades where name = 'Grade 3 Preparatory';

    select id into s_math from subjects where name = 'Mathematics';
    select id into s_phys from subjects where name = 'Physics';
    select id into s_chem from subjects where name = 'Chemistry';
    select id into s_bio from subjects where name = 'Biology';
    select id into s_eng from subjects where name = 'English';
    select id into s_arabic from subjects where name = 'Arabic';

    select id into t_ahmed from teachers where full_name = 'Ahmed Hassan';
    select id into t_mohamed from teachers where full_name = 'Mohamed Ali';
    select id into t_omar from teachers where full_name = 'Omar Khaled';
    select id into t_mahmoud from teachers where full_name = 'Mahmoud Ibrahim';
    select id into t_sara from teachers where full_name = 'Sara Mahmoud';
    select id into t_mariam from teachers where full_name = 'Mariam Ahmed';
    select id into t_youssef from teachers where full_name = 'Youssef Hassan';
    select id into t_nourhan from teachers where full_name = 'Nourhan Adel';
    select id into t_heba from teachers where full_name = 'Heba Salah';
    select id into t_karim from teachers where full_name = 'Karim Fathy';
    select id into t_dina from teachers where full_name = 'Dina Samir';
    select id into t_islam from teachers where full_name = 'Islam Fawzy';

    -- helper macro pattern: insert one slot per call
    -- Mathematics, Grade 3 Secondary, Ahmed Hassan: Sat 4PM, Sat 6PM, Mon 5PM
    select id into ts_id from teacher_subjects where teacher_id=t_ahmed and subject_id=s_math and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_math, t_ahmed, 6, '16:00', '17:30', 5),
        (ts_id, g3sec, s_math, t_ahmed, 6, '18:00', '19:30', 5),
        (ts_id, g3sec, s_math, t_ahmed, 1, '17:00', '18:30', 5);

    -- Mathematics, Grade 3 Secondary, Mohamed Ali: Sun 3PM, Tue 5PM, Thu 6PM
    select id into ts_id from teacher_subjects where teacher_id=t_mohamed and subject_id=s_math and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_math, t_mohamed, 0, '15:00', '16:30', 5),
        (ts_id, g3sec, s_math, t_mohamed, 2, '17:00', '18:30', 5),
        (ts_id, g3sec, s_math, t_mohamed, 4, '18:00', '19:30', 5);

    -- Physics, Grade 3 Secondary, Omar Khaled: Mon 4PM, Wed 6PM, Fri 5PM
    select id into ts_id from teacher_subjects where teacher_id=t_omar and subject_id=s_phys and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_phys, t_omar, 1, '16:00', '17:30', 5),
        (ts_id, g3sec, s_phys, t_omar, 3, '18:00', '19:30', 5),
        (ts_id, g3sec, s_phys, t_omar, 5, '17:00', '18:30', 5);

    -- Physics, Grade 3 Secondary, Mahmoud Ibrahim: Sun 5PM, Tue 6:30PM, Sat 2PM
    select id into ts_id from teacher_subjects where teacher_id=t_mahmoud and subject_id=s_phys and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_phys, t_mahmoud, 0, '17:00', '18:30', 5),
        (ts_id, g3sec, s_phys, t_mahmoud, 2, '18:30', '20:00', 5),
        (ts_id, g3sec, s_phys, t_mahmoud, 6, '14:00', '15:30', 5);

    -- Chemistry, Grade 3 Secondary, Sara Mahmoud: Sat 3PM, Tue 4PM, Thu 7PM
    select id into ts_id from teacher_subjects where teacher_id=t_sara and subject_id=s_chem and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_chem, t_sara, 6, '15:00', '16:30', 5),
        (ts_id, g3sec, s_chem, t_sara, 2, '16:00', '17:30', 5),
        (ts_id, g3sec, s_chem, t_sara, 4, '19:00', '20:30', 5);

    -- Chemistry, Grade 3 Secondary, Mariam Ahmed: Sun 4PM, Wed 5PM, Fri 6PM
    select id into ts_id from teacher_subjects where teacher_id=t_mariam and subject_id=s_chem and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_chem, t_mariam, 0, '16:00', '17:30', 5),
        (ts_id, g3sec, s_chem, t_mariam, 3, '17:00', '18:30', 5),
        (ts_id, g3sec, s_chem, t_mariam, 5, '18:00', '19:30', 5);

    -- Biology, Grade 3 Secondary, Youssef Hassan: Sat 5PM, Mon 6PM
    select id into ts_id from teacher_subjects where teacher_id=t_youssef and subject_id=s_bio and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_bio, t_youssef, 6, '17:00', '18:30', 5),
        (ts_id, g3sec, s_bio, t_youssef, 1, '18:00', '19:30', 5);

    -- Biology, Grade 3 Secondary, Nourhan Adel: Sun 6PM, Wed 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_nourhan and subject_id=s_bio and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_bio, t_nourhan, 0, '18:00', '19:30', 5),
        (ts_id, g3sec, s_bio, t_nourhan, 3, '16:00', '17:30', 5);

    -- English, Grade 3 Secondary, Heba Salah: Sat 1PM, Tue 3PM
    select id into ts_id from teacher_subjects where teacher_id=t_heba and subject_id=s_eng and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_eng, t_heba, 6, '13:00', '14:30', 5),
        (ts_id, g3sec, s_eng, t_heba, 2, '15:00', '16:30', 5);

    -- English, Grade 3 Secondary, Karim Fathy: Mon 2PM, Thu 3PM
    select id into ts_id from teacher_subjects where teacher_id=t_karim and subject_id=s_eng and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_eng, t_karim, 1, '14:00', '15:30', 5),
        (ts_id, g3sec, s_eng, t_karim, 4, '15:00', '16:30', 5);

    -- Arabic, Grade 3 Secondary, Dina Samir: Sun 1PM, Wed 2PM
    select id into ts_id from teacher_subjects where teacher_id=t_dina and subject_id=s_arabic and grade_id=g3sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3sec, s_arabic, t_dina, 0, '13:00', '14:30', 5),
        (ts_id, g3sec, s_arabic, t_dina, 3, '14:00', '15:30', 5);

    -- Mathematics, Grade 2 Secondary, Islam Fawzy: Sat 5PM, Mon 3PM, Wed 7PM
    select id into ts_id from teacher_subjects where teacher_id=t_islam and subject_id=s_math and grade_id=g2sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g2sec, s_math, t_islam, 6, '17:00', '18:30', 5),
        (ts_id, g2sec, s_math, t_islam, 1, '15:00', '16:30', 5),
        (ts_id, g2sec, s_math, t_islam, 3, '19:00', '20:30', 5);

    -- Mathematics, Grade 2 Secondary, Ahmed Hassan: Sun 2PM, Thu 5PM
    select id into ts_id from teacher_subjects where teacher_id=t_ahmed and subject_id=s_math and grade_id=g2sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g2sec, s_math, t_ahmed, 0, '14:00', '15:30', 5),
        (ts_id, g2sec, s_math, t_ahmed, 4, '17:00', '18:30', 5);

    -- Mathematics, Grade 1 Secondary, Mohamed Ali: Sat 2PM, Tue 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_mohamed and subject_id=s_math and grade_id=g1sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g1sec, s_math, t_mohamed, 6, '14:00', '15:30', 5),
        (ts_id, g1sec, s_math, t_mohamed, 2, '16:00', '17:30', 5);

    -- Physics, Grade 2 Secondary, Omar Khaled: Sun 6PM, Thu 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_omar and subject_id=s_phys and grade_id=g2sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g2sec, s_phys, t_omar, 0, '18:00', '19:30', 5),
        (ts_id, g2sec, s_phys, t_omar, 4, '16:00', '17:30', 5);

    -- Physics, Grade 3 Preparatory, Mahmoud Ibrahim: Mon 3PM, Wed 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_mahmoud and subject_id=s_phys and grade_id=g3prep;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3prep, s_phys, t_mahmoud, 1, '15:00', '16:30', 5),
        (ts_id, g3prep, s_phys, t_mahmoud, 3, '16:00', '17:30', 5);

    -- Chemistry, Grade 2 Secondary, Sara Mahmoud: Sat 6PM, Tue 2PM
    select id into ts_id from teacher_subjects where teacher_id=t_sara and subject_id=s_chem and grade_id=g2sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g2sec, s_chem, t_sara, 6, '18:00', '19:30', 5),
        (ts_id, g2sec, s_chem, t_sara, 2, '14:00', '15:30', 5);

    -- Chemistry, Grade 3 Preparatory, Mariam Ahmed: Sun 3PM, Thu 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_mariam and subject_id=s_chem and grade_id=g3prep;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3prep, s_chem, t_mariam, 0, '15:00', '16:30', 5),
        (ts_id, g3prep, s_chem, t_mariam, 4, '16:00', '17:30', 5);

    -- Biology, Grade 2 Secondary, Youssef Hassan: Wed 3PM, Fri 4PM
    select id into ts_id from teacher_subjects where teacher_id=t_youssef and subject_id=s_bio and grade_id=g2sec;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g2sec, s_bio, t_youssef, 3, '15:00', '16:30', 5),
        (ts_id, g2sec, s_bio, t_youssef, 5, '16:00', '17:30', 5);

    -- English, Grade 3 Preparatory, Heba Salah: Sat 12PM, Mon 1PM
    select id into ts_id from teacher_subjects where teacher_id=t_heba and subject_id=s_eng and grade_id=g3prep;
    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3prep, s_eng, t_heba, 6, '12:00', '13:30', 5),
        (ts_id, g3prep, s_eng, t_heba, 1, '13:00', '14:30', 5);

    -- Arabic, Grade 3 Preparatory, Tarek Nabil: Sun 12PM, Wed 1PM
    -- (teacher assignment already inserted above)
    -- add slots for Tarek/Arabic/g3prep
    perform 1;
end $$;

-- Additional slots for Tarek Nabil (Arabic, Grade 3 Preparatory) - separate
-- block because teacher_subjects row for it was created earlier in this file.
do $$
declare
    ts_id uuid;
    g3prep uuid;
    s_arabic uuid;
    t_tarek uuid;
begin
    select id into g3prep from grades where name = 'Grade 3 Preparatory';
    select id into s_arabic from subjects where name = 'Arabic';
    select id into t_tarek from teachers where full_name = 'Tarek Nabil';
    select id into ts_id from teacher_subjects where teacher_id=t_tarek and subject_id=s_arabic and grade_id=g3prep;

    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity) values
        (ts_id, g3prep, s_arabic, t_tarek, 0, '12:00', '13:30', 5),
        (ts_id, g3prep, s_arabic, t_tarek, 3, '13:00', '14:30', 5);
end $$;

-- ----------------------------------------------------------------------------
-- CAPACITY TEST FIXTURES: create three "reference" slots (extra Math slots
-- for Ahmed Hassan / Grade 3 Secondary) and simulate reservations to reach
-- available / almost full / full states, per the spec's test-data request.
-- We create dummy students + confirmed reservations directly (bypassing the
-- RPC, since this is trusted seed data run with elevated SQL editor rights).
-- ----------------------------------------------------------------------------
do $$
declare
    ts_id uuid;
    g3sec uuid;
    s_math uuid;
    t_ahmed uuid;
    slot_available uuid;
    slot_almost_full uuid;
    slot_full uuid;
    i int;
    dummy_student uuid;
    dummy_reservation uuid;
begin
    select id into g3sec from grades where name = 'Grade 3 Secondary';
    select id into s_math from subjects where name = 'Mathematics';
    select id into t_ahmed from teachers where full_name = 'Ahmed Hassan';
    select id into ts_id from teacher_subjects where teacher_id=t_ahmed and subject_id=s_math and grade_id=g3sec;

    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity)
    values (ts_id, g3sec, s_math, t_ahmed, 4, '19:00', '20:30', 5)
    returning id into slot_available; -- will get 2 reservations -> "available"

    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity)
    values (ts_id, g3sec, s_math, t_ahmed, 5, '15:00', '16:30', 5)
    returning id into slot_almost_full; -- will get 4 reservations -> "almost full"

    insert into lesson_slots (teacher_subject_id, grade_id, subject_id, teacher_id, day_of_week, start_time, end_time, capacity)
    values (ts_id, g3sec, s_math, t_ahmed, 2, '19:30', '21:00', 5)
    returning id into slot_full; -- will get 5 reservations -> "full", must not appear

    -- 2 reservations for "available" slot
    for i in 1..2 loop
        insert into students (full_name, mobile, age, gender, parent_name, parent_mobile, email)
        values ('Seed Student A' || i, '010000000' || i, 15, 'male', 'Seed Parent A' || i, '011000000' || i, null)
        returning id into dummy_student;
        insert into reservations (reservation_code, student_id, grade_id, status)
        values (generate_reservation_code(), dummy_student, g3sec, 'confirmed')
        returning id into dummy_reservation;
        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (dummy_reservation, s_math, t_ahmed, slot_available);
    end loop;

    -- 4 reservations for "almost full" slot
    for i in 1..4 loop
        insert into students (full_name, mobile, age, gender, parent_name, parent_mobile, email)
        values ('Seed Student B' || i, '012000000' || i, 16, 'female', 'Seed Parent B' || i, '015000000' || i, null)
        returning id into dummy_student;
        insert into reservations (reservation_code, student_id, grade_id, status)
        values (generate_reservation_code(), dummy_student, g3sec, 'confirmed')
        returning id into dummy_reservation;
        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (dummy_reservation, s_math, t_ahmed, slot_almost_full);
    end loop;

    -- 5 reservations for "full" slot
    for i in 1..5 loop
        insert into students (full_name, mobile, age, gender, parent_name, parent_mobile, email)
        values ('Seed Student C' || i, '010500000' || i, 17, 'male', 'Seed Parent C' || i, '012500000' || i, null)
        returning id into dummy_student;
        insert into reservations (reservation_code, student_id, grade_id, status)
        values (generate_reservation_code(), dummy_student, g3sec, 'confirmed')
        returning id into dummy_reservation;
        insert into reservation_items (reservation_id, subject_id, teacher_id, slot_id)
        values (dummy_reservation, s_math, t_ahmed, slot_full);
    end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Sanity check counts (visible in SQL editor output)
-- ----------------------------------------------------------------------------
select
    (select count(*) from grades) as grades_count,
    (select count(*) from subjects) as subjects_count,
    (select count(*) from teachers) as teachers_count,
    (select count(*) from teacher_subjects) as teacher_subjects_count,
    (select count(*) from lesson_slots) as lesson_slots_count;
