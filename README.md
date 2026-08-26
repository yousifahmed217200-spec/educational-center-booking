# Educational Center — Student Registration & Lesson Booking

A complete, production-ready booking application: static HTML/CSS/vanilla JS frontend + Supabase (PostgreSQL, RLS, RPC functions, Edge Functions) backend. No Node/PHP/VPS backend required.

## 1. Architecture

```
Browser (index.html/app.js)  ──Supabase JS client──►  Supabase
                                                         ├─ PostgreSQL (source of truth)
                                                         ├─ Row Level Security (RLS)
                                                         ├─ RPC functions (create_reservation, available_slots, ...)
                                                         ├─ Supabase Auth (admin login)
                                                         └─ Edge Function (send-reservation-email → Resend API)
Browser (admin.html/admin.js) ──Supabase JS client──►  Supabase (authenticated, is_admin()-gated)
```

The anon key is safe in the browser because every table has RLS enabled and public write access is *never* granted directly — all writes go through the `create_reservation()` SQL function, which is `SECURITY DEFINER` and performs every validation itself. The `service_role` key is never used anywhere in this repo.

## 2. Database ERD

```
grades ──< subject_grades >── subjects
                                  │
teachers ──< teacher_subjects >──┘   (teacher_subjects also carries grade_id)
                │
                └──< lesson_slots   (each slot = exactly one teacher+subject+grade)

students ──< reservations >── grades
reservations ──< reservation_items >── (subject_id, teacher_id, slot_id)

admin_users (id = auth.users.id)  ← used by is_admin() for RLS
```

Capacity is **never** a stored counter. `remaining = lesson_slots.capacity − count(reservation_items where reservation.status = 'confirmed')`, computed live inside `available_slots()`.

## 3–6. SQL files

Run these **in order** in the Supabase SQL Editor:

| Order | File | Purpose |
|---|---|---|
| 1 | `supabase/schema.sql` | Tables, constraints, indexes |
| 2 | `supabase/functions.sql` | `create_reservation`, `available_slots`, `is_admin`, mobile normalizer |
| 3 | `supabase/rls.sql` | Row Level Security policies |
| 4 | `supabase/seed.sql` | 9 grades, 10 subjects, 16 teachers, 22+ teacher-subject links, 50+ slots, capacity test fixtures |

## 7–9. Frontend / Admin / Edge Function

- `index.html`, `styles.css`, `app.js` — the student-facing booking SPA
- `admin.html`, `admin.css`, `admin.js` — the admin dashboard (Supabase Auth)
- `supabase-functions/send-reservation-email/index.ts` — Deno Edge Function that emails the admin via Resend

## 10. Supabase Configuration — step by step

1. Go to https://supabase.com and create a free account.
2. Click **New Project**. Choose a name, a strong database password, and a region close to Egypt (e.g. `eu-central-1` / Frankfurt).
3. Once the project is ready, go to **Project Settings → API**.
   - Copy **Project URL** → this is your `SUPABASE_URL`.
   - Copy the **anon / public** key → this is your `SUPABASE_ANON_KEY`.
   - **Do not copy the `service_role` key into any frontend file.**
4. Open **SQL Editor** → New query. Paste and run `supabase/schema.sql`.
5. New query → paste and run `supabase/functions.sql`.
6. New query → paste and run `supabase/rls.sql`.
7. New query → paste and run `supabase/seed.sql`. The final `select` shows row counts to confirm it worked (9 grades, 10 subjects, 16 teachers, 22 teacher_subjects, 53 lesson_slots).
8. Edit `app.js` and `admin.js`: replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` with the values from step 3.
9. Create your first admin user:
   - **Authentication → Users → Add user** — set an email + password.
   - Copy the new user's UUID.
   - SQL Editor: `insert into admin_users (id, full_name) values ('<uuid>', 'Your Name');`
10. (Optional but recommended) Configure the email Edge Function — see section 11.
11. Deploy the frontend — see section 12.
12. Test using the checklist in section 13.

## 11. Email Setup (Resend)

1. Create a free account at https://resend.com (100 emails/day free, no credit card).
2. **API Keys → Create API Key**, copy it.
3. Install the Supabase CLI (`npm i -g supabase`), then from the project folder:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase functions deploy send-reservation-email
   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
   supabase secrets set ADMIN_NOTIFICATION_EMAIL=yousif.ahmed217@gmail.com
   supabase secrets set RESEND_FROM_EMAIL="Bright Path Center <onboarding@resend.dev>"
   ```
   (`onboarding@resend.dev` works immediately without domain verification; once you verify your own domain in Resend you can use an address on it instead.)
4. In `app.js`, set `EMAIL_FUNCTION_URL` to:
   `https://<project-ref>.functions.supabase.co/send-reservation-email`
5. If you skip this section entirely, reservations still save successfully — the frontend calls the email function in a "fire and forget" way and never rolls back a booking if the email fails or isn't configured. You can swap Resend for Brevo or any other provider later by only editing the Edge Function — the frontend contract (`POST` the reservation JSON) doesn't change.

