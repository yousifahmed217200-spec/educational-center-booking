// ============================================================================
// EDUCATIONAL CENTER BOOKING - APPLICATION LOGIC
// ============================================================================

// ----------------------------------------------------------------------------
// CONFIGURATION — replace these with YOUR Supabase project's values.
// Find them in: Supabase Dashboard -> Project Settings -> API
//   SUPABASE_URL      = "Project URL"
//   SUPABASE_ANON_KEY = "anon / public" key (safe for the browser under RLS)
//
// NEVER put the "service_role" key here — that key must stay server-side only.
// ----------------------------------------------------------------------------
const SUPABASE_URL = "https://qfrcurdmgyzsbdomlnxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcmN1cmRtZ3l6c2Jkb21sbnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTcyNDAsImV4cCI6MjEwMjE5MzI0MH0.kbksk7I-PHhvHO_mXsdTcnALW3Q-9seHt6-a49YyMds";

// Optional: URL of your deployed send-reservation-email Edge Function.
// Looks like: https://<project-ref>.functions.supabase.co/send-reservation-email
// Leave as-is if you haven't deployed it yet — booking still works without it.
const EMAIL_FUNCTION_URL = "YOUR_SUPABASE_URL/functions/v1/send-reservation-email";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ----------------------------------------------------------------------------
// STEP DEFINITIONS
// ----------------------------------------------------------------------------
const STEPS = [
  { key: "student", label: "Student", number: 1 },
  { key: "grade", label: "Grade", number: 2 },
  { key: "subjects", label: "Subjects", number: 3 },
  { key: "teachers", label: "Teachers", number: 4 },
  { key: "slots", label: "Schedule", number: 5 },
  { key: "review", label: "Review", number: 6 },
];

// ----------------------------------------------------------------------------
// APPLICATION STATE
// ----------------------------------------------------------------------------
const bookingState = {
  currentStepIndex: -1, // -1 = welcome
  student: {
    fullName: "", mobile: "", age: "", gender: "",
    parentName: "", parentMobile: "", email: "",
  },
  grade: null,           // { id, name }
  subjects: [],           // [{ id, name, description }]
  teacherBySubject: {},    // { subjectId: { id, full_name, title } }
  slotBySubject: {},       // { subjectId: { id, day_of_week, start_time, end_time, ... } }
  idempotencyKey: null,
  reservationResult: null,
};

