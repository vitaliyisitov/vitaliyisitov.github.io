/* Использует window.db (Firebase compat), инициализированный в firebase.config.js */

const state = {
  catalog: [],
  users: [],
  selectedUserId: null,
  selectedUserSubjects: [],
  tasksBySubjectId: {},
};

const els = {
  createStudentForm: document.getElementById("createStudentForm"),
  createName: document.getElementById("createName"),
  createSubjects: document.getElementById("createSubjects"),

  studentsList: document.getElementById("studentsList"),

  editStudentForm: document.getElementById("editStudentForm"),
  editName: document.getElementById("editName"),
  editActive: document.getElementById("editActive"),
  editToken: document.getElementById("editToken"),
  editSubjects: document.getElementById("editSubjects"),
  subjectSettings: document.getElementById("subjectSettings"),
  emptyEditHint: document.getElementById("emptyEditHint"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  archiveBtn: document.getElementById("archiveBtn"),
  deleteStudentBtn: document.getElementById("deleteStudentBtn"),
  tasksEditor: document.getElementById("tasksEditor"),

  statusBox: document.getElementById("statusBox"),
};

// ─── Google Auth Gate ─────────────────────────────────────────────────────────

function getStudentDashboardBaseUrl() {
  const path = window.location.pathname || "";
  const i = path.lastIndexOf("/");
  const dir = i >= 0 ? path.slice(0, i + 1) : "/";
  return `${window.location.origin}${dir}index.html`;
}

let appInitialized = false;

function setupAdminGate() {
  const adminEmail = (window.FIREBASE_CONFIG?.adminEmail || "").trim().toLowerCase();

  // Кнопка выхода — подписываемся здесь, до появления приложения
  document.getElementById("adminLogoutBtn")?.addEventListener("click", async () => {
    await firebase.auth().signOut();
  });

  // Кнопка входа через Google
  document.getElementById("googleSignInBtn")?.addEventListener("click", () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Принудительно показываем выбор аккаунта каждый раз
    provider.setCustomParameters({ prompt: "select_account" });
    firebase.auth().signInWithPopup(provider).catch((err) => {
      const errorEl = document.getElementById("adminGateError");
      if (errorEl) {
        errorEl.textContent = "Ошибка входа: " + err.message;
        errorEl.hidden = false;
      }
    });
  });

  // Слушаем состояние авторизации
  firebase.auth().onAuthStateChanged((user) => {
    const overlay  = document.getElementById("adminLoginOverlay");
    const root     = document.getElementById("adminAppRoot");
    const logoutBtn = document.getElementById("adminLogoutBtn");
    const errorEl  = document.getElementById("adminGateError");

    if (!user) {
      // Не авторизован — показываем оверлей входа
      if (overlay) overlay.hidden = false;
      if (root)    root.hidden = true;
      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ""; }
      appInitialized = false;
      return;
    }

    const userEmail = (user.email || "").trim().toLowerCase();
    if (adminEmail && userEmail !== adminEmail) {
      // Чужой аккаунт — сразу выходим и показываем ошибку
      if (errorEl) {
        errorEl.textContent = `Аккаунт ${user.email} не имеет доступа. Войди с нужным аккаунтом.`;
        errorEl.hidden = false;
      }
      firebase.auth().signOut();
      return;
    }

    // Правильный аккаунт — открываем приложение
    if (overlay)   overlay.hidden = true;
    if (root)      root.hidden = false;
    if (logoutBtn) {
      logoutBtn.textContent = `Выйти (${user.email})`;
      logoutBtn.hidden = false;
    }

    if (!appInitialized) {
      appInitialized = true;
      void init();
    }
  });
}

setupAdminGate();

// ─── Инициализация ────────────────────────────────────────────────────────────

async function init() {
  if (!window.db) {
    setStatus("Firebase не настроен. Проверь firebase.config.js.", "error");
    disableForms();
    return;
  }

  initPageTabs();
  initYadiskSync();
  bindEvents();
  await loadCatalog();
  await loadUsers();
  setStatus("Данные загружены ✅", "success");
}

function bindEvents() {
  els.createStudentForm.addEventListener("submit", handleCreateStudent);
  els.editStudentForm.addEventListener("submit", handleSaveStudent);
  els.copyLinkBtn.addEventListener("click", handleCopyLink);
  els.archiveBtn.addEventListener("click", handleToggleArchive);
  els.deleteStudentBtn.addEventListener("click", handleDeleteStudent);

  // Делегирование для вложений — работает даже после перерендера tasksEditor
  els.tasksEditor.addEventListener("click", (e) => {
    // Добавить строку вложения
    const addBtn = e.target.closest("[data-add-attachment]");
    if (addBtn) {
      const taskId = addBtn.getAttribute("data-add-attachment");
      const editor = document.getElementById(`att-${taskId}`);
      if (editor) {
        const tmp = document.createElement("div");
        tmp.innerHTML = attachmentRowHtml("", "");
        editor.appendChild(tmp.firstElementChild);
      }
      return;
    }
    // Удалить строку вложения
    const removeBtn = e.target.closest("[data-remove-attachment]");
    if (removeBtn) removeBtn.closest(".attachment-row")?.remove();
  });
}

function disableForms() {
  [els.createStudentForm, els.editStudentForm].forEach((form) =>
    form.querySelectorAll("input,button,select,textarea").forEach((x) => {
      x.disabled = true;
    }),
  );
}

// ─── Загрузка данных ──────────────────────────────────────────────────────────

async function loadCatalog() {
  try {
    const snap = await window.db
      .collection("subject_catalog")
      .orderBy("sort_order")
      .get();
    state.catalog = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCatalogChecks(els.createSubjects, "createSubject", []);
  } catch (err) {
    setStatus(
      "Не удалось загрузить каталог. Открой setup.html и заполни базу.",
      "error",
    );
    console.error(err);
  }
}

async function loadUsers(preserveSelected = true, autoSelect = true) {
  const prevSelected = preserveSelected ? state.selectedUserId : null;

  try {
    const snap = await window.db.collection("users").orderBy("name").get();
    state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    setStatus("Не удалось загрузить учеников", "error");
    console.error(err);
    return;
  }

  renderStudentsList();
  if (!autoSelect) return;

  if (!state.users.length) {
    state.selectedUserId = null;
    renderEditPanel();
    return;
  }

  const selectedExists = state.users.some((u) => u.id === prevSelected);
  await selectUser(selectedExists ? prevSelected : state.users[0].id);
}

async function selectUser(userId) {
  state.selectedUserId = userId;
  renderStudentsList();
  await loadUserSubjects(userId);
  renderEditPanel();
}

async function loadUserSubjects(userId) {
  try {
    const snap = await window.db
      .collection("users")
      .doc(userId)
      .collection("subjects")
      .get();
    state.selectedUserSubjects = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  } catch (err) {
    setStatus("Не удалось загрузить предметы ученика", "error");
    console.error(err);
  }
}

// ─── Рендер ───────────────────────────────────────────────────────────────────

