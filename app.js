// ===========================================================
// One Less — app logic
// Vanilla JS, no build step, no dependencies, NO BACKEND.
// Everything lives in localStorage under the "ol-data" key.
// There is no fetch() anywhere in this file, on purpose.
//
// Organized: constants -> date helpers -> data layer -> stats ->
// screens/render -> calendar -> day editor -> settings -> share ->
// event wiring -> init.
// ===========================================================

const LS_DATA_KEY = "ol-data";
const APP_SHARE_URL = "https://heee.github.io/one-less/";

const DRINK_TYPES = [
  { id: "wine", label: "Wine" },
  { id: "beer", label: "Beer" },
  { id: "cocktail", label: "Cocktail" },
  { id: "spirits", label: "Spirits" },
  { id: "bubbles", label: "Bubbles" },
  { id: "other", label: "Other" },
];

const state = {
  screen: "screen-welcome",
  viewYear: 0,
  viewMonth: 0, // 0-indexed
  editorDate: null,
  catchupQueue: [],
  catchupDismissedThisSession: false,
  lastShareMessage: null,
  deleteAllArmed: false,
};

// ------------------- small helpers -------------------

function $(id) { return document.getElementById(id); }

function toast(msg, ms = 2600) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ------------------- date helpers (ALWAYS local date parts, never toISOString) -------------------

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateFromStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(dateStr, days) {
  const dt = dateFromStr(dateStr);
  dt.setDate(dt.getDate() + days);
  return todayStr(dt);
}

function yearOf(dateStr) { return Number(dateStr.slice(0, 4)); }
function monthOf(dateStr) { return Number(dateStr.slice(5, 7)); } // 1-indexed
function dayOfMonthOf(dateStr) { return Number(dateStr.slice(8, 10)); }

function daysInMonth(year, month1) { return new Date(year, month1, 0).getDate(); } // month1 = 1-indexed

function pad2(n) { return String(n).padStart(2, "0"); }
function ymd(year, month1, day) { return `${year}-${pad2(month1)}-${pad2(day)}`; }

// Monday-first day-of-week index: 0=Mon .. 6=Sun.
function mondayDow(dateStr) {
  const jsDow = dateFromStr(dateStr).getDay(); // 0=Sun..6=Sat
  return jsDow === 0 ? 6 : jsDow - 1;
}

function startOfWeekMonday(dateStr) {
  return addDays(dateStr, -mondayDow(dateStr));
}

// 1-indexed count of days from Jan 1 through dateStr, inclusive — used for
// "this year" percentages so an early-January day doesn't get judged against
// a full 365-day denominator.
function dayOfYear(dateStr) {
  const jan1 = ymd(yearOf(dateStr), 1, 1);
  let days = 1, cursor = jan1;
  while (cursor !== dateStr) { cursor = addDays(cursor, 1); days++; }
  return days;
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function compareDateStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// ------------------- data layer -------------------

function defaultData() {
  const today = todayStr();
  return { v: 1, startedOn: today, onboarded: false, days: {}, settings: { weeklyGoal: 5, shareIncludeUrl: true } };
}

// Old builds tracked a weekly drink *budget*; the redesign tracks a weekly
// alcohol-free-days *goal* instead — a different metric, not a rename, so
// there's no sensible numeric conversion. Anything missing the new field
// just gets the new default.
function migrateData(obj) {
  if (obj && obj.settings && typeof obj.settings.weeklyGoal !== "number") {
    delete obj.settings.weeklyBudget;
    obj.settings.weeklyGoal = 5;
  }
  return obj;
}

function isValidDataShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.v !== 1) return false;
  if (typeof obj.startedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.startedOn)) return false;
  if (typeof obj.onboarded !== "boolean") return false;
  if (!obj.days || typeof obj.days !== "object") return false;
  for (const [key, entry] of Object.entries(obj.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.drinks)) return false;
    for (const d of entry.drinks) {
      if (!d || typeof d !== "object" || typeof d.type !== "string" || typeof d.count !== "number") return false;
    }
  }
  if (!obj.settings || typeof obj.settings !== "object") return false;
  if (typeof obj.settings.weeklyGoal !== "number") return false;
  if (typeof obj.settings.shareIncludeUrl !== "boolean") return false;
  return true;
}

function getData() {
  try {
    const raw = localStorage.getItem(LS_DATA_KEY);
    if (!raw) return defaultData();
    const parsed = migrateData(JSON.parse(raw));
    if (!isValidDataShape(parsed)) return defaultData();
    return parsed;
  } catch (e) {
    return defaultData();
  }
}

