// ============================================================================
// EDUCATIONAL CENTER BOOKING - APPLICATION LOGIC (Arabic)
// ============================================================================

const SUPABASE_URL = "https://qfrcurdmgyzsbdomlnxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcmN1cmRtZ3l6c2Jkb21sbnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTcyNDAsImV4cCI6MjEwMjE5MzI0MH0.kbksk7I-PHhvHO_mXsdTcnALW3Q-9seHt6-a49YyMds";

const EMAIL_FUNCTION_URL = "YOUR_SUPABASE_URL/functions/v1/send-reservation-email";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STEPS = [
  { key: "student", label: "الطالب", number: 1 },
  { key: "grade", label: "الصف", number: 2 },
  { key: "subjects", label: "المواد", number: 3 },
  { key: "teachers", label: "المعلمين", number: 4 },
  { key: "slots", label: "الجدول", number: 5 },
  { key: "review", label: "المراجعة", number: 6 },
];

const bookingState = {
  currentStepIndex: -1,
  student: { fullName: "", mobile: "", age: "", gender: "", parentName: "", parentMobile: "", email: "" },
  grade: null,
  subjects: [],
  teacherBySubject: {},
  slotBySubject: {},
  idempotencyKey: null,
  reservationResult: null,
};

const dataCache = {
  grades: null,
  subjectsByGrade: {},
  teachersBySubjectGrade: {},
  slotsByTeacherSubjectGrade: {},
  centerSettings: null,
};

const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function $(id) { return document.getElementById(id); }

function formatTime12h(timeStr) {
  const [hStr, m] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "م" : "ص";
  h = h % 12 || 12;
  return `${h}:${m} ${period}`;
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

function friendlyErrorMessage(err) {
  const raw = (err && err.message) || String(err) || "";
  if (raw.includes("SLOT_FULL") || raw.includes("SLOT_UNAVAILABLE") || raw.includes("SLOT_MISMATCH")) {
    return "عذرًا، هذه الحصة اكتمل عدد المقاعد بها للتو. يرجى اختيار موعد آخر متاح.";
  }
  if (raw.includes("INVALID_") || raw.includes("SUBJECT_NOT_IN_GRADE") || raw.includes("DUPLICATE_SUBJECT")) {
    return "بعض البيانات المدخلة غير صحيحة. يرجى مراجعة اختياراتك والمحاولة مرة أخرى.";
  }
  if (raw.includes("Failed to fetch") || raw.includes("NetworkError") || raw.includes("network")) {
    return "تعذر الاتصال بالخادم. يرجى التحقق من اتصالك بالإنترنت والمحاولة مرة أخرى.";
  }
  return "حدث خطأ ما. يرجى المحاولة مرة أخرى.";
}

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
    console.warn("Admin email notification failed (reservation is still saved):", err);
  }
}

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
  btnNext.querySelector(".btn-label").textContent = stepKey === "review" ? "تأكيد الحجز" : "متابعة";
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

  if (fullName.length < 3) { showFieldError("fullName", "يرجى إدخال الاسم الكامل للطالب (3 أحرف على الأقل)."); valid = false; }
  if (!isValidEgyptianMobile(mobile)) { showFieldError("mobile", "يرجى إدخال رقم موبايل مصري صحيح."); valid = false; }
  const ageNum = Number(age);
  if (!age || isNaN(ageNum) || ageNum < 3 || ageNum > 100) { showFieldError("age", "يرجى إدخال عمر صحيح بين 3 و 100."); valid = false; }
  if (!gender) { showFieldError("gender", "يرجى اختيار النوع."); valid = false; }
  if (parentName.length < 3) { showFieldError("parentName", "يرجى إدخال اسم ولي الأمر بالكامل."); valid = false; }
  if (!isValidEgyptianMobile(parentMobile)) { showFieldError("parentMobile", "يرجى إدخال رقم موبايل مصري صحيح."); valid = false; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showFieldError("email", "يرجى إدخال بريد إلكتروني صحيح."); valid = false; }

  if (valid) {
    bookingState.student = { fullName, mobile, age, gender, parentName, parentMobile, email };
  }
  return valid;
}

