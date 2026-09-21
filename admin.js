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
    case "grade-schedule": return loadGradeSchedule();
    case "teacher-schedule": return loadTeacherSchedule();
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
    .select("id, created_at, grade_id, school_type, grades(name), students(gender)")
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
  renderSchoolTypeChart(reservations || []);
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

// Shows how confirmed reservations split across the two school types
// (school_type now lives on reservations itself, chosen once per booking —
// grades are shared across both, so this is no longer read from grades).
function renderSchoolTypeChart(reservations) {
  let arabic = 0, languages = 0;
  reservations.forEach((r) => {
    if (r.school_type === "arabic") arabic++;
    else if (r.school_type === "languages") languages++;
  });

  renderChart("chartTrack", {
    type: "doughnut",
    data: {
      labels: ["Arabic School (مدرسة عربي)", "Languages School (مدرسة لغات)"],
      datasets: [{ data: [arabic, languages], backgroundColor: [CHART_COLORS[1], CHART_COLORS[2]] }],
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
    <thead><tr><th>Code</th><th>Student</th><th>Mobile</th><th>School Type</th><th>Grade</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${(data || []).map((r) => `
        <tr>
          <td>${escapeHtml(r.reservation_code)}</td>
          <td>${escapeHtml(r.students?.full_name || "—")}</td>
          <td>${escapeHtml(r.students?.mobile || "—")}</td>
          <td>${r.school_type === "arabic" ? "Arabic School" : r.school_type === "languages" ? "Languages School" : "—"}</td>
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
    .select("id, reservation_code, status, created_at, grade_id, school_type, grades(name), students(full_name, mobile, gender, parent_name, parent_mobile, email)")
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
        "Gender": r.students?.gender || "",
        "Parent Name": r.students?.parent_name || "",
        "Parent Mobile": r.students?.parent_mobile || "",
        "Email": r.students?.email || "",
        "School Type": r.school_type === "arabic" ? "Arabic School" : r.school_type === "languages" ? "Languages School" : "",
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
          <button class="btn-tiny is-danger" onclick="deleteRow('teachers', '${t.id}', '${escapeHtml(t.full_name).replace(/'/g, "\\'")}')">Delete</button>
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
          <button class="btn-tiny is-danger" onclick="deleteRow('subjects', '${s.id}', '${escapeHtml(s.name).replace(/'/g, "\\'")}')">Delete</button>
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
        <div class="form-hint" style="margin-bottom:8px;">Check a grade to offer this subject there, then choose which school type(s) it applies to for that grade. Leave "Both school types" selected unless this subject is specific to one (e.g. Arabic-as-a-subject is Arabic-school only; French is Languages-school only).</div>
        <div class="grade-link-grid">
          ${(grades || []).map((g) => `
            <div class="grade-link-row">
              <label><input type="checkbox" class="gradeCheck" data-grade-id="${g.id}"> ${escapeHtml(g.name)}</label>
              <select class="form-select grade-school-type" data-grade-id="${g.id}" disabled>
                <option value="">Both school types</option>
                <option value="arabic">Arabic School only (مدرسة عربي)</option>
                <option value="languages">Languages School only (مدرسة لغات)</option>
              </select>
            </div>
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

  // Enable/disable each row's school-type select alongside its checkbox.
  document.querySelectorAll(".gradeCheck").forEach((cb) => {
    cb.addEventListener("change", () => {
      const select = document.querySelector(`.grade-school-type[data-grade-id="${cb.dataset.gradeId}"]`);
      select.disabled = !cb.checked;
    });
  });

  $("addSubjectForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addSubjectError");
    errBox.innerHTML = "";
    const name = $("subjectName").value.trim();
    const description = $("subjectDesc").value.trim() || null;
    const checkedGrades = Array.from(document.querySelectorAll(".gradeCheck:checked"));

    if (name.length < 2) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a subject name.</div>`;
      return;
    }

    const { data: newSubject, error } = await supabaseClient.from("subjects").insert({ name, description }).select("id").single();
    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }

    if (checkedGrades.length) {
      const rows = checkedGrades.map((cb) => {
        const select = document.querySelector(`.grade-school-type[data-grade-id="${cb.dataset.gradeId}"]`);
        return { subject_id: newSubject.id, grade_id: cb.dataset.gradeId, school_type: select.value || null };
      });
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
// Grades are NOT school-type-specific: the same grade (e.g. "Grade 3
// Secondary") is shared across مدرسة عربي and مدرسة لغات. School type only
// affects which subjects/teachers/slots are reachable for that grade --
// set that up under Subjects (grade+school-type linking) and Assignments.
async function loadGrades() {
  const table = $("gradesTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const { data } = await supabaseClient.from("grades").select("id, name, display_order, active, whatsapp_group_link").order("display_order");
  table.innerHTML = `
    <thead><tr><th>Name</th><th>Order</th><th>WhatsApp Group</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((g) => `
      <tr>
        <td>${escapeHtml(g.name)}</td>
        <td>${g.display_order}</td>
        <td>${g.whatsapp_group_link ? `<span class="status-pill confirmed">Set</span>` : `<span class="status-pill cancelled">Not set</span>`}</td>
        <td><span class="status-pill ${g.active ? "confirmed" : "cancelled"}">${g.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="editGradeWhatsappLink('${g.id}', '${escapeHtml(g.whatsapp_group_link || "").replace(/'/g, "&#39;")}')">WhatsApp Link</button>
          <button class="btn-tiny" onclick="toggleActive('grades', '${g.id}', ${g.active})">${g.active ? "Deactivate" : "Activate"}</button>
          <button class="btn-tiny is-danger" onclick="deleteRow('grades', '${g.id}', '${escapeHtml(g.name).replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

// Lets an admin set/update/remove the ONE WhatsApp group invite link for a
// whole grade. Every student who books ANY subject/slot under this grade --
// regardless of school type -- sees the SAME link after booking.
async function editGradeWhatsappLink(gradeId, currentLink) {
  openModal(`
    <h3>WhatsApp Group Link</h3>
    <form id="editGradeWhatsappForm">
      <div class="form-group">
        <label class="form-label" for="whatsappLink">Group Invite Link</label>
        <input class="form-input" id="whatsappLink" type="url" placeholder="https://chat.whatsapp.com/..." value="${escapeHtml(currentLink || "")}">
        <div class="form-hint">Every student who books any subject/slot for this grade sees this link on their booking confirmation, regardless of school type. Leave empty to remove.</div>
      </div>
      <div id="editGradeWhatsappError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);

  $("editGradeWhatsappForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("editGradeWhatsappError");
    errBox.innerHTML = "";
    const link = $("whatsappLink").value.trim();

    if (link && !/^https?:\/\//i.test(link)) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a valid link starting with http:// or https://.</div>`;
      return;
    }

    const { error } = await supabaseClient
      .from("grades")
      .update({ whatsapp_group_link: link || null })
      .eq("id", gradeId);

    if (error) {
      errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
      return;
    }
    closeModal();
    loadGrades();
  });
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
        <div class="form-hint">Controls the order grades appear in for students (lower = first). This grade will be shown to students under BOTH school types -- use Subjects and Assignments to control what's reachable under each.</div>
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
    if (name.length < 2) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a grade name.</div>`;
      return;
    }
    const { error } = await supabaseClient.from("grades").insert({ name, display_order });
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
// Sort teachers by their actual name, ignoring the "مستر" / "مس" / "أ/" title.
function teacherSortKey(name) {
  return (name || "").replace(/^\s*(مستر|مس|ماستر)\s+/, "").replace(/^\s*[أا]\s*\/\s*/, "").trim();
}

// Fills the teacher filter (keeps whatever was selected).
async function populateAssignmentTeacherFilter() {
  const select = $("filterAssignTeacher");
  const current = select.value;
  const { data } = await supabaseClient.from("teachers").select("id, full_name");
  const teachers = (data || []).slice().sort((x, y) =>
    teacherSortKey(x.full_name).localeCompare(teacherSortKey(y.full_name), "ar"));
  select.innerHTML =
    `<option value="">All Teachers</option>` +
    teachers.map((t) => `<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join("");
  select.value = current;
  if (select.value !== current) select.value = "";   // selected teacher no longer exists
}

async function loadAssignments({ refreshTeachers = true } = {}) {
  const table = $("assignmentsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  if (refreshTeachers) await populateAssignmentTeacherFilter();

  let query = supabaseClient
    .from("teacher_subjects")
    .select("id, active, school_type, grades(name), subjects(name), teachers(full_name)")
    .order("id");
  const teacherId = $("filterAssignTeacher").value;
  if (teacherId) query = query.eq("teacher_id", teacherId);

  const { data } = await query;
  $("assignmentCount").textContent = `${(data || []).length} assignment${(data || []).length === 1 ? "" : "s"}`;
  if (!data || data.length === 0) {
    table.innerHTML = `<tbody><tr><td>No assignments${teacherId ? " for this teacher" : ""}.</td></tr></tbody>`;
    return;
  }
  table.innerHTML = `
    <thead><tr><th>Teacher</th><th>Subject</th><th>Grade</th><th>School Type</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${(data || []).map((a) => `
      <tr>
        <td>${escapeHtml(a.teachers?.full_name || "—")}</td>
        <td>${escapeHtml(a.subjects?.name || "—")}</td>
        <td>${escapeHtml(a.grades?.name || "—")}</td>
        <td>${a.school_type === "arabic" ? "Arabic School" : a.school_type === "languages" ? "Languages School" : "—"}</td>
        <td><span class="status-pill ${a.active ? "confirmed" : "cancelled"}">${a.active ? "Active" : "Inactive"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="toggleActive('teacher_subjects', '${a.id}', ${a.active})">${a.active ? "Deactivate" : "Activate"}</button>
          <button class="btn-tiny is-danger" onclick="deleteRow('teacher_subjects', '${a.id}', '${escapeHtml(a.teachers?.full_name || "assignment").replace(/'/g, "\\'")} — ${escapeHtml(a.subjects?.name || "")}')">Delete</button>
        </td>
      </tr>`).join("")}
    </tbody>`;
}

$("filterAssignTeacher").addEventListener("change", () => loadAssignments({ refreshTeachers: false }));

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
        <div class="form-hint">Only subjects linked to this grade (Subjects tab → Link to Grades) appear here.</div>
      </div>
      <div class="form-group">
        <label class="form-label" for="assignSchoolType">School Type</label>
        <select class="form-select" id="assignSchoolType" required disabled>
          <option value="">Select a subject first</option>
        </select>
        <div class="form-hint" id="assignSchoolTypeHint">If this subject is offered to both school types, you can pick "Both" to create the assignment for both at once -- one teacher, one subject, one grade, no need to repeat this form.</div>
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

  function resetSubjectSelect(message) {
    const subjectSelect = $("assignSubject");
    subjectSelect.innerHTML = `<option value="">${message}</option>`;
    subjectSelect.disabled = true;
    resetSchoolTypeSelect("Select a subject first");
  }

  function resetSchoolTypeSelect(message) {
    const schoolTypeSelect = $("assignSchoolType");
    schoolTypeSelect.innerHTML = `<option value="">${message}</option>`;
    schoolTypeSelect.disabled = true;
  }

  // Subject list unlocks once a grade is chosen. Every subject linked to
  // this grade is shown here regardless of school-type restriction --
  // school type is decided in the next dropdown, based on THIS subject's
  // own eligibility for this grade.
  $("assignGrade").addEventListener("change", async () => {
    const gradeId = $("assignGrade").value;
    if (!gradeId) {
      resetSubjectSelect("Select a grade first");
      return;
    }

    const subjectSelect = $("assignSubject");
    subjectSelect.disabled = true;
    subjectSelect.innerHTML = `<option value="">Loading subjects...</option>`;

    const { data, error } = await supabaseClient
      .from("subject_grades")
      .select("school_type, subjects!inner(id, name, active)")
      .eq("grade_id", gradeId).eq("active", true).eq("subjects.active", true);

    if (error) {
      subjectSelect.innerHTML = `<option value="">Could not load subjects</option>`;
      return;
    }

    // A subject can appear more than once for this grade (e.g. one row per
    // school type, or a single NULL row meaning "both"). Collapse to a
    // unique subject list here; the school-type options for the CHOSEN
    // subject are recomputed from the raw rows on subject change below.
    const seen = new Map();
    (data || []).forEach((row) => { if (row.subjects) seen.set(row.subjects.id, row.subjects.name); });

    if (seen.size === 0) {
      subjectSelect.innerHTML = `<option value="">No subjects linked to this grade yet</option>`;
      resetSchoolTypeSelect("Select a subject first");
      return;
    }

    subjectSelect.innerHTML =
      `<option value="">Select a subject</option>` +
      Array.from(seen.entries()).map(([id, name]) => `<option value="${id}">${escapeHtml(name)}</option>`).join("");
    subjectSelect.disabled = false;
    resetSchoolTypeSelect("Select a subject first");
  });

  // School Type options depend on which school type(s) this subject is
  // actually linked to for this grade: a NULL subject_grades row means the
  // subject is offered to BOTH school types, so "Both" becomes available
  // (creating the assignment for both at once); a subject restricted to one
  // school type only offers that one type here, with no "Both" option.
  $("assignSubject").addEventListener("change", async () => {
    const gradeId = $("assignGrade").value;
    const subjectId = $("assignSubject").value;
    if (!gradeId || !subjectId) {
      resetSchoolTypeSelect("Select a subject first");
      return;
    }

    const schoolTypeSelect = $("assignSchoolType");
    schoolTypeSelect.disabled = true;
    schoolTypeSelect.innerHTML = `<option value="">Loading...</option>`;

    const { data, error } = await supabaseClient
      .from("subject_grades")
      .select("school_type")
      .eq("grade_id", gradeId).eq("subject_id", subjectId).eq("active", true);

    if (error) {
      schoolTypeSelect.innerHTML = `<option value="">Could not load</option>`;
      return;
    }

    const rows = data || [];
    const offeredForBoth = rows.some((r) => r.school_type === null);
    const specificTypes = new Set(rows.filter((r) => r.school_type !== null).map((r) => r.school_type));

    let options = `<option value="">Select a school type</option>`;
    if (offeredForBoth) {
      options += `<option value="arabic">Arabic School only (مدرسة عربي)</option>`;
      options += `<option value="languages">Languages School only (مدرسة لغات)</option>`;
      options += `<option value="both">Both (مدرسة عربي + مدرسة لغات)</option>`;
    } else {
      if (specificTypes.has("arabic")) options += `<option value="arabic">Arabic School (مدرسة عربي)</option>`;
      if (specificTypes.has("languages")) options += `<option value="languages">Languages School (مدرسة لغات)</option>`;
    }

    schoolTypeSelect.innerHTML = options;
    schoolTypeSelect.disabled = false;
  });

  $("addAssignmentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("addAssignmentError");
    errBox.innerHTML = "";
    const grade_id = $("assignGrade").value;
    const subject_id = $("assignSubject").value;
    const school_type = $("assignSchoolType").value;
    const teacher_id = $("assignTeacher").value;

    if (!grade_id || !subject_id || !school_type || !teacher_id) {
      errBox.innerHTML = `<div class="banner banner-error">Please select a grade, subject, school type, and teacher.</div>`;
      return;
    }

    // "Both" creates two teacher_subjects rows (one per school type) in a
    // single action, instead of making the admin repeat this whole form.
    const rows = school_type === "both"
      ? [{ grade_id, subject_id, teacher_id, school_type: "arabic" }, { grade_id, subject_id, teacher_id, school_type: "languages" }]
      : [{ grade_id, subject_id, teacher_id, school_type }];

    const { error } = await supabaseClient.from("teacher_subjects").insert(rows);
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

// ----------------------------------------------------------------------------
// Shared: fetch lesson_slots (with an optional filter builder callback) and
// group each Arabic/Languages pair that represents the "same" slot (same
// grade+subject+teacher+day+time+capacity+active, just offered under both
// school types) into ONE display row. This is what lets a slot created via
// the "Both Schools" option in Add Slot show up as a single row with
// School Type = "Both", instead of two separate look-alike rows.
// ----------------------------------------------------------------------------
async function fetchGroupedSlots(applyFilters) {
  let query = supabaseClient
    .from("lesson_slots")
    .select("id, day_of_week, start_time, end_time, capacity, active, school_type, grade_id, subject_id, teacher_id, grades(name), subjects(name), teachers(full_name)")
    .order("day_of_week").order("start_time");

  if (applyFilters) query = applyFilters(query);
  const { data: slots } = await query;

  const { data: items } = await supabaseClient
    .from("reservation_items")
    .select("slot_id, reservations!inner(status)")
    .eq("reservations.status", "confirmed");

  const countBySlot = {};
  (items || []).forEach((item) => { countBySlot[item.slot_id] = (countBySlot[item.slot_id] || 0) + 1; });

  const groups = new Map();
  (slots || []).forEach((s) => {
    const key = [s.grade_id, s.subject_id, s.teacher_id, s.day_of_week, s.start_time, s.end_time, s.capacity, s.active].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  const rows = [];
  groups.forEach((group) => {
    const schoolTypes = new Set(group.map((s) => s.school_type));
    if (group.length === 2 && schoolTypes.has("arabic") && schoolTypes.has("languages")) {
      const base = group[0];
      rows.push({
        ids: group.map((s) => s.id),
        schoolTypeLabel: "Both",
        bookedLabel: group.map((s) => `${s.school_type === "arabic" ? "Ar" : "Lang"}: ${countBySlot[s.id] || 0}/${s.capacity}`).join(" · "),
        booked: group.reduce((sum, s) => sum + (countBySlot[s.id] || 0), 0),
        grade_name: base.grades?.name, subject_name: base.subjects?.name, teacher_name: base.teachers?.full_name,
        day_of_week: base.day_of_week, start_time: base.start_time, end_time: base.end_time,
        capacity: base.capacity, active: base.active,
      });
    } else {
      group.forEach((s) => {
        rows.push({
          ids: [s.id],
          schoolTypeLabel: s.school_type === "arabic" ? "Arabic" : s.school_type === "languages" ? "Languages" : "—",
          bookedLabel: `${countBySlot[s.id] || 0}/${s.capacity}`,
          booked: countBySlot[s.id] || 0,
          grade_name: s.grades?.name, subject_name: s.subjects?.name, teacher_name: s.teachers?.full_name,
          day_of_week: s.day_of_week, start_time: s.start_time, end_time: s.end_time,
          capacity: s.capacity, active: s.active,
        });
      });
    }
  });

  rows.sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
  return rows;
}

async function loadSlots() {
  await populateSlotFiltersOnce();

  const table = $("slotsTable");
  table.innerHTML = `<tr><td>Loading...</td></tr>`;

  const gradeId = $("slotFilterGrade").value;
  const subjectId = $("slotFilterSubject").value;
  const teacherId = $("slotFilterTeacher").value;
  const dayOfWeek = $("slotFilterDay").value;

  const rows = await fetchGroupedSlots((query) => {
    if (gradeId) query = query.eq("grade_id", gradeId);
    if (subjectId) query = query.eq("subject_id", subjectId);
    if (teacherId) query = query.eq("teacher_id", teacherId);
    if (dayOfWeek !== "") query = query.eq("day_of_week", Number(dayOfWeek));
    return query;
  });

  table.innerHTML = `
    <thead><tr><th>Grade</th><th>School Type</th><th>Subject</th><th>Teacher</th><th>Day</th><th>Time</th><th>Capacity</th><th>Booked</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${rows.map((s) => {
      const full = s.booked >= s.capacity * s.ids.length;
      const idsCsv = s.ids.join(",");
      return `<tr>
        <td>${escapeHtml(s.grade_name || "—")}</td>
        <td>${s.schoolTypeLabel}</td>
        <td>${escapeHtml(s.subject_name || "—")}</td>
        <td>${escapeHtml(s.teacher_name || "—")}</td>
        <td>${DAY_NAMES[s.day_of_week]}</td>
        <td>${s.start_time?.slice(0,5)} - ${s.end_time?.slice(0,5)}</td>
        <td>${s.capacity}</td>
        <td>${s.bookedLabel}</td>
        <td><span class="status-pill ${s.active ? (full ? "pending" : "confirmed") : "cancelled"}">${!s.active ? "Disabled" : full ? "Full" : "Available"}</span></td>
        <td class="row-actions">
          <button class="btn-tiny" onclick="editSlotCapacity('${idsCsv}', ${s.capacity}, ${s.booked})">Edit Capacity</button>
          <button class="btn-tiny" onclick="toggleSlotsActive('${idsCsv}', ${s.active})">${s.active ? "Disable" : "Enable"}</button>
          <button class="btn-tiny is-danger" onclick="deleteSlotsGroup('${idsCsv}', '${escapeHtml(s.subject_name || "slot").replace(/'/g, "\\'")}')">Delete</button>
        </td>
      </tr>`;
    }).join("")}</tbody>`;
}

// ============================================================================
// GRADE SCHEDULE — a read-only, table-style view of every slot for one
// grade at a time: day, time, subject, teacher, school type, in one place,
// instead of hunting through the Slots tab's filters.
// ============================================================================
let gradeScheduleFilterPopulated = false;
async function populateGradeScheduleFilterOnce() {
  if (gradeScheduleFilterPopulated) return;
  const { data: grades } = await supabaseClient.from("grades").select("id, name").order("display_order");
  const select = $("gradeScheduleSelect");
  select.innerHTML = `<option value="">Select a grade</option>` + (grades || []).map((g) => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join("");
  select.addEventListener("change", loadGradeSchedule);
  gradeScheduleFilterPopulated = true;
}

async function loadGradeSchedule() {
  await populateGradeScheduleFilterOnce();
  const table = $("gradeScheduleTable");
  const gradeId = $("gradeScheduleSelect").value;

  if (!gradeId) {
    table.innerHTML = `<thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Teacher</th><th>School Type</th><th>Capacity</th><th>Booked</th><th>Status</th></tr></thead><tbody><tr><td colspan="8">Select a grade above to see its schedule.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const rows = await fetchGroupedSlots((query) => query.eq("grade_id", gradeId));

  table.innerHTML = `
    <thead><tr><th>Day</th><th>Time</th><th>Subject</th><th>Teacher</th><th>School Type</th><th>Capacity</th><th>Booked</th><th>Status</th></tr></thead>
    <tbody>${rows.length === 0 ? `<tr><td colspan="8">No slots yet for this grade.</td></tr>` : rows.map((s) => {
      const full = s.booked >= s.capacity * s.ids.length;
      return `<tr>
        <td>${DAY_NAMES[s.day_of_week]}</td>
        <td>${s.start_time?.slice(0,5)} - ${s.end_time?.slice(0,5)}</td>
        <td>${escapeHtml(s.subject_name || "—")}</td>
        <td>${escapeHtml(s.teacher_name || "—")}</td>
        <td>${s.schoolTypeLabel}</td>
        <td>${s.capacity}</td>
        <td>${s.bookedLabel}</td>
        <td><span class="status-pill ${s.active ? (full ? "pending" : "confirmed") : "cancelled"}">${!s.active ? "Disabled" : full ? "Full" : "Available"}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}

// ============================================================================
// TEACHER SCHEDULE — same idea as Grade Schedule, but per teacher: every
// grade/subject/slot this teacher is currently booked to teach.
// ============================================================================
let teacherScheduleFilterPopulated = false;
async function populateTeacherScheduleFilterOnce() {
  if (teacherScheduleFilterPopulated) return;
  const { data: teachers } = await supabaseClient.from("teachers").select("id, full_name").order("full_name");
  const select = $("teacherScheduleSelect");
  select.innerHTML = `<option value="">Select a teacher</option>` + (teachers || []).map((t) => `<option value="${t.id}">${escapeHtml(t.full_name)}</option>`).join("");
  select.addEventListener("change", loadTeacherSchedule);
  teacherScheduleFilterPopulated = true;
}

async function loadTeacherSchedule() {
  await populateTeacherScheduleFilterOnce();
  const table = $("teacherScheduleTable");
  const teacherId = $("teacherScheduleSelect").value;

  if (!teacherId) {
    table.innerHTML = `<thead><tr><th>Day</th><th>Time</th><th>Grade</th><th>Subject</th><th>School Type</th><th>Capacity</th><th>Booked</th><th>Status</th></tr></thead><tbody><tr><td colspan="8">Select a teacher above to see their schedule.</td></tr></tbody>`;
    return;
  }

  table.innerHTML = `<tr><td>Loading...</td></tr>`;
  const rows = await fetchGroupedSlots((query) => query.eq("teacher_id", teacherId));

  table.innerHTML = `
    <thead><tr><th>Day</th><th>Time</th><th>Grade</th><th>Subject</th><th>School Type</th><th>Capacity</th><th>Booked</th><th>Status</th></tr></thead>
    <tbody>${rows.length === 0 ? `<tr><td colspan="8">No slots yet for this teacher.</td></tr>` : rows.map((s) => {
      const full = s.booked >= s.capacity * s.ids.length;
      return `<tr>
        <td>${DAY_NAMES[s.day_of_week]}</td>
        <td>${s.start_time?.slice(0,5)} - ${s.end_time?.slice(0,5)}</td>
        <td>${escapeHtml(s.grade_name || "—")}</td>
        <td>${escapeHtml(s.subject_name || "—")}</td>
        <td>${s.schoolTypeLabel}</td>
        <td>${s.capacity}</td>
        <td>${s.bookedLabel}</td>
        <td><span class="status-pill ${s.active ? (full ? "pending" : "confirmed") : "cancelled"}">${!s.active ? "Disabled" : full ? "Full" : "Available"}</span></td>
      </tr>`;
    }).join("")}</tbody>`;
}

// Lets an admin change a slot's (or, for a merged "Both" row, BOTH
// underlying slots') capacity in place. The new capacity is validated to
// never go below the number of students already CONFIRMED into the fullest
// of the underlying slots -- shrinking below that would silently overbook
// the group relative to its own stated capacity.
async function editSlotCapacity(idsCsv, currentCapacity, bookedCount) {
  const ids = idsCsv.split(",");
  openModal(`
    <h3>Edit Capacity</h3>
    <form id="editCapacityForm">
      <div class="form-group">
        <label class="form-label" for="newCapacity">New Capacity ${ids.length > 1 ? "<span class=\"optional-tag\">(applies to both Arabic + Languages groups)</span>" : ""}</label>
        <input class="form-input" id="newCapacity" type="number" min="1" value="${currentCapacity}" required>
        <div class="form-hint">Capacity cannot be set below the number of students already confirmed in ${ids.length > 1 ? "either group" : "this slot"}.</div>
      </div>
      <div id="editCapacityError"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);

  $("editCapacityForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = $("editCapacityError");
    errBox.innerHTML = "";
    const newCapacity = Number($("newCapacity").value);

    if (!Number.isInteger(newCapacity) || newCapacity < 1) {
      errBox.innerHTML = `<div class="banner banner-error">Please enter a valid capacity (a whole number of at least 1).</div>`;
      return;
    }

    for (const id of ids) {
      const { error } = await supabaseClient.from("lesson_slots").update({ capacity: newCapacity }).eq("id", id);
      if (error) {
        errBox.innerHTML = `<div class="banner banner-error">${escapeHtml(friendlyDbError(error))}</div>`;
        return;
      }
    }
    closeModal();
    loadTab(document.querySelector(".admin-nav__item.is-active").dataset.tab);
  });
}

// Toggles active/inactive for a slot, or for BOTH underlying slots of a
// merged "Both Schools" row at once.
async function toggleSlotsActive(idsCsv, currentActive) {
  const ids = idsCsv.split(",");
  for (const id of ids) {
    const { error } = await supabaseClient.from("lesson_slots").update({ active: !currentActive }).eq("id", id);
    if (error) { alert(friendlyDbError(error)); return; }
  }
  loadTab(document.querySelector(".admin-nav__item.is-active").dataset.tab);
}

// Deletes a slot, or BOTH underlying slots of a merged "Both Schools" row.
async function deleteSlotsGroup(idsCsv, label) {
  const ids = idsCsv.split(",");
  const confirmed = confirm(`Delete "${label}"${ids.length > 1 ? " (both the Arabic and Languages groups)" : ""}? This cannot be undone.`);
  if (!confirmed) return;

  for (const id of ids) {
    const { error } = await supabaseClient.from("lesson_slots").delete().eq("id", id);
    if (error) {
      if (error.code === "23503") {
        alert(`Can't delete "${label}" because it's still linked to other records (e.g. existing reservations). Disable it instead.`);
      } else {
        alert(friendlyDbError(error));
      }
      return;
    }
  }
  loadTab(document.querySelector(".admin-nav__item.is-active").dataset.tab);
}

$("btnAddSlot").addEventListener("click", async () => {
  const { data: assignments } = await supabaseClient
    .from("teacher_subjects")
    .select("id, school_type, teacher_id, subject_id, grade_id, grades(name), subjects(name), teachers(full_name)")
    .eq("active", true);

  // Collapse an Arabic + Languages pair of assignments (same teacher,
  // subject, grade) into ONE "Both Schools" option, so the admin can create
  // both slots -- Arabic and Languages -- in a single Add Slot action,
  // instead of having to repeat this whole form for the second school type.
  const byCombo = new Map();
  (assignments || []).forEach((a) => {
    const key = `${a.teacher_id}|${a.subject_id}|${a.grade_id}`;
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key).push(a);
  });

  const options = [];
  byCombo.forEach((group) => {
    const schoolTypes = new Set(group.map((a) => a.school_type));
    const base = group[0];
    const label = `${escapeHtml(base.teachers?.full_name)} — ${escapeHtml(base.subjects?.name)} (${escapeHtml(base.grades?.name)}`;
    if (group.length === 2 && schoolTypes.has("arabic") && schoolTypes.has("languages")) {
      const arId = group.find((a) => a.school_type === "arabic").id;
      const langId = group.find((a) => a.school_type === "languages").id;
      options.push(`<option value="both:${arId}:${langId}">${label}, Both Schools)</option>`);
    } else {
      group.forEach((a) => {
        options.push(`<option value="${a.id}">${label}, ${a.school_type === "arabic" ? "Arabic School" : "Languages School"})</option>`);
      });
    }
  });

  openModal(`
    <h3>Add Lesson Slot</h3>
    <form id="addSlotForm">
      <div class="form-group">
        <label class="form-label" for="slotAssignment">Teacher / Subject / Grade / School Type</label>
        <select class="form-select" id="slotAssignment" required>
          <option value="">Select an assignment</option>
          ${options.join("")}
        </select>
        <div class="form-hint">Don't see the combination you need? Add it first under the Assignments tab. A "Both Schools" option appears here when the same teacher is assigned to teach this subject to this grade under both Arabic and Languages school -- picking it creates matching slots for both at once.</div>
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
        <label class="form-label" for="slotCapacity">Capacity <span class="optional-tag">(applies to each school type separately if Both Schools is selected)</span></label>
        <input class="form-input" id="slotCapacity" type="number" min="1" value="5" required>
      </div>
      <div class="form-hint">WhatsApp group links are now set per grade (Grades tab), not per slot.</div>
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

    const assignmentValue = $("slotAssignment").value;
    const dayOfWeek = Number($("slotDay").value);
    const startTime = $("slotStart").value;
    const endTime = $("slotEnd").value;
    const capacity = Number($("slotCapacity").value);

    if (!assignmentValue) {
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

    const isBoth = assignmentValue.startsWith("both:");
    const teacherSubjectIds = isBoth ? assignmentValue.split(":").slice(1) : [assignmentValue];

    const { data: matchedAssignments, error: assignmentError } = await supabaseClient
      .from("teacher_subjects")
      .select("id, grade_id, subject_id, teacher_id, school_type")
      .in("id", teacherSubjectIds);

    if (assignmentError || !matchedAssignments || matchedAssignments.length !== teacherSubjectIds.length) {
      errBox.innerHTML = `<div class="banner banner-error">Could not find that assignment. Please try again.</div>`;
      return;
    }

    const rows = matchedAssignments.map((assignment) => ({
      teacher_subject_id: assignment.id,
      grade_id: assignment.grade_id,
      subject_id: assignment.subject_id,
      teacher_id: assignment.teacher_id,
      school_type: assignment.school_type,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      capacity,
    }));

    const { error } = await supabaseClient.from("lesson_slots").insert(rows);

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

// Permanently deletes a row from the given table (teachers, subjects,
// grades, or teacher_subjects/assignments). Unlike Deactivate, this cannot
// be undone. If the row is still referenced elsewhere (e.g. a teacher with
// existing assignments, or a subject/grade with lesson slots), the delete
// will be rejected by a foreign key constraint -- in that case, deactivate
// it instead of deleting it.
async function deleteRow(table, id, label) {
  const confirmed = confirm(`Delete "${label}"? This cannot be undone.`);
  if (!confirmed) return;

  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) {
    if (error.code === "23503") {
      alert(`Can't delete "${label}" because it's still linked to other records (e.g. assignments or lesson slots). Deactivate it instead, or remove those links first.`);
    } else {
      alert(friendlyDbError(error));
    }
    return;
  }
  loadTab(document.querySelector(".admin-nav__item.is-active").dataset.tab);
}
window.deleteRow = deleteRow;
window.closeModal = closeModal;
window.editSlotCapacity = editSlotCapacity;
window.toggleSlotsActive = toggleSlotsActive;
window.deleteSlotsGroup = deleteSlotsGroup;
window.editGradeWhatsappLink = editGradeWhatsappLink;

// ----------------------------------------------------------------------------
// INIT
// ----------------------------------------------------------------------------
checkSession();