// Cache of catalog data fetched from Supabase, keyed by relevant IDs.
const dataCache = {
  grades: null,
  subjectsByGrade: {},      // gradeId -> [subjects]
  teachersBySubjectGrade: {}, // `${gradeId}:${subjectId}` -> [teachers]
  slotsByTeacherSubjectGrade: {}, // `${gradeId}:${subjectId}:${teacherId}` -> [slots]
  centerSettings: null,
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ============================================================================
// UTILITIES
// ============================================================================

function $(id) { return document.getElementById(id); }

function formatTime12h(timeStr) {
  // "16:00:00" -> "4:00 PM"
  const [hStr, m] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function generateIdempotencyKey() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return "idem-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}

// Egyptian mobile validation (frontend UX layer — backend re-validates via
// normalize_egyptian_mobile() inside create_reservation()).
function isValidEgyptianMobile(raw) {
  if (!raw) return false;
  const cleaned = raw.replace(/[\s\-()]/g, "");
  let local = cleaned;
  if (cleaned.startsWith("+20")) local = "0" + cleaned.slice(3);
  else if (cleaned.startsWith("0020")) local = "0" + cleaned.slice(4);
  else if (cleaned.startsWith("20") && cleaned.length === 12) local = "0" + cleaned.slice(2);
  return /^01[0125][0-9]{8}$/.test(local);
}

function setButtonLoading(btn, isLoading, loadingText, defaultText) {
  btn.disabled = isLoading;
  btn.classList.toggle("is-loading", isLoading);
  const label = btn.querySelector(".btn-label");
  if (label) label.textContent = isLoading ? loadingText : defaultText;
  else btn.textContent = isLoading ? loadingText : defaultText;
}

function showBanner(containerEl, type, message) {
  containerEl.innerHTML = `<div class="banner banner-${type}">${escapeHtml(message)}</div>`;
}

function clearBanner(containerEl) {
  containerEl.innerHTML = "";
}

// Friendly mapping from backend error codes/messages to student-facing text.
function friendlyErrorMessage(err) {
  const raw = (err && err.message) || String(err) || "";
  if (raw.includes("SLOT_FULL") || raw.includes("SLOT_UNAVAILABLE") || raw.includes("SLOT_MISMATCH")) {
    return "Sorry, this lesson has just become fully booked. Please choose another available slot.";
  }
  if (raw.includes("INVALID_") || raw.includes("SUBJECT_NOT_IN_GRADE") || raw.includes("DUPLICATE_SUBJECT")) {
    return "Some of the information provided is invalid. Please review your selections and try again.";
  }
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("network")) {
    return "Unable to connect to the server. Please check your internet connection and try again.";
  }
  return "Something went wrong. Please try again.";
}

// ============================================================================
// SUPABASE DATA ACCESS
// ============================================================================

async function fetchCenterSettings() {
  if (dataCache.centerSettings) return dataCache.centerSettings;
  const { data, error } = await supabaseClient
    .from("center_settings")
    .select("center_name, center_tagline")
    .eq("id", 1)
    .single();
  if (error) throw error;
  dataCache.centerSettings = data;
  return data;
}

async function fetchGrades() {
  if (dataCache.grades) return dataCache.grades;
  const { data, error } = await supabaseClient
    .from("grades")
    .select("id, name, display_order")
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  dataCache.grades = data;
  return data;
}

async function fetchSubjectsForGrade(gradeId) {
  if (dataCache.subjectsByGrade[gradeId]) return dataCache.subjectsByGrade[gradeId];
  const { data, error } = await supabaseClient
    .from("subject_grades")
    .select("subjects!inner(id, name, description, active)")
    .eq("grade_id", gradeId)
    .eq("active", true)
    .eq("subjects.active", true);
  if (error) throw error;
  const subjects = data.map((row) => row.subjects);
  dataCache.subjectsByGrade[gradeId] = subjects;
  return subjects;
}

async function fetchTeachersForSubject(gradeId, subjectId) {
  const key = `${gradeId}:${subjectId}`;
  if (dataCache.teachersBySubjectGrade[key]) return dataCache.teachersBySubjectGrade[key];
  const { data, error } = await supabaseClient
    .from("teacher_subjects")
    .select("teachers!inner(id, full_name, title, active)")
    .eq("grade_id", gradeId)
    .eq("subject_id", subjectId)
    .eq("active", true)
    .eq("teachers.active", true);
  if (error) throw error;
  const teachers = data.map((row) => row.teachers);
  dataCache.teachersBySubjectGrade[key] = teachers;
  return teachers;
}

async function fetchAvailableSlots(gradeId, subjectId, teacherId) {
  const key = `${gradeId}:${subjectId}:${teacherId}`;
  if (dataCache.slotsByTeacherSubjectGrade[key]) return dataCache.slotsByTeacherSubjectGrade[key];
  // Uses the available_slots() RPC — it already excludes full slots and
  // computes "remaining" live from confirmed reservation_items, never from a
  // manually maintained counter.
  const { data, error } = await supabaseClient.rpc("available_slots", {
    p_grade_id: gradeId,
    p_subject_id: subjectId,
    p_teacher_id: teacherId,
  });
  if (error) throw error;
  dataCache.slotsByTeacherSubjectGrade[key] = data;
  return data;
}

async function submitReservation() {
  const payload = {
    p_student: {
      full_name: bookingState.student.fullName,
      mobile: bookingState.student.mobile,
      age: Number(bookingState.student.age),
      gender: bookingState.student.gender,
      parent_name: bookingState.student.parentName,
      parent_mobile: bookingState.student.parentMobile,
      email: bookingState.student.email || null,
    },
    p_grade_id: bookingState.grade.id,
    p_items: bookingState.subjects.map((subject) => ({
      subject_id: subject.id,
      teacher_id: bookingState.teacherBySubject[subject.id].id,
      slot_id: bookingState.slotBySubject[subject.id].id,
    })),
    p_idempotency_key: bookingState.idempotencyKey,
  };

  const { data, error } = await supabaseClient.rpc("create_reservation", payload);
  if (error) throw error;
  return data;
}

async function notifyAdminByEmail(reservationPayload) {
  if (!EMAIL_FUNCTION_URL || EMAIL_FUNCTION_URL.includes("YOUR_SUPABASE_URL")) {
    console.info("Email function not configured — skipping admin notification.");
    return;
  }
  try {
    await fetch(EMAIL_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(reservationPayload),
    });
  } catch (err) {
    // Never block or undo the reservation because of an email failure.
    console.warn("Admin email notification failed (reservation is still saved):", err);
  }
}