async function renderGradeStep() {
  const listEl = $("gradeList");
  listEl.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جارٍ تحميل الصفوف الدراسية...</div>`;
  const grades = await fetchGrades();
  listEl.innerHTML = "";

  if (!grades.length) {
    listEl.innerHTML = `<div class="state-block">لا توجد صفوف دراسية متاحة حاليًا. يرجى التواصل مع المركز.</div>`;
    return;
  }

  grades.forEach((grade, i) => {
    const card = document.createElement("div");
    card.className = `option-card ${accentClass(i)}`;
    card.style.animationDelay = `${i * 0.045}s`;
    card.setAttribute("role", "radio");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.grade && bookingState.grade.id === grade.id;
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      ${avatarSpan(grade.name)}
      <span class="option-card__body">
        <span class="option-card__title">${escapeHtml(grade.name)}</span>
      </span>
      <span class="option-card__check is-radio">${checkIconSvg()}</span>`;
    const select = () => selectGrade(grade);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    listEl.appendChild(card);
  });
}

function checkIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function accentClass(i) {
  return `accent-${i % 6}`;
}

function avatarSpan(label) {
  const letter = (label || "؟").trim().charAt(0);
  return `<span class="option-card__avatar">${escapeHtml(letter)}</span>`;
}

function selectGrade(grade) {
  const gradeChanged = !bookingState.grade || bookingState.grade.id !== grade.id;
  bookingState.grade = { id: grade.id, name: grade.name };

  if (gradeChanged) {
    bookingState.subjects = [];
    bookingState.teacherBySubject = {};
    bookingState.slotBySubject = {};
  }
  renderGradeStep();
}

async function renderSubjectsStep() {
  $("subjectsGradeName").textContent = bookingState.grade.name;
  const listEl = $("subjectList");
  listEl.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جارٍ تحميل المواد...</div>`;
  const subjects = await fetchSubjectsForGrade(bookingState.grade.id);
  listEl.innerHTML = "";

  if (!subjects.length) {
    listEl.innerHTML = `<div class="state-block">لا توجد مواد متاحة حاليًا لهذا الصف. يرجى اختيار صف آخر أو التواصل مع المركز.</div>`;
    return;
  }

  subjects.forEach((subject, i) => {
    const card = document.createElement("div");
    card.className = `option-card ${accentClass(i)}`;
    card.style.animationDelay = `${i * 0.045}s`;
    card.setAttribute("role", "checkbox");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.subjects.some((s) => s.id === subject.id);
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      ${avatarSpan(subject.name)}
      <span class="option-card__body">
        <span class="option-card__title">${escapeHtml(subject.name)}</span>
        ${subject.description ? `<span class="option-card__subtitle">${escapeHtml(subject.description)}</span>` : ""}
      </span>
      <span class="option-card__check is-checkbox">${checkIconSvg()}</span>`;
    const toggle = () => toggleSubject(subject);
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    listEl.appendChild(card);
  });
}

function toggleSubject(subject) {
  const idx = bookingState.subjects.findIndex((s) => s.id === subject.id);
  if (idx >= 0) {
    bookingState.subjects.splice(idx, 1);
    delete bookingState.teacherBySubject[subject.id];
    delete bookingState.slotBySubject[subject.id];
  } else {
    bookingState.subjects.push(subject);
  }
  renderSubjectsStep();
}

