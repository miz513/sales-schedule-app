(function () {
  "use strict";

  const STORAGE_KEY = "sales-schedule-app.events.v1";
  const CATEGORY_STORAGE_KEY = "sales-schedule-app.categories.v1";
  const MEMO_STORAGE_KEY = "sales-schedule-app.memos.v1";

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

  /** @type {Array<{id: string, title: string, color: string, items: Array<{id: string, text: string, checked: boolean}>, createdAt: number}>} */
  let memos = loadMemos();

  let state = {
    view: "month", // 'month' | 'week'
    cursor: startOfDay(new Date()), // reference date for current period
    activeCategories: new Set(), // empty = show all; non-empty = show only these
    dayModalDate: null, // Date currently shown in day modal
    selectedDateKey: null, // last day cell the user tapped, highlighted distinctly from "today"
  };

  // ---------- Persistence ----------

  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(migrateEvent);
    } catch (e) {
      console.error("イベントの読み込みに失敗しました", e);
      return [];
    }
  }

  // Older saved events used a single "date" + "start"/"end" time pair.
  // Convert them to the startDate/endDate range format.
  function migrateEvent(ev) {
    if (ev.startDate) return ev;
    const { date, start, end, ...rest } = ev;
    return { ...rest, startDate: date, endDate: date, startTime: start || "", endTime: end || "" };
  }

  function saveEvents() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    notifyDataChanged();
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
    notifyDataChanged();
  }

  function loadMemos() {
    try {
      const raw = localStorage.getItem(MEMO_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("メモの読み込みに失敗しました", e);
      return [];
    }
  }

  function saveMemos() {
    localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(memos));
    notifyDataChanged();
  }

  // ---------- Cloud sync hook ----------
  // A tiny public surface so firebase-sync.js can read/replace all local data
  // and get notified when it changes, without needing to know this module's internals.

  const changeListeners = [];
  function notifyDataChanged() {
    changeListeners.forEach((cb) => cb());
  }

  function setData(data) {
    events = Array.isArray(data.events) ? data.events.map(migrateEvent) : [];
    categories =
      Array.isArray(data.categories) && data.categories.length
        ? data.categories
        : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    memos = Array.isArray(data.memos) ? data.memos : [];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(categories));
    localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(memos));
    state.activeCategories = new Set();
    renderCategoryChips();
    renderCategorySelectOptions();
    render();
    refreshOpenDayModalIfNeeded();
    renderMemoList();
  }

  window.ScheduleApp = {
    getData: () => ({ events, categories, memos }),
    setData,
    onChange: (cb) => changeListeners.push(cb),
  };

  function getCategoryColor(name) {
    const found = categories.find((c) => c.name === name);
    return found ? found.color : FALLBACK_COLOR;
  }

  function uid(prefix) {
    return (prefix || "ev") + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
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

  function addDaysToDateKey(dateKey, n) {
    return toDateKey(addDays(new Date(dateKey + "T00:00:00"), n));
  }

  function daysBetweenDateKeys(a, b) {
    const da = new Date(a + "T00:00:00");
    const db = new Date(b + "T00:00:00");
    return Math.round((db - da) / 86400000);
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
  const btnToday = document.getElementById("btnToday");
  const yearMonthModal = document.getElementById("yearMonthModal");
  const btnYearPrev = document.getElementById("btnYearPrev");
  const btnYearNext = document.getElementById("btnYearNext");
  const yearMonthYearLabel = document.getElementById("yearMonthYearLabel");
  const monthPickerGrid = document.getElementById("monthPickerGrid");
  const undoToast = document.getElementById("undoToast");
  const undoToastText = document.getElementById("undoToastText");
  const btnUndo = document.getElementById("btnUndo");

  const btnMonthView = document.getElementById("btnMonthView");
  const btnWeekView = document.getElementById("btnWeekView");
  const btnNewEvent = document.getElementById("btnNewEvent");
  const btnMenu = document.getElementById("btnMenu");
  const menuDropdown = document.getElementById("menuDropdown");
  const btnManageCategories = document.getElementById("btnManageCategories");
  const categoryChips = document.getElementById("categoryChips");
  const btnMonthlySummary = document.getElementById("btnMonthlySummary");
  const summaryModal = document.getElementById("summaryModal");
  const summaryModalTitle = document.getElementById("summaryModalTitle");
  const summaryModalBody = document.getElementById("summaryModalBody");

  const categoryModal = document.getElementById("categoryModal");
  const categoryModalBox = categoryModal.querySelector(".modal");
  const categoryList = document.getElementById("categoryList");
  const newCategoryName = document.getElementById("newCategoryName");
  const newCategoryColor = document.getElementById("newCategoryColor");
  const btnAddCategory = document.getElementById("btnAddCategory");
  const btnAddCategoryInline = document.getElementById("btnAddCategoryInline");

  const btnMemo = document.getElementById("btnMemo");
  const memoModal = document.getElementById("memoModal");
  const memoModalBody = memoModal.querySelector(".modal-body");
  const memoList = document.getElementById("memoList");
  const btnAddMemo = document.getElementById("btnAddMemo");
  const memoEditModal = document.getElementById("memoEditModal");
  const memoEditModalBody = memoEditModal.querySelector(".modal-body");
  const memoEditModalTitle = document.getElementById("memoEditModalTitle");
  const memoIdInput = document.getElementById("memoId");
  const memoTitleInput = document.getElementById("memoTitleInput");
  const memoColorInput = document.getElementById("memoColorInput");
  const memoTypeRadios = document.querySelectorAll('input[name="memoType"]');
  const memoTextSection = document.getElementById("memoTextSection");
  const memoContentInput = document.getElementById("memoContentInput");
  const memoChecklistSection = document.getElementById("memoChecklistSection");
  const memoItemsList = document.getElementById("memoItemsList");
  const btnAddMemoItem = document.getElementById("btnAddMemoItem");
  const btnDeleteMemo = document.getElementById("btnDeleteMemo");
  const btnSaveMemo = document.getElementById("btnSaveMemo");
  const btnNotifyMemoNow = document.getElementById("btnNotifyMemoNow");

  const dayModal = document.getElementById("dayModal");
  const dayModalTitle = document.getElementById("dayModalTitle");
  const dayModalList = document.getElementById("dayModalList");
  const btnAddInDay = document.getElementById("btnAddInDay");

  const eventModal = document.getElementById("eventModal");
  const eventModalBody = eventModal.querySelector(".modal-body");
  const eventModalTitle = document.getElementById("eventModalTitle");
  const eventForm = document.getElementById("eventForm");
  const eventIdInput = document.getElementById("eventId");
  const eventStartDateInput = document.getElementById("eventStartDate");
  const eventStartTimeInput = document.getElementById("eventStartTime");
  const eventEndDateInput = document.getElementById("eventEndDate");
  const eventEndTimeInput = document.getElementById("eventEndTime");
  const eventAllDayInput = document.getElementById("eventAllDay");
  const startTimeField = document.getElementById("startTimeField");
  const endTimeField = document.getElementById("endTimeField");
  const repeatRow = document.getElementById("repeatRow");
  const eventRepeatWeeklyInput = document.getElementById("eventRepeatWeekly");
  const repeatDaysRow = document.getElementById("repeatDaysRow");
  const repeatWeekdayPicker = document.getElementById("repeatWeekdayPicker");
  const repeatUntilRow = document.getElementById("repeatUntilRow");
  const eventRepeatUntilInput = document.getElementById("eventRepeatUntil");
  const eventCategoryInput = document.getElementById("eventCategory");
  const titleSuggestions = document.getElementById("titleSuggestions");
  const eventTitleInput = document.getElementById("eventTitle");
  const eventNotesInput = document.getElementById("eventNotes");
  const btnDeleteEvent = document.getElementById("btnDeleteEvent");
  const btnDuplicateEvent = document.getElementById("btnDuplicateEvent");

  // ---------- Rendering ----------

  function render() {
    renderPeriodLabel();
    mainArea.classList.toggle("view-month", state.view === "month");
    mainArea.classList.toggle("view-week", state.view === "week");
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
      .filter((ev) => ev.startDate <= dateKey && dateKey <= ev.endDate && matchesFilters(ev))
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
  }

  function formatShortDate(dateKey) {
    const [, m, d] = dateKey.split("-");
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  }

  // Judges by date first, then by time only when both sides fall on the same day.
  function isEndBeforeStart(startDate, startTime, endDate, endTime) {
    if (endDate < startDate) return true;
    if (endDate === startDate && startTime && endTime && endTime < startTime) return true;
    return false;
  }

  // Full-detail time label (day modal, week cards): describes how the event
  // relates to this specific date when it spans multiple days.
  function eventTimeLabel(ev, dateKey) {
    const singleDay = ev.startDate === ev.endDate;
    if (singleDay) {
      return ev.startTime ? ev.startTime + (ev.endTime ? " - " + ev.endTime : "") : "終日";
    }
    const range = `${formatShortDate(ev.startDate)}〜${formatShortDate(ev.endDate)}`;
    if (dateKey === ev.startDate && ev.startTime) {
      return `${range} ${ev.startTime}開始`;
    }
    if (dateKey === ev.endDate && ev.endTime) {
      return `${range} ${ev.endTime}終了`;
    }
    return `${range} 終日`;
  }

  // Compact decoration for tiny month-view pills: a leading/trailing marker
  // showing whether this day is the start, end, or a middle day of a multi-day event.
  function monthPillDecoration(ev, dateKey) {
    // isTime marks the prefix as a clock time (as opposed to a continuation
    // arrow) so narrow screens can hide it and give the title the full pill
    // width, since a title is more useful than an exact time at a glance.
    if (ev.startDate === ev.endDate) {
      return { prefix: ev.startTime ? ev.startTime + " " : "", suffix: "", isTime: true };
    }
    if (dateKey === ev.startDate) return { prefix: "▶ ", suffix: "", isTime: false };
    if (dateKey === ev.endDate) return { prefix: "◀ ", suffix: "", isTime: false };
    return { prefix: "─ ", suffix: " ─", isTime: false };
  }

  const MAX_BANNER_LANES = 2;

  // Multi-day events get a continuous banner spanning the days they cover in
  // each week-row (like a project bar), instead of a separate pill per day.
  // Greedily assigns each into the first free lane per row so concurrent
  // spans stack without overlapping; anything beyond MAX_BANNER_LANES falls
  // back to the old per-day pill with ▶/─/◀ continuation markers.
  function computeMonthBanners(dateKeys) {
    const rowBanners = [];
    const shownIdsByDate = {};
    const colLaneCounts = []; // colLaneCounts[i] = lanes reserved for that specific day cell only
    for (let r = 0; r < 6; r++) {
      const rowStartKey = dateKeys[r * 7];
      const rowEndKey = dateKeys[r * 7 + 6];
      const overlapping = events
        .filter(
          (ev) =>
            ev.startDate !== ev.endDate &&
            matchesFilters(ev) &&
            ev.startDate <= rowEndKey &&
            ev.endDate >= rowStartKey
        )
        .sort((a, b) => (a.startDate + (a.startTime || "")).localeCompare(b.startDate + (b.startTime || "")));

      const laneEnd = [];
      const rowResult = [];
      overlapping.forEach((ev) => {
        const startCol = Math.max(0, daysBetweenDateKeys(rowStartKey, ev.startDate));
        const endCol = Math.min(6, daysBetweenDateKeys(rowStartKey, ev.endDate));
        let lane = -1;
        for (let l = 0; l < MAX_BANNER_LANES; l++) {
          if (laneEnd[l] === undefined || laneEnd[l] < startCol) {
            lane = l;
            break;
          }
        }
        if (lane === -1) return; // too many concurrent spans; falls back to a normal pill
        laneEnd[lane] = endCol;
        rowResult.push({ ev, lane, startCol, endCol });
        for (let c = startCol; c <= endCol; c++) {
          const dk = dateKeys[r * 7 + c];
          (shownIdsByDate[dk] || (shownIdsByDate[dk] = new Set())).add(ev.id);
          const idx = r * 7 + c;
          colLaneCounts[idx] = Math.max(colLaneCounts[idx] || 0, lane + 1);
        }
      });
      rowBanners.push(rowResult);
    }
    return { rowBanners, shownIdsByDate, colLaneCounts };
  }

  function renderMonthView() {
    const monthStart = startOfMonth(state.cursor);
    const gridStart = startOfWeek(monthStart);
    const today = startOfDay(new Date());

    const dateKeys = [];
    for (let i = 0; i < 42; i++) dateKeys.push(toDateKey(addDays(gridStart, i)));
    const { rowBanners, shownIdsByDate, colLaneCounts } = computeMonthBanners(dateKeys);

    let html = `<div class="weekday-header">`;
    WEEKDAY_LABELS.forEach((label, i) => {
      const cls = i === 0 ? "sun" : i === 6 ? "sat" : "";
      html += `<div class="${cls}">${label}</div>`;
    });
    html += `</div><div class="month-grid">`;

    for (let i = 0; i < 42; i++) {
      const row = Math.floor(i / 7);
      const col = i % 7;
      const d = addDays(gridStart, i);
      const dateKey = dateKeys[i];
      const inMonth = d.getMonth() === monthStart.getMonth();
      const isToday = isSameDay(d, today);
      const isSelected = dateKey === state.selectedDateKey;
      const dow = d.getDay();
      const dayNumCls = dow === 0 ? "sun" : dow === 6 ? "sat" : "";

      const shownIds = shownIdsByDate[dateKey];
      const dayEvents = getEventsForDate(dateKey).filter((ev) => !shownIds || !shownIds.has(ev.id));
      const maxShow = 3;
      let eventsHtml = "";
      dayEvents.slice(0, maxShow).forEach((ev) => {
        const { prefix, suffix, isTime } = monthPillDecoration(ev, dateKey);
        const prefixHtml = isTime && prefix ? `<span class="pill-time">${prefix}</span>` : prefix;
        eventsHtml += `<div class="event-pill" style="background-color:${getCategoryColor(ev.category)}">${prefixHtml}${escapeHtml(ev.title)}${suffix}</div>`;
      });
      if (dayEvents.length > maxShow) {
        eventsHtml += `<div class="more-label">他 ${dayEvents.length - maxShow} 件</div>`;
      }

      const cellLanes = colLaneCounts[i] || 0;
      const spacerHtml = cellLanes > 0 ? `<div class="banner-spacer" style="--lanes:${cellLanes}"></div>` : "";

      html += `
        <div class="day-cell ${inMonth ? "" : "other-month"} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" style="grid-row:${row + 1};grid-column:${col + 1}" data-date="${dateKey}">
          <div class="day-number ${dayNumCls}">${d.getDate()}</div>
          ${spacerHtml}
          <div class="day-events">${eventsHtml}</div>
        </div>`;
    }

    rowBanners.forEach((rowResult, r) => {
      rowResult.forEach(({ ev, lane, startCol, endCol }) => {
        const isRowStart = dateKeys[r * 7 + startCol] === ev.startDate;
        const isRowEnd = dateKeys[r * 7 + endCol] === ev.endDate;
        const prefix = isRowStart ? "" : "◀ ";
        const suffix = isRowEnd ? "" : " ▶";
        html += `
        <div class="month-banner" style="grid-row:${r + 1};grid-column:${startCol + 1} / ${endCol + 2};--lane:${lane};background-color:${getCategoryColor(ev.category)}" data-date="${dateKeys[r * 7 + startCol]}">${prefix}${escapeHtml(ev.title)}${suffix}</div>`;
      });
    });

    html += `</div>`;

    mainArea.innerHTML = html;

    mainArea.querySelectorAll(".day-cell").forEach((cell) => {
      cell.addEventListener("click", () => openDayModal(new Date(cell.dataset.date + "T00:00:00")));
    });
    mainArea.querySelectorAll(".month-banner").forEach((banner) => {
      banner.addEventListener("click", () => openDayModal(new Date(banner.dataset.date + "T00:00:00")));
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
          const timeRange = eventTimeLabel(ev, dateKey);
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

    if (state.selectedDateKey !== dateKey) {
      state.selectedDateKey = dateKey;
      state.cursor = date; // so switching to week view shows the week containing the selected day
      if (state.view === "month") renderMonthView();
    }

    dayModalTitle.textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAY_LABELS[date.getDay()]}）の予定`;

    const dayEvents = getEventsForDate(dateKey);
    if (dayEvents.length === 0) {
      dayModalList.innerHTML = `<div class="empty-hint">この日の予定はまだありません</div>`;
    } else {
      dayModalList.innerHTML = dayEvents
        .map((ev) => {
          const timeRange = eventTimeLabel(ev, dateKey);
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
    dayModalList.scrollTop = 0;
  }

  btnAddInDay.addEventListener("click", () => {
    const dateKey = state.dayModalDate ? toDateKey(state.dayModalDate) : toDateKey(new Date());
    closeModal(dayModal);
    openEventModal(null, dateKey);
  });

  // ---------- Event modal ----------

  function syncAllDayUI() {
    const isAllDay = eventAllDayInput.checked;
    eventStartTimeInput.disabled = isAllDay;
    eventEndTimeInput.disabled = isAllDay;
    startTimeField.classList.toggle("hidden", isAllDay);
    endTimeField.classList.toggle("hidden", isAllDay);
    if (isAllDay) {
      eventStartTimeInput.value = "";
      eventEndTimeInput.value = "";
    }
  }

  eventAllDayInput.addEventListener("change", syncAllDayUI);

  // Keep the end date from falling before the start date; single-day events
  // (the common case) just move together as the user picks a start date.
  eventStartDateInput.addEventListener("change", () => {
    if (!eventEndDateInput.value || eventEndDateInput.value < eventStartDateInput.value) {
      eventEndDateInput.value = eventStartDateInput.value;
    }
  });

  function openEventModal(ev, presetDateKey) {
    eventForm.reset();
    if (ev) {
      eventModalTitle.textContent = "予定を編集";
      eventIdInput.value = ev.id;
      eventStartDateInput.value = ev.startDate;
      eventEndDateInput.value = ev.endDate;
      eventStartTimeInput.value = ev.startTime || "";
      eventEndTimeInput.value = ev.endTime || "";
      eventAllDayInput.checked = !ev.startTime && !ev.endTime;
      renderCategorySelectOptions(ev.category);
      eventTitleInput.value = ev.title;
      eventNotesInput.value = ev.notes || "";
      btnDeleteEvent.classList.remove("hidden");
      btnDuplicateEvent.classList.remove("hidden");
      // Editing only ever touches this single occurrence, so the repeat
      // setup (only meaningful when first creating a series) is hidden.
      repeatRow.classList.add("hidden");
      repeatDaysRow.classList.add("hidden");
      repeatUntilRow.classList.add("hidden");
    } else {
      eventModalTitle.textContent = "予定を追加";
      eventIdInput.value = "";
      const dateKey = presetDateKey || toDateKey(new Date());
      eventStartDateInput.value = dateKey;
      eventEndDateInput.value = dateKey;
      eventAllDayInput.checked = false;
      renderCategorySelectOptions(categories[0] ? categories[0].name : undefined);
      btnDeleteEvent.classList.add("hidden");
      btnDuplicateEvent.classList.add("hidden");
      repeatRow.classList.remove("hidden");
      eventRepeatWeeklyInput.checked = false;
      repeatDaysRow.classList.add("hidden");
      repeatUntilRow.classList.add("hidden");
      eventRepeatUntilInput.value = "";
    }
    syncAllDayUI();
    eventModal.classList.remove("hidden");
    eventModalBody.scrollTop = 0;
  }

  eventRepeatWeeklyInput.addEventListener("change", () => {
    const on = eventRepeatWeeklyInput.checked;
    repeatDaysRow.classList.toggle("hidden", !on);
    repeatUntilRow.classList.toggle("hidden", !on);
    if (on) {
      // Default to the weekday of the chosen start date; the user can add more.
      const startDow = new Date(eventStartDateInput.value + "T00:00:00").getDay();
      repeatWeekdayPicker.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = Number(cb.value) === startDow;
      });
    }
  });

  eventForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const id = eventIdInput.value;
    const isAllDay = eventAllDayInput.checked;
    const startDate = eventStartDateInput.value;
    const endDate = eventEndDateInput.value;
    const startTime = isAllDay ? "" : eventStartTimeInput.value;
    const endTime = isAllDay ? "" : eventEndTimeInput.value;

    if (isEndBeforeStart(startDate, startTime, endDate, endTime)) {
      alert("終了日時が開始日時より前になっています。日付・時刻を確認してください。");
      return;
    }

    const data = {
      startDate,
      endDate,
      startTime,
      endTime,
      category: eventCategoryInput.value,
      title: eventTitleInput.value.trim(),
      notes: eventNotesInput.value,
    };

    if (!data.title || !data.startDate || !data.endDate) return;

    if (id) {
      const idx = events.findIndex((ev) => ev.id === id);
      if (idx !== -1) events[idx] = { ...events[idx], ...data };
    } else if (eventRepeatWeeklyInput.checked) {
      const until = eventRepeatUntilInput.value;
      if (!until || until < data.startDate) {
        alert("繰り返しの終了日を、開始日以降の日付で指定してください。");
        return;
      }
      const selectedWeekdays = Array.from(repeatWeekdayPicker.querySelectorAll("input:checked")).map((cb) =>
        Number(cb.value)
      );
      if (selectedWeekdays.length === 0) {
        alert("繰り返す曜日を1つ以上選択してください。");
        return;
      }
      const MAX_OCCURRENCES = 104; // about 2 years of weekly occurrences at one day/week
      const spanDays = daysBetweenDateKeys(data.startDate, data.endDate);
      const occurrenceDates = [];
      let cursor = data.startDate;
      while (cursor <= until && occurrenceDates.length <= MAX_OCCURRENCES) {
        const dow = new Date(cursor + "T00:00:00").getDay();
        if (selectedWeekdays.includes(dow)) occurrenceDates.push(cursor);
        cursor = addDaysToDateKey(cursor, 1);
      }
      if (occurrenceDates.length > MAX_OCCURRENCES) {
        alert(`繰り返しの回数が多すぎます(最大${MAX_OCCURRENCES}回)。終了日を早めるか、曜日を減らしてください。`);
        return;
      }
      const seriesId = uid();
      occurrenceDates.forEach((occStart) => {
        const occEnd = addDaysToDateKey(occStart, spanDays);
        events.push({ id: uid(), createdAt: Date.now(), seriesId, ...data, startDate: occStart, endDate: occEnd });
      });
    } else {
      events.push({ id: uid(), createdAt: Date.now(), ...data });
    }

    saveEvents();
    closeModal(eventModal);
    render();
    refreshOpenDayModalIfNeeded();
  });

  let undoTimer = null;

  function showUndoToast(message, deletedEvents) {
    clearTimeout(undoTimer);
    undoToastText.textContent = message;
    undoToast.classList.remove("hidden");
    btnUndo.onclick = () => {
      events.push(...deletedEvents);
      saveEvents();
      render();
      refreshOpenDayModalIfNeeded();
      hideUndoToast();
    };
    undoTimer = setTimeout(hideUndoToast, 6000);
  }

  function hideUndoToast() {
    clearTimeout(undoTimer);
    undoToast.classList.add("hidden");
  }

  btnDeleteEvent.addEventListener("click", () => {
    const id = eventIdInput.value;
    if (!id) return;
    const ev = events.find((e) => e.id === id);
    if (!ev) return;

    let deletedEvents;
    if (ev.seriesId) {
      const deleteFuture = confirm(
        "この予定は毎週繰り返す予定の一部です。\n\nOK: この回以降のすべての回を削除\nキャンセル: この回だけ削除"
      );
      deletedEvents = deleteFuture
        ? events.filter((e) => e.seriesId === ev.seriesId && e.startDate >= ev.startDate)
        : events.filter((e) => e.id === id);
    } else {
      deletedEvents = events.filter((e) => e.id === id);
    }

    const deletedIds = new Set(deletedEvents.map((e) => e.id));
    events = events.filter((e) => !deletedIds.has(e.id));

    saveEvents();
    closeModal(eventModal);
    render();
    refreshOpenDayModalIfNeeded();
    showUndoToast(
      deletedEvents.length > 1 ? `${deletedEvents.length}件の予定を削除しました` : "予定を削除しました",
      deletedEvents
    );
  });

  btnDuplicateEvent.addEventListener("click", () => {
    const id = eventIdInput.value;
    const ev = events.find((e) => e.id === id);
    if (!ev) return;

    // Re-open as a fresh "add" form (so repeat options, delete/duplicate
    // buttons, etc. reset correctly) pre-filled with this event's details.
    openEventModal(null, ev.startDate);
    eventModalTitle.textContent = "予定を複製";
    eventEndDateInput.value = ev.endDate;
    eventStartTimeInput.value = ev.startTime || "";
    eventEndTimeInput.value = ev.endTime || "";
    eventAllDayInput.checked = !ev.startTime && !ev.endTime;
    syncAllDayUI();
    renderCategorySelectOptions(ev.category);
    eventTitleInput.value = ev.title;
    eventNotesInput.value = ev.notes || "";
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

  [dayModal, eventModal, categoryModal, summaryModal, yearMonthModal, memoModal, memoEditModal].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      [dayModal, eventModal, categoryModal, summaryModal, yearMonthModal, memoModal, memoEditModal].forEach((overlay) => {
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

  btnToday.addEventListener("click", () => {
    state.cursor = startOfDay(new Date());
    render();
    playNavAnimation("next");
  });

  // ---------- Year/month picker ----------

  let pickerYear = state.cursor.getFullYear();

  function renderMonthPicker() {
    yearMonthYearLabel.textContent = `${pickerYear}年`;
    monthPickerGrid.innerHTML = "";
    for (let m = 0; m < 12; m++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${m + 1}月`;
      if (pickerYear === state.cursor.getFullYear() && m === state.cursor.getMonth()) {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        state.cursor = new Date(pickerYear, m, 1);
        closeModal(yearMonthModal);
        render();
        playNavAnimation("next");
      });
      monthPickerGrid.appendChild(btn);
    }
  }

  periodLabel.addEventListener("click", () => {
    pickerYear = state.cursor.getFullYear();
    renderMonthPicker();
    yearMonthModal.classList.remove("hidden");
  });

  btnYearPrev.addEventListener("click", () => {
    pickerYear -= 1;
    renderMonthPicker();
  });
  btnYearNext.addEventListener("click", () => {
    pickerYear += 1;
    renderMonthPicker();
  });

  function setView(view) {
    state.view = view;
    if (view === "week") {
      // Jump to the selected day's week, or today's week if nothing is selected,
      // rather than wherever month-browsing happened to leave the cursor.
      state.cursor = state.selectedDateKey ? new Date(state.selectedDateKey + "T00:00:00") : startOfDay(new Date());
    }
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

  // ---------- Menu ----------

  btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menuDropdown.classList.add("hidden"));

  // ---------- Monthly summary ----------

  function renderMonthlySummary() {
    const y = state.cursor.getFullYear();
    const m = state.cursor.getMonth();
    const startKey = toDateKey(new Date(y, m, 1));
    const endKey = toDateKey(new Date(y, m + 1, 0));

    summaryModalTitle.textContent = `${y}年${m + 1}月の集計`;

    const counts = {};
    let total = 0;
    events.forEach((ev) => {
      if (ev.startDate >= startKey && ev.startDate <= endKey) {
        counts[ev.category] = (counts[ev.category] || 0) + 1;
        total++;
      }
    });

    if (total === 0) {
      summaryModalBody.innerHTML = `<div class="summary-empty">この月の予定はまだありません</div>`;
      return;
    }

    const rows = categories
      .map((c) => ({ name: c.name, color: c.color, count: counts[c.name] || 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count);

    summaryModalBody.innerHTML =
      `<div class="summary-total"><strong>${total}</strong>件の予定</div>` +
      rows
        .map(
          (r) => `
          <div class="summary-row">
            <div class="summary-row-header">
              <span class="dot" style="background-color:${r.color}"></span>
              <span class="cat-name">${escapeHtml(r.name)}</span>
              <span class="cat-count">${r.count}件</span>
            </div>
            <div class="summary-bar-track">
              <div class="summary-bar-fill" style="width:${(r.count / total) * 100}%; background-color:${r.color}"></div>
            </div>
          </div>`
        )
        .join("");
  }

  btnMonthlySummary.addEventListener("click", () => {
    menuDropdown.classList.add("hidden");
    renderMonthlySummary();
    summaryModal.classList.remove("hidden");
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
    renderTitleSuggestions();
  }

  // Most-recently-used titles (with their time) for a category, one entry per
  // distinct title, so picking a category can suggest past entries to reuse.
  function getRecentEventsForCategory(category) {
    const seen = new Set();
    const results = [];
    events
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .forEach((ev) => {
        if (ev.category !== category || !ev.title || seen.has(ev.title)) return;
        seen.add(ev.title);
        results.push(ev);
      });
    return results.slice(0, 5);
  }

  function renderTitleSuggestions() {
    const suggestions = getRecentEventsForCategory(eventCategoryInput.value);
    if (suggestions.length === 0) {
      titleSuggestions.classList.add("hidden");
      titleSuggestions.innerHTML = "";
      return;
    }
    titleSuggestions.classList.remove("hidden");
    titleSuggestions.innerHTML =
      `<div class="suggestion-label">過去の入力候補</div>` +
      suggestions
        .map((ev) => {
          const timeLabel = ev.startTime ? `${ev.startTime}${ev.endTime ? " - " + ev.endTime : ""}` : "終日";
          return `
            <button type="button" class="suggestion-chip" data-id="${ev.id}">
              <span class="suggestion-title">${escapeHtml(ev.title)}</span>
              <span class="suggestion-time">${timeLabel}</span>
            </button>`;
        })
        .join("");

    titleSuggestions.querySelectorAll(".suggestion-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const ev = events.find((e) => e.id === btn.dataset.id);
        if (!ev) return;
        eventTitleInput.value = ev.title;
        eventAllDayInput.checked = !ev.startTime;
        eventStartTimeInput.value = ev.startTime || "";
        eventEndTimeInput.value = ev.endTime || "";
        syncAllDayUI();
      });
    });
  }

  eventCategoryInput.addEventListener("change", renderTitleSuggestions);

  let editingCategoryName = null;

  function renderCategoryListRows() {
    categoryList.innerHTML = categories
      .map((c) => {
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
            <button type="button" class="cat-edit" title="編集">✎</button>
            <button type="button" class="cat-delete" title="削除">×</button>
          </div>`;
      })
      .join("");

    categoryList.querySelectorAll(".category-row:not(.editing)").forEach((row) => {
      attachCategoryDragHandle(row);
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
      let scrolling = false;
      let lastY = startY;
      let placeholder = null;
      let grabOffsetY = 0;
      let longPressTimer = null;

      function onMove(ev) {
        if (scrolling) {
          // touch-action is disabled on the row so drags are never fought by native
          // scrolling; once we know this gesture is a scroll, drive it manually instead.
          categoryList.scrollTop -= ev.clientY - lastY;
          lastY = ev.clientY;
          return;
        }
        if (!dragging) {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
            scrolling = true;
            clearTimeout(longPressTimer);
            lastY = ev.clientY;
          }
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
    categoryList.scrollTop = 0;
    categoryModalBox.scrollTop = 0;
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
    categoryList.scrollTop = 0;
    categoryModalBox.scrollTop = 0;
    newCategoryName.focus();
  });

  // ---------- Memo ----------

  let editingMemoItems = [];

  // Memos saved before the type toggle existed only ever stored items
  // (checklist-style), so a missing type falls back to "checklist" to keep
  // them displaying the same way they always have.
  function memoType(memo) {
    return memo.type || "checklist";
  }

  function renderMemoList() {
    if (memos.length === 0) {
      memoList.innerHTML = `<div class="empty-hint">まだメモがありません</div>`;
      return;
    }
    memoList.innerHTML = memos
      .map((memo) => {
        const bodyHtml =
          memoType(memo) === "text"
            ? `<div class="memo-card-content">${escapeHtml(memo.content || "")}</div>`
            : renderMemoChecklistBody(memo);
        return `
        <div class="memo-card" style="border-left-color:${memo.color || FALLBACK_COLOR}" data-id="${memo.id}">
          <div class="memo-card-title">${escapeHtml(memo.title)}</div>
          ${bodyHtml}
        </div>`;
      })
      .join("");
  }

  function renderMemoChecklistBody(memo) {
    const items = memo.items || [];
    const checkedCount = items.filter((it) => it.checked).length;
    const itemsHtml = items
      .map(
        (it) => `
      <div class="memo-card-item ${it.checked ? "checked" : ""}">
        <span class="memo-check" data-memo-id="${memo.id}" data-item-id="${it.id}">${it.checked ? "☑" : "☐"}</span>
        <span>${escapeHtml(it.text)}</span>
      </div>`
      )
      .join("");
    const progressHtml = items.length > 0 ? `<div class="memo-progress">${checkedCount}/${items.length} 完了</div>` : "";
    return `<div class="memo-card-items">${itemsHtml}</div>${progressHtml}`;
  }

  memoList.addEventListener("click", (e) => {
    const check = e.target.closest(".memo-check");
    if (check) {
      e.stopPropagation();
      const memo = memos.find((m) => m.id === check.dataset.memoId);
      const item = memo && (memo.items || []).find((it) => it.id === check.dataset.itemId);
      if (item) {
        item.checked = !item.checked;
        saveMemos();
        renderMemoList();
      }
      return;
    }
    const card = e.target.closest(".memo-card");
    if (card) {
      closeModal(memoModal);
      openMemoEdit(memos.find((m) => m.id === card.dataset.id));
    }
  });

  btnMemo.addEventListener("click", () => {
    renderMemoList();
    memoModal.classList.remove("hidden");
    memoModalBody.scrollTop = 0;
  });

  btnAddMemo.addEventListener("click", () => {
    closeModal(memoModal);
    openMemoEdit(null);
  });

  function syncMemoTypeSections() {
    const type = document.querySelector('input[name="memoType"]:checked').value;
    memoTextSection.classList.toggle("hidden", type !== "text");
    memoChecklistSection.classList.toggle("hidden", type !== "checklist");
  }

  memoTypeRadios.forEach((radio) =>
    radio.addEventListener("change", () => {
      syncMemoTypeSections();
      const type = document.querySelector('input[name="memoType"]:checked').value;
      if (type === "checklist" && editingMemoItems.length === 0) {
        editingMemoItems.push({ id: uid("mi"), text: "", checked: false });
        renderMemoItemRows();
      }
    })
  );

  function openMemoEdit(memo) {
    memoIdInput.value = memo ? memo.id : "";
    memoEditModalTitle.textContent = memo ? "メモを編集" : "メモを追加";
    memoTitleInput.value = memo ? memo.title : "";
    memoColorInput.value = memo ? memo.color || "#16a34a" : "#16a34a";
    memoContentInput.value = memo ? memo.content || "" : "";
    editingMemoItems = memo ? (memo.items || []).map((it) => ({ ...it })) : [];
    const type = memo ? memoType(memo) : "text";
    memoTypeRadios.forEach((radio) => (radio.checked = radio.value === type));
    syncMemoTypeSections();
    btnDeleteMemo.classList.toggle("hidden", !memo);
    renderMemoItemRows();
    memoEditModal.classList.remove("hidden");
    memoEditModalBody.scrollTop = 0;
    memoTitleInput.focus();
  }

  function renderMemoItemRows() {
    memoItemsList.innerHTML = editingMemoItems
      .map(
        (it) => `
      <div class="memo-item-row" data-id="${it.id}">
        <input type="checkbox" ${it.checked ? "checked" : ""}>
        <input type="text" value="${escapeHtml(it.text)}" placeholder="項目を入力">
        <button type="button" class="memo-item-delete" aria-label="項目を削除">×</button>
      </div>`
      )
      .join("");

    memoItemsList.querySelectorAll(".memo-item-row").forEach((row) => {
      const id = row.dataset.id;
      const item = editingMemoItems.find((it) => it.id === id);
      row.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
        item.checked = e.target.checked;
      });
      row.querySelector('input[type="text"]').addEventListener("input", (e) => {
        item.text = e.target.value;
      });
      row.querySelector(".memo-item-delete").addEventListener("click", () => {
        editingMemoItems = editingMemoItems.filter((it) => it.id !== id);
        renderMemoItemRows();
      });
    });
  }

  btnAddMemoItem.addEventListener("click", () => {
    editingMemoItems.push({ id: uid("mi"), text: "", checked: false });
    renderMemoItemRows();
    const rows = memoItemsList.querySelectorAll('input[type="text"]');
    if (rows.length) rows[rows.length - 1].focus();
  });

  btnSaveMemo.addEventListener("click", () => {
    const title = memoTitleInput.value.trim();
    if (!title) {
      memoTitleInput.focus();
      return;
    }
    const type = document.querySelector('input[name="memoType"]:checked').value;
    const content = memoContentInput.value.trim();
    const items = editingMemoItems
      .map((it) => ({ ...it, text: it.text.trim() }))
      .filter((it) => it.text !== "");
    const id = memoIdInput.value;
    if (id) {
      const memo = memos.find((m) => m.id === id);
      memo.title = title;
      memo.color = memoColorInput.value;
      memo.type = type;
      memo.content = content;
      memo.items = items;
    } else {
      memos.push({ id: uid("memo"), title, color: memoColorInput.value, type, content, items, createdAt: Date.now() });
    }
    saveMemos();
    closeModal(memoEditModal);
    renderMemoList();
    memoModal.classList.remove("hidden");
  });

  const NOTIFY_BODY_MAX = 300;

  btnNotifyMemoNow.addEventListener("click", async () => {
    const title = memoTitleInput.value.trim() || "メモ";
    const type = document.querySelector('input[name="memoType"]:checked').value;
    let body;
    if (type === "text") {
      body = memoContentInput.value.trim();
    } else {
      body = editingMemoItems
        .filter((it) => it.text.trim() !== "")
        .map((it) => `${it.checked ? "☑" : "☐"} ${it.text.trim()}`)
        .join("\n");
    }
    body = truncate(body || "（内容なし）", NOTIFY_BODY_MAX);

    if (!window.ScheduleApp.notifyMemo) {
      alert("通知機能の読み込みに失敗しました。ページを再読み込みしてください。");
      return;
    }
    btnNotifyMemoNow.disabled = true;
    try {
      await window.ScheduleApp.notifyMemo(title, body);
      alert("通知を送信しました");
    } catch (e) {
      const code = (e && e.code) || "";
      const msg = (e && e.message) || String(e);
      if (code.includes("failed-precondition") || code.includes("unauthenticated")) {
        alert("先にメニューから「予定の通知を有効にする」をタップしてください");
      } else {
        alert("通知の送信に失敗しました: " + msg);
      }
    } finally {
      btnNotifyMemoNow.disabled = false;
    }
  });

  btnDeleteMemo.addEventListener("click", () => {
    const id = memoIdInput.value;
    if (!id) return;
    const memo = memos.find((m) => m.id === id);
    if (!memo || !confirm(`メモ「${memo.title}」を削除しますか？`)) return;
    memos = memos.filter((m) => m.id !== id);
    saveMemos();
    closeModal(memoEditModal);
    renderMemoList();
    memoModal.classList.remove("hidden");
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

  // ---------- Mascot ----------

  function setupMascotAnimation() {
    const MASCOT_ACTIONS = [
      { cls: "action-flap", duration: 900 },
      { cls: "action-jump", duration: 500 },
      { cls: "action-wave", duration: 1300 },
    ];
    document.querySelectorAll(".mascot-penguin").forEach((penguin) => {
      let lastCls = null;
      function scheduleNext() {
        const delay = 3000 + Math.random() * 5000;
        setTimeout(() => {
          let action = MASCOT_ACTIONS[Math.floor(Math.random() * MASCOT_ACTIONS.length)];
          if (MASCOT_ACTIONS.length > 1 && action.cls === lastCls) {
            action = MASCOT_ACTIONS[(MASCOT_ACTIONS.indexOf(action) + 1) % MASCOT_ACTIONS.length];
          }
          lastCls = action.cls;
          penguin.classList.add(action.cls);
          setTimeout(() => {
            penguin.classList.remove(action.cls);
            scheduleNext();
          }, action.duration);
        }, delay);
      }
      scheduleNext();
    });
  }

  // Tapping a memo's push notification links to ?open=memo so the app comes
  // straight back to the memo list instead of the calendar.
  function openMemoFromDeepLink() {
    if (new URLSearchParams(location.search).get("open") !== "memo") return;
    history.replaceState(null, "", location.pathname);
    renderMemoList();
    memoModal.classList.remove("hidden");
    memoModalBody.scrollTop = 0;
  }

  // ---------- Init ----------

  renderCategoryChips();
  renderCategorySelectOptions();
  renderMemoList();
  render();
  setupMascotAnimation();
  openMemoFromDeepLink();
})();
