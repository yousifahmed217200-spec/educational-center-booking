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
    case "analytics": return loadAnalytics();
    case "reservations": return loadReservations();
    case "teachers": return loadTeachers();
    case "subjects": return loadSubjects();
    case "grades": return loadGrades();
    case "assignments": return loadAssignments();
    case "slots": return loadSlots();
  }
}

function friendlyDbError(err) {
  const msg = (err && err.message) || String(err);
  if (msg.includes("duplicate key")) return "That entry already exists.";
  if (msg.includes("violates foreign key")) return "This item is referenced elsewhere and can't be removed.";
  return msg || "Something went wrong. Please try again.";
}

// ============================================================================
// MODAL SYSTEM (shared by all "Add ..." forms)
// ============================================================================

function openModal(html) {
  $("modalCard").innerHTML = html;
  $("modalOverlay").hidden = false;
}
function closeModal() {
  $("modalOverlay").hidden = true;
  $("modalCard").innerHTML = "";
}
$("modalOverlay").addEventListener("click", (e) => {
  if (e.target.id === "modalOverlay") closeModal();
});

// ============================================================================
// DASHBOARD
// ============================================================================
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

// ============================================================================
// ANALYTICS — insightful charts for center managers
// ============================================================================
// Chart.js instances are kept here so we can destroy() the old chart before
// redrawing on the same <canvas> each time this tab is opened — otherwise
// Chart.js stacks a new chart on top of the old one.
const chartInstances = {};

function renderChart(canvasId, config) {
  const canvas = $(canvasId);
  if (!canvas) return;
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  chartInstances[canvasId] = new Chart(canvas.getContext("2d"), config);
}

const CHART_COLORS = ["#0e6b64", "#d97a2b", "#2563eb", "#be185d", "#7c3aed", "#059669", "#ca8a04", "#dc2626"];

