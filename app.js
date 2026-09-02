// ============================================================================
// EDUCATIONAL CENTER BOOKING - APPLICATION LOGIC
// ============================================================================

const SUPABASE_URL = "https://qfrcurdmgyzsbdomlnxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmcmN1cmRtZ3l6c2Jkb21sbnh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MTcyNDAsImV4cCI6MjEwMjE5MzI0MH0.kbksk7I-PHhvHO_mXsdTcnALW3Q-9seHt6-a49YyMds";

const EMAIL_FUNCTION_URL = "YOUR_SUPABASE_URL/functions/v1/send-reservation-email";
const WHATSAPP_FUNCTION_URL = "YOUR_SUPABASE_URL/functions/v1/send-whatsapp-reminder";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STEPS = [
  { key: "student", label: "بياناتك", icon: "user-round" },
  { key: "schoolType", label: "المدرسة", icon: "layout-grid" },
  { key: "grade", label: "الصف", icon: "school" },
  { key: "subjects", label: "المواد", icon: "book-open" },
  { key: "teachers", label: "المعلمين", icon: "users-round" },
  { key: "slots", label: "الموعد", icon: "calendar-clock" },
  { key: "review", label: "المراجعة", icon: "clipboard-check" },
];

// school_type is an INDEPENDENT filter from grade -- the same grade list
// (e.g. "Grade 3 Secondary") applies to both, only subjects/teachers/slots
// differ. See supabase/schema.sql for the full data model.
const SCHOOL_TYPES = [
  { id: "arabic", label: "مدرسة عربي", subtitle: "الدراسة بالعربي", icon: "book-text" },
  { id: "languages", label: "مدرسة لغات", subtitle: "الدراسة بالإنجليزية", icon: "globe" },
];

const SIDE_ART_BY_STEP = {
  welcome: { icon: "graduation-cap", caption: "رحلتك التعليمية تبدأ من هنا" },
  student: { icon: "user-round", caption: "لنتعرف عليك أولًا" },
  schoolType: { icon: "layout-grid", caption: "أخبرنا عن نوع مدرستك" },
  grade: { icon: "school", caption: "أخبرنا عن صفك الدراسي" },
  subjects: { icon: "book-open", caption: "اختر ما يثير شغفك" },
  teachers: { icon: "users-round", caption: "تعلّم مع أفضل المعلمين" },
  slots: { icon: "calendar-clock", caption: "اختر الوقت الذي يناسبك" },
  review: { icon: "clipboard-check", caption: "خطوة أخيرة قبل الانطلاق" },
  success: { icon: "party-popper", caption: "أنت جاهز لبدء التعلم!" },
};

const SUBJECT_STYLE = [
  { match: /math/i, icon: "calculator", color: "#2563eb" },
  { match: /phys/i, icon: "atom", color: "#7c3aed" },
  { match: /chem/i, icon: "flask-conical", color: "#059669" },
  { match: /bio/i, icon: "microscope", color: "#0e6b64" },
  { match: /english/i, icon: "book-open-text", color: "#d97a2b" },
  { match: /arabic/i, icon: "book-text", color: "#be185d" },
  { match: /french/i, icon: "languages", color: "#0891b2" },
  { match: /geolog/i, icon: "mountain", color: "#78716c" },
  { match: /computer/i, icon: "laptop", color: "#4338ca" },
  { match: /social/i, icon: "globe", color: "#ca8a04" },
];
function subjectStyle(name) {
  const found = SUBJECT_STYLE.find((s) => s.match.test(name));
  return found || { icon: "book-open", color: "var(--color-primary)" };
}

const AVATAR_COLORS = ["#0e6b64", "#d97a2b", "#2563eb", "#be185d", "#7c3aed", "#059669", "#ca8a04"];
function avatarColorFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function initialsFor(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
}

// NOTE: intentionally NO "age" field anywhere in this state -- the app
// does not collect student age.
const bookingState = {
  currentStepIndex: -1,
  student: { fullName: "", mobile: "", gender: "", parentName: "", parentMobile: "", email: "" },
  schoolType: null,
  grade: null,
  subjects: [],
  teacherBySubject: {},
  slotBySubject: {},
  idempotencyKey: null,
  reservationResult: null,
};