// ============================================================================
// VIEW RENDERING — PROGRESS BAR
// ============================================================================

function renderProgress() {
  const track = $("progressTrack");
  track.innerHTML = "";
  STEPS.forEach((step, idx) => {
    const stepEl = document.createElement("div");
    const state = idx < bookingState.currentStepIndex ? "is-done"
      : idx === bookingState.currentStepIndex ? "is-active" : "";
    stepEl.className = `progress-step ${state}`.trim();
    stepEl.innerHTML = `<span class="progress-step__dot">${idx < bookingState.currentStepIndex ? "✓" : step.number}</span><span>${step.label}</span>`;
    track.appendChild(stepEl);
    if (idx < STEPS.length - 1) {
      const sep = document.createElement("div");
      sep.className = "progress-sep";
      track.appendChild(sep);
    }
  });
}

function showView(stepKey) {
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${stepKey}`; });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function setHeaderVisible(visible) {
  $("appHeader").hidden = !visible;
  $("stepFooter").hidden = !visible;
}

// ============================================================================
// STEP NAVIGATION
// ============================================================================

async function goToStep(index) {
  bookingState.currentStepIndex = index;
  const step = STEPS[index];
  renderProgress();
  setHeaderVisible(true);
  showView(step.key);
  updateFooterForStep(step.key);

  try {
    switch (step.key) {
      case "student": renderStudentStep(); break;
      case "grade": await renderGradeStep(); break;
      case "subjects": await renderSubjectsStep(); break;
      case "teachers": await renderTeachersStep(); break;
      case "slots": await renderSlotsStep(); break;
      case "review": renderReviewStep(); break;
    }
  } catch (err) {
    console.error(err);
    renderStepLoadError(step.key, err);
  }
}

function updateFooterForStep(stepKey) {
  const btnBack = $("btnBack");
  const btnNext = $("btnNext");
  btnBack.style.visibility = stepKey === "student" ? "hidden" : "visible";
  btnNext.querySelector(".btn-label").textContent = stepKey === "review" ? "Confirm Reservation" : "Continue";
}

function renderStepLoadError(stepKey, err) {
  const container = document.getElementById(`view-${stepKey}`);
  const wrapper = document.createElement("div");
  showBanner(wrapper, "error", friendlyErrorMessage(err));
  container.appendChild(wrapper.firstElementChild);
}

function goNext() { handleNextClicked(); }
function goBack() {
  if (bookingState.currentStepIndex === 0) {
    setHeaderVisible(false);
    showView("welcome");
    bookingState.currentStepIndex = -1;
    return;
  }
  goToStep(bookingState.currentStepIndex - 1);
}

// ============================================================================
// STEP 1: STUDENT INFORMATION
// ============================================================================

function renderStudentStep() {
  $("fullName").value = bookingState.student.fullName;
  $("mobile").value = bookingState.student.mobile;
  $("age").value = bookingState.student.age;
  $("parentName").value = bookingState.student.parentName;
  $("parentMobile").value = bookingState.student.parentMobile;
  $("email").value = bookingState.student.email;
  document.querySelectorAll("#genderRow .radio-pill").forEach((pill) => {
    const selected = pill.dataset.value === bookingState.student.gender;
    pill.classList.toggle("is-selected", selected);
    pill.setAttribute("aria-checked", String(selected));
  });
}

function bindGenderPills() {
  document.querySelectorAll("#genderRow .radio-pill").forEach((pill) => {
    const select = () => {
      document.querySelectorAll("#genderRow .radio-pill").forEach((p) => {
        p.classList.remove("is-selected");
        p.setAttribute("aria-checked", "false");
      });
      pill.classList.add("is-selected");
      pill.setAttribute("aria-checked", "true");
      bookingState.student.gender = pill.dataset.value;
      hideFieldError("gender");
    };
    pill.addEventListener("click", select);
    pill.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
  });
}

function showFieldError(field, message) {
  const input = $(field);
  const errEl = $(`err-${field}`);
  if (input) input.classList.add("has-error");
  if (errEl) { errEl.textContent = message; errEl.classList.add("is-visible"); }
}
function hideFieldError(field) {
  const input = $(field);
  const errEl = $(`err-${field}`);
  if (input) input.classList.remove("has-error");
  if (errEl) { errEl.textContent = ""; errEl.classList.remove("is-visible"); }
}

function validateStudentStep() {
  let valid = true;
  ["fullName", "mobile", "age", "gender", "parentName", "parentMobile", "email"].forEach(hideFieldError);

  const fullName = $("fullName").value.trim();
  const mobile = $("mobile").value.trim();
  const age = $("age").value.trim();
  const parentName = $("parentName").value.trim();
  const parentMobile = $("parentMobile").value.trim();
  const email = $("email").value.trim();
  const gender = bookingState.student.gender;

  if (fullName.length < 3) { showFieldError("fullName", "Please enter the student's full name (at least 3 characters)."); valid = false; }
  if (!isValidEgyptianMobile(mobile)) { showFieldError("mobile", "Please enter a valid Egyptian mobile number."); valid = false; }
  const ageNum = Number(age);
  if (!age || isNaN(ageNum) || ageNum < 3 || ageNum > 100) { showFieldError("age", "Please enter a valid age between 3 and 100."); valid = false; }
  if (!gender) { showFieldError("gender", "Please select a gender."); valid = false; }
  if (parentName.length < 3) { showFieldError("parentName", "Please enter the parent/guardian's full name."); valid = false; }
  if (!isValidEgyptianMobile(parentMobile)) { showFieldError("parentMobile", "Please enter a valid Egyptian mobile number."); valid = false; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showFieldError("email", "Please enter a valid email address."); valid = false; }

  if (valid) {
    bookingState.student = { fullName, mobile, age, gender, parentName, parentMobile, email };
  }
  return valid;
}

// ============================================================================
// STEP 2: GRADE
// ============================================================================

async function renderGradeStep() {
  const listEl = $("gradeList");
  listEl.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Loading grades...</div>`;
  const grades = await fetchGrades();
  listEl.innerHTML = "";

  if (!grades.length) {
    listEl.innerHTML = `<div class="state-block">No grades are currently available. Please contact the center.</div>`;
    return;
  }

  grades.forEach((grade) => {
    const card = document.createElement("div");
    card.className = "option-card";
    card.setAttribute("role", "radio");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.grade && bookingState.grade.id === grade.id;
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      <span class="option-card__check is-radio">${checkIconSvg()}</span>
      <span class="option-card__body">
        <span class="option-card__title">${escapeHtml(grade.name)}</span>
      </span>`;
    const select = () => selectGrade(grade);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    listEl.appendChild(card);
  });
}

function checkIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function selectGrade(grade) {
  const gradeChanged = !bookingState.grade || bookingState.grade.id !== grade.id;
  bookingState.grade = { id: grade.id, name: grade.name };

  if (gradeChanged) {
    // Rule from spec #38: if the grade changes, clear incompatible
    // downstream selections (subjects/teachers/slots).
    bookingState.subjects = [];
    bookingState.teacherBySubject = {};
    bookingState.slotBySubject = {};
  }
  renderGradeStep();
}

// ============================================================================
// STEP 3: SUBJECTS
// ============================================================================

async function renderSubjectsStep() {
  $("subjectsGradeName").textContent = bookingState.grade.name;
  const listEl = $("subjectList");
  listEl.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Loading subjects...</div>`;
  const subjects = await fetchSubjectsForGrade(bookingState.grade.id);
  listEl.innerHTML = "";

  if (!subjects.length) {
    listEl.innerHTML = `<div class="state-block">No subjects are currently available for this grade. Please choose a different grade or contact the center.</div>`;
    return;
  }

  subjects.forEach((subject) => {
    const card = document.createElement("div");
    card.className = "option-card";
    card.setAttribute("role", "checkbox");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.subjects.some((s) => s.id === subject.id);
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      <span class="option-card__check is-checkbox">${checkIconSvg()}</span>
      <span class="option-card__body">
        <span class="option-card__title">${escapeHtml(subject.name)}</span>
        ${subject.description ? `<span class="option-card__subtitle">${escapeHtml(subject.description)}</span>` : ""}
      </span>`;
    const toggle = () => toggleSubject(subject);
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    listEl.appendChild(card);
  });
}

function toggleSubject(subject) {
  const idx = bookingState.subjects.findIndex((s) => s.id === subject.id);
  if (idx >= 0) {
    // Rule from spec #38: removing a subject removes its teacher & slot too.
    bookingState.subjects.splice(idx, 1);
    delete bookingState.teacherBySubject[subject.id];
    delete bookingState.slotBySubject[subject.id];
  } else {
    bookingState.subjects.push(subject);
  }
  renderSubjectsStep();
}

// ============================================================================
// STEP 4: TEACHERS (one selection group per selected subject)
// ============================================================================

async function renderTeachersStep() {
  const container = $("teacherGroups");
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Loading teachers...</div>`;

  const results = await Promise.all(
    bookingState.subjects.map((subject) => fetchTeachersForSubject(bookingState.grade.id, subject.id))
  );

  container.innerHTML = "";

  bookingState.subjects.forEach((subject, i) => {
    const teachers = results[i];
    const group = document.createElement("div");
    group.className = "subject-group";
    const heading = document.createElement("div");
    heading.className = "subject-group__title";
    heading.textContent = subject.name;
    group.appendChild(heading);

    if (!teachers.length) {
      const empty = document.createElement("div");
      empty.className = "state-block";
      empty.style.padding = "16px 0";
      empty.textContent = "No teachers are currently assigned to this subject for the selected grade.";
      group.appendChild(empty);
    } else {
      teachers.forEach((teacher) => {
        const card = document.createElement("div");
        card.className = "option-card";
        card.setAttribute("role", "radio");
        card.setAttribute("tabindex", "0");
        const selectedTeacher = bookingState.teacherBySubject[subject.id];
        const isSelected = selectedTeacher && selectedTeacher.id === teacher.id;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-checked", String(isSelected));
        card.innerHTML = `
          <span class="option-card__check is-radio">${checkIconSvg()}</span>
          <span class="option-card__body">
            <span class="option-card__title">${escapeHtml(teacher.full_name)}</span>
            ${teacher.title ? `<span class="option-card__subtitle">${escapeHtml(teacher.title)}</span>` : ""}
          </span>`;
        const select = () => selectTeacher(subject, teacher);
        card.addEventListener("click", select);
        card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
        group.appendChild(card);
      });
    }
    container.appendChild(group);
  });
}

function selectTeacher(subject, teacher) {
  const prevTeacher = bookingState.teacherBySubject[subject.id];
  const teacherChanged = !prevTeacher || prevTeacher.id !== teacher.id;
  bookingState.teacherBySubject[subject.id] = { id: teacher.id, full_name: teacher.full_name, title: teacher.title };
  if (teacherChanged) {
    // Changing teacher invalidates any previously chosen slot for this subject.
    delete bookingState.slotBySubject[subject.id];
  }
  renderTeachersStep();
}

// ============================================================================
// STEP 5: LESSON SLOTS
// ============================================================================

async function renderSlotsStep() {
  const container = $("slotGroups");
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>Checking availability...</div>`;

  const results = await Promise.all(
    bookingState.subjects.map((subject) => {
      const teacher = bookingState.teacherBySubject[subject.id];
      return fetchAvailableSlots(bookingState.grade.id, subject.id, teacher.id);
    })
  );

  container.innerHTML = "";

  bookingState.subjects.forEach((subject, i) => {
    const teacher = bookingState.teacherBySubject[subject.id];
    const slots = results[i];

    const group = document.createElement("div");
    group.className = "subject-group";
    const heading = document.createElement("div");
    heading.className = "subject-group__title";
    heading.textContent = `${subject.name} — ${teacher.full_name}`;
    group.appendChild(heading);

    if (!slots.length) {
      const empty = document.createElement("div");
      empty.className = "state-block";
      empty.style.padding = "16px 0";
      empty.textContent = "No available lesson times for this teacher right now. Please choose a different teacher.";
      group.appendChild(empty);
    } else {
      slots.forEach((slot) => {
        const card = document.createElement("div");
        card.className = "option-card";
        card.setAttribute("role", "radio");
        card.setAttribute("tabindex", "0");
        const selectedSlot = bookingState.slotBySubject[subject.id];
        const isSelected = selectedSlot && selectedSlot.id === slot.id;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-checked", String(isSelected));
        const badgeClass = slot.remaining <= 1 ? "option-card__badge is-low" : "option-card__badge";
        const seatWord = slot.remaining === 1 ? "seat" : "seats";
        card.innerHTML = `
          <span class="option-card__check is-radio">${checkIconSvg()}</span>
          <span class="option-card__body">
            <span class="option-card__title">${DAY_NAMES[slot.day_of_week]}</span>
            <span class="option-card__subtitle">${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</span>
          </span>
          <span class="${badgeClass}">${slot.remaining} ${seatWord} left</span>`;
        const select = () => selectSlot(subject, slot);
        card.addEventListener("click", select);
        card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
        group.appendChild(card);
      });
    }
    container.appendChild(group);
  });
}

function selectSlot(subject, slot) {
  bookingState.slotBySubject[subject.id] = {
    id: slot.id, day_of_week: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time,
  };
  renderSlotsStep();
}

// ============================================================================
// STEP 6: REVIEW
// ============================================================================

function renderReviewStep() {
  clearBanner($("reviewErrorBanner"));
  const s = bookingState.student;
  const container = $("reviewContent");

  const lessonsHtml = bookingState.subjects.map((subject) => {
    const teacher = bookingState.teacherBySubject[subject.id];
    const slot = bookingState.slotBySubject[subject.id];
    return `
      <div class="lesson-summary-card">
        <div class="lesson-summary-card__subject">${escapeHtml(subject.name)}</div>
        <div class="lesson-summary-card__meta">Teacher: ${escapeHtml(teacher.full_name)}</div>
        <div class="lesson-summary-card__meta">${DAY_NAMES[slot.day_of_week]} · ${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="summary-section">
      <div class="summary-section__title">Student</div>
      <div class="card">
        <div class="summary-row"><span class="summary-row__label">Full Name</span><span class="summary-row__value">${escapeHtml(s.fullName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">Mobile</span><span class="summary-row__value">${escapeHtml(s.mobile)}</span></div>
        <div class="summary-row"><span class="summary-row__label">Age</span><span class="summary-row__value">${escapeHtml(String(s.age))}</span></div>
        <div class="summary-row"><span class="summary-row__label">Gender</span><span class="summary-row__value">${s.gender === "male" ? "Male" : "Female"}</span></div>
        <div class="summary-row"><span class="summary-row__label">Parent Name</span><span class="summary-row__value">${escapeHtml(s.parentName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">Parent Mobile</span><span class="summary-row__value">${escapeHtml(s.parentMobile)}</span></div>
        ${s.email ? `<div class="summary-row"><span class="summary-row__label">Email</span><span class="summary-row__value">${escapeHtml(s.email)}</span></div>` : ""}
        <div class="summary-row"><span class="summary-row__label">Grade</span><span class="summary-row__value">${escapeHtml(bookingState.grade.name)}</span></div>
      </div>
    </div>
    <div class="summary-section">
      <div class="summary-section__title">Lessons</div>
      ${lessonsHtml}
    </div>`;
}

// ============================================================================
// STEP VALIDATION + FORWARD NAVIGATION
// ============================================================================

function validateCurrentStepBeforeAdvance() {
  const stepKey = STEPS[bookingState.currentStepIndex].key;
  switch (stepKey) {
    case "student":
      return validateStudentStep() ? null : "Please correct the highlighted fields.";
    case "grade":
      return bookingState.grade ? null : "Please select a grade to continue.";
    case "subjects":
      return bookingState.subjects.length > 0 ? null : "Please select at least one subject to continue.";
    case "teachers": {
      const missing = bookingState.subjects.some((s) => !bookingState.teacherBySubject[s.id]);
      return missing ? "Please choose a teacher for every subject." : null;
    }
    case "slots": {
      const missing = bookingState.subjects.some((s) => !bookingState.slotBySubject[s.id]);
      return missing ? "Please choose a lesson time for every subject." : null;
    }
    default:
      return null;
  }
}

async function handleNextClicked() {
  const stepKey = STEPS[bookingState.currentStepIndex].key;

  if (stepKey === "review") {
    await handleConfirmReservation();
    return;
  }

  const errorMsg = validateCurrentStepBeforeAdvance();
  if (errorMsg) {
    if (stepKey !== "student") alert(errorMsg); // simple guard for non-form steps
    return;
  }

  if (bookingState.currentStepIndex < STEPS.length - 1) {
    await goToStep(bookingState.currentStepIndex + 1);
  }
}

// ============================================================================
// RESERVATION SUBMISSION
// ============================================================================

async function handleConfirmReservation() {
  const btnNext = $("btnNext");
  const btnBack = $("btnBack");

  // Duplicate-submission protection: disable the button immediately and
  // reuse the same idempotency key on any retry within this attempt.
  if (btnNext.disabled) return;
  if (!bookingState.idempotencyKey) bookingState.idempotencyKey = generateIdempotencyKey();

  setButtonLoading(btnNext, true, "Submitting reservation...", "Confirm Reservation");
  btnBack.disabled = true;
  clearBanner($("reviewErrorBanner"));

  try {
    const result = await submitReservation();
    bookingState.reservationResult = result;

    // Fire-and-forget admin email — never blocks or reverses the reservation.
    notifyAdminByEmail(result);

    renderSuccessView(result);
    bookingState.currentStepIndex = STEPS.length; // past review
    setHeaderVisible(false);
    showView("success");
  } catch (err) {
    console.error("Reservation failed:", err);
    showBanner($("reviewErrorBanner"), "error", friendlyErrorMessage(err));
    // Allow retry with a NEW idempotency key only if the failure wasn't a
    // transient duplicate — safe default: keep the same key, since a retry
    // of a genuinely failed transaction should not double-book either.
  } finally {
    setButtonLoading(btnNext, false, "", "Confirm Reservation");
    btnBack.disabled = false;
  }
}

function renderSuccessView(result) {
  $("successThankYou").textContent = `Thank you, ${result.student.full_name}. Your reservation has been successfully completed.`;
  $("successReservationCode").textContent = result.reservation_code;

  const lessonsEl = $("successLessons");
  lessonsEl.innerHTML = result.items.map((item) => `
    <div class="lesson-summary-card">
      <div class="lesson-summary-card__subject">${escapeHtml(item.subject_name)}</div>
      <div class="lesson-summary-card__meta">${escapeHtml(item.teacher_name)}</div>
      <div class="lesson-summary-card__meta">${DAY_NAMES[item.day_of_week]} — ${formatTime12h(item.start_time)}</div>
    </div>`).join("");
}

// ============================================================================
// RESET / NEW RESERVATION
// ============================================================================

function resetBookingState() {
  bookingState.currentStepIndex = -1;
  bookingState.student = { fullName: "", mobile: "", age: "", gender: "", parentName: "", parentMobile: "", email: "" };
  bookingState.grade = null;
  bookingState.subjects = [];
  bookingState.teacherBySubject = {};
  bookingState.slotBySubject = {};
  bookingState.idempotencyKey = null;
  bookingState.reservationResult = null;
  // Clear slot cache since capacity has changed after this reservation.
  dataCache.slotsByTeacherSubjectGrade = {};
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function initWelcomeContent() {
  try {
    const settings = await fetchCenterSettings();
    document.title = `${settings.center_name} — Lesson Booking`;
    $("welcomeCenterName").textContent = settings.center_name;
    $("centerNameHeader").textContent = settings.center_name;
    $("welcomeTagline").textContent = settings.center_tagline;
    $("welcomeBadge").textContent = settings.center_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  } catch (err) {
    console.warn("Could not load center settings, using defaults.", err);
  }
}

function bindStaticEvents() {
  $("btnStartRegistration").addEventListener("click", () => goToStep(0));
  $("btnNext").addEventListener("click", goNext);
  $("btnBack").addEventListener("click", goBack);
  $("btnNewReservation").addEventListener("click", () => {
    resetBookingState();
    setHeaderVisible(false);
    showView("welcome");
  });
  bindGenderPills();

  // Live-clear field errors as the student types.
  ["fullName", "mobile", "age", "parentName", "parentMobile", "email"].forEach((id) => {
    $(id).addEventListener("input", () => hideFieldError(id));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  initWelcomeContent();
});
