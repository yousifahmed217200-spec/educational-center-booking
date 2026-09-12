-- ============================================================================
-- Allows admins to delete reservations from the admin dashboard.
-- reservation_items rows are removed automatically via the existing
-- "on delete cascade" foreign key in schema.sql — no separate policy needed
-- for that table since deleting the parent reservation cascades to it.
-- Run this once in the Supabase SQL Editor.
-- ============================================================================
create policy "admins can delete reservations"
    on reservations for delete
    using (is_admin());