function renderStudentsList() {
  if (!state.users.length) {
    els.studentsList.innerHTML = `<p class="muted">Пока нет учеников.</p>`;
    return;
  }

  els.studentsList.innerHTML = state.users
    .map((u) => {
      const active = u.id === state.selectedUserId ? "is-active" : "";
      const tokenSuffix = String(u.access_token || "").slice(-8);
      const stateLabel = u.is_active === false ? "архив" : "активен";
      return `
        <button class="student-row ${active}" type="button" data-user-id="${escapeAttr(u.id)}">
          <div class="student-name">${escapeHtml(u.name || "Без имени")}</div>
          <div class="student-meta">${stateLabel} • токен …${escapeHtml(tokenSuffix || "—")}</div>
        </button>`;
    })
    .join("");

  els.studentsList.querySelectorAll("[data-user-id]").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => void selectUser(btn.getAttribute("data-user-id")),
    );
  });
}

function renderEditPanel() {
  const user = getSelectedUser();
  if (!user) {
    els.editStudentForm.hidden = true;
    els.emptyEditHint.hidden = false;
    return;
  }

  els.editStudentForm.hidden = false;
  els.emptyEditHint.hidden = true;
  els.editName.value = user.name || "";
  els.editActive.value = String(user.is_active !== false);
  els.editToken.textContent = user.access_token || "—";

  renderCatalogChecks(
    els.editSubjects,
    "editSubject",
    state.selectedUserSubjects.map((s) => s.catalog_id).filter(Boolean),
  );
  renderSubjectSettings();
  void renderTasksEditor();
}

function renderCatalogChecks(root, prefix, selectedIds) {
  const selected = new Set(selectedIds || []);
  root.innerHTML = state.catalog
    .map((c) => {
      const isOn = selected.has(c.id);
      return `
        <button
          class="subject-check ${isOn ? "is-on" : ""}"
          type="button"
          data-check-name="${escapeAttr(prefix)}"
          data-check-value="${escapeAttr(c.id)}"
          data-checked="${isOn}"
          aria-pressed="${isOn}"
        >${escapeHtml(c.emoji || "📘")} ${escapeHtml(c.title)}</button>`;
    })
    .join("");

  root.querySelectorAll("[data-check-name]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-checked") !== "true";
      btn.setAttribute("data-checked", next);
      btn.setAttribute("aria-pressed", next);
      btn.classList.toggle("is-on", next);
    });
  });
}

function renderSubjectSettings() {
  const byCatalog = new Map(state.catalog.map((c) => [c.id, c]));
  const rows = state.selectedUserSubjects.map((s) => {
    const cat = byCatalog.get(s.catalog_id);
    const title = s.title || cat?.title || "Предмет";
    const emoji = s.emoji || cat?.emoji || "📘";
    const examDate = s.exam_date || cat?.default_exam_date || "";
    const examTime = s.exam_time || cat?.default_exam_time || "10:00";
    const duration = Number(
      s.duration_minutes || cat?.default_duration_minutes || 235,
    );
    const tasksTotal = Number(s.tasks_total || cat?.default_tasks_total || 0);

    return `
      <div class="subject-setting" data-subject-id="${escapeAttr(s.id)}">
        <div class="subject-setting__title">${escapeHtml(emoji)} ${escapeHtml(title)}</div>
        <div class="subject-setting__grid">
          <label><span>Дата экзамена</span>
            <input data-field="exam_date" type="date" value="${escapeAttr(examDate)}" /></label>
          <label><span>Время</span>
            <input data-field="exam_time" type="text" value="${escapeAttr(examTime)}" /></label>
          <label><span>Длительность (мин)</span>
            <input data-field="duration_minutes" type="number" min="1" value="${escapeAttr(duration)}" /></label>
          <label><span>Кол-во заданий</span>
            <input data-field="tasks_total" type="number" min="0" value="${escapeAttr(tasksTotal)}" /></label>
        </div>
      </div>`;
  });

  els.subjectSettings.innerHTML = rows.length
    ? rows.join("")
    : `<p class="muted">У ученика пока нет предметов.</p>`;
}

// ─── Создание ученика ─────────────────────────────────────────────────────────

async function handleCreateStudent(e) {
  e.preventDefault();
  const name = els.createName.value.trim();
  const selectedCatalogIds = getCheckedValues(
    els.createSubjects,
    "createSubject",
  );

  if (!name) {
    setStatus("Укажи имя ученика", "error");
    return;
  }

  setStatus("Создаю ученика...", "muted");
  try {
    const token = generateToken();
    const userRef = await window.db.collection("users").add({
      name,
      timezone: "Europe/Moscow",
      is_active: true,
      access_token: token,
      created_at: new Date().toISOString(),
    });
    const userId = userRef.id;

    for (const catalogId of selectedCatalogIds) {
      await addSubjectWithTasks(userId, catalogId);
    }

    els.createStudentForm.reset();
    renderCatalogChecks(els.createSubjects, "createSubject", []);
    await loadUsers(false);
    await selectUser(userId);
    setStatus("Ученик создан", "success");
  } catch (err) {
    setStatus("Не удалось создать ученика", "error");
    console.error(err);
  }
}

async function addSubjectWithTasks(userId, catalogId) {
  const cat = state.catalog.find((c) => c.id === catalogId);
  if (!cat) return;

  const subjectRef = await window.db
    .collection("users")
    .doc(userId)
    .collection("subjects")
    .add({
      catalog_id: cat.id,
      catalog_slug: cat.slug || "",
      title: cat.title,
      emoji: cat.emoji || "📘",
      exam_date: cat.default_exam_date || "",
      exam_time: cat.default_exam_time || "10:00",
      duration_minutes: cat.default_duration_minutes || 235,
      tasks_total: cat.default_tasks_total || 0,
      tips: cat.default_tips || [],
      order_index: cat.sort_order || 0,
    });

  const templatesSnap = await window.db
    .collection("task_templates")
    .where("catalog_id", "==", catalogId)
    .get();

  if (templatesSnap.empty) return;

  const templates = templatesSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

  const batch = window.db.batch();
  const now = new Date().toISOString();
  templates.forEach((t) => {
    const taskRef = window.db
      .collection("users")
      .doc(userId)
      .collection("subjects")
      .doc(subjectRef.id)
      .collection("tasks")
      .doc();
    batch.set(taskRef, {
      template_id: t.id,
      subject_id: subjectRef.id,
      title: t.title,
      description: t.description || "",
      status: "not_started",
      order_index: t.order_index || 0,
      details: t.default_details || {
        lessonNotes: "",
        homework: [],
        hints: [],
        attachments: [],
      },
      created_at: now,
      updated_at: now,
    });
  });
  await batch.commit();
}

// ─── Сохранение ученика ───────────────────────────────────────────────────────