async function loadAnalytics() {
  const statGrid = $("analyticsStatGrid");
  statGrid.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Loading analytics...</div>`;

  // Reservation-level data (one row per reservation) — used for the time
  // series, grade breakdown, and gender split, so a reservation with
  // multiple lessons doesn't get double-counted in those charts.
  const { data: reservations } = await supabaseClient
    .from("reservations")
    .select("id, created_at, grade_id, grades(name, track), students(gender)")
    .eq("status", "confirmed")
    .order("created_at", { ascending: false })
    .limit(3000);

  // Lesson-level data (one row per booked subject/teacher/slot) — used for
  // subject popularity, teacher popularity, and day-of-week popularity,
  // where each booked lesson should count separately.
  const { data: items } = await supabaseClient
    .from("reservation_items")
    .select("subjects(name), teachers(full_name), lesson_slots(day_of_week), reservations!inner(status)")
    .eq("reservations.status", "confirmed")
    .limit(6000);

  // Slot capacity data — used for the utilization chart.
  const { data: slots } = await supabaseClient.from("lesson_slots").select("id, capacity").eq("active", true);
  const { data: confirmedItems } = await supabaseClient
    .from("reservation_items")
    .select("slot_id, reservations!inner(status)")
    .eq("reservations.status", "confirmed");

  const countBySlot = {};
  (confirmedItems || []).forEach((i) => { countBySlot[i.slot_id] = (countBySlot[i.slot_id] || 0) + 1; });
  const totalCapacity = (slots || []).reduce((sum, s) => sum + s.capacity, 0);
  const totalBooked = (slots || []).reduce((sum, s) => sum + Math.min(countBySlot[s.id] || 0, s.capacity), 0);
  const utilizationPct = totalCapacity ? Math.round((totalBooked / totalCapacity) * 100) : 0;

  const uniqueStudents = new Set((reservations || []).map((r) => r.id)).size;
  const totalLessonsBooked = (items || []).length;
  const avgLessonsPerStudent = uniqueStudents ? (totalLessonsBooked / uniqueStudents).toFixed(1) : "0";

  statGrid.innerHTML = `
    ${statCard(reservations?.length ?? 0, "Confirmed Reservations")}
    ${statCard(totalLessonsBooked, "Lessons Booked")}
    ${statCard(avgLessonsPerStudent, "Avg. Lessons / Student")}
    ${statCard(`${utilizationPct}%`, "Overall Slot Utilization")}
  `;

  renderTimelineChart(reservations || []);
  renderByGradeChart(reservations || []);
  renderBySubjectChart(items || []);
  renderByTeacherChart(items || []);
  renderByDayChart(items || []);
  renderGenderChart(reservations || []);
  renderUtilizationChart(totalBooked, totalCapacity);
  renderTrackChart(reservations || []);
}

function renderTimelineChart(reservations) {
  const days = [];
  const countByDate = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push(key);
    countByDate[key] = 0;
  }
  reservations.forEach((r) => {
    const key = new Date(r.created_at).toISOString().slice(0, 10);
    if (key in countByDate) countByDate[key]++;
  });

  renderChart("chartTimeline", {
    type: "line",
    data: {
      labels: days.map((d) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })),
      datasets: [{
        label: "Reservations",
        data: days.map((d) => countByDate[d]),
        borderColor: CHART_COLORS[0],
        backgroundColor: "rgba(14, 107, 100, 0.12)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderByGradeChart(reservations) {
  const countByGrade = {};
  reservations.forEach((r) => {
    const name = r.grades?.name || "Unknown";
    countByGrade[name] = (countByGrade[name] || 0) + 1;
  });
  const labels = Object.keys(countByGrade);
  const data = labels.map((l) => countByGrade[l]);

  renderChart("chartByGrade", {
    type: "bar",
    data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS[0] }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { autoSkip: false, maxRotation: 40, minRotation: 0, font: { size: 10 } } } },
    },
  });
}

function renderBySubjectChart(items) {
  const countBySubject = {};
  items.forEach((i) => {
    const name = i.subjects?.name || "Unknown";
    countBySubject[name] = (countBySubject[name] || 0) + 1;
  });
  const sorted = Object.entries(countBySubject).sort((a, b) => b[1] - a[1]).slice(0, 8);

  renderChart("chartBySubject", {
    type: "bar",
    data: {
      labels: sorted.map((s) => s[0]),
      datasets: [{ data: sorted.map((s) => s[1]), backgroundColor: CHART_COLORS[1] }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderByTeacherChart(items) {
  const countByTeacher = {};
  items.forEach((i) => {
    const name = i.teachers?.full_name || "Unknown";
    countByTeacher[name] = (countByTeacher[name] || 0) + 1;
  });
  const sorted = Object.entries(countByTeacher).sort((a, b) => b[1] - a[1]).slice(0, 8);

  renderChart("chartByTeacher", {
    type: "bar",
    data: {
      labels: sorted.map((s) => s[0]),
      datasets: [{ data: sorted.map((s) => s[1]), backgroundColor: CHART_COLORS[2] }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderByDayChart(items) {
  const counts = new Array(7).fill(0);
  items.forEach((i) => {
    if (i.lesson_slots && typeof i.lesson_slots.day_of_week === "number") {
      counts[i.lesson_slots.day_of_week]++;
    }
  });

  renderChart("chartByDay", {
    type: "bar",
    data: {
      labels: DAY_NAMES.map((d) => d.slice(0, 3)),
      datasets: [{ data: counts, backgroundColor: CHART_COLORS[4] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
    },
  });
}

function renderGenderChart(reservations) {
  let male = 0, female = 0;
  reservations.forEach((r) => {
    if (r.students?.gender === "male") male++;
    else if (r.students?.gender === "female") female++;
  });

  renderChart("chartGender", {
    type: "doughnut",
    data: {
      labels: ["Male", "Female"],
      datasets: [{ data: [male, female], backgroundColor: [CHART_COLORS[2], CHART_COLORS[3]] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

function renderUtilizationChart(booked, capacity) {
  const remaining = Math.max(capacity - booked, 0);
  renderChart("chartUtilization", {
    type: "doughnut",
    data: {
      labels: ["Booked Seats", "Remaining Seats"],
      datasets: [{ data: [booked, remaining], backgroundColor: [CHART_COLORS[0], "#e5e7eb"] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

// Shows how confirmed reservations split across the two school tracks
// (Arabic-medium vs Languages school), plus grades that aren't track-specific.
function renderTrackChart(reservations) {
  let arabic = 0, languages = 0, notSet = 0;
  reservations.forEach((r) => {
    const track = r.grades?.track;
    if (track === "arabic") arabic++;
    else if (track === "languages") languages++;
    else notSet++;
  });

  renderChart("chartTrack", {
    type: "doughnut",
    data: {
      labels: ["Arabic School", "Languages School", "Not Track-Specific"],
      datasets: [{ data: [arabic, languages, notSet], backgroundColor: [CHART_COLORS[1], CHART_COLORS[2], "#e5e7eb"] }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
    },
  });
}

// ============================================================================
// RESERVATIONS (with filters + Excel export)
// ============================================================================
async function loadReservations() {
  await populateGradeFilterOnce();

  const table = $("reservationsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;

  const { data, error } = await fetchFilteredReservations();
  if (error) { table.innerHTML = `<tr><td>Error loading reservations.</td></tr>`; return; }

  table.innerHTML = `
    <thead><tr><th>Code</th><th>Student</th><th>Mobile</th><th>Grade</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${(data || []).map((r) => `
        <tr>
          <td>${escapeHtml(r.reservation_code)}</td>
          <td>${escapeHtml(r.students?.full_name || "—")}</td>
          <td>${escapeHtml(r.students?.mobile || "—")}</td>
          <td>${escapeHtml(r.grades?.name || "—")}</td>
          <td>${new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
          <td><span class="status-pill ${r.status}">${r.status}</span></td>
          <td class="row-actions">
            <button class="btn-tiny is-danger" onclick="deleteReservation('${r.id}', '${escapeHtml(r.reservation_code)}')">Delete</button>
          </td>
        </tr>`).join("")}
    </tbody>`;
}

// Permanently deletes a reservation (and its reservation_items, via the
// existing "on delete cascade" foreign key). This frees up the seat(s) it
// held immediately, since capacity is always computed live from confirmed
// reservation_items — nothing else needs to be updated.
async function deleteReservation(id, code) {
  const confirmed = confirm(`Delete reservation ${code}? This cannot be undone, and the seat(s) it held will become available again.`);
  if (!confirmed) return;

  const { error } = await supabaseClient.from("reservations").delete().eq("id", id);
  if (error) {
    alert(friendlyDbError(error));
    return;
  }
  loadReservations();
}
window.deleteReservation = deleteReservation;

async function fetchFilteredReservations() {
  let query = supabaseClient
    .from("reservations")
    .select("id, reservation_code, status, created_at, grade_id, grades(name), students(full_name, mobile, age, gender, parent_name, parent_mobile, email)")
    .order("created_at", { ascending: false })
    .limit(500);

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

  return query;
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

// ---- Excel export ----
$("btnExportExcel").addEventListener("click", async () => {
  const btn = $("btnExportExcel");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing file...";

  try {
    const { data: reservations, error } = await fetchFilteredReservations();
    if (error) throw error;

    const reservationIds = (reservations || []).map((r) => r.id);
    let itemsByReservation = {};

    if (reservationIds.length) {
      const { data: items, error: itemsError } = await supabaseClient
        .from("reservation_items")
        .select("reservation_id, subjects(name), teachers(full_name), lesson_slots(day_of_week, start_time, end_time)")
        .in("reservation_id", reservationIds);
      if (itemsError) throw itemsError;

      (items || []).forEach((item) => {
        if (!itemsByReservation[item.reservation_id]) itemsByReservation[item.reservation_id] = [];
        itemsByReservation[item.reservation_id].push(item);
      });
    }

    // One row per (reservation x lesson) so every booked subject/teacher/time
    // is fully visible in the spreadsheet, with student info repeated per row.
    const rows = [];
    (reservations || []).forEach((r) => {
      const lessons = itemsByReservation[r.id] || [];
      const baseRow = {
        "Reservation Code": r.reservation_code,
        "Status": r.status,
        "Submitted At (Cairo)": new Date(r.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
        "Student Name": r.students?.full_name || "",
        "Student Mobile": r.students?.mobile || "",
        "Age": r.students?.age ?? "",
        "Gender": r.students?.gender || "",
        "Parent Name": r.students?.parent_name || "",
        "Parent Mobile": r.students?.parent_mobile || "",
        "Email": r.students?.email || "",
        "Grade": r.grades?.name || "",
      };
      if (!lessons.length) {
        rows.push({ ...baseRow, "Subject": "", "Teacher": "", "Day": "", "Time": "" });
      } else {
        lessons.forEach((lesson) => {
          rows.push({
            ...baseRow,
            "Subject": lesson.subjects?.name || "",
            "Teacher": lesson.teachers?.full_name || "",
            "Day": lesson.lesson_slots ? DAY_NAMES[lesson.lesson_slots.day_of_week] : "",
            "Time": lesson.lesson_slots ? `${lesson.lesson_slots.start_time?.slice(0,5)} - ${lesson.lesson_slots.end_time?.slice(0,5)}` : "",
          });
        });
      }
    });

    if (!rows.length) {
      alert("No reservations match the current filters.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = Object.keys(rows[0]).map((key) => ({ wch: Math.max(12, key.length + 2) }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Reservations");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `reservations-${dateStr}.xlsx`);
  } catch (err) {
    console.error("Export failed:", err);
    alert("Could not export reservations. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// ============================================================================
// TEACHERS
// ============================================================================
async function loadTeachers() {
  const table = $("teachersTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("teachers").select("id, full_name, title, active").order("full_name");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Title</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((t) => `
      <tr>
        <td>${escapeHtml(t.full_name)}</td>
        <td>${escapeHtml(t.title || "—")}</td>
        <td><span class="status-pill ${t.active ? "confirmed" : "cancelled"}">${t.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('teachers', '${t.id}', ${t.active})">${t.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

$("btnAddTeacher").addEventListener("click", () => {
  openModal(`
    <h3>Add Teacher</h3>
    <form id="addTeacherForm">
      <div class="form-group">
        <label class="form-label" for="teacherName">Full Name</label>
        <input class="form-input" id="teacherName" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="teacherTitle">Title <span class="optional-tag">(optional)</span></label>
        <input class="form-input" id="teacherTitle" placeholder="e.g. Mathematics Teacher">
      </div>
      <div id="addTeacherError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Teacher</button>
      </div>
    </form>
  `);

  $("addTeacherForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addTeacherError");
    errBox.innerHTML = "";
    const full_name = $("teacherName").value.trim();
    const title = $("teacherTitle").value.trim() || null;
    if (full_name.length < 3) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter the teacher's full name.</div>`;
      return;
    }
    const { error } = await supabaseClient.from("teachers").insert({ full_name, title });
    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }
    closeModal();
    loadTeachers();
  });
});