## 12. Deployment (Cloudflare Pages — easiest for beginners)

1. Push this folder to a GitHub repository.
2. Go to https://pages.cloudflare.com → **Create a project → Connect to Git**.
3. Select your repo. Framework preset: **None**. Build command: *(leave empty)*. Output directory: `/` (project root).
4. Deploy. You'll get a URL like `https://educational-center-booking.pages.dev`.
5. Add a custom domain later under **Custom domains** if you own one.

(Netlify and Vercel work identically for a static site — drag-and-drop the folder or connect the repo, no build step needed.)

## 13. Testing Checklist

**Student registration**
- [ ] Valid data on all fields → advances to Grade step
- [ ] Name < 3 chars → inline error, blocked
- [ ] Invalid mobile (e.g. `0999999999`) → inline error, blocked
- [ ] Valid `+20` international format mobile → accepted
- [ ] Age outside 3–100 → inline error, blocked
- [ ] Missing gender → inline error, blocked
- [ ] Optional email left blank → allowed; invalid email format → blocked

**Grade / Subject / Teacher filtering**
- [ ] Grade 3 Secondary shows Math/Physics/Chemistry/Biology/English/Arabic/Geology, not Grade-4-Primary-only subjects
- [ ] Grade 4 Primary shows a different, smaller subject set
- [ ] Selecting Mathematics under Grade 3 Secondary shows only Ahmed Hassan & Mohamed Ali (not Physics teachers)
- [ ] Changing grade after selecting subjects clears subjects/teachers/slots
- [ ] Removing a subject clears its teacher & slot

**Slot filtering & capacity**
- [ ] Ahmed Hassan's Mathematics slots differ from Mohamed Ali's
- [ ] A slot with 2/5 booked shows "3 seats remaining"
- [ ] A slot with 4/5 booked shows "1 seat remaining" with the low-seats badge
- [ ] A slot with 5/5 booked does **not** appear in the list at all (seeded via `seed.sql`)

**Race condition (overbooking prevention)**
- [ ] Open two browser tabs, select the same "1 seat remaining" slot in both, submit both nearly simultaneously → exactly one succeeds, the other gets "this lesson has just become fully booked"

**Duplicate submission**
- [ ] Double-click "Confirm Reservation" rapidly → only one reservation row is created (verify in Admin → Reservations or the DB); the idempotency key + disabled button both protect against this

**Security**
- [ ] From the browser console, try `supabase.from('students').select('*')` while logged out as a normal visitor → RLS blocks it (empty/error)
- [ ] Try inserting directly into `reservations` from the console → blocked by RLS
- [ ] Log into `/admin.html` with a non-admin Supabase Auth user → login succeeds but dashboard queries return nothing / `is_admin()` check rejects it
- [ ] Confirm `service_role` key does not appear anywhere in any `.js`/`.html` file

## 14. Security Review Summary

- **SQL injection**: all queries go through the Supabase client/PostgREST or parameterized RPC calls — no string-concatenated SQL anywhere.
- **Unauthorized DB access / RLS**: every table has RLS enabled; anon can only `select` explicitly-marked `active = true` catalog rows, and has zero direct write access to `students`, `reservations`, `reservation_items`. All writes happen inside `create_reservation()`, a `SECURITY DEFINER` function that re-validates everything server-side.
- **Service-role key exposure**: never referenced in any frontend file; only ever used server-side (there is no server-side code in this app besides Supabase itself, so it is never needed at all in normal operation).
- **Client-side-only validation**: every field re-validated inside `create_reservation()` (name length, age range, gender enum, Egyptian mobile format via `normalize_egyptian_mobile()`, email format, grade/subject/teacher/slot relationship integrity).
- **Booking race conditions**: `create_reservation()` takes a row lock (`SELECT ... FOR UPDATE`) on each `lesson_slots` row before counting confirmed reservations, serializing concurrent attempts on the same slot.
- **Duplicate submissions**: frontend disables the submit button + generates a client-side `idempotency_key`; backend has a `unique` constraint on `reservations.idempotency_key` and replays the existing reservation on retry instead of creating a new one.
- **Unauthorized admin access**: admin status is derived from the `admin_users` table via `is_admin()`, checked inside RLS policies themselves — never trusted from client state. New admins must be inserted manually via the SQL editor, so there's no self-service privilege escalation path.
- **Data leakage**: `get_reservation_confirmation()` is only ever called with a UUID the caller just generated (returned by `create_reservation()`) or by an admin; there is no reservation-listing RPC exposed to anon.
- **Email API key exposure**: the Resend API key lives only in Supabase Function secrets, never in any client-reachable file.

## Notes on future extensibility

The schema already separates grades/subjects/teachers/slots/reservations cleanly, so adding student/parent/teacher accounts, payments, attendance, or rescheduling later mainly means adding new tables + RLS policies that reference the existing `students`, `teachers`, and `reservations` primary keys — no redesign of the core booking chain is required.