const dataCache = {
  gradesBySchoolType: {},
  subjectsByGradeAndSchoolType: {},
  teachersBySubjectGradeAndSchoolType: {},
  slotsByTeacherSubjectGradeAndSchoolType: {},
  centerSettings: null,
};

const DAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function $(id) { return document.getElementById(id); }

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function firstName() {
  return (bookingState.student.fullName || "").trim().split(/\s+/)[0] || "";
}

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
  const icon = type === "error" ? "circle-alert" : type === "warning" ? "triangle-alert" : type === "success" ? "circle-check" : "info";
  containerEl.innerHTML = `<div class="banner banner-${type}"><i data-lucide="${icon}"></i><span>${escapeHtml(message)}</span></div>`;
  refreshIcons();
  containerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
function clearBanner(containerEl) { containerEl.innerHTML = ""; }

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

function checkIconSvg() { return `<i data-lucide="check"></i>`; }

function schoolTypeLabel(id) {
  const found = SCHOOL_TYPES.find((t) => t.id === id);
  return found ? found.label : id;
}

async function fetchCenterSettings() {
  if (dataCache.centerSettings) return dataCache.centerSettings;
  const { data, error } = await supabaseClient.from("center_settings").select("center_name, center_tagline").eq("id", 1).single();
  if (error) throw error;
  dataCache.centerSettings = data;
  return data;
}

// Grades are filtered to ONLY those with at least one actually-bookable
// subject for the chosen school type (see available_grades_for_school_type
// in functions.sql) -- otherwise a student could pick a grade and then hit
// "no subjects available", which is exactly the confusing dead-end this
// avoids.
async function fetchGrades(schoolType) {
  if (dataCache.gradesBySchoolType[schoolType]) return dataCache.gradesBySchoolType[schoolType];
  const { data, error } = await supabaseClient.rpc("available_grades_for_school_type", { p_school_type: schoolType });
  if (error) throw error;
  dataCache.gradesBySchoolType[schoolType] = data;
  return data;
}

// Uses available_subjects_for_grade(), which already filters down to ONLY
// subjects that are actually bookable for this grade+schoolType (linked,
// has an assigned teacher, that teacher has an active slot, that slot has
// remaining capacity). teacher_count on each row is the number of teachers
// the student could actually book -- used for the "X مدرسين متاحين" badge.
async function fetchSubjectsForGrade(gradeId, schoolType) {
  const key = `${gradeId}:${schoolType}`;
  if (dataCache.subjectsByGradeAndSchoolType[key]) return dataCache.subjectsByGradeAndSchoolType[key];
  const { data, error } = await supabaseClient.rpc("available_subjects_for_grade", {
    p_grade_id: gradeId, p_school_type: schoolType,
  });
  if (error) throw error;
  dataCache.subjectsByGradeAndSchoolType[key] = data;
  return data;
}

// Uses available_teachers_for_subject(), which already filters to active
// teachers assigned to this exact grade+schoolType+subject AND who have at
// least one slot with remaining capacity.
async function fetchTeachersForSubject(gradeId, schoolType, subjectId) {
  const key = `${gradeId}:${schoolType}:${subjectId}`;
  if (dataCache.teachersBySubjectGradeAndSchoolType[key]) return dataCache.teachersBySubjectGradeAndSchoolType[key];
  const { data, error } = await supabaseClient.rpc("available_teachers_for_subject", {
    p_grade_id: gradeId, p_school_type: schoolType, p_subject_id: subjectId,
  });
  if (error) throw error;
  dataCache.teachersBySubjectGradeAndSchoolType[key] = data;
  return data;
}