// ============================================================================
// SUBJECTS (with grade eligibility checkboxes -> subject_grades)
// ============================================================================
async function loadSubjects() {
  const table = $("subjectsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("subjects").select("id, name, description, active").order("name");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.description || "—")}</td>
        <td><span class="status-pill ${s.active ? "confirmed" : "cancelled"}">${s.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('subjects', '${s.id}', ${s.active})">${s.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

$("btnAddSubject").addEventListener("click", async () => {
  const { data: grades } = await supabaseClient.from("grades").select("id, name").eq("active", true).order("display_order");

  openModal(`
    <h3>Add Subject</h3>
    <form id="addSubjectForm">
      <div class="form-group">
        <label class="form-label" for="subjectName">Subject Name</label>
        <input class="form-input" id="subjectName" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="subjectDesc">Description <span class="optional-tag">(optional)</span></label>
        <input class="form-input" id="subjectDesc">
      </div>
      <div class="form-group">
        <label class="form-label">Available for Grades</label>
        <div class="checkbox-grid">
          ${(grades || []).map((g) => `
            <label><input type="checkbox" name="gradeCheck" value="${g.id}"> ${escapeHtml(g.name)}</label>
          `).join("")}
        </div>
      </div>
      <div id="addSubjectError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Subject</button>
      </div>
    </form>
  `);

  $("addSubjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addSubjectError");
    errBox.innerHTML = "";
    const name = $("subjectName").value.trim();
    const description = $("subjectDesc").value.trim() || null;
    const gradeIds = Array.from(document.querySelectorAll('input[name="gradeCheck"]:checked')).map((cb) => cb.value);

    if (name.length < 2) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a subject name.</div>`;
      return;
    }

    const { data: newSubject, error } = await supabaseClient.from("subjects").insert({ name, description }).select("id").single();
    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }

    if (gradeIds.length) {
      const rows = gradeIds.map((gradeId) => ({ subject_id: newSubject.id, grade_id: gradeId }));
      const { error: linkError } = await supabaseClient.from("subject_grades").insert(rows);
      if (linkError) {
        errBox.innerHTML = `<div class="banner banner-error">Subject created, but linking grades failed: ${escapeHtml(friendlyDbError(linkError))}</div>`;
        return;
      }
    }

    closeModal();
    loadSubjects();
  });
});

// ============================================================================
// GRADES
// ============================================================================
async function loadGrades() {
  const table = $("gradesTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("grades").select("id, name, display_order, active, track").order("display_order");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Order</th><th>Track</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((g) => `
      <tr>
        <td>${escapeHtml(g.name)}</td>
        <td>${g.display_order}</td>
        <td>${g.track === "arabic" ? "Arabic School" : g.track === "languages" ? "Languages School" : "Both / Unset"}</td>
        <td><span class="status-pill ${g.active ? "confirmed" : "cancelled"}">${g.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('grades', '${g.id}', ${g.active})">${g.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

$("btnAddGrade").addEventListener("click", () => {
  openModal(`
    <h3>Add Grade</h3>
    <form id="addGradeForm">
      <div class="form-group">
        <label class="form-label" for="gradeName">Grade Name</label>
        <input class="form-input" id="gradeName" placeholder="e.g. Grade 4 Secondary" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="gradeOrder">Display Order</label>
        <input class="form-input" id="gradeOrder" type="number" min="0" value="0">
        <div class="form-hint">Controls the order grades appear in for students (lower = first).</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="gradeTrack">School Track</label>
        <select class="form-select" id="gradeTrack">
          <option value="">Both / Not track-specific</option>
          <option value="arabic">Arabic School (مدرسة عربي)</option>
          <option value="languages">Languages School (مدرسة لغات)</option>
        </select>
        <div class="form-hint">If a track is chosen, this grade only appears to students who picked that school type. Leave as "Both" for a grade shared across tracks.</div>
      </div>
      <div id="addGradeError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Grade</button>
      </div>
    </form>
  `);

  $("addGradeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addGradeError");
    errBox.innerHTML = "";
    const name = $("gradeName").value.trim();
    const display_order = Number($("gradeOrder").value) || 0;
    const track = $("gradeTrack").value || null;
    if (name.length < 2) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a grade name.</div>`;
      return;
    }
    const { error } = await supabaseClient.from("grades").insert({ name, display_order, track });
    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }
    closeModal();
    loadGrades();
  });
});


// ============================================================================
// ASSIGNMENTS (teacher_subjects: links teacher + subject + grade)
// ============================================================================
async function loadAssignments() {
  const table = $("assignmentsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient
    .from("teacher_subjects")
    .select("id, active, grades(name), subjects(name), teachers(full_name)")
    .order("id");
  table.innerHTML = `
    <thead><tr><th>Teacher</th><th>Subject</th><th>Grade</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((a) => `
      <tr>
        <td>${escapeHtml(a.teachers?.full_name || "—")}</td>
        <td>${escapeHtml(a.subjects?.name || "—")}</td>
        <td>${escapeHtml(a.grades?.name || "—")}</td>
        <td><span class="status-pill ${a.active ? "confirmed" : "cancelled"}">${a.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('teacher_subjects', '${a.id}', ${a.active})">${a.active ? "Deactivate" : "Activate"}</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

$("btnAddAssignment").addEventListener("click", async () => {
  const [{ data: grades }, { data: teachers }] = await Promise.all([
    supabaseClient.from("grades").select("id, name").eq("active", true).order("display_order"),
    supabaseClient.from("teachers").select("id, full_name").eq("active", true).order("full_name"),
  ]);

  openModal(`
    <h3>Add Teacher Assignment</h3>
    <form id="addAssignmentForm">
      <div class="form-group">
        <label class="form-label" for="assignGrade">Grade</label>
        <select class="form-select" id="assignGrade" required>
          <option value="">Select a grade</option>
          ${(grades || []).map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="assignSubject">Subject</label>
        <select class="form-select" id="assignSubject" required disabled>
          <option value="">Select a grade first</option>
        </select>
        <div class="form-hint">Only subjects already linked to the chosen grade (Subjects tab → Link to Grades) appear here — this keeps teacher assignments from pointing at a subject/grade pair students can't actually see.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="assignTeacher">Teacher</label>
        <select class="form-select" id="assignTeacher" required>
          <option value="">Select a teacher</option>
          ${(teachers || []).map((t) => `<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join("")}
        </select>
      </div>
      <div id="addAssignmentError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Assignment</button>
      </div>
    </form>
  `);

  // Re-populate the Subject dropdown whenever the Grade changes, restricted
  // to subjects actually linked to that grade via subject_grades. This is
  // the fix for the "orphaned assignment" bug: previously ANY active
  // subject could be picked for ANY grade here, even if that subject was
  // never added to the grade's subject list — producing a teacher
  // assignment students could never actually reach.
  $("assignGrade").addEventListener("change", async () => {
    const subjectSelect = $("assignSubject");
    const gradeId = $("assignGrade").value;

    if (!gradeId) {
      subjectSelect.innerHTML = `<option value="">Select a grade first</option>`;
      subjectSelect.disabled = true;
      return;
    }

    subjectSelect.disabled = true;
    subjectSelect.innerHTML = `<option value="">Loading subjects...</option>`;

    const { data, error } = await supabaseClient
      .from("subject_grades")
      .select("subjects!inner(id, name, active)")
      .eq("grade_id", gradeId).eq("active", true).eq("subjects.active", true);

    if (error) {
      subjectSelect.innerHTML = `<option value="">Could not load subjects</option>`;
      return;
    }

    const subjects = (data || []).map((row) => row.subjects);
    if (subjects.length === 0) {
      subjectSelect.innerHTML = `<option value="">No subjects linked to this grade yet</option>`;
      return;
    }

    subjectSelect.innerHTML =
      `<option value="">Select a subject</option>` +
      subjects.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    subjectSelect.disabled = false;
  });

  $("addAssignmentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addAssignmentError");
    errBox.innerHTML = "";
    const grade_id = $("assignGrade").value;
    const subject_id = $("assignSubject").value;
    const teacher_id = $("assignTeacher").value;

    if (!grade_id || !subject_id || !teacher_id) {
      errBox.innerHTML = `<div class="banner banner-error">Please select a grade, subject, and teacher.</div>`;
      return;
    }

    const { error } = await supabaseClient.from("teacher_subjects").insert({ grade_id, subject_id, teacher_id });
    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }
    closeModal();
    loadAssignments();
  });
});

// ============================================================================
// SLOTS (with live booked-count display + filters)
// ============================================================================
let slotFiltersPopulated = false;
async function populateSlotFiltersOnce() {
  if (slotFiltersPopulated) return;

  const [{ data: grades }, { data: subjects }, { data: teachers }] = await Promise.all([
    supabaseClient.from("grades").select("id, name").order("display_order"),
    supabaseClient.from("subjects").select("id, name").order("name"),
    supabaseClient.from("teachers").select("id, full_name").order("full_name"),
  ]);

  const gradeSelect = $("slotFilterGrade");
  (grades || []).forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id; opt.textContent = g.name;
    gradeSelect.appendChild(opt);
  });

  const subjectSelect = $("slotFilterSubject");
  (subjects || []).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id; opt.textContent = s.name;
    subjectSelect.appendChild(opt);
  });

  const teacherSelect = $("slotFilterTeacher");
  (teachers || []).forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.full_name;
    teacherSelect.appendChild(opt);
  });

  slotFiltersPopulated = true;
  ["slotFilterGrade", "slotFilterSubject", "slotFilterTeacher", "slotFilterDay"].forEach((id) =>
    $(id).addEventListener("change", loadSlots)
  );
}