function setData(data) {
  localStorage.setItem(LS_DATA_KEY, JSON.stringify(data));
}

// Total drinks poured on a given day entry (undefined-safe).
function dayTotal(entry) {
  if (!entry) return 0;
  return entry.drinks.reduce((sum, d) => sum + d.count, 0);
}

// ------------------- stats: exact definitions per spec -------------------

// Dry streak: walk backwards from today. If today is unlogged, it's "in
// progress" — start from yesterday and don't break. Count consecutive days
// with an explicit empty drinks array; stop at the first day that either
// has >=1 drink logged or is unlogged entirely.
function computeDryStreak(data, today) {
  let cursor;
  if (!(today in data.days)) {
    cursor = addDays(today, -1);
  } else if (dayTotal(data.days[today]) > 0) {
    return 0;
  } else {
    cursor = today;
  }
  let streak = 0;
  while (true) {
    const entry = data.days[cursor];
    if (entry && entry.drinks.length === 0) {
      streak++;
      cursor = addDays(cursor, -1);
    } else {
      break;
    }
  }
  return streak;
}

// Longest streak ever, applying the same rule across all of history, merged
// with the (possibly still in-progress) current streak.
function computeLongestStreakEver(data, today) {
  let longest = 0;
  let run = 0;
  const yesterday = addDays(today, -1);
  let cursor = data.startedOn;
  // Guard against a pathological/huge startedOn->today span.
  let guard = 0;
  while (compareDateStr(cursor, yesterday) <= 0 && guard < 20000) {
    const entry = data.days[cursor];
    if (entry && entry.drinks.length === 0) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
    cursor = addDays(cursor, 1);
    guard++;
  }
  const current = computeDryStreak(data, today);
  return Math.max(longest, current);
}

// Alcohol-free days within the current Monday-start week, counting only
// days up to and including today (future days in the week haven't happened
// yet, so they can't count toward the goal).
function computeWeekGoalProgress(data, today) {
  const weekStart = startOfWeekMonday(today);
  let met = 0;
  let cursor = weekStart;
  while (compareDateStr(cursor, today) <= 0) {
    const entry = data.days[cursor];
    if (entry && entry.drinks.length === 0) met++;
    cursor = addDays(cursor, 1);
  }
  const goal = data.settings.weeklyGoal;
  return { met, goal, remaining: Math.max(0, goal - met), fraction: goal > 0 ? Math.min(1, met / goal) : 0 };
}

// Total drinks from day 1 through `uptoDay` (inclusive) of the given
// year/month.
function monthWindowTotal(data, year, month1, uptoDay) {
  let total = 0;
  for (let d = 1; d <= uptoDay; d++) {
    total += dayTotal(data.days[ymd(year, month1, d)]);
  }
  return total;
}

function computeMonthTotal(data, today) {
  return monthWindowTotal(data, yearOf(today), monthOf(today), dayOfMonthOf(today));
}

// Count of explicit `drinks: []` days within [fromDate, toDate] inclusive.
function countDryDaysInRange(data, fromDate, toDate) {
  let count = 0;
  let cursor = fromDate;
  let guard = 0;
  while (compareDateStr(cursor, toDate) <= 0 && guard < 400) {
    const entry = data.days[cursor];
    if (entry && entry.drinks.length === 0) count++;
    cursor = addDays(cursor, 1);
    guard++;
  }
  return count;
}

function computeDryDaysThisMonth(data, today) {
  const from = ymd(yearOf(today), monthOf(today), 1);
  return countDryDaysInRange(data, from, today);
}

function computeDryDaysThisYear(data, today) {
  const from = ymd(yearOf(today), 1, 1);
  return countDryDaysInRange(data, from, today);
}

// Trailing 7-day (today back 6 days) total drinks / 7, one decimal.
function computeRollingAverage7(data, today) {
  let total = 0;
  for (let i = 0; i < 7; i++) total += dayTotal(data.days[addDays(today, -i)]);
  return Math.round((total / 7) * 10) / 10;
}

// Last 30 days of daily drink totals, oldest first, for the trend chart.
function computeTrend30(data, today) {
  const points = [];
  for (let i = 29; i >= 0; i--) {
    const d = addDays(today, -i);
    points.push(dayTotal(data.days[d]));
  }
  return points;
}

