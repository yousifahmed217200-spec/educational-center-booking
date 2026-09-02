-- ============================================================================
-- MIGRATION: add per-slot WhatsApp group link
-- ============================================================================
-- Run this ONCE if you already have an existing database (created before
-- this feature was added). Safe to re-run (uses IF NOT EXISTS).
--
-- After running this, also re-run the updated functions.sql so that
-- get_reservation_confirmation() returns whatsapp_group_link for each
-- booked item.
-- ============================================================================

alter table lesson_slots
    add column if not exists whatsapp_group_link text;

comment on column lesson_slots.whatsapp_group_link is
    'WhatsApp group invite link for this slot, set by the admin. Shown to the student immediately after they book this slot.';