async function fetchAvailableSlots(gradeId, schoolType, subjectId, teacherId) {
  const key = `${gradeId}:${schoolType}:${subjectId}:${teacherId}`;
  if (dataCache.slotsByTeacherSubjectGradeAndSchoolType[key]) return dataCache.slotsByTeacherSubjectGradeAndSchoolType[key];
  const { data, error } = await supabaseClient.rpc("available_slots", {
    p_grade_id: gradeId, p_school_type: schoolType, p_subject_id: subjectId, p_teacher_id: teacherId,
  });
  if (error) throw error;
  dataCache.slotsByTeacherSubjectGradeAndSchoolType[key] = data;
  return data;
}

// NOTE: p_student intentionally has NO age field. school_type is sent once
// for the whole reservation and re-validated server-side against every
// item (see create_reservation() in functions.sql) -- a tampered frontend
// request cannot mix school types.
async function submitReservation() {
  const payload = {
    p_student: {
      full_name: bookingState.student.fullName,
      mobile: bookingState.student.mobile,
      gender: bookingState.student.gender,
      parent_name: bookingState.student.parentName,
      parent_mobile: bookingState.student.parentMobile,
      email: bookingState.student.email || null,
    },
    p_grade_id: bookingState.grade.id,
    p_school_type: bookingState.schoolType,
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
  if (!EMAIL_FUNCTION_URL || EMAIL_FUNCTION_URL.includes("YOUR_SUPABASE_URL")) return;
  try {
    await fetch(EMAIL_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(reservationPayload),
    });
  } catch (err) {
    console.warn("Admin email notification failed (reservation is still saved):", err);
  }
}

// Sends a WhatsApp confirmation/reminder to the STUDENT's own mobile number
// (the number they entered in step 1), listing every booked subject,
// teacher, day and time. Fire-and-forget — never blocks or reverses the
// reservation if WhatsApp isn't configured or the send fails.
async function notifyStudentByWhatsApp(reservationPayload) {
  if (!WHATSAPP_FUNCTION_URL || WHATSAPP_FUNCTION_URL.includes("YOUR_SUPABASE_URL")) return;
  try {
    await fetch(WHATSAPP_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(reservationPayload),
    });
  } catch (err) {
    console.warn("WhatsApp notification failed (reservation is still saved):", err);
  }
}

function renderStepper() {
  const track = $("stepperTrack");
  track.innerHTML = "";
  STEPS.forEach((step, idx) => {
    const state = idx < bookingState.currentStepIndex ? "is-done" : idx === bookingState.currentStepIndex ? "is-active" : "";
    const el = document.createElement("div");
    el.className = `stepper-step ${state}`.trim();
    el.innerHTML = `
      <div class="stepper-step__line"></div>
      <div class="stepper-step__icon">${idx < bookingState.currentStepIndex ? '<i data-lucide="check"></i>' : `<i data-lucide="${step.icon}"></i>`}</div>
      <div class="stepper-step__label">${step.label}</div>`;
    track.appendChild(el);
  });
  refreshIcons();
}

function updateSideArt(stepKey) {
  const info = SIDE_ART_BY_STEP[stepKey];
  if (!info) return;
  const iconEl = $("sideArtIcon");
  const captionEl = $("sideArtCaption");
  if (!iconEl || !captionEl) return;
  iconEl.style.opacity = 0;
  captionEl.style.opacity = 0;
  setTimeout(() => {
    iconEl.setAttribute("data-lucide", info.icon);
    captionEl.textContent = info.caption;
    refreshIcons();
    iconEl.style.opacity = 1;
    captionEl.style.opacity = 1;
  }, 150);
}

function showView(stepKey) {
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== `view-${stepKey}`; });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  updateSideArt(stepKey);
}

function setHeaderVisible(visible) {
  $("appHeader").hidden = !visible;
  $("stepFooter").hidden = !visible;
}