// Last 6 calendar months (oldest first, current month last and partial) of
// total drinks, for the bar chart.
function computeMonthly6(data, today) {
  const months = [];
  let year = yearOf(today), month1 = monthOf(today);
  for (let i = 5; i >= 0; i--) {
    let y = year, m = month1 - i;
    while (m <= 0) { m += 12; y -= 1; }
    const isCurrent = i === 0;
    const upto = isCurrent ? dayOfMonthOf(today) : daysInMonth(y, m);
    const total = monthWindowTotal(data, y, m, upto);
    months.push({ year: y, month1: m, total, isPartial: isCurrent });
  }
  return months;
}

// Unlogged days from max(startedOn, 60 days ago) through yesterday
// (today is never nagged about).
function collectCatchupDays(data, today) {
  const sixtyDaysAgo = addDays(today, -60);
  const from = compareDateStr(data.startedOn, sixtyDaysAgo) > 0 ? data.startedOn : sixtyDaysAgo;
  const yesterday = addDays(today, -1);
  if (compareDateStr(from, yesterday) > 0) return [];
  const out = [];
  let cursor = from;
  let guard = 0;
  while (compareDateStr(cursor, yesterday) <= 0 && guard < 400) {
    if (!(cursor in data.days)) out.push(cursor);
    cursor = addDays(cursor, 1);
    guard++;
  }
  return out;
}

// ------------------- screen routing -------------------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  state.screen = id;
  if (id === "screen-home") renderHome();
  if (id === "screen-settings") renderSettings();
}

// ------------------- home render -------------------

function renderHome() {
  const data = getData();
  const today = todayStr();

  renderGoalCard(data, today);

  const streak = computeDryStreak(data, today);
  const longest = computeLongestStreakEver(data, today);
  const monthTotal = computeMonthTotal(data, today);
  $("stat-caption").innerHTML =
    `<b>${streak}-day streak</b> (best ${longest}) · <b>${monthTotal}</b> drink${monthTotal === 1 ? "" : "s"} logged this month`;

  renderCatchupBanner(data, today);
  renderCalendar(data);
  renderMoreStats(data, today);
}

function renderGoalCard(data, today) {
  const { met, goal, remaining, fraction } = computeWeekGoalProgress(data, today);
  const deg = fraction * 360;
  $("goal-ring").style.background = `conic-gradient(var(--accent) 0deg ${deg}deg, var(--border) ${deg}deg 360deg)`;
  $("goal-ring-value").textContent = `${met}/${goal}`;

  if (met >= goal) {
    $("goal-text-title").textContent = "Goal met this week";
    $("goal-text-sub").textContent = `You've logged ${met} alcohol-free day${met === 1 ? "" : "s"} — nice work.`;
  } else {
    $("goal-text-title").textContent = "On pace this week";
    $("goal-text-sub").textContent = `${remaining} more alcohol-free day${remaining === 1 ? "" : "s"} to hit your goal.`;
  }
}

function renderCatchupBanner(data, today) {
  const banner = $("catchup-banner");
  if (state.catchupDismissedThisSession) { banner.classList.add("hidden"); return; }
  const days = collectCatchupDays(data, today);
  state.catchupQueue = days;
  if (days.length === 0) { banner.classList.add("hidden"); return; }
  banner.classList.remove("hidden");
  $("catchup-text").textContent = `${days.length} day${days.length === 1 ? "" : "s"} need${days.length === 1 ? "s" : ""} logging`;
}

// ------------------- calendar -------------------

function renderCalendar(data) {
  const today = todayStr();
  if (!state.viewYear) { state.viewYear = yearOf(today); state.viewMonth = monthOf(today); }

  $("calendar-month-label").textContent = `${MONTH_NAMES[state.viewMonth - 1]} ${state.viewYear}`;

  const isCurrentMonth = state.viewYear === yearOf(today) && state.viewMonth === monthOf(today);
  $("btn-month-next").disabled = isCurrentMonth;

  const grid = $("calendar-grid");
  grid.innerHTML = "";

  const firstOfMonth = ymd(state.viewYear, state.viewMonth, 1);
  const leadingBlanks = mondayDow(firstOfMonth);
  const totalDays = daysInMonth(state.viewYear, state.viewMonth);

  // Blank leading cells (days outside the month): fully transparent, no
  // border, not interactive.
  for (let i = 0; i < leadingBlanks; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-cell";
    grid.appendChild(blank);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateStr = ymd(state.viewYear, state.viewMonth, day);
    grid.appendChild(buildCalTile(data, dateStr, today, day));
  }
}

