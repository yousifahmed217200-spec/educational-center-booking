// ============================================================================
// ADMIN DASHBOARD LOGIC
// ============================================================================
// Uses Supabase Auth (email/password) for login. Authorization itself is
// enforced server-side by RLS policies calling is_admin(), which checks
// membership in the admin_users table — NOT by any client-side flag. If a
// logged-in user is not in admin_users, every admin-only query below will
// simply return zero rows / be rejected by RLS.
//
// To create your first admin user:
//   1. Supabase Dashboard -> Authentication -> Users -> "Add user" (set email+password)
//   2. SQL Editor: insert into admin_users (id, full_name)
//      values ('<the auth user's UUID>', 'Your Name');
// ============================================================================

const SUPABASE_URL = "https://qfrcurdmgyzsbdomlnxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcmN1cmRtZ3l6c2Jkb21sbnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTcyNDAsImV4cCI6MjEwMjE5MzI0MH0.kbksk7I-PHhvHO_mXsdTcnALW3Q-9seHt6-a49YyMds";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function $(id) { return document.getElementById(id); }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str ?? ""; return d.innerHTML; }

// ----------------------------------------------------------------------------
// AUTH
// ----------------------------------------------------------------------------
async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    showAdminApp();
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  $("loginScreen").hidden = false;
  $("adminApp").hidden = true;
}

async function showAdminApp() {
  $("loginScreen").hidden = true;
  $("adminApp").hidden = false;
  await loadDashboard();
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("btnLogin");
  const errBox = $("loginError");
  errBox.innerHTML = "";
  btn.disabled = true;
  btn.classList.add("is-loading");

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  btn.disabled = false;
  btn.classList.remove("is-loading");

  if (error) {
    errBox.innerHTML = `<div class="banner banner-error">Invalid email or password.</div>`;
    return;
  }

  // Verify this user is actually an admin (RLS-backed check).
  const { data: adminRow } = await supabaseClient.rpc("is_admin");
  if (!adminRow) {
    errBox.innerHTML = `<div class="banner banner-error">This account does not have admin access.</div>`;
    await supabaseClient.auth.signOut();
    return;
  }

  await showAdminApp();
});

$("btnLogout").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  showLoginScreen();
});

// ----------------------------------------------------------------------------
// TAB NAVIGATION
// ----------------------------------------------------------------------------
document.querySelectorAll(".admin-nav__item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-nav__item").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".admin-tab").forEach((t) => (t.hidden = true));
    btn.classList.add("is-active");
    const tab = btn.dataset.tab;
    $(`tab-${tab}`).hidden = false;
    loadTab(tab);
  });
});

function loadTab(tab) {
  switch (tab) {
    case "dashboard": return loadDashboard();
    case "reservations": return loadReservations();
    case "teachers": return loadTeachers();
    case "subjects": return loadSubjects();
    case "grades": return loadGrades();
    case "slots": return loadSlots();
  }
}