async function goToStep(index) {
  bookingState.currentStepIndex = index;
  const step = STEPS[index];
  renderStepper();
  setHeaderVisible(true);
  showView(step.key);
  updateFooterForStep(step.key);

  try {
    switch (step.key) {
      case "student": renderStudentStep(); break;
      case "schoolType": renderSchoolTypeStep(); break;
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
  refreshIcons();
}

function updateFooterForStep(stepKey) {
  const btnNext = $("btnNext");
  $("btnBack").style.visibility = stepKey === "student" ? "hidden" : "visible";
  btnNext.querySelector(".btn-label").textContent = stepKey === "review" ? "تأكيد الحجز" : "متابعة";
}

function renderStepLoadError(stepKey, err) {
  const bannerEl = $(`${stepKey}ErrorBanner`);
  if (bannerEl) showBanner(bannerEl, "error", friendlyErrorMessage(err));
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
      document.querySelectorAll("#genderRow .radio-pill").forEach((p) => { p.classList.remove("is-selected"); p.setAttribute("aria-checked", "false"); });
      pill.classList.add("is-selected");
      pill.setAttribute("aria-checked", "true");
      bookingState.student.gender = pill.dataset.value;
      hideFieldError("gender");
    };
    pill.addEventListener("click", select);
    pill.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
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
  clearBanner($("studentErrorBanner"));
  ["fullName", "mobile", "gender", "parentName", "parentMobile", "email"].forEach(hideFieldError);

  const fullName = $("fullName").value.trim();
  const mobile = $("mobile").value.trim();
  const parentName = $("parentName").value.trim();
  const parentMobile = $("parentMobile").value.trim();
  const email = $("email").value.trim();
  const gender = bookingState.student.gender;

  if (fullName.length < 3) { showFieldError("fullName", "يرجى إدخال الاسم الكامل للطالب (3 أحرف على الأقل)."); valid = false; }
  if (!isValidEgyptianMobile(mobile)) { showFieldError("mobile", "يرجى إدخال رقم موبايل مصري صحيح."); valid = false; }
  if (!gender) { showFieldError("gender", "يرجى اختيار النوع."); valid = false; }
  if (parentName.length < 3) { showFieldError("parentName", "يرجى إدخال اسم ولي الأمر بالكامل."); valid = false; }
  if (!isValidEgyptianMobile(parentMobile)) { showFieldError("parentMobile", "يرجى إدخال رقم موبايل مصري صحيح."); valid = false; }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showFieldError("email", "يرجى إدخال بريد إلكتروني صحيح."); valid = false; }

  if (!valid) showBanner($("studentErrorBanner"), "warning", "يرجى تصحيح الحقول المميزة أدناه للمتابعة.");
  if (valid) bookingState.student = { fullName, mobile, gender, parentName, parentMobile, email };
  return valid;
}

// ============================================================================
// STEP: SCHOOL TYPE (نوع المدرسة — مدرسة عربي / مدرسة لغات)
// This is a MAJOR filter, independent of grade: it determines which
// subjects/teachers/slots are reachable downstream (see functions.sql).
// ============================================================================