function buildCalTile(data, dateStr, today, dayNum) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "cal-tile";
  tile.textContent = String(dayNum);

  const isFuture = compareDateStr(dateStr, today) > 0;
  const isToday = dateStr === today;
  const entry = data.days[dateStr];

  if (isFuture) {
    tile.classList.add("is-future");
    tile.disabled = true;
    return tile;
  }

  if (isToday) tile.classList.add("is-today");

  if (entry && entry.drinks.length === 0) {
    tile.classList.add("is-dry");
  } else if (entry) {
    tile.classList.add("is-drink");
    const badge = document.createElement("span");
    badge.className = "cal-tile-badge";
    badge.textContent = String(dayTotal(entry));
    tile.appendChild(badge);
  }

  // Every tap opens the day-detail sheet, pre-populated with whatever's
  // already logged (or blank) — there's no separate one-tap dry toggle.
  tile.addEventListener("click", () => openDayEditor(dateStr));

  return tile;
}

// ---- calendar month navigation (arrows + swipe) ----

function goToMonth(delta) {
  const today = todayStr();
  let y = state.viewYear, m = state.viewMonth + delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  // Forward stops at the current month; back navigation is unlimited.
  if (y > yearOf(today) || (y === yearOf(today) && m > monthOf(today))) return;
  state.viewYear = y;
  state.viewMonth = m;
  renderCalendar(getData());
}

$("btn-month-prev").addEventListener("click", () => goToMonth(-1));
$("btn-month-next").addEventListener("click", () => goToMonth(1));

(function setupCalendarSwipe() {
  const grid = $("calendar-grid");
  let startX = 0, startY = 0, tracking = false, decided = false, horizontal = false;

  grid.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    decided = false;
    horizontal = false;
  }, { passive: true });

  grid.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!decided && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (horizontal) e.preventDefault(); // only steal the gesture once horizontal intent is clear
  }, { passive: false });

  grid.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    if (!horizontal) return;
    const dx = e.changedTouches[0].clientX - startX;
    const THRESHOLD = 40;
    if (dx <= -THRESHOLD) goToMonth(1);
    else if (dx >= THRESHOLD) goToMonth(-1);
  });
})();

// ------------------- more stats: percentages, trend, 6-month bars -------------------

function renderMoreStats(data, today) {
  const dryMonth = computeDryDaysThisMonth(data, today);
  const dryYear = computeDryDaysThisYear(data, today);
  const monthPct = Math.round((dryMonth / dayOfMonthOf(today)) * 100);
  const yearPct = Math.round((dryYear / dayOfYear(today)) * 100);

  $("stat-dry-month").textContent = String(dryMonth);
  $("stat-dry-month-pct").textContent = `(${monthPct}%)`;
  $("stat-dry-year").textContent = String(dryYear);
  $("stat-dry-year-pct").textContent = `(${yearPct}%)`;
  $("stat-avg7").textContent = computeRollingAverage7(data, today).toFixed(1);
  $("stat-longest-ever").textContent = String(computeLongestStreakEver(data, today));

  renderTrendChart(computeTrend30(data, today));
  renderBarChart(computeMonthly6(data, today));
}