// ----------------------------------------------------------------------------
// DASHBOARD
// ----------------------------------------------------------------------------
async function loadDashboard() {
  const statGrid = $("statGrid");
  statGrid.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Loading dashboard...</div>`;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [{ count: totalReservations }, { count: todayReservations }, { count: totalStudents }, { data: slots }] =
    await Promise.all([
      supabaseClient.from("reservations").select("*", { count: "exact", head: true }).eq("status", "confirmed"),
      supabaseClient.from("reservations").select("*", { count: "exact", head: true }).eq("status", "confirmed").gte("created_at", todayStart.toISOString()),
      supabaseClient.from("students").select("*", { count: "exact", head: true }),
      supabaseClient.from("lesson_slots").select("id, capacity"),
    ]);

  const { data: items } = await supabaseClient
    .from("reservation_items")
    .select("slot_id, reservations!inner(status)")
    .eq("reservations.status", "confirmed");

  const countBySlot = {};
  (items || []).forEach((item) => { countBySlot[item.slot_id] = (countBySlot[item.slot_id] || 0) + 1; });

  let availableSlots = 0, fullSlots = 0;
  (slots || []).forEach((slot) => {
    const used = countBySlot[slot.id] || 0;
    if (used >= slot.capacity) fullSlots++; else availableSlots++;
  });

  statGrid.innerHTML = `
    ${statCard(totalReservations ?? 0, "Total Reservations")}
    ${statCard(todayReservations ?? 0, "Today's Reservations")}
    ${statCard(totalStudents ?? 0, "Active Students")}
    ${statCard(availableSlots, "Available Slots")}
    ${statCard(fullSlots, "Full Slots")}
  `;
}

function statCard(value, label) {
  return `<div class="stat-card"><div class="stat-card__value">${value}</div><div class="stat-card__label">${label}</div></div>`;
}

// ----------------------------------------------------------------------------
// RESERVATIONS (with filters)
// ----------------------------------------------------------------------------
async function loadReservations() {
  await populateGradeFilterOnce();

  const table = $("reservationsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;

  let query = supabaseClient
    .from("reservations")
    .select("id, reservation_code, status, created_at, grade_id, grades(name), students(full_name, mobile)")
    .order("created_at", { ascending: false })
    .limit(200);

  const gradeId = $("filterGrade").value;
  const status = $("filterStatus").value;
  const date = $("filterDate").value;

  if (gradeId) query = query.eq("grade_id", gradeId);
  if (status) query = query.eq("status", status);
  if (date) {
    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end = new Date(date); end.setHours(23, 59, 59, 999);
    query = query.gte("created_at", start.toISOString()).lte("created_at", end.toISOString());
  }

  const { data, error } = await query;
  if (error) { table.innerHTML = `<tr><td>Error loading reservations.</td></tr>`; return; }

  table.innerHTML = `
    <thead><tr><th>Code</th><th>Student</th><th>Mobile</th><th>Grade</th><th>Date</th><th>Status</th></tr></thead>
    <tbody>
      ${(data || []).map((r) => `
        <tr>
          <td>${escapeHtml(r.reservation_code)}</td>
          <td>${escapeHtml(r.students?.full_name || "—")}</td>
          <td>${escapeHtml(r.students?.mobile || "—")}</td>
          <td>${escapeHtml(r.grades?.name || "—")}</td>
          <td>${new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
          <td><span class="status-pill ${r.status}">${r.status}</span></td>
        </tr>`).join("")}
    </tbody>`;
}

let gradeFilterPopulated = false;
async function populateGradeFilterOnce() {
  if (gradeFilterPopulated) return;
  const { data } = await supabaseClient.from("grades").select("id, name").order("display_order");
  const select = $("filterGrade");
  (data || []).forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id; opt.textContent = g.name;
    select.appendChild(opt);
  });
  gradeFilterPopulated = true;
  ["filterGrade", "filterStatus", "filterDate"].forEach((id) => $(id).addEventListener("change", loadReservations));
}

// ----------------------------------------------------------------------------
// TEACHERS
// ----------------------------------------------------------------------------
async function loadTeachers() {
  const table = $("teachersTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("teachers").select("id, full_name, title, active").order("full_name");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Title</th><th>Status</th></tr></thead>
    <tbody>${(data || []).map((t) => `
      <tr><td>${escapeHtml(t.full_name)}</td><td>${escapeHtml(t.title || "—")}</td>
      <td><span class="status-pill ${t.active ? "confirmed" : "cancelled"}">${t.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}
    </tbody>`;
}

// ----------------------------------------------------------------------------
// SUBJECTS
// ----------------------------------------------------------------------------
async function loadSubjects() {
  const table = $("subjectsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("subjects").select("id, name, description, active").order("name");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Description</th><th>Status</th></tr></thead>
    <tbody>${(data || []).map((s) => `
      <tr><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.description || "—")}</td>
      <td><span class="status-pill ${s.active ? "confirmed" : "cancelled"}">${s.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}
    </tbody>`;
}

// ----------------------------------------------------------------------------
// GRADES
// ----------------------------------------------------------------------------
async function loadGrades() {
  const table = $("gradesTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("grades").select("id, name, display_order, active").order("display_order");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Order</th><th>Status</th></tr></thead>
    <tbody>${(data || []).map((g) => `
      <tr><td>${escapeHtml(g.name)}</td><td>${g.display_order}</td>
      <td><span class="status-pill ${g.active ? "confirmed" : "cancelled"}">${g.active ? "Active" : "Inactive"}</span></td></tr>`).join("")}
    </tbody>`;
}

// ----------------------------------------------------------------------------
// SLOTS (with live remaining-seat calculation)
// ----------------------------------------------------------------------------
async function loadSlots() {
  const table = $("slotsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;

  const { data: slots } = await supabaseClient
    .from("lesson_slots")
    .select("id, day_of_week, start_time, end_time, capacity, active, grades(name), subjects(name), teachers(full_name)")
    .order("day_of_week");

  const { data: items } = await supabaseClient
    .from("reservation_items")
    .select("slot_id, reservations!inner(status)")
    .eq("reservations.status", "confirmed");

  const countBySlot = {};
  (items || []).forEach((item) => { countBySlot[item.slot_id] = (countBySlot[item.slot_id] || 0) + 1; });

  table.innerHTML = `
    <thead><tr><th>Grade</th><th>Subject</th><th>Teacher</th><th>Day</th><th>Time</th><th>Capacity</th><th>Booked</th><th>Status</th></tr></thead>
    <tbody>${(slots || []).map((s) => {
      const booked = countBySlot[s.id] || 0;
      const full = booked >= s.capacity;
      return `<tr>
        <td>${escapeHtml(s.grades?.name || "—")}</td>
        <td>${escapeHtml(s.subjects?.name || "—")}</td>
        <td>${escapeHtml(s.teachers?.full_name || "—")}</td>
        <td>${DAY_NAMES[s.day_of_week]}</td>
        <td>${s.start_time?.slice(0,5)} - ${s.end_time?.slice(0,5)}</td>
        <td>${s.capacity}</td>
        <td>${booked}</td>
        <td><span class="status-pill ${full ? "pending" : "confirmed"}">${full ? "Full" : "Available"}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}

// ----------------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------------
checkSession();