async function handleSaveStudent(e) {
  e.preventDefault();
  const user = getSelectedUser();
  if (!user) return;

  const name = els.editName.value.trim();
  const isActive = els.editActive.value === "true";
  const selectedCatalogIds = getCheckedValues(els.editSubjects, "editSubject");
  const selectedSet = new Set(selectedCatalogIds);
  const currentCatalogIds = new Set(
    state.selectedUserSubjects.map((s) => s.catalog_id).filter(Boolean),
  );

  const toAdd = selectedCatalogIds.filter((id) => !currentCatalogIds.has(id));
  const toRemove = state.selectedUserSubjects.filter(
    (s) => s.catalog_id && !selectedSet.has(s.catalog_id),
  );

  setStatus("Сохраняю...", "muted");
  try {
    await window.db
      .collection("users")
      .doc(user.id)
      .update({
        name: name || user.name,
        is_active: isActive,
      });

    for (const s of toRemove) {
      await deleteSubjectWithTasks(user.id, s.id);
    }
    for (const catalogId of toAdd) {
      await addSubjectWithTasks(user.id, catalogId);
    }

    const subjectUpdates = Array.from(
      els.subjectSettings.querySelectorAll("[data-subject-id]"),
    )
      .map((row) => {
        const subjectId = row.getAttribute("data-subject-id");
        const subject = state.selectedUserSubjects.find(
          (s) => s.id === subjectId,
        );
        if (!subject || !selectedSet.has(subject.catalog_id)) return null;
        const duration = Number(
          row.querySelector('[data-field="duration_minutes"]')?.value || 0,
        );
        const tasksTotal = Number(
          row.querySelector('[data-field="tasks_total"]')?.value || 0,
        );
        return {
          id: subjectId,
          exam_date:
            row.querySelector('[data-field="exam_date"]')?.value?.trim() ||
            null,
          exam_time:
            row.querySelector('[data-field="exam_time"]')?.value?.trim() ||
            null,
          duration_minutes:
            Number.isFinite(duration) && duration > 0 ? duration : 235,
          tasks_total:
            Number.isFinite(tasksTotal) && tasksTotal >= 0 ? tasksTotal : 0,
        };
      })
      .filter(Boolean);

    for (const { id, ...payload } of subjectUpdates) {
      await window.db
        .collection("users")
        .doc(user.id)
        .collection("subjects")
        .doc(id)
        .update(payload);
    }

    await loadUsers(true, false);
    await loadUserSubjects(user.id);
    state.selectedUserId = user.id;
    renderStudentsList();
    renderEditPanel();
    setStatus("Изменения сохранены", "success");
  } catch (err) {
    setStatus("Не удалось сохранить изменения", "error");
    console.error(err);
  }
}

// ─── Архив / удаление ─────────────────────────────────────────────────────────

async function handleToggleArchive() {
  const user = getSelectedUser();
  if (!user) return;
  const next = user.is_active === false;
  try {
    await window.db
      .collection("users")
      .doc(user.id)
      .update({ is_active: next });
    await loadUsers(true, false);
    await loadUserSubjects(user.id);
    state.selectedUserId = user.id;
    renderStudentsList();
    renderEditPanel();
    setStatus(
      next ? "Ученик активирован" : "Ученик отправлен в архив",
      "success",
    );
  } catch (err) {
    setStatus("Не удалось сменить статус", "error");
    console.error(err);
  }
}

async function handleDeleteStudent() {
  const user = getSelectedUser();
  if (!user) return;
  if (
    !window.confirm(
      `Удалить ученика "${user.name || "Без имени"}" и все его данные?`,
    )
  )
    return;

  setStatus("Удаляю...", "muted");
  try {
    await deleteUserWithAllData(user.id);
    await loadUsers(false);
    setStatus("Ученик удалён", "success");
  } catch (err) {
    setStatus("Не удалось удалить ученика", "error");
    console.error(err);
  }
}

// ─── Копирование ссылки ───────────────────────────────────────────────────────

async function handleCopyLink() {
  const user = getSelectedUser();
  if (!user?.access_token) {
    setStatus("У ученика нет токена", "error");
    return;
  }
  const fullUrl = `${getStudentDashboardBaseUrl()}?k=${encodeURIComponent(user.access_token)}`;
  try {
    await navigator.clipboard.writeText(fullUrl);
    setStatus("Ссылка скопирована в буфер обмена", "success");
  } catch {
    setStatus(`Не удалось скопировать. Ссылка: ${fullUrl}`, "error");
  }
}

// ─── Редактор заданий ─────────────────────────────────────────────────────────

async function renderTasksEditor() {
  const user = getSelectedUser();
  if (!user) {
    els.tasksEditor.innerHTML =
      '<p class="muted admin-empty">Выбери ученика.</p>';
    return;
  }

  const subjects = state.selectedUserSubjects;
  if (!subjects.length) {
    els.tasksEditor.innerHTML =
      '<p class="muted admin-empty">У ученика нет предметов. Добавь предметы выше.</p>';
    return;
  }

  try {
    const taskSnaps = await Promise.all(
      subjects.map((s) =>
        window.db
          .collection("users")
          .doc(user.id)
          .collection("subjects")
          .doc(s.id)
          .collection("tasks")
          .get(),
      ),
    );

    state.tasksBySubjectId = {};
    subjects.forEach((s, i) => {
      state.tasksBySubjectId[s.id] = taskSnaps[i].docs.map((d) => ({
        id: d.id,
        subject_id: s.id,
        ...d.data(),
      }));
    });
    Object.keys(state.tasksBySubjectId).forEach((k) => {
      state.tasksBySubjectId[k] = sortTasksForAdmin(state.tasksBySubjectId[k]);
    });
  } catch (err) {
    setStatus("Не удалось загрузить задания", "error");
    console.error(err);
    return;
  }

  const firstId = subjects[0]?.id;
  const tabs = subjects
    .map(
      (s, i) =>
        `<button class="chip ${i === 0 ? "is-active" : ""}" type="button" data-task-subject="${escapeAttr(s.id)}">${escapeHtml(s.emoji || "📘")} ${escapeHtml(s.title || "Предмет")}</button>`,
    )
    .join("");

  const blocks = subjects
    .map((s) => {
      const tasks = state.tasksBySubjectId[s.id] || [];
      const rows = tasks.length
        ? tasks.map(renderTaskRow).join("")
        : `<p class="muted">Заданий нет. <button class="icon-btn" type="button" data-add-task="${escapeAttr(s.id)}">Добавить первое задание</button></p>`;
      return `<div class="task-subject-block" data-task-block="${escapeAttr(s.id)}" style="display:${s.id === firstId ? "grid" : "none"};gap:10px;grid-template-columns:repeat(3,minmax(0,1fr));">${rows}<div class="task-actions" style="grid-column:1/-1;"><button class="icon-btn" type="button" data-add-task="${escapeAttr(s.id)}">+ Добавить задание</button></div></div>`;
    })
    .join("");

  els.tasksEditor.innerHTML = `<div class="tasks-subject-tabs">${tabs}</div>${blocks}`;

  els.tasksEditor.querySelectorAll("[data-task-subject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sid = btn.getAttribute("data-task-subject");
      els.tasksEditor
        .querySelectorAll("[data-task-subject]")
        .forEach((x) => x.classList.toggle("is-active", x === btn));
      els.tasksEditor.querySelectorAll("[data-task-block]").forEach((block) => {
        const isActive = block.getAttribute("data-task-block") === sid;
        block.style.display = isActive ? "grid" : "none";
        if (isActive)
          block.style.gridTemplateColumns = "repeat(3,minmax(0,1fr))";
      });
    });
  });

  els.tasksEditor.querySelectorAll("[data-save-task]").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => void saveTaskFromRow(btn.closest("[data-task-id]")),
    );
  });
  els.tasksEditor.querySelectorAll("[data-delete-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest("[data-task-id]");
      void deleteTask(
        btn.getAttribute("data-delete-task"),
        row?.getAttribute("data-subject-id-tr"),
      );
    });
  });
  els.tasksEditor.querySelectorAll("[data-add-task]").forEach((btn) => {
    btn.addEventListener(
      "click",
      () => void addTask(btn.getAttribute("data-add-task")),
    );
  });
  els.tasksEditor.querySelectorAll("[data-task-move-up]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void moveTaskInOrder(btn.getAttribute("data-task-move-up"), "up");
    });
  });
  els.tasksEditor.querySelectorAll("[data-task-move-down]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void moveTaskInOrder(btn.getAttribute("data-task-move-down"), "down");
    });
  });
}