function renderTrendChart(points) {
  const max = Math.max(0, ...points);
  const w = 300, h = 82;
  const topPad = 14, bottomPad = 8;
  const plotH = h - topPad - bottomPad;
  const stepX = w / (points.length - 1 || 1);

  const yFor = (v) => max > 0 ? topPad + plotH - (v / max) * plotH : h - bottomPad;
  const coords = points.map((v, i) => `${(i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`);

  let markers = "";
  if (max > 0) {
    const peakIdx = points.indexOf(max);
    const lastIdx = points.length - 1;
    const marked = new Set([peakIdx, lastIdx]);
    for (const idx of marked) {
      const cx = idx * stepX, cy = yFor(points[idx]);
      const labelY = cy < 18 ? cy + 13 : cy - 8;
      markers += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="var(--accent)" />`;
      markers += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${points[idx]}</text>`;
    }
  }

  $("trend-chart").innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <polyline points="${coords.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${markers}
    </svg>`;
}

function renderBarChart(months) {
  const max = Math.max(1, ...months.map((m) => m.total));
  const container = $("bar-chart");
  container.innerHTML = "";
  for (const m of months) {
    const col = document.createElement("div");
    col.className = "bar-col";

    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = String(m.total);
    col.appendChild(value);

    const track = document.createElement("div");
    track.className = "bar-track";
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (m.isPartial ? " is-current" : "");
    fill.style.height = `${Math.max(2, (m.total / max) * 100)}%`;
    track.appendChild(fill);
    col.appendChild(track);

    const label = document.createElement("div");
    label.className = "bar-label";
    label.textContent = MONTH_NAMES[m.month1 - 1].slice(0, 3);
    col.appendChild(label);

    container.appendChild(col);
  }
}

// ------------------- day editor (bottom sheet) -------------------

function openDayEditor(dateStr) {
  state.editorDate = dateStr;
  renderDayEditor();
  $("sheet-backdrop").classList.remove("hidden");
  $("day-editor").classList.remove("hidden");
}

function closeDayEditor() {
  $("sheet-backdrop").classList.add("hidden");
  $("day-editor").classList.add("hidden");
  state.editorDate = null;
  renderHome();
  advanceCatchupQueue();
}

// If a catch-up flow is in progress, open the next unlogged day; otherwise
// no-op. Called whenever the editor closes, regardless of how.
function advanceCatchupQueue() {
  if (state.catchupQueue.length === 0) return;
  const next = state.catchupQueue.shift();
  // The day may have been logged in the meantime by some other path — skip
  // straight through anything no longer unlogged.
  const data = getData();
  if (next in data.days) { advanceCatchupQueue(); return; }
  openDayEditor(next);
}

function renderDayEditor() {
  const dateStr = state.editorDate;
  if (!dateStr) return;
  const data = getData();
  const entry = data.days[dateStr] || { drinks: [] };

  const dt = dateFromStr(dateStr);
  const weekday = dt.toLocaleDateString(undefined, { weekday: "long" });
  $("day-editor-date").textContent = `${weekday}, ${MONTH_NAMES[dt.getMonth()]} ${dt.getDate()}`;

  // One card per type: an inactive "+" affordance at count 0, a stepper once
  // it's been tapped. No emoji — label only, per the redesign.
  const grid = $("day-editor-types");
  grid.innerHTML = "";
  for (const type of DRINK_TYPES) {
    const d = entry.drinks.find((x) => x.type === type.id);
    const count = d ? d.count : 0;

    const card = document.createElement("div");
    card.className = "type-card" + (count > 0 ? " is-active" : "");

    const label = document.createElement("span");
    label.className = "type-card-label";
    label.textContent = type.label;
    card.appendChild(label);

    if (count === 0) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "type-card-add";
      add.textContent = "+";
      add.setAttribute("aria-label", `Add ${type.label}`);
      add.addEventListener("click", () => adjustDrink(dateStr, type.id, 1));
      card.appendChild(add);
    } else {
      const stepper = document.createElement("div");
      stepper.className = "type-stepper";
      stepper.innerHTML = `
        <button type="button" class="type-stepper-btn" data-action="dec">−</button>
        <span class="type-stepper-count">${count}</span>
        <button type="button" class="type-stepper-btn" data-action="inc">+</button>`;
      stepper.querySelector('[data-action="dec"]').addEventListener("click", () => adjustDrink(dateStr, type.id, -1));
      stepper.querySelector('[data-action="inc"]').addEventListener("click", () => adjustDrink(dateStr, type.id, 1));
      card.appendChild(stepper);
    }
    grid.appendChild(card);
  }

  const total = dayTotal(entry);
  $("day-editor-total").textContent = `${total} drink${total === 1 ? "" : "s"} logged`;
}

// Adds/removes one drink of `typeId` for `dateStr`, writing straight
// through to localStorage so Home stays live behind the sheet.
function adjustDrink(dateStr, typeId, delta) {
  const data = getData();
  const entry = data.days[dateStr] || { drinks: [] };
  const drinks = entry.drinks.slice();
  const idx = drinks.findIndex((d) => d.type === typeId);
  if (idx === -1) {
    if (delta > 0) drinks.push({ type: typeId, count: 1 });
  } else {
    const newCount = drinks[idx].count + delta;
    if (newCount <= 0) drinks.splice(idx, 1);
    else drinks[idx] = { ...drinks[idx], count: newCount };
  }
  data.days[dateStr] = { drinks };
  setData(data);
  renderDayEditor();
  renderHome();
}

// Mutually exclusive with logging drinks: marking a day alcohol-free clears
// any counts for it, and logging a drink implicitly un-marks it (drinks.length
// becomes > 0, which is exactly what "alcohol-free" checks against).
$("btn-mark-dry").addEventListener("click", () => {
  const data = getData();
  data.days[state.editorDate] = { drinks: [] };
  setData(data);
  closeDayEditor();
});

$("btn-clear-day").addEventListener("click", () => {
  const data = getData();
  delete data.days[state.editorDate];
  setData(data);
  closeDayEditor();
});

$("btn-day-done").addEventListener("click", () => closeDayEditor());

$("sheet-backdrop").addEventListener("click", () => closeDayEditor());

(function setupSheetSwipeDown() {
  const sheet = $("day-editor");
  let startY = 0, currentDy = 0, tracking = false;
  sheet.addEventListener("touchstart", (e) => {
    // Only start the close-swipe from the handle area to avoid hijacking
    // scrolling within the sheet's content.
    if (!e.target.closest(".sheet-handle")) return;
    startY = e.touches[0].clientY;
    tracking = true;
    currentDy = 0;
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    currentDy = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${currentDy}px)`;
  }, { passive: true });
  sheet.addEventListener("touchend", () => {
    if (!tracking) return;
    tracking = false;
    sheet.style.transform = "";
    if (currentDy > 80) closeDayEditor();
  });
})();

