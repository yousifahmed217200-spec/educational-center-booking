-- ============================================================================
-- MIGRATION: move WhatsApp group link from per-slot to per-grade
-- ============================================================================
-- Run this ONCE on an existing database that was created before this change.
-- Safe to re-run (uses IF NOT EXISTS).
--
-- WHY: previously every lesson_slots row had its own whatsapp_group_link,
-- so a grade with 10 slots needed the admin to paste the same group link
-- 10 times. Now there is ONE link per grade -- every student who books any
-- subject/slot under that grade sees the same link, regardless of school
-- type or which slot they picked.
--
-- After running this, also re-run the updated functions.sql so that
-- get_reservation_confirmation() returns the grade-level link instead of
-- the old per-slot one.
--
-- If you previously ran an earlier version of this migration that added
-- whatsapp_group_link_arabic / whatsapp_group_link_languages (two columns,
-- one per school type), this migration also collapses those back down into
-- the single whatsapp_group_link column below and drops the two old ones.
-- ============================================================================

alter table grades
    add column if not exists whatsapp_group_link text;

comment on column grades.whatsapp_group_link is
    'WhatsApp group invite link shown to any student of this grade after booking, regardless of school type or which subject/slot they booked.';

-- Collapse the old two-column (per-school-type) version, if present, into
-- the single column above -- preferring the Arabic link, falling back to
-- the Languages link, if only one of the two was actually set.
do $$
begin
    if exists (select 1 from information_schema.columns where table_name = 'grades' and column_name = 'whatsapp_group_link_arabic') then
        update grades
        set whatsapp_group_link = coalesce(whatsapp_group_link, whatsapp_group_link_arabic, whatsapp_group_link_languages)
        where whatsapp_group_link is null;

        alter table grades drop column if exists whatsapp_group_link_arabic;
        alter table grades drop column if exists whatsapp_group_link_languages;
    end if;
end $$;

-- OPTIONAL one-time backfill from the old per-slot links, if you had set
-- them consistently across a grade's slots and never set the new
-- grade-level link at all. Uncomment and run if useful -- safe to skip.
--
-- update grades g
-- set whatsapp_group_link = sub.link
-- from (
--     select distinct on (grade_id) grade_id, whatsapp_group_link as link
--     from lesson_slots
--     where whatsapp_group_link is not null
--     group by grade_id, whatsapp_group_link
--     order by grade_id, count(*) desc
-- ) sub
-- where sub.grade_id = g.id and g.whatsapp_group_link is null;