async function renderTeachersStep() {
  const container = $("teacherGroups");
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جارٍ تحميل المعلمين...</div>`;

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
      empty.textContent = "لا يوجد معلمون معينون حاليًا لهذه المادة في هذا الصف.";
      group.appendChild(empty);
    } else {
      teachers.forEach((teacher, ti) => {
        const card = document.createElement("div");
        card.className = `option-card ${accentClass(ti)}`;
        card.style.animationDelay = `${ti * 0.045}s`;
        card.setAttribute("role", "radio");
        card.setAttribute("tabindex", "0");
        const selectedTeacher = bookingState.teacherBySubject[subject.id];
        const isSelected = selectedTeacher && selectedTeacher.id === teacher.id;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-checked", String(isSelected));
        card.innerHTML = `
          ${avatarSpan(teacher.full_name)}
          <span class="option-card__body">
            <span class="option-card__title">${escapeHtml(teacher.full_name)}</span>
            ${teacher.title ? `<span class="option-card__subtitle">${escapeHtml(teacher.title)}</span>` : ""}
          </span>
          <span class="option-card__check is-radio">${checkIconSvg()}</span>`;
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
    delete bookingState.slotBySubject[subject.id];
  }
  renderTeachersStep();
}

async function renderSlotsStep() {
  const container = $("slotGroups");
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جارٍ التحقق من التوافر...</div>`;

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
      empty.textContent = "لا توجد مواعيد متاحة لهذا المعلم حاليًا. يرجى اختيار معلم آخر.";
      group.appendChild(empty);
    } else {
      slots.forEach((slot, si) => {
        const card = document.createElement("div");
        card.className = `option-card ${accentClass(si)}`;
        card.style.animationDelay = `${si * 0.045}s`;
        card.setAttribute("role", "radio");
        card.setAttribute("tabindex", "0");
        const selectedSlot = bookingState.slotBySubject[subject.id];
        const isSelected = selectedSlot && selectedSlot.id === slot.id;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-checked", String(isSelected));
        const badgeClass = slot.remaining <= 1 ? "option-card__badge is-low" : "option-card__badge";
        const seatWord = slot.remaining === 1 ? "مقعد متبقٍ" : "مقاعد متبقية";
        card.innerHTML = `
          ${avatarSpan(DAY_NAMES[slot.day_of_week])}
          <span class="option-card__body">
            <span class="option-card__title">${DAY_NAMES[slot.day_of_week]}</span>
            <span class="option-card__subtitle">${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</span>
          </span>
          <span class="option-card__check is-radio">${checkIconSvg()}</span>
          <span class="${badgeClass}">${slot.remaining} ${seatWord}</span>`;
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
        <div class="lesson-summary-card__meta">المعلم: ${escapeHtml(teacher.full_name)}</div>
        <div class="lesson-summary-card__meta">${DAY_NAMES[slot.day_of_week]} · ${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</div>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="summary-section">
      <div class="summary-section__title">بيانات الطالب</div>
      <div class="card">
        <div class="summary-row"><span class="summary-row__label">الاسم الكامل</span><span class="summary-row__value">${escapeHtml(s.fullName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">الموبايل</span><span class="summary-row__value">${escapeHtml(s.mobile)}</span></div>
        <div class="summary-row"><span class="summary-row__label">العمر</span><span class="summary-row__value">${escapeHtml(String(s.age))}</span></div>
        <div class="summary-row"><span class="summary-row__label">النوع</span><span class="summary-row__value">${s.gender === "male" ? "ذكر" : "أنثى"}</span></div>
        <div class="summary-row"><span class="summary-row__label">اسم ولي الأمر</span><span class="summary-row__value">${escapeHtml(s.parentName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">موبايل ولي الأمر</span><span class="summary-row__value">${escapeHtml(s.parentMobile)}</span></div>
        ${s.email ? `<div class="summary-row"><span class="summary-row__label">البريد الإلكتروني</span><span class="summary-row__value">${escapeHtml(s.email)}</span></div>` : ""}
        <div class="summary-row"><span class="summary-row__label">الصف الدراسي</span><span class="summary-row__value">${escapeHtml(bookingState.grade.name)}</span></div>
      </div>
    </div>
    <div class="summary-section">
      <div class="summary-section__title">الحصص</div>
      ${lessonsHtml}
    </div>`;
}

function validateCurrentStepBeforeAdvance() {
  const stepKey = STEPS[bookingState.currentStepIndex].key;
  switch (stepKey) {
    case "student":
      return validateStudentStep() ? null : "يرجى تصحيح الحقول المميزة.";
    case "grade":
      return bookingState.grade ? null : "يرجى اختيار الصف الدراسي للمتابعة.";
    case "subjects":
      return bookingState.subjects.length > 0 ? null : "يرجى اختيار مادة واحدة على الأقل للمتابعة.";
    case "teachers": {
      const missing = bookingState.subjects.some((s) => !bookingState.teacherBySubject[s.id]);
      return missing ? "يرجى اختيار معلم لكل مادة." : null;
    }
    case "slots": {
      const missing = bookingState.subjects.some((s) => !bookingState.slotBySubject[s.id]);
      return missing ? "يرجى اختيار موعد حصة لكل مادة." : null;
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
    if (stepKey !== "student") alert(errorMsg);
    return;
  }

  if (bookingState.currentStepIndex < STEPS.length - 1) {
    await goToStep(bookingState.currentStepIndex + 1);
  }
}

async function handleConfirmReservation() {
  const btnNext = $("btnNext");
  const btnBack = $("btnBack");

  if (btnNext.disabled) return;
  if (!bookingState.idempotencyKey) bookingState.idempotencyKey = generateIdempotencyKey();

  setButtonLoading(btnNext, true, "جارٍ تأكيد الحجز...", "تأكيد الحجز");
  btnBack.disabled = true;
  clearBanner($("reviewErrorBanner"));

  try {
    const result = await submitReservation();
    bookingState.reservationResult = result;

    notifyAdminByEmail(result);

    renderSuccessView(result);
    bookingState.currentStepIndex = STEPS.length;
    setHeaderVisible(false);
    showView("success");
    launchConfetti();
  } catch (err) {
    console.error("Reservation failed:", err);
    showBanner($("reviewErrorBanner"), "error", friendlyErrorMessage(err));
  } finally {
    setButtonLoading(btnNext, false, "", "تأكيد الحجز");
    btnBack.disabled = false;
  }
}

function renderSuccessView(result) {
  $("successThankYou").textContent = `شكرًا لك، ${result.student.full_name}. تم إتمام حجزك بنجاح.`;
  $("successReservationCode").textContent = result.reservation_code;

  const lessonsEl = $("successLessons");
  lessonsEl.innerHTML = result.items.map((item) => `
    <div class="lesson-summary-card">
      <div class="lesson-summary-card__subject">${escapeHtml(item.subject_name)}</div>
      <div class="lesson-summary-card__meta">${escapeHtml(item.teacher_name)}</div>
      <div class="lesson-summary-card__meta">${DAY_NAMES[item.day_of_week]} — ${formatTime12h(item.start_time)}</div>
    </div>`).join("");
}

function launchConfetti() {
  const container = $("confettiContainer");
  if (!container) return;
  container.innerHTML = "";
  const colors = ["#0e6b64", "#d97a2b", "#15803d", "#2563eb", "#be185d"];
  const pieceCount = 24;

  for (let i = 0; i < pieceCount; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const angle = (Math.PI * 2 * i) / pieceCount + Math.random() * 0.4;
    const distance = 70 + Math.random() * 60;
    const tx = Math.cos(angle) * distance;
    const ty = Math.sin(angle) * distance - 20;
    piece.style.setProperty("--tx", `${tx}px`);
    piece.style.setProperty("--ty", `${ty}px`);
    piece.style.setProperty("--rot", `${Math.random() * 360}deg`);
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${0.7 + Math.random() * 0.5}s`;
    piece.style.animationDelay = `${0.3 + Math.random() * 0.15}s`;
    container.appendChild(piece);
  }
}

function resetBookingState() {
  bookingState.currentStepIndex = -1;
  bookingState.student = { fullName: "", mobile: "", age: "", gender: "", parentName: "", parentMobile: "", email: "" };
  bookingState.grade = null;
  bookingState.subjects = [];
  bookingState.teacherBySubject = {};
  bookingState.slotBySubject = {};
  bookingState.idempotencyKey = null;
  bookingState.reservationResult = null;
  dataCache.slotsByTeacherSubjectGrade = {};
}

async function initWelcomeContent() {
  try {
    const settings = await fetchCenterSettings();
    document.title = `${settings.center_name} — حجز الحصص`;
    $("welcomeCenterName").textContent = settings.center_name;
    $("centerNameHeader").textContent = settings.center_name;
    $("welcomeTagline").textContent = settings.center_tagline;
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

  ["fullName", "mobile", "age", "parentName", "parentMobile", "email"].forEach((id) => {
    $(id).addEventListener("input", () => hideFieldError(id));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  initWelcomeContent();
});