$("btn-catchup-log").addEventListener("click", () => {
  if (state.catchupQueue.length === 0) return;
  const sorted = state.catchupQueue.slice().sort(compareDateStr);
  state.catchupQueue = sorted.slice(1);
  openDayEditor(sorted[0]);
});

$("btn-catchup-dismiss").addEventListener("click", () => {
  state.catchupDismissedThisSession = true;
  $("catchup-banner").classList.add("hidden");
});

// ------------------- welcome / onboarding -------------------

// iOS has no API to trigger its own "Add to Home Screen" sheet — Apple never
// exposed one, deliberately, so a page can't spam the prompt the way some
// Android browsers' beforeinstallprompt gets abused. The closest honest
// substitute: detect Safari-on-iOS running as a plain tab (not already
// installed) and show a clearer two-step picture plus a nudge toward the
// browser's own Share button, rather than a paragraph of instructions.
function isIOSDevice() {
  const isIOSUA = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isIPadOS13Plus = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return isIOSUA || isIPadOS13Plus;
}

function isStandaloneDisplay() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

(function setupAddToHomeScreenHint() {
  if (isStandaloneDisplay()) {
    // Already installed — telling someone to add it again is just noise.
    $("welcome-callout").classList.add("hidden");
    return;
  }
  if (isIOSDevice()) {
    $("ios-add-steps").classList.remove("hidden");
    $("ios-bounce-hint").classList.remove("hidden");
  }
})();

$("btn-get-started").addEventListener("click", () => {
  const data = getData();
  data.onboarded = true;
  setData(data);
  showScreen("screen-home");
});

// ------------------- settings -------------------

function renderSettings() {
  const data = getData();
  $("settings-weekly-goal-value").textContent = String(data.settings.weeklyGoal);
  $("settings-share-url").checked = data.settings.shareIncludeUrl;
  $("confirm-delete-all").classList.add("hidden");
  state.deleteAllArmed = false;
}

$("btn-open-settings").addEventListener("click", () => showScreen("screen-settings"));
$("btn-settings-back").addEventListener("click", () => showScreen("screen-home"));

function adjustWeeklyGoal(delta) {
  const data = getData();
  const next = Math.min(7, Math.max(1, data.settings.weeklyGoal + delta));
  data.settings.weeklyGoal = next;
  setData(data);
  $("settings-weekly-goal-value").textContent = String(next);
}
$("btn-goal-dec").addEventListener("click", () => adjustWeeklyGoal(-1));
$("btn-goal-inc").addEventListener("click", () => adjustWeeklyGoal(1));

$("settings-share-url").addEventListener("change", (e) => {
  const data = getData();
  data.settings.shareIncludeUrl = e.target.checked;
  setData(data);
});

$("btn-show-about").addEventListener("click", () => showScreen("screen-welcome"));

// ---- backup / restore / email ----

function buildBackupFile() {
  const data = getData();
  const json = JSON.stringify(data);
  const filename = `one-less-backup-${todayStr()}.json`;
  return { json, filename };
}

function downloadBackup(json, filename) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$("btn-backup").addEventListener("click", () => {
  const { json, filename } = buildBackupFile();
  downloadBackup(json, filename);
  toast("Backup downloaded");
});

$("btn-restore").addEventListener("click", () => $("input-restore-file").click());

$("input-restore-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = migrateData(JSON.parse(reader.result));
    } catch (err) {
      toast("That file isn't valid JSON — nothing was changed.", 4000);
      return;
    }
    if (!isValidDataShape(parsed)) {
      toast("That file doesn't look like a One Less backup — nothing was changed.", 4000);
      return;
    }
    const ok = confirm("Restore this backup? It will replace everything currently on this device.");
    if (!ok) return;
    setData(parsed);
    location.reload();
  };
  reader.onerror = () => toast("Couldn't read that file — nothing was changed.", 4000);
  reader.readAsText(file);
});

