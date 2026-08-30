(function () {
  "use strict";

  const STORAGE_KEY = "sales-schedule-app.events.v1";
  const CATEGORY_STORAGE_KEY = "sales-schedule-app.categories.v1";

  const DEFAULT_CATEGORIES = [
    { name: "商談", color: "#2563eb" },
    { name: "訪問", color: "#16a34a" },
    { name: "電話", color: "#d97706" },
    { name: "会議", color: "#7c3aed" },
    { name: "社内作業", color: "#6b7280" },
    { name: "その他", color: "#db2777" },
  ];
  const FALLBACK_COLOR = "#94a3b8";

  const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

  /** @type {Array<Object>} */
  let events = loadEvents();

  /** @type {Array<{name: string, color: string}>} */
  let categories = loadCategories();

  let state = {
    view: "month", // 'month' | 'week'
    cursor: startOfDay(new Date()), // reference date for current period
    activeCategories: new Set(), // empty = show all; non-empty = show only these
    dayModalDate: null, // Date currently shown in day modal
  };

  // ---------- Persistence ----------

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (e) {
      console.error("イベントの読み込みに失敗しました", e);
      return [];
    }
  }

  function saveEvents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }

  function loadCategories() {
    try {
      const raw = localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (!raw) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      return parsed;
    } catch (e) {
      console.error("種別の読み込みに失敗しました", e);
      return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
  }

  function saveCategories() {
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
  }

  function getCategoryColor(name) {
    const found = categories.find((c) => c.name === name);
    return found ? found.color : FALLBACK_COLOR;
  }

  function uid() {
    return "ev_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Date helpers ----------

  function startOfDay(d) {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd;
  }

  function toDateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function addDays(d, n) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
  }

  function addMonths(d, n) {
    const nd = new Date(d);
    nd.setDate(1);
    nd.setMonth(nd.getMonth() + n);
    return nd;
  }

  function startOfWeek(d) {
    const nd = startOfDay(d);
    const dow = nd.getDay(); // 0 = Sunday
    return addDays(nd, -dow);
  }

  function startOfMonth(d) {
    const nd = new Date(d.getFullYear(), d.getMonth(), 1);
    return nd;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  // ---------- DOM references ----------

  const mainArea = document.getElementById("mainArea");
  const periodLabel = document.getElementById("periodLabel");

  const btnPrev = document.getElementById("btnPrev");
  const btnNext = document.getElementById("btnNext");
  const btnToday = document.getElementById("btnToday");
  const btnMonthView = document.getElementById("btnMonthView");
  const btnWeekView = document.getElementById("btnWeekView");
  const btnNewEvent = document.getElementById("btnNewEvent");
  const btnMenu = document.getElementById("btnMenu");
  const menuDropdown = document.getElementById("menuDropdown");
  const btnManageCategories = document.getElementById("btnManageCategories");
  const btnExport = document.getElementById("btnExport");
  const btnImport = document.getElementById("btnImport");
  const importFile = document.getElementById("importFile");
  const categoryChips = document.getElementById("categoryChips");

  const categoryModal = document.getElementById("categoryModal");
  const categoryList = document.getElementById("categoryList");
  const newCategoryName = document.getElementById("newCategoryName");
  const newCategoryColor = document.getElementById("newCategoryColor");
  const btnAddCategory = document.getElementById("btnAddCategory");
  const btnAddCategoryInline = document.getElementById("btnAddCategoryInline");

  const dayModal = document.getElementById("dayModal");
  const dayModalTitle = document.getElementById("dayModalTitle");
  const dayModalList = document.getElementById("dayModalList");
  const btnAddInDay = document.getElementById("btnAddInDay");

  const eventModal = document.getElementById("eventModal");
  const eventModalTitle = document.getElementById("eventModalTitle");
  const eventForm = document.getElementById("eventForm");
  const eventIdInput = document.getElementById("eventId");
  const eventDateInput = document.getElementById("eventDate");
  const eventStartInput = document.getElementById("eventStart");
  const eventEndInput = document.getElementById("eventEnd");
  const eventCategoryInput = document.getElementById("eventCategory");
  const eventTitleInput = document.getElementById("eventTitle");
  const eventCustomerInput = document.getElementById("eventCustomer");
  const eventPlaceInput = document.getElementById("eventPlace");
  const eventNotesInput = document.getElementById("eventNotes");
  const btnDeleteEvent = document.getElementById("btnDeleteEvent");

  // ---------- Rendering ----------

  function render() {
    renderPeriodLabel();
    if (state.view === "month") {
      renderMonthView();
    } else {
      renderWeekView();
    }
  }

  function renderPeriodLabel() {
    if (state.view === "month") {
      periodLabel.textContent = `${state.cursor.getFullYear()}年 ${state.cursor.getMonth() + 1}月`;
    } else {
      const ws = startOfWeek(state.cursor);
      const we = addDays(ws, 6);
      if (ws.getMonth() === we.getMonth()) {
        periodLabel.textContent = `${ws.getFullYear()}年 ${ws.getMonth() + 1}月 ${ws.getDate()}〜${we.getDate()}日`;
      } else {
        periodLabel.textContent = `${ws.getMonth() + 1}/${ws.getDate()} 〜 ${we.getMonth() + 1}/${we.getDate()}`;
      }
    }
  }

  function matchesFilters(ev) {
    if (state.activeCategories.size > 0 && !state.activeCategories.has(ev.category)) return false;
    return true;
  }

  function getEventsForDate(dateKey) {
    return events
      .filter((ev) => ev.date === dateKey && matchesFilters(ev))
      .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  }

  function renderMonthView() {
    const monthStart = startOfMonth(state.cursor);
    const gridStart = startOfWeek(monthStart);
    const today = startOfDay(new Date());

    let html = `<div class="weekday-header">`;
    WEEKDAY_LABELS.forEach((label, i) => {
      const cls = i === 0 ? "sun" : i === 6 ? "sat" : "";
      html += `<div class="${cls}">${label}</div>`;
    });
    html += `</div><div class="month-grid">`;

    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const dateKey = toDateKey(d);
      const inMonth = d.getMonth() === monthStart.getMonth();
      const isToday = isSameDay(d, today);
      const dow = d.getDay();
      const dayNumCls = dow === 0 ? "sun" : dow === 6 ? "sat" : "";

      const dayEvents = getEventsForDate(dateKey);
      const maxShow = 3;
      let eventsHtml = "";
      dayEvents.slice(0, maxShow).forEach((ev) => {
        const timeLabel = ev.start ? ev.start + " " : "";
        eventsHtml += `<div class="event-pill" style="background-color:${getCategoryColor(ev.category)}">${timeLabel}${escapeHtml(ev.title)}</div>`;
      });
      if (dayEvents.length > maxShow) {
        eventsHtml += `<div class="more-label">他 ${dayEvents.length - maxShow} 件</div>`;
      }

      html += `
        <div class="day-cell ${inMonth ? "" : "other-month"} ${isToday ? "today" : ""}" data-date="${dateKey}">
          <div class="day-number ${dayNumCls}">${d.getDate()}</div>
          <div class="day-events">${eventsHtml}</div>
        </div>`;
    }
    html += `</div>`;

    mainArea.innerHTML = html;

    mainArea.querySelectorAll(".day-cell").forEach((cell) => {
      cell.addEventListener("click", () => openDayModal(new Date(cell.dataset.date + "T00:00:00")));
    });
  }

  function renderWeekView() {
    const ws = startOfWeek(state.cursor);
    const today = startOfDay(new Date());

    let html = `<div class="week-grid">`;
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      const dateKey = toDateKey(d);
      const isToday = isSameDay(d, today);
      const dow = d.getDay();

      const dayEvents = getEventsForDate(dateKey);
      let eventsHtml = "";
      if (dayEvents.length === 0) {
        eventsHtml = `<div class="empty-hint">予定なし</div>`;
      } else {
        dayEvents.forEach((ev) => {
          const timeRange = ev.start ? `${ev.start}${ev.end ? " - " + ev.end : ""}` : "終日";
          const noteSnippet = ev.notes ? escapeHtml(ev.notes) : "";
          eventsHtml += `
            <div class="week-event-card" style="border-left-color:${getCategoryColor(ev.category)}" data-id="${ev.id}">
              <div class="wt">${timeRange} ・ ${escapeHtml(ev.category)}</div>
              <div class="wtitle">${escapeHtml(ev.title)}</div>
              ${ev.customer ? `<div class="wcust">${escapeHtml(ev.customer)}</div>` : ""}
              ${ev.place ? `<div class="wplace">${escapeHtml(ev.place)}</div>` : ""}
              ${noteSnippet ? `<div class="wnote">${noteSnippet}</div>` : ""}
            </div>`;
        });
      }

      html += `
        <div class="week-day-col ${isToday ? "today" : ""}" data-date="${dateKey}">
          <div class="week-day-header">
            <div class="dow">${WEEKDAY_LABELS[dow]}</div>
            <div class="dnum">${d.getDate()}</div>
          </div>
          <div class="week-day-body">${eventsHtml}</div>
          <button class="week-add-btn" data-date="${dateKey}">＋ 追加</button>
        </div>`;
    }
    html += `</div>`;

    mainArea.innerHTML = html;

    mainArea.querySelectorAll(".week-event-card").forEach((card) => {
      card.addEventListener("click", () => openEventModal(events.find((e) => e.id === card.dataset.id)));
    });
    mainArea.querySelectorAll(".week-add-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openEventModal(null, btn.dataset.date);
      });
    });
  }

  // ---------- Day modal ----------

  function openDayModal(date) {
    state.dayModalDate = date;
    const dateKey = toDateKey(date);
    dayModalTitle.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_LABELS[date.getDay()]}）の予定`;

    const dayEvents = getEventsForDate(dateKey);
    if (dayEvents.length === 0) {
      dayModalList.innerHTML = `<div class="empty-hint">この日の予定はまだありません</div>`;
    } else {
      dayModalList.innerHTML = dayEvents
        .map((ev) => {
          const timeRange = ev.start ? `${ev.start}${ev.end ? " - " + ev.end : ""}` : "終日";
          return `
          <div class="day-event-item" style="border-left-color:${getCategoryColor(ev.category)}" data-id="${ev.id}">
            <div class="dtime">${timeRange} ・ ${escapeHtml(ev.category)}</div>
            <div class="dtitle">${escapeHtml(ev.title)}</div>
            ${ev.customer ? `<div class="dcust">${escapeHtml(ev.customer)}</div>` : ""}
            ${ev.notes ? `<div class="dnote">${escapeHtml(truncate(ev.notes, 160))}</div>` : ""}
          </div>`;
        })
        .join("");

      dayModalList.querySelectorAll(".day-event-item").forEach((item) => {
        item.addEventListener("click", () => {
          openEventModal(events.find((e) => e.id === item.dataset.id));
        });
      });
    }

    dayModal.classList.remove("hidden");
  }

  btnAddInDay.addEventListener("click", () => {
    const dateKey = state.dayModalDate ? toDateKey(state.dayModalDate) : toDateKey(new Date());
    closeModal(dayModal);
    openEventModal(null, dateKey);
  });

  // ---------- Event modal ----------

  function openEventModal(ev, presetDateKey) {
    eventForm.reset();
    if (ev) {
      eventModalTitle.textContent = "予定を編集";
      eventIdInput.value = ev.id;
      eventDateInput.value = ev.date;
      eventStartInput.value = ev.start || "";
      eventEndInput.value = ev.end || "";
      renderCategorySelectOptions(ev.category);
      eventTitleInput.value = ev.title;
      eventCustomerInput.value = ev.customer || "";
      eventPlaceInput.value = ev.place || "";
      eventNotesInput.value = ev.notes || "";
      btnDeleteEvent.classList.remove("hidden");
    } else {
      eventModalTitle.textContent = "予定を追加";
      eventIdInput.value = "";
      eventDateInput.value = presetDateKey || toDateKey(new Date());
      renderCategorySelectOptions(categories[0] ? categories[0].name : undefined);
      btnDeleteEvent.classList.add("hidden");
    }
    eventModal.classList.remove("hidden");
    eventTitleInput.focus();
  }

  eventForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const id = eventIdInput.value;
    const data = {
      date: eventDateInput.value,
      start: eventStartInput.value,
      end: eventEndInput.value,
      category: eventCategoryInput.value,
      title: eventTitleInput.value.trim(),
      customer: eventCustomerInput.value.trim(),
      place: eventPlaceInput.value.trim(),
      notes: eventNotesInput.value,
    };

    if (!data.title || !data.date) return;

    if (id) {
      const idx = events.findIndex((ev) => ev.id === id);
      if (idx !== -1) events[idx] = { ...events[idx], ...data };
    } else {
      events.push({ id: uid(), createdAt: Date.now(), ...data });
    }

    saveEvents();
    closeModal(eventModal);
    render();
    refreshOpenDayModalIfNeeded();
  });

  btnDeleteEvent.addEventListener("click", () => {
    const id = eventIdInput.value;
    if (!id) return;
    if (!confirm("この予定を削除しますか？メモの内容も削除されます。")) return;
    events = events.filter((ev) => ev.id !== id);
    saveEvents();
    closeModal(eventModal);
    render();
    refreshOpenDayModalIfNeeded();
  });

  function refreshOpenDayModalIfNeeded() {
    if (!dayModal.classList.contains("hidden") && state.dayModalDate) {
      openDayModal(state.dayModalDate);
    }
  }

  // ---------- Modal close handling ----------

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(document.getElementById(btn.dataset.close)));
  });

  [dayModal, eventModal, categoryModal].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      [dayModal, eventModal, categoryModal].forEach((overlay) => {
        if (!overlay.classList.contains("hidden")) closeModal(overlay);
      });
    }
  });

  function closeModal(overlay) {
    overlay.classList.add("hidden");
  }

  // ---------- Navigation ----------

  function playNavAnimation(direction) {
    mainArea.classList.remove("anim-next", "anim-prev");
    void mainArea.offsetWidth; // force reflow so the animation restarts every time
    mainArea.classList.add(direction === "next" ? "anim-next" : "anim-prev");
  }

  function navigate(direction) {
    if (direction === "prev") {
      state.cursor = state.view === "month" ? addMonths(state.cursor, -1) : addDays(state.cursor, -7);
    } else {
      state.cursor = state.view === "month" ? addMonths(state.cursor, 1) : addDays(state.cursor, 7);
    }
    render();
    playNavAnimation(direction);
  }

  btnPrev.addEventListener("click", () => navigate("prev"));
  btnNext.addEventListener("click", () => navigate("next"));

  btnToday.addEventListener("click", () => {
    state.cursor = startOfDay(new Date());
    render();
  });

  function setView(view) {
    state.view = view;
    btnMonthView.classList.toggle("active", view === "month");
    btnWeekView.classList.toggle("active", view === "week");
    render();
  }

  btnMonthView.addEventListener("click", () => setView("month"));
  btnWeekView.addEventListener("click", () => setView("week"));

  btnNewEvent.addEventListener("click", () => openEventModal(null, toDateKey(state.cursor)));

  // ---------- Swipe navigation (month/week) ----------
  // In week view, the day columns scroll horizontally on their own, so a swipe
  // only changes the period once that inner scroll is already at its edge.

  (function setupSwipeNav() {
    const SWIPE_MIN_DIST = 50;
    const SWIPE_MAX_TIME = 600;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let startScrollLeft = 0;
    let startScrollMax = 0;

    mainArea.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startTime = Date.now();
        const grid = mainArea.querySelector(".week-grid");
        if (grid) {
          startScrollLeft = grid.scrollLeft;
          startScrollMax = grid.scrollWidth - grid.clientWidth;
        } else {
          startScrollLeft = 0;
          startScrollMax = 0;
        }
      },
      { passive: true }
    );

    mainArea.addEventListener(
      "touchend",
      (e) => {
        const t = e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        const dt = Date.now() - startTime;
        if (dt > SWIPE_MAX_TIME) return;
        if (Math.abs(dx) < SWIPE_MIN_DIST) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.5) return;

        if (state.view === "week") {
          if (dx < 0 && startScrollLeft < startScrollMax - 2) return; // more days to scroll to before switching week
          if (dx > 0 && startScrollLeft > 2) return;
        }

        if (dx < 0) {
          navigate("next");
        } else {
          navigate("prev");
        }
      },
      { passive: true }
    );
  })();

  // ---------- Filters (category chips) ----------

  function renderCategoryChips() {
    categoryChips.innerHTML = categories
      .map((c) => {
        const checked = state.activeCategories.has(c.name) ? "checked" : "";
        return `
          <label class="chip" data-cat="${escapeHtml(c.name)}">
            <input type="checkbox" value="${escapeHtml(c.name)}" ${checked}>
            <span class="dot" style="background-color:${c.color}"></span>${escapeHtml(c.name)}
          </label>`;
      })
      .join("");

    categoryChips.querySelectorAll(".chip input").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.checked) {
          state.activeCategories.add(cb.value);
        } else {
          state.activeCategories.delete(cb.value);
        }
        render();
      });
    });
  }

  // ---------- Menu / Export / Import ----------

  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menuDropdown.classList.add("hidden"));

  btnExport.addEventListener("click", () => {
    const payload = { events, categories };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = toDateKey(new Date());
    a.href = url;
    a.download = `sales-schedule-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  btnImport.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", () => {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const importedEvents = Array.isArray(parsed) ? parsed : parsed.events;
        const importedCategories = Array.isArray(parsed) ? null : parsed.categories;
        if (!Array.isArray(importedEvents)) throw new Error("形式が不正です");
        if (!confirm(`${importedEvents.length}件の予定を読み込みます。現在のデータはこの内容で置き換わります。よろしいですか？`)) return;
        events = importedEvents;
        saveEvents();
        if (Array.isArray(importedCategories) && importedCategories.length > 0) {
          categories = importedCategories;
          saveCategories();
        }
        state.activeCategories = new Set();
        renderCategoryChips();
        renderCategorySelectOptions();
        render();
      } catch (err) {
        alert("ファイルの読み込みに失敗しました。JSON形式のバックアップファイルを選択してください。");
      } finally {
        importFile.value = "";
      }
    };
    reader.readAsText(file);
  });

  // ---------- Category management ----------

  function renderCategorySelectOptions(selectedName) {
    const current = selectedName || eventCategoryInput.value;
    eventCategoryInput.innerHTML = categories
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
      .join("");
    if (current && categories.some((c) => c.name === current)) {
      eventCategoryInput.value = current;
    }
  }

  let editingCategoryName = null;

  function renderCategoryListRows() {
    categoryList.innerHTML = categories
      .map((c) => {
        const count = events.filter((ev) => ev.category === c.name).length;
        if (editingCategoryName === c.name) {
          return `
            <div class="category-row editing" data-name="${escapeHtml(c.name)}">
              <input type="color" class="edit-color" value="${c.color}">
              <input type="text" class="edit-name" value="${escapeHtml(c.name)}">
              <button type="button" class="cat-save" title="保存">✓</button>
              <button type="button" class="cat-cancel" title="キャンセル">×</button>
            </div>`;
        }
        return `
          <div class="category-row" data-name="${escapeHtml(c.name)}">
            <span class="cat-handle" title="長押しでドラッグして並び替え">⠿</span>
            <span class="dot" style="background-color:${c.color}"></span>
            <span class="cat-name">${escapeHtml(c.name)}</span>
            <span class="cat-count">${count}件</span>
            <button type="button" class="cat-edit" title="編集">✎</button>
            <button type="button" class="cat-delete" title="削除">×</button>
          </div>`;
      })
      .join("");

    categoryList.querySelectorAll(".cat-handle").forEach((handle) => {
      attachCategoryDragHandle(handle);
    });

    categoryList.querySelectorAll(".cat-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingCategoryName = btn.closest(".category-row").dataset.name;
        renderCategoryListRows();
        const row = categoryList.querySelector(".category-row.editing");
        if (row) row.querySelector(".edit-name").focus();
      });
    });

    categoryList.querySelectorAll(".cat-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.closest(".category-row").dataset.name;
        deleteCategory(name);
      });
    });

    categoryList.querySelectorAll(".cat-save").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".category-row");
        saveCategoryEdit(row.dataset.name, row.querySelector(".edit-name").value, row.querySelector(".edit-color").value);
      });
    });

    categoryList.querySelectorAll(".cat-cancel").forEach((btn) => {
      btn.addEventListener("click", () => {
        editingCategoryName = null;
        renderCategoryListRows();
      });
    });

    categoryList.querySelectorAll(".edit-name").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.closest(".category-row").querySelector(".cat-save").click();
        } else if (e.key === "Escape") {
          e.preventDefault();
          editingCategoryName = null;
          renderCategoryListRows();
        }
      });
    });
  }

  function saveCategoryEdit(originalName, rawNewName, newColor) {
    const newName = (rawNewName || "").trim();
    if (!newName) {
      alert("種別名を入力してください。");
      return;
    }
    if (newName !== originalName && categories.some((c) => c.name === newName)) {
      alert("同じ名前の種別が既に存在します。");
      return;
    }
    const cat = categories.find((c) => c.name === originalName);
    if (!cat) return;

    const nameChanged = newName !== originalName;
    cat.name = newName;
    cat.color = newColor || cat.color;

    if (nameChanged) {
      events.forEach((ev) => {
        if (ev.category === originalName) ev.category = newName;
      });
      saveEvents();
      if (state.activeCategories.has(originalName)) {
        state.activeCategories.delete(originalName);
        state.activeCategories.add(newName);
      }
    }

    saveCategories();
    editingCategoryName = null;
    renderCategoryListRows();
    renderCategoryChips();
    renderCategorySelectOptions();
    render();
    refreshOpenDayModalIfNeeded();
  }

  function attachCategoryDragHandle(handle) {
    const LONG_PRESS_MS = 350;
    const MOVE_CANCEL_PX = 10;

    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const row = handle.closest(".category-row");
      if (!row || row.classList.contains("editing")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let placeholder = null;
      let grabOffsetY = 0;
      let longPressTimer = null;

      function onMove(ev) {
        if (!dragging) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) cleanup();
          return;
        }
        ev.preventDefault();
        const y = ev.clientY;
        row.style.top = y - grabOffsetY + "px";

        const under = document.elementFromPoint(ev.clientX, y);
        const targetRow = under ? under.closest(".category-row") : null;
        if (
          targetRow &&
          targetRow !== row &&
          targetRow !== placeholder &&
          categoryList.contains(targetRow) &&
          !targetRow.classList.contains("editing")
        ) {
          const rect = targetRow.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;
          if (y < midpoint) {
            categoryList.insertBefore(placeholder, targetRow);
          } else {
            categoryList.insertBefore(placeholder, targetRow.nextSibling);
          }
        }
      }

      function onUp() {
        cleanup();
        if (!dragging) return;
        const orderedNames = Array.from(categoryList.children)
          .map((el) => el.dataset.name)
          .filter(Boolean);
        row.remove();
        if (placeholder && placeholder.parentNode) placeholder.remove();
        const reordered = orderedNames.map((name) => categories.find((c) => c.name === name)).filter(Boolean);
        if (reordered.length === categories.length) {
          categories = reordered;
          saveCategories();
        }
        renderCategoryListRows();
        renderCategoryChips();
        renderCategorySelectOptions();
      }

      function cleanup() {
        clearTimeout(longPressTimer);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        if (dragging) {
          row.classList.remove("dragging");
          row.style.position = "";
          row.style.top = "";
          row.style.left = "";
          row.style.width = "";
          row.style.zIndex = "";
          row.style.pointerEvents = "";
        }
      }

      longPressTimer = setTimeout(() => {
        dragging = true;
        const rect = row.getBoundingClientRect();
        grabOffsetY = startY - rect.top;

        placeholder = document.createElement("div");
        placeholder.className = "category-row category-row-placeholder";
        placeholder.dataset.name = row.dataset.name;
        placeholder.style.height = rect.height + "px";
        row.after(placeholder);

        row.classList.add("dragging");
        row.style.position = "fixed";
        row.style.top = rect.top + "px";
        row.style.left = rect.left + "px";
        row.style.width = rect.width + "px";
        row.style.zIndex = "500";
        row.style.pointerEvents = "none";
        document.body.appendChild(row);

        if (navigator.vibrate) navigator.vibrate(15);
      }, LONG_PRESS_MS);

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    });
  }

  function addCategoryAndSelect(rawName, color) {
    const name = (rawName || "").trim();
    if (!name) {
      alert("種別名を入力してください。");
      return false;
    }
    if (categories.some((c) => c.name === name)) {
      alert("同じ名前の種別が既に存在します。");
      return false;
    }
    categories.push({ name, color: color || FALLBACK_COLOR });
    saveCategories();
    renderCategoryChips();
    renderCategorySelectOptions(name);
    render();
    return true;
  }

  function deleteCategory(name) {
    const count = events.filter((ev) => ev.category === name).length;
    if (count > 0) {
      alert(`「${name}」は${count}件の予定で使用されているため削除できません。先に該当の予定の種別を変更してください。`);
      return;
    }
    if (categories.length <= 1) {
      alert("種別は最低1つ必要です。");
      return;
    }
    if (!confirm(`種別「${name}」を削除しますか？`)) return;
    categories = categories.filter((c) => c.name !== name);
    state.activeCategories.delete(name);
    saveCategories();
    renderCategoryListRows();
    renderCategoryChips();
    renderCategorySelectOptions();
    render();
  }

  btnManageCategories.addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    editingCategoryName = null;
    renderCategoryListRows();
    newCategoryName.value = "";
    categoryModal.classList.remove("hidden");
  });

  btnAddCategory.addEventListener("click", () => {
    if (addCategoryAndSelect(newCategoryName.value, newCategoryColor.value)) {
      newCategoryName.value = "";
      renderCategoryListRows();
      newCategoryName.focus();
    }
  });

  newCategoryName.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnAddCategory.click();
    }
  });

  btnAddCategoryInline.addEventListener("click", () => {
    editingCategoryName = null;
    renderCategoryListRows();
    newCategoryName.value = "";
    categoryModal.classList.remove("hidden");
    newCategoryName.focus();
  });

  // ---------- Utils ----------

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function truncate(str, n) {
    if (str.length <= n) return str;
    return str.slice(0, n) + "…";
  }

  // ---------- Init ----------

  renderCategoryChips();
  renderCategorySelectOptions();
  render();
})();