function renderTaskRow(task) {
  const details =
    task.details && typeof task.details === "object" ? task.details : {};
  const isPinned = details.isPinned === true;
  const homework = Array.isArray(details.homework)
    ? details.homework.join("\n")
    : "";
  const hints = Array.isArray(details.hints) ? details.hints.join("\n") : "";
  const attachmentsRaw = Array.isArray(details.attachments)
    ? details.attachments
    : [];
  const orderVal = getAdminTaskOrderValue(task);
  const updatedLocal = toDateTimeLocalValue(task.updated_at);

  const attachmentRowsHtml = attachmentsRaw
    .map((a) => { const p = parseStoredAttachment(a); return attachmentRowHtml(p.label, p.url); })
    .join("");

  return `
    <details class="task-row" open data-task-id="${escapeAttr(task.id)}" data-subject-id-tr="${escapeAttr(task.subject_id || "")}" data-order-index="${escapeAttr(orderVal)}">
      <summary class="task-row__summary">
        <span>${escapeHtml(task.title || "Задание")}</span>
        <span class="muted">${escapeHtml(formatStatus(task.status))}${attachmentsRaw.length ? ` · 📎 ${attachmentsRaw.length}` : ""}</span>
      </summary>
      <div class="task-row__body">
        <div class="task-order-bar" role="group">
          <button class="icon-btn" type="button" data-task-move-up="${escapeAttr(task.id)}" title="Выше">↑</button>
          <button class="icon-btn" type="button" data-task-move-down="${escapeAttr(task.id)}" title="Ниже">↓</button>
        </div>
        <div class="task-row__grid">
          <label><span>Порядок</span>
            <input data-f="order_index" type="number" min="1" step="1" value="${escapeAttr(orderVal)}" /></label>
          <label><span>Закрепить</span>
            <select data-f="isPinned">
              <option value="false" ${!isPinned ? "selected" : ""}>Нет</option>
              <option value="true" ${isPinned ? "selected" : ""}>Да (📌)</option>
            </select></label>
          <label><span>Статус</span>
            <select data-f="status">
              <option value="not_started" ${task.status === "not_started" ? "selected" : ""}>Не начато</option>
              <option value="in_progress" ${task.status === "in_progress" ? "selected" : ""}>В процессе</option>
              <option value="homework" ${task.status === "homework" ? "selected" : ""}>Сделать ДЗ</option>
              <option value="completed" ${task.status === "completed" ? "selected" : ""}>Пройдено</option>
            </select></label>
          <label><span>Дата «Обновлено»</span>
            <input data-f="updated_at" type="datetime-local" value="${task.status === "not_started" ? "" : escapeAttr(updatedLocal)}" /></label>
        </div>
        <label><span>Название</span>
          <input data-f="title" value="${escapeAttr(task.title || "")}" /></label>
        <label><span>Описание</span>
          <input data-f="description" value="${escapeAttr(task.description || "")}" /></label>
        <label><span>Конспект</span><textarea data-f="lessonNotes" rows="3">${escapeHtml(details.lessonNotes || "")}</textarea></label>
        <label><span>Домашка (1 строка = 1 пункт)</span><textarea data-f="homework" rows="3">${escapeHtml(homework)}</textarea></label>
        <label><span>Подсказки (1 строка = 1 пункт)</span><textarea data-f="hints" rows="3">${escapeHtml(hints)}</textarea></label>

        <div class="admin-field">
          <span>Вложения (записи с урока, файлы)</span>
          <div class="attachments-editor" id="att-${escapeAttr(task.id)}">${attachmentRowsHtml}</div>
          <button class="icon-btn" type="button" data-add-attachment="${escapeAttr(task.id)}">+ Добавить вложение</button>
        </div>

        <div class="task-actions">
          <button class="icon-btn" type="button" data-save-task="${escapeAttr(task.id)}">Сохранить задание</button>
          <button class="icon-btn danger" type="button" data-delete-task="${escapeAttr(task.id)}">Удалить задание</button>
        </div>
      </div>
    </details>`;
}

async function saveTaskFromRow(row) {
  if (!row) return;
  const taskId = row.getAttribute("data-task-id");
  const subjectId = row.getAttribute("data-subject-id-tr");
  if (!taskId || !subjectId) return;

  const orderInput = Number(row.querySelector('[data-f="order_index"]')?.value);
  const order_index =
    Number.isFinite(orderInput) && orderInput > 0
      ? orderInput
      : Number(row.getAttribute("data-order-index")) || 1;

  const isPinned = row.querySelector('[data-f="isPinned"]')?.value === "true";
  const statusVal =
    row.querySelector('[data-f="status"]')?.value || "not_started";
  const updatedFromForm = fromDateTimeLocalValue(
    row.querySelector('[data-f="updated_at"]')?.value,
  );
  const updatedAtIso =
    updatedFromForm ||
    (statusVal === "not_started" ? null : new Date().toISOString());

  const payload = {
    title: row.querySelector('[data-f="title"]')?.value?.trim() || "Задание",
    description:
      row.querySelector('[data-f="description"]')?.value?.trim() || "",
    status: statusVal,
    order_index,
    details: {
      lessonNotes:
        row.querySelector('[data-f="lessonNotes"]')?.value?.trim() || "",
      homework: splitLines(row.querySelector('[data-f="homework"]')?.value),
      hints: splitLines(row.querySelector('[data-f="hints"]')?.value),
      attachments: readAttachmentsFromRow(row),
      isPinned,
    },
  };
  if (updatedAtIso) payload.updated_at = updatedAtIso;

  try {
    await window.db
      .collection("users")
      .doc(state.selectedUserId)
      .collection("subjects")
      .doc(subjectId)
      .collection("tasks")
      .doc(taskId)
      .update(payload);
    setStatus("Задание сохранено", "success");
    await renderTasksEditor();
  } catch (err) {
    setStatus("Не удалось сохранить задание", "error");
    console.error(err);
  }
}