// "Email" is a human-readable export, distinct from "Back up": a day-by-day
// plain-text listing in the email body, not the JSON file. Sorted oldest to
// newest so it reads like a log.
function formatDayLine(dateStr, entry) {
  const weekday = dateFromStr(dateStr).toLocaleDateString(undefined, { weekday: "short" });
  if (entry.drinks.length === 0) return `${dateStr} (${weekday}): Alcohol-free`;
  const parts = DRINK_TYPES
    .map((type) => {
      const d = entry.drinks.find((x) => x.type === type.id);
      return d ? `${type.label} x${d.count}` : null;
    })
    .filter(Boolean);
  const total = dayTotal(entry);
  return `${dateStr} (${weekday}): ${parts.join(", ")} — ${total} drink${total === 1 ? "" : "s"} total`;
}

// mailto: URLs have no formal length limit, but older mail clients and OSes
// start failing well before a year of daily entries would produce. If the
// listing is too long, keep the most RECENT days (drop from the oldest end)
// and say so, rather than silently truncating or failing to open Mail.
const EMAIL_BODY_CHAR_BUDGET = 4000;

function buildDataListingEmail() {
  const data = getData();
  const dates = Object.keys(data.days).sort(compareDateStr);
  const lines = dates.map((d) => formatDayLine(d, data.days[d]));

  let included = lines;
  let omitted = 0;
  while (included.join("\n").length > EMAIL_BODY_CHAR_BUDGET && included.length > 1) {
    included = included.slice(1);
    omitted++;
  }

  const bodyLines = [`One Less — logged data (${lines.length} day${lines.length === 1 ? "" : "s"} total)`];
  if (omitted > 0) {
    bodyLines.push(`Showing the most recent ${included.length} of ${lines.length} — the earliest ${omitted} were left out to keep this email a reasonable size. Settings → Back up gives you the complete file.`);
  }
  bodyLines.push("", ...included);

  return { subject: "One Less - My data", body: bodyLines.join("\n") };
}