function renderSchoolTypeStep() {
  $("schoolTypeStepHeading").textContent = firstName() ? `يا ${firstName()}، نوع مدرستك إيه؟` : "نوع مدرستك؟";
  const listEl = $("schoolTypeList");
  listEl.innerHTML = "";

  SCHOOL_TYPES.forEach((type, i) => {
    const card = document.createElement("div");
    card.className = "option-card option-card--feature";
    card.style.animationDelay = `${i * 0.06}s`;
    card.setAttribute("role", "radio");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.schoolType === type.id;
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      <span class="option-card__check">${checkIconSvg()}</span>
      <span class="option-card__icon option-card__icon--feature"><i data-lucide="${type.icon}"></i></span>
      <span class="option-card__body">
        <span class="option-card__title">${escapeHtml(type.label)}</span>
        <span class="option-card__subtitle">${escapeHtml(type.subtitle)}</span>
      </span>`;
    const select = () => selectSchoolType(type);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    listEl.appendChild(card);
  });
  refreshIcons();
}

function selectSchoolType(type) {
  const changed = bookingState.schoolType !== type.id;
  bookingState.schoolType = type.id;
  if (changed) {
    // A different school type can have entirely different subjects/
    // teachers/slots for the SAME grade, so clear everything downstream —
    // same rule already applied when the grade itself changes.
    bookingState.grade = null;
    bookingState.subjects = [];
    bookingState.teacherBySubject = {};
    bookingState.slotBySubject = {};
  }
  renderSchoolTypeStep();
}

async function renderGradeStep() {
  $("gradeStepHeading").textContent = firstName() ? `في أي صف أنت يا ${firstName()}؟` : "في أي صف أنت؟";
  const listEl = $("gradeList");
  listEl.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جاري تحميل الصفوف الدراسية...</div>`;
  const grades = await fetchGrades(bookingState.schoolType);
  listEl.innerHTML = "";

  if (!grades.length) {
    listEl.innerHTML = emptyState("school", "لا توجد صفوف متاحة", "لا توجد صفوف بها مواد قابلة للحجز حاليًا لهذا النوع من المدارس. جرّب نوع المدرسة الآخر.");
    refreshIcons();
    return;
  }

  grades.forEach((grade, i) => {
    const card = document.createElement("div");
    card.className = "option-card";
    card.style.animationDelay = `${i * 0.03}s`;
    card.setAttribute("role", "radio");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.grade && bookingState.grade.id === grade.id;
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    card.innerHTML = `
      <span class="option-card__check">${checkIconSvg()}</span>
      <span class="option-card__icon"><i data-lucide="graduation-cap"></i></span>
      <span class="option-card__body"><span class="option-card__title">${escapeHtml(grade.name)}</span></span>`;
    const select = () => selectGrade(grade);
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
    listEl.appendChild(card);
  });
  refreshIcons();
}

function emptyState(icon, title, text) {
  return `<div class="state-block">
    <div class="state-block__icon"><i data-lucide="${icon}"></i></div>
    <div class="state-block__title">${escapeHtml(title)}</div>
    <div class="state-block__text">${escapeHtml(text)}</div>
  </div>`;
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
  $("subjectsStepHeading").textContent = firstName() ? `إيه المواد اللي عايز تحجزها يا ${firstName()}؟` : "إيه المواد اللي عايز تحجزها؟";
  $("subjectsGradeName").textContent = bookingState.grade.name;
  const listEl = $("subjectList");
  listEl.innerHTML = `<div class="state-block" style="grid-column:1/-1;"><div class="spinner-lg"></div>جاري تحميل المواد...</div>`;
  // available_subjects_for_grade() already filters out anything unbookable
  // (no teacher, no active slot, or no remaining capacity) -- what comes
  // back here is exactly what the student is allowed to see.
  const subjects = await fetchSubjectsForGrade(bookingState.grade.id, bookingState.schoolType);
  listEl.innerHTML = "";

  if (!subjects.length) {
    listEl.innerHTML = emptyState("book-x", "لا توجد مواد متاحة", "لا توجد مواد متاحة حاليًا لهذا الصف. جرّب صفًا آخر أو نوع مدرسة آخر.");
    listEl.style.gridColumn = "1/-1";
    refreshIcons();
    return;
  }

  subjects.forEach((subject, i) => {
    const style = subjectStyle(subject.name);
    const card = document.createElement("div");
    card.className = "subject-card";
    card.style.animationDelay = `${i * 0.04}s`;
    card.setAttribute("role", "checkbox");
    card.setAttribute("tabindex", "0");
    const isSelected = bookingState.subjects.some((s) => s.id === subject.id);
    card.classList.toggle("is-selected", isSelected);
    card.setAttribute("aria-checked", String(isSelected));
    const teacherWord = subject.teacher_count === 1 ? "مدرس متاح" : "مدرسين متاحين";
    card.innerHTML = `
      <span class="subject-card__check">${checkIconSvg()}</span>
      <span class="subject-card__icon" style="background:${style.color}"><i data-lucide="${style.icon}"></i></span>
      <span class="subject-card__title">${escapeHtml(subject.name)}</span>
      <span class="subject-card__meta">${subject.teacher_count} ${teacherWord}</span>`;
    const toggle = () => toggleSubject(subject);
    card.addEventListener("click", toggle);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    listEl.appendChild(card);
  });
  refreshIcons();
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
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جاري تحميل المعلمين...</div>`;

  const results = await Promise.all(bookingState.subjects.map((subject) => fetchTeachersForSubject(bookingState.grade.id, bookingState.schoolType, subject.id)));
  container.innerHTML = "";

  bookingState.subjects.forEach((subject, i) => {
    const teachers = results[i];
    const style = subjectStyle(subject.name);
    const group = document.createElement("div");
    group.className = "subject-group";
    group.innerHTML = `<div class="subject-group__title"><i data-lucide="${style.icon}" style="color:${style.color}"></i>${subject.name}</div>`;

    if (!teachers.length) {
      const empty = document.createElement("div");
      empty.innerHTML = emptyState("user-x", "لا يوجد معلمون بعد", "لا يوجد معلمون معينون حاليًا لهذه المادة. جرّب مادة أخرى.");
      empty.style.padding = "8px 0 16px";
      group.appendChild(empty.firstElementChild);
    } else {
      teachers.forEach((teacher) => {
        const card = document.createElement("div");
        card.className = "teacher-card";
        card.setAttribute("role", "radio");
        card.setAttribute("tabindex", "0");
        const selectedTeacher = bookingState.teacherBySubject[subject.id];
        const isSelected = selectedTeacher && selectedTeacher.id === teacher.id;
        card.classList.toggle("is-selected", isSelected);
        card.setAttribute("aria-checked", String(isSelected));
        card.innerHTML = `
          <span class="teacher-card__avatar" style="background:${avatarColorFor(teacher.full_name)}">${initialsFor(teacher.full_name)}</span>
          <span class="teacher-card__body">
            <span class="teacher-card__name">${escapeHtml(teacher.full_name)}</span>
            ${teacher.title ? `<span class="teacher-card__subtitle">${escapeHtml(teacher.title)}</span>` : ""}
          </span>
          <span class="teacher-card__check">${checkIconSvg()}</span>`;
        const select = () => selectTeacher(subject, teacher);
        card.addEventListener("click", select);
        card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
        group.appendChild(card);
      });
    }
    container.appendChild(group);
  });
  refreshIcons();
}

function selectTeacher(subject, teacher) {
  const prevTeacher = bookingState.teacherBySubject[subject.id];
  const teacherChanged = !prevTeacher || prevTeacher.id !== teacher.id;
  bookingState.teacherBySubject[subject.id] = { id: teacher.id, full_name: teacher.full_name, title: teacher.title };
  if (teacherChanged) delete bookingState.slotBySubject[subject.id];
  renderTeachersStep();
}

async function renderSlotsStep() {
  const container = $("slotGroups");
  container.innerHTML = `<div class="state-block"><div class="spinner-lg"></div>جاري التحقق من المواعيد المتاحة...</div>`;

  const results = await Promise.all(bookingState.subjects.map((subject) => {
    const teacher = bookingState.teacherBySubject[subject.id];
    return fetchAvailableSlots(bookingState.grade.id, bookingState.schoolType, subject.id, teacher.id);
  }));

  container.innerHTML = "";

  bookingState.subjects.forEach((subject, i) => {
    const teacher = bookingState.teacherBySubject[subject.id];
    const slots = results[i];
    const style = subjectStyle(subject.name);

    const group = document.createElement("div");
    group.className = "subject-group";
    group.innerHTML = `<div class="subject-group__title"><i data-lucide="${style.icon}" style="color:${style.color}"></i>${subject.name} — ${teacher.full_name}</div>`;

    if (!slots.length) {
      const empty = document.createElement("div");
      empty.innerHTML = emptyState("calendar-x", "لا توجد مواعيد متاحة", "لا توجد مواعيد متاحة لهذا المعلم حاليًا. جرّب معلمًا آخر.");
      empty.style.padding = "8px 0 16px";
      group.appendChild(empty.firstElementChild);
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
        const isLow = slot.remaining <= 1;
        const badgeClass = isLow ? "option-card__badge is-low" : "option-card__badge";
        const seatWord = slot.remaining === 1 ? "مقعد متبقي" : "مقاعد متبقية";
        card.innerHTML = `
          <span class="option-card__check">${checkIconSvg()}</span>
          <span class="option-card__icon"><i data-lucide="clock"></i></span>
          <span class="option-card__body">
            <span class="option-card__title">${DAY_NAMES[slot.day_of_week]}</span>
            <span class="option-card__subtitle">${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}</span>
          </span>
          <span class="${badgeClass}">${isLow ? '<i data-lucide="triangle-alert"></i>' : ""}${slot.remaining} ${seatWord}</span>`;
        const select = () => selectSlot(subject, slot);
        card.addEventListener("click", select);
        card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
        group.appendChild(card);
      });
    }
    container.appendChild(group);
  });
  refreshIcons();
}

function selectSlot(subject, slot) {
  bookingState.slotBySubject[subject.id] = { id: slot.id, day_of_week: slot.day_of_week, start_time: slot.start_time, end_time: slot.end_time };
  renderSlotsStep();
}

function renderReviewStep() {
  clearBanner($("reviewErrorBanner"));
  $("reviewStepHeading").textContent = firstName() ? `راجع حجزك يا ${firstName()}` : "راجع حجزك";
  const s = bookingState.student;
  const container = $("reviewContent");

  const lessonsHtml = bookingState.subjects.map((subject) => {
    const teacher = bookingState.teacherBySubject[subject.id];
    const slot = bookingState.slotBySubject[subject.id];
    const style = subjectStyle(subject.name);
    return `
      <div class="lesson-summary-card">
        <span class="lesson-summary-card__icon" style="background:${style.color}"><i data-lucide="${style.icon}"></i></span>
        <span class="lesson-summary-card__body">
          <div class="lesson-summary-card__subject">${escapeHtml(subject.name)}</div>
          <div class="lesson-summary-card__meta">مع ${escapeHtml(teacher.full_name)} · ${DAY_NAMES[slot.day_of_week]} · ${formatTime12h(slot.start_time)}</div>
        </span>
      </div>`;
  }).join("");

  container.innerHTML = `
    <div class="summary-section">
      <div class="summary-section__title">بيانات الطالب</div>
      <div class="card">
        <div class="summary-row"><span class="summary-row__label">الاسم الكامل</span><span class="summary-row__value">${escapeHtml(s.fullName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">الموبايل</span><span class="summary-row__value">${escapeHtml(s.mobile)}</span></div>
        <div class="summary-row"><span class="summary-row__label">النوع</span><span class="summary-row__value">${s.gender === "male" ? "ذكر" : "أنثى"}</span></div>
        <div class="summary-row"><span class="summary-row__label">اسم ولي الأمر</span><span class="summary-row__value">${escapeHtml(s.parentName)}</span></div>
        <div class="summary-row"><span class="summary-row__label">موبايل ولي الأمر</span><span class="summary-row__value">${escapeHtml(s.parentMobile)}</span></div>
        ${s.email ? `<div class="summary-row"><span class="summary-row__label">البريد الإلكتروني</span><span class="summary-row__value">${escapeHtml(s.email)}</span></div>` : ""}
        <div class="summary-row"><span class="summary-row__label">نوع المدرسة</span><span class="summary-row__value">${escapeHtml(schoolTypeLabel(bookingState.schoolType))}</span></div>
        <div class="summary-row"><span class="summary-row__label">الصف الدراسي</span><span class="summary-row__value">${escapeHtml(bookingState.grade.name)}</span></div>
      </div>
    </div>
    <div class="summary-section">
      <div class="summary-section__title">الحصص</div>
      ${lessonsHtml}
    </div>`;
  refreshIcons();
}

function validateCurrentStepBeforeAdvance() {
  const stepKey = STEPS[bookingState.currentStepIndex].key;
  switch (stepKey) {
    case "student": return validateStudentStep() ? null : true;
    case "schoolType": return bookingState.schoolType ? null : "يرجى اختيار نوع المدرسة للمتابعة.";
    case "grade": return bookingState.grade ? null : "يرجى اختيار الصف الدراسي للمتابعة.";
    case "subjects": return bookingState.subjects.length > 0 ? null : "يرجى اختيار مادة واحدة على الأقل للمتابعة.";
    case "teachers": {
      const missing = bookingState.subjects.some((s) => !bookingState.teacherBySubject[s.id]);
      return missing ? "يرجى اختيار معلم لكل مادة." : null;
    }
    case "slots": {
      const missing = bookingState.subjects.some((s) => !bookingState.slotBySubject[s.id]);
      return missing ? "يرجى اختيار موعد حصة لكل مادة." : null;
    }
    default: return null;
  }
}

async function handleNextClicked() {
  const stepKey = STEPS[bookingState.currentStepIndex].key;

  if (stepKey === "review") {
    await handleConfirmReservation();
    return;
  }

  const result = validateCurrentStepBeforeAdvance();
  if (result === true) return;
  if (result) {
    const bannerEl = $(`${stepKey}ErrorBanner`);
    if (bannerEl) showBanner(bannerEl, "warning", result);
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

  setButtonLoading(btnNext, true, "جاري تأكيد الحجز...", "تأكيد الحجز");
  btnBack.disabled = true;
  clearBanner($("reviewErrorBanner"));

  try {
    const result = await submitReservation();
    bookingState.reservationResult = result;
    notifyAdminByEmail(result);
    notifyStudentByWhatsApp(result);
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
  const centerName = dataCache.centerSettings?.center_name || "سنتر ديار التعليمي";
  $("successThankYou").textContent = `شكرًا لاختيارك ${centerName}`;
  $("successReservationCode").textContent = result.reservation_code;

  const lessonsEl = $("successLessons");
  lessonsEl.innerHTML = result.items.map((item) => {
    const style = subjectStyle(item.subject_name);
    const joinButton = item.whatsapp_group_link
      ? `<a class="btn btn-whatsapp-join" href="${escapeHtml(item.whatsapp_group_link)}" target="_blank" rel="noopener">
          <i data-lucide="message-circle"></i>
          <span>انضم لجروب الواتساب</span>
        </a>`
      : "";
    return `
    <div class="lesson-summary-card">
      <span class="lesson-summary-card__icon" style="background:${style.color}"><i data-lucide="${style.icon}"></i></span>
      <span class="lesson-summary-card__body">
        <div class="lesson-summary-card__subject">${escapeHtml(item.subject_name)}</div>
        <div class="lesson-summary-card__meta">${escapeHtml(item.teacher_name)} · ${DAY_NAMES[item.day_of_week]} — ${formatTime12h(item.start_time)}</div>
        ${joinButton}
      </span>
    </div>`;
  }).join("");
  refreshIcons();
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
    piece.style.setProperty("--tx", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--ty", `${Math.sin(angle) * distance - 20}px`);
    piece.style.setProperty("--rot", `${Math.random() * 360}deg`);
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${0.7 + Math.random() * 0.5}s`;
    piece.style.animationDelay = `${0.3 + Math.random() * 0.15}s`;
    container.appendChild(piece);
  }
}

function resetBookingState() {
  bookingState.currentStepIndex = -1;
  bookingState.student = { fullName: "", mobile: "", gender: "", parentName: "", parentMobile: "", email: "" };
  bookingState.schoolType = null;
  bookingState.grade = null;
  bookingState.subjects = [];
  bookingState.teacherBySubject = {};
  bookingState.slotBySubject = {};
  bookingState.idempotencyKey = null;
  bookingState.reservationResult = null;
  dataCache.slotsByTeacherSubjectGradeAndSchoolType = {};
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
  ["fullName", "mobile", "parentName", "parentMobile", "email"].forEach((id) => {
    $(id).addEventListener("input", () => hideFieldError(id));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindStaticEvents();
  initWelcomeContent();
  refreshIcons();
});