async function loadSlots() {
  await populateSlotFiltersOnce();

  const table = $("slotsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;

  let query = supabaseClient
    .from("lesson_slots")
    .select("id, day_of_week, start_time, end_time, capacity, active, grades(name), subjects(name), teachers(full_name)")
    .order("day_of_week");

  const gradeId = $("slotFilterGrade").value;
  const subjectId = $("slotFilterSubject").value;
  const teacherId = $("slotFilterTeacher").value;
  const dayOfWeek = $("slotFilterDay").value;

  if (gradeId) query = query.eq("grade_id", gradeId);
  if (subjectId) query = query.eq("subject_id", subjectId);
  if (teacherId) query = query.eq("teacher_id", teacherId);
  if (dayOfWeek !== "") query = query.eq("day_of_week", Number(dayOfWeek));

  const { data: slots } = await query;

  const { data: items } = await supabaseClient
    .from("reservation_items")
    .select("slot_id, reservations!inner(status)")
    .eq("reservations.status", "confirmed");

  const countBySlot = {};
  (items || []).forEach((item) => { countBySlot[item.slot_id] = (countBySlot[item.slot_id] || 0) + 1; });

  table.innerHTML = `
    <thead><tr><th>Grade</th><th>Subject</th><th>Teacher</th><th>Day</th><th>Time</th><th>Capacity</th><th>Booked</th><th>Status</th><th>Actions</th></tr></thead>
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
        <td><span class="status-pill ${s.active ? (full ? "pending" : "confirmed") : "cancelled"}">${!s.active ? "Disabled" : full ? "Full" : "Available"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('lesson_slots', '${s.id}', ${s.active})">${s.active ? "Disable" : "Enable"}</button>
        </td>
      </tr>`;
    }).join("")}</tbody>`;
}

$("btnAddSlot").addEventListener("click", async () => {
  const { data: assignments } = await supabaseClient
    .from("teacher_subjects")
    .select("id, grades(name), subjects(name), teachers(full_name)")
    .eq("active", true);

  openModal(`
    <h3>Add Lesson Slot</h3>
    <form id="addSlotForm">
      <div class="form-group">
        <label class="form-label" for="slotAssignment">Teacher / Subject / Grade</label>
        <select class="form-select" id="slotAssignment" required>
          <option value="">Select an assignment</option>
          ${(assignments || []).map((a) => `<option value="${a.id}">${escapeHtml(a.teachers?.full_name)} — ${escapeHtml(a.subjects?.name)} (${escapeHtml(a.grades?.name)})</option>`).join("")}
        </select>
        <div class="form-hint">Don't see the combination you need? Add it first under the Assignments tab.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="slotDay">Day of Week</label>
        <select class="form-select" id="slotDay" required>
          ${DAY_NAMES.map((d, i) => `<option value="${i}">${d}</option>`).join("")}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="slotStart">Start Time</label>
        <input class="form-input" id="slotStart" type="time" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="slotEnd">End Time</label>
        <input class="form-input" id="slotEnd" type="time" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="slotCapacity">Capacity</label>
        <input class="form-input" id="slotCapacity" type="number" min="1" value="5" required>
      </div>
      <div id="addSlotError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Slot</button>
      </div>
    </form>
  `);

  $("addSlotForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addSlotError");
    errBox.innerHTML = "";

    const teacherSubjectId = $("slotAssignment").value;
    const dayOfWeek = Number($("slotDay").value);
    const startTime = $("slotStart").value;
    const endTime = $("slotEnd").value;
    const capacity = Number($("slotCapacity").value);

    if (!teacherSubjectId) {
      errBox.innerHTML = `<div class="banner banner-error">Please select a teacher/subject/grade assignment.</div>`;
      return;
    }
    if (!startTime || !endTime || endTime <= startTime) {
      errBox.innerHTML = `<div class="banner banner-error">End time must be after start time.</div>`;
      return;
    }
    if (!capacity || capacity < 1) {
      errBox.innerHTML = `<div class="banner banner-error">Capacity must be at least 1.</div>`;
      return;
    }

    const { data: assignment, error: assignmentError } = await supabaseClient
      .from("teacher_subjects")
      .select("grade_id, subject_id, teacher_id")
      .eq("id", teacherSubjectId)
      .single();

    if (assignmentError || !assignment) {
      errBox.innerHTML = `<div class="banner banner-error">Could not find that assignment. Please try again.</div>`;
      return;
    }

    const { error } = await supabaseClient.from("lesson_slots").insert({
      teacher_subject_id: teacherSubjectId,
      grade_id: assignment.grade_id,
      subject_id: assignment.subject_id,
      teacher_id: assignment.teacher_id,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      capacity,
    });

    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }

    closeModal();
    loadSlots();
  });
});

// ============================================================================
// SHARED: toggle active/inactive for any of the manageable tables
// ============================================================================
async function toggleActive(table, id, currentActive) {
  const { error } = await supabaseClient.from(table).update({ active: !currentActive }).eq("id", id);
  if (error) {
    alert(friendlyDbError(error));
    return;
  }
  loadTab(document.querySelector(".admin-nav__item.is-active").dataset.tab);
}
window.toggleActive = toggleActive;
window.closeModal = closeModal;

// ----------------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------------
checkSession();