$("btn-email-backup").addEventListener("click", () => {
  const { subject, body } = buildDataListingEmail();
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

// ---- delete all data (two-step confirm) ----

$("btn-delete-all").addEventListener("click", () => {
  $("confirm-delete-all").classList.remove("hidden");
});
$("btn-delete-all-cancel").addEventListener("click", () => {
  $("confirm-delete-all").classList.add("hidden");
});
$("btn-delete-all-confirm").addEventListener("click", () => {
  localStorage.removeItem(LS_DATA_KEY);
  location.reload();
});

// ------------------- share -------------------
// Rotating template pools, mixed and rotating, never repeating the previous
// message. A day with drinks logged, or no active streak, always gets the
// plain pool — never a punchline on a bad day.

const SHARE_MESSAGES_WARM = [
  (ctx) => `${ctx.dayText}. ${ctx.streak > 0 ? `On a ${ctx.streakText}.` : "Starting fresh today."} ${ctx.dryMonthText}.`,
  (ctx) => `Checking in — ${ctx.dayText.toLowerCase()}, ${ctx.dryMonthText.toLowerCase()} so far this month.`,
  (ctx) => `${ctx.streak > 0 ? `${ctx.streakText}.` : "No streak going right now, and that's okay."} ${ctx.dryMonthText}.`,
  (ctx) => `Just logging today: ${ctx.dayText.toLowerCase()}. ${ctx.dryMonthText}.`,
  (ctx) => `${ctx.dayText}. ${ctx.dryMonthText} — one day at a time.`,
  (ctx) => `Sharing where I'm at: ${ctx.dayText.toLowerCase()}, ${ctx.streak > 0 ? ctx.streakText : "rebuilding my streak"}.`,
  (ctx) => `${ctx.streak > 0 ? `${ctx.streakText} and counting.` : "Back at it today."} ${ctx.dryMonthText}.`,
  (ctx) => `Today: ${ctx.dayText.toLowerCase()}. This month: ${ctx.dryMonthText.toLowerCase()}.`,
  (ctx) => `${ctx.dayText}. Thanks for checking in on me — ${ctx.dryMonthText.toLowerCase()}.`,
  (ctx) => `Wanted to share: ${ctx.dayText.toLowerCase()}, ${ctx.streak > 0 ? ctx.streakText : "starting a new stretch"}.`,
  (ctx) => `${ctx.dryMonthText} so far. ${ctx.streak > 0 ? `Currently on a ${ctx.streakText}.` : "Today's a reset, and that's fine."}`,
  (ctx) => `Small update: ${ctx.dayText.toLowerCase()}. ${ctx.dryMonthText}.`,
  (ctx) => `${ctx.dayText}. ${ctx.streak > 0 ? ctx.streakText : "Not tracking a streak right now"} — appreciate you.`,
  (ctx) => `Keeping this simple: ${ctx.dayText.toLowerCase()}, ${ctx.dryMonthText.toLowerCase()}.`,
];

const SHARE_MESSAGES_HUMOR = [
  (ctx) => `${ctx.streakText} and I've become insufferable about herbal tea. Ask me how many kinds I own now.`,
  (ctx) => `${ctx.streakText}. My sleep tracker thinks I've been replaced by a new, better person.`,
  (ctx) => `${ctx.streakText} in, and my bank account has started sending me thank-you notes.`,
  (ctx) => `${ctx.streakText}. I now have opinions about sparkling water brands. This is who I am now.`,
  (ctx) => `${ctx.streakText}, and I woke up before my alarm today. Genuinely unsettling. Recommend it though.`,
  (ctx) => `${ctx.streakText}. I've started describing chamomile as "bright." Send help, or don't, I'm fine.`,
  (ctx) => `${ctx.streakText} deep and my skin looks better than my personality does, which is saying something.`,
  (ctx) => `${ctx.streakText}. I could recite the ingredients on a kombucha label from memory at this point.`,
  (ctx) => `${ctx.streakText}, and I've discovered mornings exist and can be pleasant. Wild concept.`,
  (ctx) => `${ctx.streakText}. My mocktail order has gotten so specific the bartender just nods now.`,
  (ctx) => `${ctx.streakText} and counting — I've saved enough on drinks to be smug about it, so here I am.`,
  (ctx) => `${ctx.streakText}. I've become the friend who suggests "getting coffee instead." Sorry, not sorry.`,
  (ctx) => `${ctx.streakText}, and I have never been more well-rested or more insufferable about it.`,
  (ctx) => `${ctx.streakText}. ${ctx.dryMonthText} — my liver sent a card, it just says "finally."`,
];

function buildShareContext(data, today) {
  const entry = data.days[today];
  const todayHasDrinks = !!entry && entry.drinks.length > 0;
  const todayCount = entry ? dayTotal(entry) : 0;
  const streak = computeDryStreak(data, today);
  const dryMonth = computeDryDaysThisMonth(data, today);
  return {
    todayHasDrinks,
    streak,
    dayText: todayHasDrinks ? `${todayCount} drink${todayCount === 1 ? "" : "s"} today` : "Drink-free today",
    streakText: `${streak}-day dry streak`,
    dryMonthText: `${dryMonth} dry day${dryMonth === 1 ? "" : "s"} this month`,
  };
}

function pickShareMessage(ctx) {
  const forcePlain = ctx.todayHasDrinks || ctx.streak === 0;
  const pool = forcePlain ? SHARE_MESSAGES_WARM : (Math.random() < 0.5 ? SHARE_MESSAGES_WARM : SHARE_MESSAGES_HUMOR);
  let template, guard = 0;
  do {
    template = pool[Math.floor(Math.random() * pool.length)];
  } while (template === state.lastShareMessage && pool.length > 1 && ++guard < 10);
  state.lastShareMessage = template;
  return template(ctx);
}

async function shareProgress() {
  const data = getData();
  const ctx = buildShareContext(data, todayStr());
  const message = pickShareMessage(ctx);
  const shareData = { text: message };
  if (data.settings.shareIncludeUrl) shareData.url = APP_SHARE_URL;

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (e) {
      // user cancelled the share sheet — not an error
    }
    return;
  }
  const clipboardText = data.settings.shareIncludeUrl ? `${message} ${APP_SHARE_URL}` : message;
  try {
    await navigator.clipboard.writeText(clipboardText);
    toast("Copied to clipboard");
  } catch (e) {
    toast("Couldn't share automatically — copy your message manually.", 4000);
  }
}

$("btn-share").addEventListener("click", shareProgress);

// ------------------- init -------------------

function init() {
  const data = getData();
  const today = todayStr();
  state.viewYear = yearOf(today);
  state.viewMonth = monthOf(today);

  if (data.onboarded) {
    showScreen("screen-home");
  } else {
    showScreen("screen-welcome");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* ignore */ });
  }
}

init();