async function deleteTask(taskId, subjectId) {
  if (!taskId || !subjectId) return;
  if (!window.confirm("Удалить это задание?")) return;
  try {
    await window.db
      .collection("users")
      .doc(state.selectedUserId)
      .collection("subjects")
      .doc(subjectId)
      .collection("tasks")
      .doc(taskId)
      .delete();
    await renderTasksEditor();
    setStatus("Задание удалено", "success");
  } catch (err) {
    setStatus("Не удалось удалить задание", "error");
    console.error(err);
  }
}

async function addTask(subjectId) {
  if (!subjectId) return;
  try {
    await window.db
      .collection("users")
      .doc(state.selectedUserId)
      .collection("subjects")
      .doc(subjectId)
      .collection("tasks")
      .add({
        subject_id: subjectId,
        template_id: null,
        title: "Новое задание",
        description: "",
        status: "not_started",
        order_index: getNextOrderIndex(subjectId),
        details: {
          lessonNotes: "",
          homework: [],
          hints: [],
          attachments: [],
          isPinned: false,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    await renderTasksEditor();
    setStatus("Задание добавлено", "success");
  } catch (err) {
    setStatus("Не удалось добавить задание", "error");
    console.error(err);
  }
}

function getNextOrderIndex(subjectId) {
  const list = sortTasksForAdmin(state.tasksBySubjectId[subjectId] || []);
  if (!list.length) return 1;
  return (
    list.reduce((acc, t) => Math.max(acc, getAdminTaskOrderValue(t)), 0) + 1
  );
}

async function moveTaskInOrder(taskId, direction) {
  const el = Array.from(els.tasksEditor.querySelectorAll(".task-row")).find(
    (n) => n.getAttribute("data-task-id") === taskId,
  );
  if (!el) return;
  const subjectId = el.getAttribute("data-subject-id-tr");
  if (!subjectId) return;

  const list = sortTasksForAdmin([
    ...(state.tasksBySubjectId[subjectId] || []),
  ]);
  const idx = list.findIndex((t) => t.id === taskId);
  if (idx < 0) return;
  const newIdx = direction === "up" ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= list.length) return;
  [list[idx], list[newIdx]] = [list[newIdx], list[idx]];

  setStatus("Меняю порядок…", "muted");
  try {
    const batch = window.db.batch();
    list.forEach((t, i) => {
      batch.update(
        window.db
          .collection("users")
          .doc(state.selectedUserId)
          .collection("subjects")
          .doc(subjectId)
          .collection("tasks")
          .doc(t.id),
        { order_index: i + 1 },
      );
    });
    await batch.commit();
    await renderTasksEditor();
    setStatus("Порядок обновлён", "success");
  } catch (err) {
    setStatus("Не удалось сохранить порядок", "error");
    console.error(err);
  }
}

// ─── Вспомогательные Firebase-функции ────────────────────────────────────────

async function deleteSubjectWithTasks(userId, subjectId) {
  const tasksSnap = await window.db
    .collection("users")
    .doc(userId)
    .collection("subjects")
    .doc(subjectId)
    .collection("tasks")
    .get();
  const batch = window.db.batch();
  tasksSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(
    window.db
      .collection("users")
      .doc(userId)
      .collection("subjects")
      .doc(subjectId),
  );
  await batch.commit();
}

async function deleteUserWithAllData(userId) {
  const subjectsSnap = await window.db
    .collection("users")
    .doc(userId)
    .collection("subjects")
    .get();
  for (const s of subjectsSnap.docs) {
    await deleteSubjectWithTasks(userId, s.id);
  }
  await window.db.collection("users").doc(userId).delete();
}

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Утилиты ─────────────────────────────────────────────────────────────────

function sortTasksForAdmin(tasks) {
  return (Array.isArray(tasks) ? tasks.slice() : []).sort((a, b) => {
    const pinDiff =
      Number(b?.details?.isPinned === true) -
      Number(a?.details?.isPinned === true);
    if (pinDiff !== 0) return pinDiff;
    const oa = getAdminTaskOrderValue(a);
    const ob = getAdminTaskOrderValue(b);
    if (oa !== ob) return oa - ob;
    return String(a.id).localeCompare(String(b.id));
  });
}

function getAdminTaskOrderValue(task) {
  const o = Number(task?.order_index);
  if (Number.isFinite(o) && o > 0) return o;
  const m = String(task?.title || "").match(/задание\s*(\d+)/i);
  return m ? Number(m[1]) || 9999 : 9999;
}

function getCheckedValues(root, name) {
  return Array.from(
    root.querySelectorAll(`[data-check-name="${name}"][data-checked="true"]`),
  ).map((x) => x.getAttribute("data-check-value"));
}

function getSelectedUser() {
  return state.users.find((u) => u.id === state.selectedUserId) || null;
}

function toDateTimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateTimeLocalValue(s) {
  if (!s?.trim()) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function splitLines(value) {
  return String(value || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseAttachmentsJson(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatStatus(status) {
  if (status === "not_started") return "Не начато";
  if (status === "in_progress") return "В процессе";
  if (status === "homework") return "Сделать ДЗ";
  if (status === "completed") return "Пройдено";
  return "—";
}

function setStatus(message, kind = "muted") {
  els.statusBox.textContent = message;
  els.statusBox.classList.remove("is-error", "is-success");
  if (kind === "error") els.statusBox.classList.add("is-error");
  if (kind === "success") els.statusBox.classList.add("is-success");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

// ─── Вложения (attachments) ───────────────────────────────────────────────────

/** Парсит элемент хранилища → {label, url}.
 *  Форматы: "label|https://..." / "https://..." / {label, url} */
function parseStoredAttachment(item) {
  if (item && typeof item === "object") {
    return { label: String(item.label || ""), url: String(item.url || "") };
  }
  const s = String(item || "").trim();
  if (s.includes("|")) {
    const idx = s.indexOf("|");
    return { label: s.slice(0, idx).trim(), url: s.slice(idx + 1).trim() };
  }
  return { label: "", url: s };
}

/** HTML одной строки редактора вложений */
function attachmentRowHtml(label, url) {
  return `<div class="attachment-row">
    <input class="att-label" type="text"  placeholder="Название (напр. Запись урока)" value="${escapeAttr(label)}" />
    <input class="att-url"   type="url"   placeholder="https://disk.yandex.ru/…"     value="${escapeAttr(url)}" />
    <button class="icon-btn danger" type="button" data-remove-attachment title="Удалить">✕</button>
  </div>`;
}

/** Считывает все вложения из строк редактора → массив строк "label|url" */
function readAttachmentsFromRow(row) {
  return Array.from(row.querySelectorAll(".attachment-row"))
    .map((r) => {
      const label = (r.querySelector(".att-label")?.value || "").trim();
      const url   = (r.querySelector(".att-url")?.value   || "").trim();
      if (!url) return null;
      return label ? `${label}|${url}` : url;
    })
    .filter(Boolean);
}

// ─── Вкладки страницы ─────────────────────────────────────────────────────────

function initPageTabs() {
  const tabs   = document.querySelectorAll("[data-page-tab]");
  const panels = document.querySelectorAll("[data-page-panel]");

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-page-tab");
      tabs.forEach((b) => b.classList.toggle("is-active", b === btn));
      panels.forEach((p) => { p.hidden = p.getAttribute("data-page-panel") !== target; });
    });
  });

  // Обработчики базы данных и шаблонов — вешаем один раз здесь
  document.getElementById("checkBtn")?.addEventListener("click", () => checkState());
  document.getElementById("seedBtn")?.addEventListener("click", () => seedDatabase(false));
  document.getElementById("resetBtn")?.addEventListener("click", () => {
    if (window.confirm("Удалить subject_catalog и task_templates и пересоздать?\n\nДанные учеников не затрагиваются.")) {
      seedDatabase(true);
    }
  });
  document.getElementById("copyRulesBtn")?.addEventListener("click", () => {
    // Копируем правила как чистый текст без HTML-энтити
    const raw = document.getElementById("rulesBlock")?.textContent || "";
    navigator.clipboard.writeText(raw).then(() => {
      const btn = document.getElementById("copyRulesBtn");
      const orig = btn.textContent;
      btn.textContent = "Скопировано ✓";
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => alert("Не удалось скопировать — выдели текст вручную."));
  });
  document.getElementById("loadTemplatesBtn")?.addEventListener("click", () => loadTemplates());
}

// ─── Яндекс Диск синхронизация ───────────────────────────────────────────────

function initYadiskSync() {
  const workerUrl   = (window.FIREBASE_CONFIG?.yadiskWorkerUrl || "").trim();
  const rootFolder  = (window.FIREBASE_CONFIG?.yadiskRootFolder || "/Ученики").trim();
  const btn = document.getElementById("yadiskSyncBtn");
  const label = document.getElementById("yadiskRootLabel");
  if (label) label.textContent = rootFolder;

  if (!btn) return;

  if (!workerUrl) {
    btn.disabled = true;
    btn.title = "Укажи yadiskWorkerUrl в firebase.config.js";
    return;
  }

  btn.addEventListener("click", () => syncYadisk(workerUrl, rootFolder));
}

function yadiskLog(msg, cls) {
  const el = document.getElementById("yadiskLog");
  if (!el) return;
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = msg + "\n";
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function yadiskLogClear() {
  const el = document.getElementById("yadiskLog");
  if (el) el.innerHTML = "";
}

async function yadiskRequest(workerUrl, path) {
  const url = workerUrl.replace(/\/$/, "") + "/v1/disk/resources?path=" + encodeURIComponent(path) + "&limit=100";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Яндекс API вернул ${r.status}`);
  return r.json();
}

async function yadiskPublish(workerUrl, path) {
  const url = workerUrl.replace(/\/$/, "") + "/v1/disk/resources/publish?path=" + encodeURIComponent(path);
  const r = await fetch(url, { method: "PUT" });
  if (!r.ok && r.status !== 409) throw new Error(`publish ${r.status}`);
  // Получаем public_url
  const meta = await yadiskRequest(workerUrl, path);
  return meta.public_url || null;
}

async function syncYadisk(workerUrl, rootFolder) {
  yadiskLogClear();
  const btn = document.getElementById("yadiskSyncBtn");
  if (btn) btn.disabled = true;

  try {
    yadiskLog(`📂 Сканирую ${rootFolder}…`, "log-inf");

    // Список студентов на диске
    const rootData = await yadiskRequest(workerUrl, `disk:${rootFolder}`);
    const studentFolders = (rootData._embedded?.items || []).filter((i) => i.type === "dir");

    if (!studentFolders.length) {
      yadiskLog("⚠️  Папка пуста или не найдена", "log-err");
      return;
    }

    // Загружаем всех учеников из Firestore
    const usersSnap = await window.db.collection("users").get();
    const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    let totalAttached = 0;

    for (const studentFolder of studentFolders) {
      const studentName = studentFolder.name;
      yadiskLog(`\n👤 ${studentName}`, "log-inf");

      // Ищем совпадение по имени (регистронезависимо)
      const user = users.find(
        (u) => (u.name || "").trim().toLowerCase() === studentName.trim().toLowerCase()
      );
      if (!user) {
        yadiskLog(`  ⚠️  Ученик «${studentName}» не найден в базе — пропускаю`, "log-err");
        continue;
      }

      // Загружаем предметы ученика
      const subjectsSnap = await window.db.collection("users").doc(user.id).collection("subjects").get();
      const subjects = subjectsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Папки предметов
      const subjectDirsData = await yadiskRequest(workerUrl, `disk:${rootFolder}/${studentName}`);
      const subjectFolders = (subjectDirsData._embedded?.items || []).filter((i) => i.type === "dir");

      for (const subjectFolder of subjectFolders) {
        const subjectName = subjectFolder.name;

        // Ищем совпадение по названию предмета
        const subject = subjects.find(
          (s) => (s.title || "").trim().toLowerCase() === subjectName.trim().toLowerCase()
        );
        if (!subject) {
          yadiskLog(`  ⚠️  Предмет «${subjectName}» не найден — пропускаю`, "log-dim");
          continue;
        }

        // Файлы в папке предмета
        const filesData = await yadiskRequest(workerUrl, `disk:${rootFolder}/${studentName}/${subjectName}`);
        const files = (filesData._embedded?.items || []).filter((i) => i.type === "file");

        // Загружаем задания
        const tasksSnap = await window.db
          .collection("users").doc(user.id)
          .collection("subjects").doc(subject.id)
          .collection("tasks").get();
        const tasks = tasksSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        for (const file of files) {
          // Извлекаем номер задания из имени файла (напр. "Задание 3.pdf" → 3)
          const match = file.name.match(/задание\s*(\d+)/i);
          if (!match) {
            yadiskLog(`    ⏭  ${file.name} — номер задания не распознан`, "log-dim");
            continue;
          }
          const taskNum = Number(match[1]);
          const task = tasks.find((t) => Number(t.order_index) === taskNum);
          if (!task) {
            yadiskLog(`    ⚠️  Задание ${taskNum} не найдено у ${studentName}`, "log-dim");
            continue;
          }

          // Делаем файл публичным
          const filePath = `disk:${rootFolder}/${studentName}/${subjectName}/${file.name}`;
          const publicUrl = await yadiskPublish(workerUrl, filePath);
          if (!publicUrl) {
            yadiskLog(`    ⚠️  Нет публичной ссылки для ${file.name}`, "log-err");
            continue;
          }

          // Обновляем attachments задания
          const existingDetails = task.details || {};
          const existingAtt     = Array.isArray(existingDetails.attachments) ? existingDetails.attachments : [];
          const label = file.name.replace(/\.[^.]+$/, ""); // без расширения
          const entry = `${label}|${publicUrl}`;

          if (!existingAtt.includes(entry)) {
            const newAtt = [...existingAtt.filter((a) => !String(a).includes(publicUrl)), entry];
            await window.db
              .collection("users").doc(user.id)
              .collection("subjects").doc(subject.id)
              .collection("tasks").doc(task.id)
              .update({ "details.attachments": newAtt });
            yadiskLog(`    ✓ ${file.name} → Задание ${taskNum}`, "log-ok");
            totalAttached++;
          } else {
            yadiskLog(`    ⏭  ${file.name} — уже прикреплено`, "log-dim");
          }
        }
      }
    }

    yadiskLog(`\n✅ Готово! Прикреплено файлов: ${totalAttached}`, "log-ok");
    if (totalAttached > 0) {
      await loadUsers(true, false);
      if (state.selectedUserId) await loadUserSubjects(state.selectedUserId);
      renderEditPanel();
    }
  } catch (err) {
    yadiskLog("❌ Ошибка: " + err.message, "log-err");
    console.error(err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Каталог предметов ────────────────────────────────────────────────────────

const SUBJECT_CATALOG = [
  {
    slug: "oge_math", title: "ОГЭ Математика", emoji: "📐", sort_order: 1,
    default_tasks_total: 25, default_duration_minutes: 235,
    default_exam_date: "2026-06-02", default_exam_time: "10:00",
    default_tips: [
      "Сделай 1 задание на время, затем разбор по конспекту.",
      "Веди журнал ошибок: тема → ошибка → правильный ход.",
    ],
  },
  {
    slug: "oge_info", title: "ОГЭ Информатика", emoji: "💻", sort_order: 2,
    default_tasks_total: 27, default_duration_minutes: 235,
    default_exam_date: "2026-06-15", default_exam_time: "10:00",
    default_tips: [
      "Чередуй теорию и практику по таймеру.",
      "Делай шаблоны кода под типовые задачи.",
    ],
  },
  {
    slug: "ege_math", title: "ЕГЭ Математика", emoji: "📐", sort_order: 3,
    default_tasks_total: 19, default_duration_minutes: 235,
    default_exam_date: "2026-05-31", default_exam_time: "10:00",
    default_tips: [
      "Один блок за раз: первично точность, потом скорость.",
      "Фиксируй типовые промахи по профилю.",
    ],
  },
  {
    slug: "ege_info", title: "ЕГЭ Информатика", emoji: "💻", sort_order: 4,
    default_tasks_total: 27, default_duration_minutes: 235,
    default_exam_date: "2026-06-10", default_exam_time: "10:00",
    default_tips: [
      "Разбор ограничений и краевых случаев обязателен.",
      "Тренируй ввод/вывод и устойчивость к мусору во вводе.",
    ],
  },
];

// ─── Лог (вкладка «База данных») ─────────────────────────────────────────────

function dbLog(msg, cls) {
  const el = document.getElementById("setupLog");
  if (!el) return;
  const line = document.createElement("span");
  if (cls) line.className = cls;
  line.textContent = msg + "\n";
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function dbLogClear() {
  const el = document.getElementById("setupLog");
  if (el) el.innerHTML = "";
}

// ─── Проверка состояния ───────────────────────────────────────────────────────

async function checkState() {
  dbLogClear();
  dbLog("🔍 Проверяю состояние Firestore...", "log-inf");
  try {
    const catSnap  = await window.db.collection("subject_catalog").orderBy("sort_order").get();
    const tmplSnap = await window.db.collection("task_templates").get();
    const usersSnap = await window.db.collection("users").get();

    dbLog(`📚 subject_catalog: ${catSnap.size} документов`,  catSnap.size  > 0 ? "log-ok" : "log-inf");
    dbLog(`📝 task_templates: ${tmplSnap.size} документов`,  tmplSnap.size > 0 ? "log-ok" : "log-inf");
    dbLog(`👤 users: ${usersSnap.size} документов`, "log-dim");

    if (catSnap.size > 0) {
      dbLog("", "");
      dbLog("Предметы в каталоге:", "log-inf");
      catSnap.docs.forEach((d) => {
        const c = d.data();
        dbLog(`  ${c.emoji} ${c.title} (${c.default_tasks_total} заданий)`, "log-ok");
      });
    }

    dbLog("", "");
    if (catSnap.size === 0) {
      dbLog("⚠️  База пустая — нажми «Заполнить базу»", "log-err");
    } else if (tmplSnap.size > 0) {
      dbLog("✅ Всё готово", "log-ok");
    } else {
      dbLog("⚠️  Каталог есть, но шаблонов нет — нажми «Заполнить базу»", "log-err");
    }
  } catch (err) {
    dbLog("❌ Ошибка: " + err.message, "log-err");
    dbLog("  • Убедись, что Firestore Rules обновлены", "log-inf");
  }
}

// ─── Заполнение базы ──────────────────────────────────────────────────────────

async function seedDatabase(forceReset) {
  dbLogClear();
  if (forceReset) {
    dbLog("⚠️  Сброс — удаляю старые данные...", "log-err");
    await clearDbCollection("subject_catalog");
    await clearDbCollection("task_templates");
    dbLog("✓ Старые данные удалены", "log-ok");
    dbLog("", "");
  }

  dbLog("📚 Создаю subject_catalog...", "log-inf");
  const existingCat = await window.db.collection("subject_catalog").get();
  const existingSlugs   = {};
  const catalogIdBySlug = {};
  existingCat.docs.forEach((d) => {
    existingSlugs[d.data().slug]   = true;
    catalogIdBySlug[d.data().slug] = d.id;
  });

  for (const cat of SUBJECT_CATALOG) {
    if (existingSlugs[cat.slug]) {
      dbLog(`  ⏭  ${cat.emoji} ${cat.title} — уже есть, пропускаю`, "log-dim");
      continue;
    }
    const ref = await window.db.collection("subject_catalog").add(cat);
    catalogIdBySlug[cat.slug] = ref.id;
    dbLog(`  ✓ Создан: ${cat.emoji} ${cat.title}`, "log-ok");
  }

  dbLog("", "");
  dbLog("📝 Создаю task_templates...", "log-inf");
  const existingTmpl      = await window.db.collection("task_templates").get();
  const existingByCatalog = {};
  existingTmpl.docs.forEach((d) => { existingByCatalog[d.data().catalog_id] = true; });

  for (const c of SUBJECT_CATALOG) {
    const catalogId = catalogIdBySlug[c.slug];
    if (!catalogId) { dbLog(`  ⚠️  Нет ID для ${c.slug}`, "log-err"); continue; }
    if (existingByCatalog[catalogId]) {
      const cnt = existingTmpl.docs.filter((d) => d.data().catalog_id === catalogId).length;
      dbLog(`  ⏭  ${c.emoji} ${c.title} — уже есть ${cnt} шаблонов`, "log-dim");
      continue;
    }
    const batch = window.db.batch();
    const now   = new Date().toISOString();
    for (let n = 1; n <= c.default_tasks_total; n++) {
      const ref = window.db.collection("task_templates").doc();
      batch.set(ref, {
        catalog_id: catalogId, order_index: n,
        title: `Задание ${n}`, description: "",
        default_details: { lessonNotes: "", homework: [], hints: [], attachments: [] },
        created_at: now,
      });
    }
    await batch.commit();
    dbLog(`  ✓ ${c.emoji} ${c.title}: создано ${c.default_tasks_total} шаблонов`, "log-ok");
  }

  dbLog("", "");
  const finalCat  = await window.db.collection("subject_catalog").get();
  const finalTmpl = await window.db.collection("task_templates").get();
  dbLog(`✅ Готово! subject_catalog: ${finalCat.size} | task_templates: ${finalTmpl.size}`, "log-ok");
}

async function clearDbCollection(name) {
  const snap = await window.db.collection(name).get();
  if (snap.empty) return;
  const batch = window.db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  dbLog(`  ✓ ${name} очищена (${snap.size} документов)`, "log-ok");
}

// ─── Редактор шаблонов ────────────────────────────────────────────────────────

let tmplCatalog = [];
let tmplData    = [];
let activeTmplSubject = null;

async function loadTemplates() {
  const editorEl = document.getElementById("templatesEditor");
  if (!editorEl) return;
  editorEl.innerHTML = '<p class="muted" style="padding:0 18px">Загружаю…</p>';
  try {
    const catSnap = await window.db.collection("subject_catalog").orderBy("sort_order").get();
    tmplCatalog   = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const tmplSnap = await window.db.collection("task_templates").get();
    tmplData = tmplSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (!tmplCatalog.length) {
      editorEl.innerHTML = '<p class="muted" style="padding:0 18px;color:var(--red)">Каталог пуст — сначала заполни базу на вкладке «База данных».</p>';
      return;
    }
    activeTmplSubject = tmplCatalog[0].id;
    renderTmplEditor();
  } catch (err) {
    editorEl.innerHTML = `<p class="muted" style="padding:0 18px;color:var(--red)">Ошибка загрузки: ${escapeHtml(err.message)}</p>`;
  }
}

function renderTmplEditor() {
  const editorEl = document.getElementById("templatesEditor");
  if (!editorEl) return;

  const tabs = tmplCatalog.map((c) =>
    `<button class="chip ${c.id === activeTmplSubject ? "is-active" : ""}" type="button" data-tmpl-cat="${escapeAttr(c.id)}">${escapeHtml(c.emoji || "📘")} ${escapeHtml(c.title)}</button>`
  ).join("");

  const blocks = tmplCatalog.map((c) => {
    const isActive  = c.id === activeTmplSubject;
    const templates = tmplData.filter((t) => t.catalog_id === c.id);
    const rows = templates.length
      ? templates.map(renderTmplRow).join("")
      : `<p class="muted" style="padding:0 18px">Шаблонов нет — заполни базу.</p>`;
    return `<div data-tmpl-block="${escapeAttr(c.id)}" style="display:${isActive ? "grid" : "none"};gap:8px;">${rows}</div>`;
  }).join("");

  editorEl.innerHTML = `<div class="tasks-subject-tabs" style="padding:0 18px 10px;">${tabs}</div>${blocks}`;

  editorEl.querySelectorAll("[data-tmpl-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTmplSubject = btn.getAttribute("data-tmpl-cat");
      editorEl.querySelectorAll("[data-tmpl-cat]").forEach((b) => b.classList.toggle("is-active", b === btn));
      editorEl.querySelectorAll("[data-tmpl-block]").forEach((block) => {
        block.style.display = block.getAttribute("data-tmpl-block") === activeTmplSubject ? "grid" : "none";
      });
    });
  });

  editorEl.querySelectorAll("[data-save-tmpl]").forEach((btn) => {
    btn.addEventListener("click", () => saveTmplRow(btn.closest("[data-tmpl-id]")));
  });
}

function renderTmplRow(t) {
  const details  = (t.default_details && typeof t.default_details === "object") ? t.default_details : {};
  const homework = Array.isArray(details.homework) ? details.homework.join("\n") : "";
  const hints    = Array.isArray(details.hints)    ? details.hints.join("\n")    : "";

  return `
    <details class="task-row tmpl-row" data-tmpl-id="${escapeAttr(t.id)}" style="margin:0 18px;">
      <summary class="task-row__summary">
        <span>${escapeHtml(t.title || "Задание")}</span>
        <span class="muted" style="font-size:11px;">№${t.order_index || "?"}</span>
      </summary>
      <div class="task-row__body">
        <div class="task-row__grid">
          <label><span>Название</span><input data-f="title" value="${escapeAttr(t.title || "")}" /></label>
          <label><span>Описание</span><input data-f="description" value="${escapeAttr(t.description || "")}" /></label>
        </div>
        <label><span>Конспект (lessonNotes)</span><textarea data-f="lessonNotes" rows="3">${escapeHtml(details.lessonNotes || "")}</textarea></label>
        <label><span>Домашка (1 строка = 1 пункт)</span><textarea data-f="homework" rows="3">${escapeHtml(homework)}</textarea></label>
        <label><span>Подсказки (1 строка = 1 пункт)</span><textarea data-f="hints" rows="3">${escapeHtml(hints)}</textarea></label>
        <div class="task-actions">
          <button class="icon-btn" type="button" data-save-tmpl="${escapeAttr(t.id)}">Сохранить шаблон</button>
          <span class="tmpl-save-status" data-save-status="${escapeAttr(t.id)}"></span>
        </div>
      </div>
    </details>`;
}

async function saveTmplRow(row) {
  if (!row) return;
  const id = row.getAttribute("data-tmpl-id");
  if (!id) return;
  const statusEl = document.querySelector(`[data-save-status="${id}"]`);

  const payload = {
    title:       (row.querySelector('[data-f="title"]')?.value       || "").trim() || "Задание",
    description: (row.querySelector('[data-f="description"]')?.value || "").trim(),
    default_details: {
      lessonNotes:  (row.querySelector('[data-f="lessonNotes"]')?.value || "").trim(),
      homework:     splitLines(row.querySelector('[data-f="homework"]')?.value),
      hints:        splitLines(row.querySelector('[data-f="hints"]')?.value),
      attachments:  [],
    },
  };

  if (statusEl) { statusEl.textContent = "Сохраняю…"; statusEl.className = "tmpl-save-status"; }
  try {
    await window.db.collection("task_templates").doc(id).update(payload);
    if (statusEl) { statusEl.textContent = "✓ Сохранено"; statusEl.className = "tmpl-save-status ok"; }
    const t = tmplData.find((x) => x.id === id);
    if (t) Object.assign(t, payload);
  } catch (err) {
    if (statusEl) { statusEl.textContent = "Ошибка: " + err.message; statusEl.className = "tmpl-save-status err"; }
  }
}
