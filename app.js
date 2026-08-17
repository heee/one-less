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
  { id: "wine", label: "Wine", hint: "Red, white, rosé, orange", color: "#8E5A62" },
  { id: "beer", label: "Beer", hint: "Lager, IPA, stout, etc.", color: "#B58A43" },
  { id: "cocktail", label: "Cocktail", hint: "Mixed drinks, regardless of base spirit", color: "#C87854" },
  { id: "spirits", label: "Spirits", hint: "Neat, rocks, shot, highball", color: "#756B88" },
  { id: "sparkling", label: "Sparkling", hint: "Champagne, Prosecco, Cava, sparkling wine", color: "#6F9196" },
  { id: "cider", label: "Cider", hint: "", color: "#A66B2E" },
  { id: "seltzer", label: "Seltzer / RTD", hint: "Hard seltzers, canned cocktails, hard lemonade, alcopops", color: "#4F8578" },
  { id: "other", label: "Other", hint: "Sake, soju, mead, fortified wine, unusual drinks", color: "#737B70" },
];

// The three ways Home's goal card can measure progress. `field` is the
// settings key holding the target number; each type keeps its own field so
// switching types in Settings never loses the other types' targets.
const GOAL_TYPES = {
  dryDays: { field: "weeklyGoal", label: "Alcohol-free days goal / week", pickerLabel: "Dry days", min: 1, max: 7, default: 5 },
  drinkBudget: { field: "weeklyDrinkBudget", label: "Weekly drink budget", pickerLabel: "Drink budget", min: 1, max: 30, default: 7 },
  streak: { field: "streakGoal", label: "Dry-streak target (days)", pickerLabel: "Streak", min: 3, max: 90, default: 30 },
};

const state = {
  screen: "screen-welcome",
  viewYear: 0,
  viewMonth: 0, // 0-indexed
  editorDate: null,
  catchupQueue: [],
  catchupDismissedThisSession: false,
  reviewNamesDismissedThisSession: false,
  reviewItems: [],
  lastShareMessage: null,
  deleteAllArmed: false,
  statsPeriod: "month",
  newNameSlots: new Set(),
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
  return {
    v: 2, startedOn: today, onboarded: false, days: {},
    settings: { goalType: "dryDays", weeklyGoal: 5, weeklyDrinkBudget: 7, streakGoal: 30, shareIncludeUrl: true },
  };
}

// Splits a legacy free-text drink name into a best-guess {brand, drink}
// pair: first word becomes the brand, the rest becomes the drink. A
// single-word name can't be split, so it's kept as the drink with no
// brand guessed. This is only ever a starting guess — surfaced to the
// user via the pending-review banner so they can correct it centrally.
function splitLegacyDrinkName(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return { brand: "", drink: "" };
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { brand: "", drink: trimmed };
  return { brand: trimmed.slice(0, spaceIndex).trim(), drink: trimmed.slice(spaceIndex + 1).trim() };
}

// Old builds tracked a weekly drink *budget*; the redesign tracked a weekly
// alcohol-free-days *goal* instead — a different metric, not a rename, so
// there's no sensible numeric conversion. Anything missing the new field
// just gets the new default. Later, goal-type selection reintroduced a
// drink budget alongside a streak target as alternatives, not a replacement
// — each type keeps its own field, defaulted independently if missing.
function migrateData(obj) {
  if (obj && obj.settings && typeof obj.settings.weeklyGoal !== "number") {
    delete obj.settings.weeklyBudget;
    obj.settings.weeklyGoal = 5;
  }
  if (obj && obj.settings) {
    if (!GOAL_TYPES[obj.settings.goalType]) obj.settings.goalType = "dryDays";
    if (typeof obj.settings.weeklyDrinkBudget !== "number") obj.settings.weeklyDrinkBudget = 7;
    if (typeof obj.settings.streakGoal !== "number") obj.settings.streakGoal = 30;
  }
  if (obj && obj.days && typeof obj.days === "object") {
    for (const entry of Object.values(obj.days)) {
      if (!entry || !Array.isArray(entry.drinks)) continue;
      entry.drinks = entry.drinks.map((drink) => {
        if (!drink || typeof drink !== "object") return drink;
        if (!Number.isInteger(drink.count) || drink.count < 1 || drink.count > 1000) return drink;
        // "Bubbles" was renamed to "Sparkling" — same category, new label.
        const type = drink.type === "bubbles" ? "sparkling" : drink.type;

        if (Array.isArray(drink.entries)) {
          // Already on the brand/drink schema — just make sure the array
          // length tracks count (e.g. after a count bump elsewhere).
          const entries = Array.from({ length: drink.count }, (_, index) => {
            const e = drink.entries[index];
            if (!e || typeof e !== "object") return { brand: "", drink: "" };
            const out = { brand: typeof e.brand === "string" ? e.brand : "", drink: typeof e.drink === "string" ? e.drink : "" };
            if (typeof e._raw === "string") out._raw = e._raw;
            return out;
          });
          return { type, count: drink.count, entries };
        }

        // Legacy single-name schema: split each name into a best-guess
        // {brand, drink} pair, tagged with `_raw` so the pending-review
        // banner can find it and let the user correct the guess.
        const previousNames = Array.isArray(drink.names) ? drink.names : [];
        const entries = Array.from({ length: drink.count }, (_, index) => {
          const rawName = index === 0 && !previousNames[index] && typeof drink.name === "string"
            ? drink.name
            : previousNames[index];
          const raw = (typeof rawName === "string" ? rawName : "").trim();
          if (!raw) return { brand: "", drink: "" };
          const guess = splitLegacyDrinkName(raw);
          return { ...guess, _raw: raw };
        });
        return { type, count: drink.count, entries };
      });
    }
  }
  if (obj) obj.v = 2;
  return obj;
}

// Every {brand, drink} entry still carrying `_raw` came from an
// auto-split legacy name and hasn't been confirmed by the user yet.
// Deduped by type + original raw string so the review sheet shows one
// row per distinct legacy name, however many times it was logged.
function getPendingReviewItems(data) {
  const items = new Map();
  for (const entry of Object.values(data.days)) {
    for (const drink of entry.drinks) {
      for (const e of drink.entries || []) {
        if (!e._raw) continue;
        const key = `${drink.type}|${e._raw.toLocaleLowerCase()}`;
        if (!items.has(key)) items.set(key, { typeId: drink.type, raw: e._raw, brand: e.brand, drink: e.drink });
      }
    }
  }
  return [...items.values()];
}

// Applies user-corrected {brand, drink} values from the review sheet to
// every entry sharing the same type + original raw name, then clears the
// `_raw` tag so those entries drop out of the pending-review list.
function applyNameReview(corrections) {
  const data = getData();
  const byKey = new Map(corrections.map((c) => [`${c.typeId}|${c.raw.toLocaleLowerCase()}`, c]));
  for (const entry of Object.values(data.days)) {
    for (const drink of entry.drinks) {
      if (!Array.isArray(drink.entries)) continue;
      drink.entries = drink.entries.map((e) => {
        if (!e._raw) return e;
        const key = `${drink.type}|${e._raw.toLocaleLowerCase()}`;
        const c = byKey.get(key);
        if (!c) return { brand: e.brand, drink: e.drink };
        return { brand: c.brand.trim().slice(0, 60), drink: c.drink.trim().slice(0, 60) };
      });
    }
  }
  setData(data);
}

function isValidDataShape(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.v !== 2) return false;
  if (typeof obj.startedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(obj.startedOn)) return false;
  if (typeof obj.onboarded !== "boolean") return false;
  if (!obj.days || typeof obj.days !== "object") return false;
  for (const [key, entry] of Object.entries(obj.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.drinks)) return false;
    for (const d of entry.drinks) {
      if (!d || typeof d !== "object" || typeof d.type !== "string" || !Number.isInteger(d.count) || d.count < 1 || d.count > 1000) return false;
      if (!Array.isArray(d.entries) || d.entries.length !== d.count) return false;
      for (const e of d.entries) {
        if (!e || typeof e !== "object" || typeof e.brand !== "string" || typeof e.drink !== "string") return false;
        if (e._raw !== undefined && typeof e._raw !== "string") return false;
      }
    }
  }
  if (!obj.settings || typeof obj.settings !== "object") return false;
  if (typeof obj.settings.weeklyGoal !== "number") return false;
  if (!GOAL_TYPES[obj.settings.goalType]) return false;
  if (typeof obj.settings.weeklyDrinkBudget !== "number") return false;
  if (typeof obj.settings.streakGoal !== "number") return false;
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

function getKnownBrands(data, typeId) {
  const brands = new Map();
  for (const entry of Object.values(data.days)) {
    const drink = entry.drinks.find((item) => item.type === typeId);
    if (!drink) continue;
    for (const e of drink.entries || []) {
      const brand = (e.brand || "").trim();
      const key = brand.toLocaleLowerCase();
      if (brand && !brands.has(key)) brands.set(key, brand);
    }
  }
  return [...brands.values()].sort((a, b) => a.localeCompare(b));
}

// Drink options for a type, filtered to a specific brand once one's been
// picked — the drink list is meant to follow the brand. With no brand
// selected yet, every known drink for the type is offered.
function getKnownDrinkOptions(data, typeId, brand) {
  const drinks = new Map();
  const brandKey = (brand || "").trim().toLocaleLowerCase();
  for (const entry of Object.values(data.days)) {
    const drink = entry.drinks.find((item) => item.type === typeId);
    if (!drink) continue;
    for (const e of drink.entries || []) {
      const name = (e.drink || "").trim();
      if (!name) continue;
      if (brandKey && (e.brand || "").trim().toLocaleLowerCase() !== brandKey) continue;
      const key = name.toLocaleLowerCase();
      if (!drinks.has(key)) drinks.set(key, name);
    }
  }
  return [...drinks.values()].sort((a, b) => a.localeCompare(b));
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
// Also reports whether the goal is still mathematically reachable this
// week, and whether `met` is currently at or above the pace needed to hit
// it by Sunday — both drive the message on Home, so e.g. a Sunday with
// nothing logged reads as "the goal's behind" rather than the flatly wrong
// "on pace."
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
  const remaining = Math.max(0, goal - met);
  const fraction = goal > 0 ? Math.min(1, met / goal) : 0;

  const daysElapsed = mondayDow(today) + 1; // 1 (Mon) .. 7 (Sun)
  const todayUndecided = !(today in data.days);
  // Days with a settled outcome so far — excludes today while it's still
  // unlogged, since it could yet turn out either way.
  const decidedDaysSoFar = daysElapsed - (todayUndecided ? 1 : 0);
  // Best case: every remaining day, including an undecided today, comes up dry.
  const remainingOpportunities = (7 - daysElapsed) + (todayUndecided ? 1 : 0);
  const maxPossibleMet = met + remainingOpportunities;

  return { met, goal, remaining, fraction, decidedDaysSoFar, remainingOpportunities, maxPossibleMet };
}

// Same Monday-start week window as computeWeekGoalProgress, but for a
// "stay under N drinks" budget instead of a dry-days count. Unlike the
// dry-days goal, going over is unrecoverable within the week — no later day
// can undo drinks already logged — so pace only matters while still under.
function computeWeekBudgetProgress(data, today) {
  const weekStart = startOfWeekMonday(today);
  let used = 0;
  let cursor = weekStart;
  while (compareDateStr(cursor, today) <= 0) {
    used += dayTotal(data.days[cursor]);
    cursor = addDays(cursor, 1);
  }
  const budget = data.settings.weeklyDrinkBudget;
  const remaining = Math.max(0, budget - used);
  const fraction = budget > 0 ? Math.min(1, used / budget) : 0;

  const daysElapsed = mondayDow(today) + 1; // 1 (Mon) .. 7 (Sun)
  const todayUndecided = !(today in data.days);
  const decidedDaysSoFar = daysElapsed - (todayUndecided ? 1 : 0);
  const remainingOpportunities = (7 - daysElapsed) + (todayUndecided ? 1 : 0);
  const overBudget = used > budget;
  const weekSettled = daysElapsed === 7 && !todayUndecided;
  // On pace: spend so far is at or under the even daily rate for the days
  // that have actually settled (mirrors the dry-days pace check, inverted).
  const onPace = decidedDaysSoFar === 0 || used * 7 <= budget * decidedDaysSoFar;

  return { used, budget, remaining, fraction, decidedDaysSoFar, remainingOpportunities, overBudget, weekSettled, onPace };
}

// Progress toward a target dry-streak length. Unlike the other two goal
// types this has no weekly reset — the streak either keeps growing or
// breaks to zero on a logged drinking day.
function computeStreakGoalProgress(data, today) {
  const streak = computeDryStreak(data, today);
  const target = data.settings.streakGoal;
  const remaining = Math.max(0, target - streak);
  const fraction = target > 0 ? Math.min(1, streak / target) : 0;
  return { streak, target, remaining, fraction };
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
    points.push({ date: d, total: dayTotal(data.days[d]) });
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
  if (id === "screen-drinks") renderDrinkInsights();
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
  renderReviewNamesBanner(data);
  renderCalendar(data);
  renderMoreStats(data, today);
}

const s = (n) => (n === 1 ? "" : "s");

function setGoalCard(fraction, ringValue, title, sub) {
  const deg = fraction * 360;
  $("goal-ring").style.background = `conic-gradient(var(--accent) 0deg ${deg}deg, var(--border) ${deg}deg 360deg)`;
  $("goal-ring-value").textContent = ringValue;
  $("goal-text-title").textContent = title;
  $("goal-text-sub").textContent = sub;
}

// Dispatches to the render for whichever goal type is active in Settings.
function renderGoalCard(data, today) {
  if (data.settings.goalType === "drinkBudget") renderGoalCardBudget(data, today);
  else if (data.settings.goalType === "streak") renderGoalCardStreak(data, today);
  else renderGoalCardDryDays(data, today);
}

// Five states, checked in order: goal already met; goal now mathematically
// impossible (not enough days left, however the rest of the week goes);
// too early in the week to judge pace at all; on pace; behind pace but
// still possible. Each gets its own honest, non-shaming message rather than
// a blanket "on pace" that's wrong for most of these.
function renderGoalCardDryDays(data, today) {
  const p = computeWeekGoalProgress(data, today);
  let title, sub;

  if (p.met >= p.goal) {
    title = "Goal met this week";
    sub = `You've logged ${p.met} alcohol-free day${s(p.met)} — nice work.`;
  } else if (p.maxPossibleMet < p.goal) {
    title = "This week's goal is behind";
    sub = `${p.met} of ${p.goal} logged this week. There's always next week.`;
  } else if (p.decidedDaysSoFar === 0) {
    title = "New week, fresh start";
    sub = `${p.remaining} alcohol-free day${s(p.remaining)} this week would hit your goal.`;
  } else if (p.met * 7 >= p.goal * p.decidedDaysSoFar) {
    title = "On pace this week";
    sub = `${p.remaining} more alcohol-free day${s(p.remaining)} to hit your goal.`;
  } else {
    title = "Behind pace, still possible";
    sub = `Log ${p.remaining} more in the ${p.remainingOpportunities} day${s(p.remainingOpportunities)} left to hit your goal.`;
  }

  setGoalCard(p.fraction, `${p.met}/${p.goal}`, title, sub);
}

// Four states, checked in order: already over budget (unrecoverable this
// week); week fully settled and still under; too early to judge pace; on
// pace or above pace. Ring fraction here tracks *spend*, not progress — a
// full ring means the budget is used up, not that the goal was hit.
function renderGoalCardBudget(data, today) {
  const p = computeWeekBudgetProgress(data, today);
  let title, sub;

  if (p.overBudget) {
    title = "Over budget this week";
    sub = `You've logged ${p.used} of ${p.budget} drinks — ${p.used - p.budget} over.`;
  } else if (p.weekSettled) {
    title = "Budget met this week";
    sub = `You stayed at ${p.used} of ${p.budget} drinks this week — nice work.`;
  } else if (p.decidedDaysSoFar === 0) {
    title = "New week, fresh start";
    sub = `${p.remaining} drink${s(p.remaining)} left in your ${p.budget}-drink weekly budget.`;
  } else if (p.onPace) {
    title = "On pace this week";
    sub = `${p.remaining} drink${s(p.remaining)} left in your budget, ${p.remainingOpportunities} day${s(p.remainingOpportunities)} to go.`;
  } else {
    title = "Above pace this week";
    sub = `${p.remaining} drink${s(p.remaining)} left — pace it out over the ${p.remainingOpportunities} day${s(p.remainingOpportunities)} left.`;
  }

  setGoalCard(p.fraction, `${p.used}/${p.budget}`, title, sub);
}

// Three states: target reached, streak still at zero, or building toward
// it. No pace logic — there's no deadline, just the running streak.
function renderGoalCardStreak(data, today) {
  const p = computeStreakGoalProgress(data, today);
  let title, sub;

  if (p.streak >= p.target) {
    title = "Streak goal reached";
    sub = `${p.streak}-day streak — past your ${p.target}-day goal.`;
  } else if (p.streak === 0) {
    title = "Start your streak";
    sub = `${p.target} alcohol-free day${s(p.target)} in a row would hit your goal.`;
  } else {
    title = "Building your streak";
    sub = `${p.remaining} more day${s(p.remaining)} to reach your ${p.target}-day goal.`;
  }

  setGoalCard(p.fraction, `${p.streak}/${p.target}`, title, sub);
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

function renderReviewNamesBanner(data) {
  const banner = $("review-names-banner");
  if (state.reviewNamesDismissedThisSession) { banner.classList.add("hidden"); return; }
  const items = getPendingReviewItems(data);
  if (items.length === 0) { banner.classList.add("hidden"); return; }
  banner.classList.remove("hidden");
  $("review-names-text").textContent = `${items.length} drink name${items.length === 1 ? "" : "s"} to review`;
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
  const values = points.map((point) => point.total);
  const average = values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  const max = Math.max(1, average, ...values);
  const w = 320, h = 104;
  const topPad = 12, bottomPad = 25;
  const plotH = h - topPad - bottomPad;
  const stepX = w / (points.length - 1 || 1);

  const yFor = (v) => max > 0 ? topPad + plotH - (v / max) * plotH : h - bottomPad;
  const coords = values.map((v, i) => `${(i * stepX).toFixed(1)},${yFor(v).toFixed(1)}`);

  let markers = "";
  const peak = Math.max(...values);
  if (peak > 0) {
    const peakIdx = values.indexOf(peak);
    const lastIdx = values.length - 1;
    const marked = new Set([peakIdx, lastIdx]);
    for (const idx of marked) {
      const cx = idx * stepX, cy = yFor(values[idx]);
      const labelY = cy < 18 ? cy + 13 : cy - 8;
      markers += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="2.5" fill="var(--accent)" />`;
      markers += `<text x="${cx.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle">${values[idx]}</text>`;
    }
  }

  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const dateLabels = labelIndexes.map((idx, position) => {
    const label = dateFromStr(points[idx].date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const anchor = position === 0 ? "start" : position === 2 ? "end" : "middle";
    return `<text class="trend-date-label" x="${(idx * stepX).toFixed(1)}" y="${h - 3}" text-anchor="${anchor}">${label}</text>`;
  }).join("");
  const avgY = yFor(average).toFixed(1);

  $("trend-chart").innerHTML = `
    <div class="trend-legend">
      <span><i class="legend-line daily"></i>Daily</span>
      <span><i class="legend-line average"></i>30-day avg ${average.toFixed(1)}</span>
    </div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-label="Daily drinks and 30-day average">
      <line x1="0" y1="${h - bottomPad}" x2="${w}" y2="${h - bottomPad}" stroke="var(--divider)" stroke-width="1" />
      <line x1="0" y1="${avgY}" x2="${w}" y2="${avgY}" stroke="var(--clay-text)" stroke-width="1.6" stroke-dasharray="5 4" />
      <polyline points="${coords.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${markers}
      ${dateLabels}
    </svg>`;
}

function renderBarChart(months) {
  const max = Math.max(1, ...months.map((m) => m.total));
  const container = $("bar-chart");
  container.innerHTML = "";
  for (const m of months) {
    const col = document.createElement("div");
    col.className = "bar-col";

    const track = document.createElement("div");
    track.className = "bar-track";
    const barHeight = Math.max(2, (m.total / max) * 100);
    track.style.setProperty("--bar-height", `${barHeight}%`);
    const fill = document.createElement("div");
    fill.className = "bar-fill" + (m.isPartial ? " is-current" : "");
    fill.style.height = `${barHeight}%`;
    track.appendChild(fill);
    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = String(m.total);
    track.appendChild(value);
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
  state.newNameSlots.clear();
  renderDayEditor();
  $("sheet-backdrop").classList.remove("hidden");
  $("day-editor").classList.remove("hidden");
}

// `cancelCatchup` distinguishes "I decided this day, move on" (Done, No
// drinks, Clear — advances the queue) from "let me out" (X, tapping the
// backdrop, swiping down — stops the auto-advance so the sheet doesn't just
// pop back open for the next overdue day). The banner still reflects the
// true count of unlogged days either way, since it's recomputed from data.
function closeDayEditor(cancelCatchup) {
  $("sheet-backdrop").classList.add("hidden");
  $("day-editor").classList.add("hidden");
  state.editorDate = null;
  state.newNameSlots.clear();
  renderHome();
  if (cancelCatchup) { state.catchupQueue = []; return; }
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
    if (type.hint) card.title = `${type.label} — ${type.hint}`;

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

  renderDrinkDetails(data, entry, dateStr);
  const total = dayTotal(entry);
  $("day-editor-total").textContent = `${total} drink${total === 1 ? "" : "s"} logged`;
}

function renderDrinkDetails(data, entry, dateStr) {
  const container = $("day-editor-details");
  container.innerHTML = "";
  const selected = DRINK_TYPES
    .map((type) => ({ type, drink: entry.drinks.find((item) => item.type === type.id) }))
    .filter(({ drink }) => drink && drink.count > 0);

  container.classList.toggle("hidden", selected.length === 0);
  if (selected.length === 0) return;

  const intro = document.createElement("p");
  intro.className = "drink-details-intro";
  intro.textContent = "Add the specific drink or brand (optional)";
  container.appendChild(intro);

  for (const { type, drink } of selected) {
    const group = document.createElement("div");
    group.className = "drink-detail-group";

    const heading = document.createElement("div");
    heading.className = "drink-detail-heading";
    heading.innerHTML = `<span>${type.label}</span><span>${drink.count} selected</span>`;
    group.appendChild(heading);

    const knownBrands = getKnownBrands(data, type.id);
    for (let index = 0; index < drink.count; index++) {
      const current = (drink.entries && drink.entries[index]) || { brand: "", drink: "" };
      const knownDrinkOptions = getKnownDrinkOptions(data, type.id, current.brand);
      const brandSlotKey = `${dateStr}|${type.id}|${index}|brand`;
      const drinkSlotKey = `${dateStr}|${type.id}|${index}|drink`;

      const row = document.createElement("div");
      row.className = "drink-name-row";

      if (drink.count > 1) {
        const number = document.createElement("span");
        number.className = "drink-name-number";
        number.textContent = `Drink ${index + 1}`;
        row.appendChild(number);
      }

      const fieldPair = document.createElement("div");
      fieldPair.className = "drink-field-pair";

      fieldPair.appendChild(buildDrinkFieldRow({
        slotKey: brandSlotKey,
        fieldLabel: "Brand",
        ariaLabel: `${type.label} drink ${index + 1} brand`,
        knownValues: knownBrands,
        currentValue: current.brand,
        placeholderLabel: "Choose a saved brand",
        newLabel: "+ New brand",
        inputPlaceholder: "Enter brand",
        // Changing the brand reshapes the drink field's option list below
        // it, so this one re-renders the whole editor rather than just
        // writing through — the drink select needs an actual remount.
        onCommit: (value) => { setDrinkEntryField(dateStr, type.id, index, "brand", value); renderDayEditor(); },
      }));

      fieldPair.appendChild(buildDrinkFieldRow({
        slotKey: drinkSlotKey,
        fieldLabel: "Drink",
        ariaLabel: `${type.label} drink ${index + 1}`,
        knownValues: knownDrinkOptions,
        currentValue: current.drink,
        placeholderLabel: "Choose a saved drink",
        newLabel: "+ New drink",
        inputPlaceholder: "Enter drink",
        onCommit: (value) => setDrinkEntryField(dateStr, type.id, index, "drink", value),
      }));

      row.appendChild(fieldPair);
      group.appendChild(row);
    }
    container.appendChild(group);
  }
}

// Builds one labeled brand-or-drink field: a dropdown of known values plus
// a "+ New" option, or a free-text input once that's picked (with a
// "Saved" button to switch back). Brand and drink fields both follow this
// same pattern — only the value list and labels differ.
function buildDrinkFieldRow({ slotKey, fieldLabel, ariaLabel, knownValues, currentValue, placeholderLabel, newLabel, inputPlaceholder, onCommit }) {
  const field = document.createElement("label");
  field.className = "drink-field";

  const caption = document.createElement("span");
  caption.className = "drink-field-label";
  caption.textContent = fieldLabel;
  field.appendChild(caption);

  if (knownValues.length > 0 && !state.newNameSlots.has(slotKey)) {
    const select = document.createElement("select");
    select.className = "drink-name-select";
    select.setAttribute("aria-label", ariaLabel);

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = placeholderLabel;
    select.appendChild(placeholder);
    for (const value of knownValues) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
    const newOption = document.createElement("option");
    newOption.value = "__new__";
    newOption.textContent = newLabel;
    select.appendChild(newOption);
    select.value = knownValues.find((value) => value.toLocaleLowerCase() === currentValue.toLocaleLowerCase()) || "";
    select.addEventListener("change", () => {
      if (select.value === "__new__") {
        state.newNameSlots.add(slotKey);
        onCommit("");
        renderDayEditor();
        const input = [...document.querySelectorAll("[data-name-slot]")]
          .find((element) => element.dataset.nameSlot === slotKey);
        if (input) input.focus();
      } else {
        onCommit(select.value);
      }
    });
    field.appendChild(select);
  } else {
    const inputWrap = document.createElement("div");
    inputWrap.className = "drink-name-input-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "drink-name-input";
    input.placeholder = inputPlaceholder;
    input.value = currentValue;
    input.maxLength = 60;
    input.dataset.nameSlot = slotKey;
    input.setAttribute("aria-label", ariaLabel);
    input.addEventListener("input", () => onCommit(input.value));
    inputWrap.appendChild(input);

    if (knownValues.length > 0) {
      const savedButton = document.createElement("button");
      savedButton.type = "button";
      savedButton.className = "use-saved-btn";
      savedButton.textContent = "Saved";
      savedButton.addEventListener("click", () => {
        state.newNameSlots.delete(slotKey);
        renderDayEditor();
      });
      inputWrap.appendChild(savedButton);
    }
    field.appendChild(inputWrap);
  }
  return field;
}

function setDrinkEntryField(dateStr, typeId, index, field, value) {
  const data = getData();
  const entry = data.days[dateStr];
  if (!entry) return;
  const drinkIndex = entry.drinks.findIndex((drink) => drink.type === typeId);
  if (drinkIndex === -1 || index >= entry.drinks[drinkIndex].count) return;
  const drink = entry.drinks[drinkIndex];
  const entries = Array.isArray(drink.entries) ? drink.entries.slice(0, drink.count) : [];
  while (entries.length < drink.count) entries.push({ brand: "", drink: "" });
  const current = entries[index] || { brand: "", drink: "" };
  entries[index] = { brand: field === "brand" ? value.slice(0, 60) : current.brand, drink: field === "drink" ? value.slice(0, 60) : current.drink };
  entry.drinks[drinkIndex] = { ...drink, entries };
  setData(data);
  renderHome();
}

// Adds/removes one drink of `typeId` for `dateStr`, writing straight
// through to localStorage so Home stays live behind the sheet.
function adjustDrink(dateStr, typeId, delta) {
  const data = getData();
  const entry = data.days[dateStr] || { drinks: [] };
  const drinks = entry.drinks.slice();
  const idx = drinks.findIndex((d) => d.type === typeId);
  if (idx === -1) {
    if (delta > 0) drinks.push({ type: typeId, count: 1, entries: [{ brand: "", drink: "" }] });
  } else {
    const newCount = drinks[idx].count + delta;
    if (newCount <= 0) drinks.splice(idx, 1);
    else {
      const entries = (drinks[idx].entries || []).slice(0, newCount);
      while (entries.length < newCount) entries.push({ brand: "", drink: "" });
      drinks[idx] = { ...drinks[idx], count: newCount, entries };
    }
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

$("btn-day-editor-close").addEventListener("click", () => closeDayEditor(true));

$("sheet-backdrop").addEventListener("click", () => {
  if (!$("name-review-editor").classList.contains("hidden")) { closeNameReviewSheet(); return; }
  closeDayEditor(true);
});

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
    if (currentDy > 80) closeDayEditor(true);
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

$("btn-review-names").addEventListener("click", () => openNameReviewSheet());

$("btn-review-names-dismiss").addEventListener("click", () => {
  state.reviewNamesDismissedThisSession = true;
  $("review-names-banner").classList.add("hidden");
});

function openNameReviewSheet() {
  const items = getPendingReviewItems(getData());
  state.reviewItems = items;
  const list = $("name-review-list");
  list.innerHTML = "";
  items.forEach((item, index) => {
    const typeLabel = (DRINK_TYPES.find((t) => t.id === item.typeId) || {}).label || item.typeId;
    const row = document.createElement("div");
    row.className = "name-review-row";
    row.innerHTML = `
      <div class="name-review-heading"><span>${escapeHtml(typeLabel)}</span><span class="name-review-raw">"${escapeHtml(item.raw)}"</span></div>
      <label class="drink-field">
        <span class="drink-field-label">Brand</span>
        <input type="text" class="drink-name-input" data-review-field="brand" data-review-index="${index}" value="${escapeHtml(item.brand)}" maxlength="60">
      </label>
      <label class="drink-field">
        <span class="drink-field-label">Drink</span>
        <input type="text" class="drink-name-input" data-review-field="drink" data-review-index="${index}" value="${escapeHtml(item.drink)}" maxlength="60">
      </label>`;
    list.appendChild(row);
  });
  $("sheet-backdrop").classList.remove("hidden");
  $("name-review-editor").classList.remove("hidden");
}

function closeNameReviewSheet() {
  $("sheet-backdrop").classList.add("hidden");
  $("name-review-editor").classList.add("hidden");
}

$("btn-name-review-close").addEventListener("click", closeNameReviewSheet);

$("btn-name-review-save").addEventListener("click", () => {
  const corrections = (state.reviewItems || []).map((item, index) => {
    const brandInput = document.querySelector(`[data-review-field="brand"][data-review-index="${index}"]`);
    const drinkInput = document.querySelector(`[data-review-field="drink"][data-review-index="${index}"]`);
    return { typeId: item.typeId, raw: item.raw, brand: brandInput ? brandInput.value : item.brand, drink: drinkInput ? drinkInput.value : item.drink };
  });
  applyNameReview(corrections);
  state.reviewItems = [];
  closeNameReviewSheet();
  renderHome();
  toast("Drink names updated");
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

// ------------------- drink insights -------------------

const STATS_PERIODS = {
  week: { days: 7, label: "Last 7 days" },
  month: { days: 30, label: "Last 30 days" },
  quarter: { days: 90, label: "Last 3 months" },
  year: { days: 365, label: "Last year" },
};

function computeDrinkInsights(data, today, days) {
  const from = addDays(today, -(days - 1));
  const categories = new Map(DRINK_TYPES.map((type) => [type.id, {
    type,
    total: 0,
    named: 0,
    brands: new Map(),
    drinkNames: new Map(),
  }]));

  for (const [dateStr, entry] of Object.entries(data.days)) {
    if (compareDateStr(dateStr, from) < 0 || compareDateStr(dateStr, today) > 0) continue;
    for (const drink of entry.drinks) {
      const category = categories.get(drink.type);
      if (!category) continue;
      category.total += drink.count;
      for (const e of drink.entries || []) {
        const brand = (e.brand || "").trim();
        const drinkName = (e.drink || "").trim();
        if (drinkName) category.named++;
        if (brand) {
          const key = brand.toLocaleLowerCase();
          const existing = category.brands.get(key);
          if (existing) existing.count++;
          else category.brands.set(key, { name: brand, count: 1 });
        }
        if (drinkName) {
          const key = drinkName.toLocaleLowerCase();
          const existing = category.drinkNames.get(key);
          if (existing) existing.count++;
          else category.drinkNames.set(key, { name: drinkName, count: 1 });
        }
      }
    }
  }

  const list = [...categories.values()];
  const total = list.reduce((sum, category) => sum + category.total, 0);
  const named = list.reduce((sum, category) => sum + category.named, 0);
  const distinct = list.reduce((sum, category) => sum + category.drinkNames.size, 0);
  const max = Math.max(0, ...list.map((category) => category.total));
  const leader = max > 0 ? list.find((category) => category.total === max) : null;
  return { from, today, list, total, named, distinct, max, leader };
}

function shortRangeDate(dateStr) {
  return dateFromStr(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function renderDrinkInsights() {
  const period = STATS_PERIODS[state.statsPeriod];
  const stats = computeDrinkInsights(getData(), todayStr(), period.days);
  document.querySelectorAll(".period-option").forEach((button) => {
    const active = button.dataset.period === state.statsPeriod;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  $("drinks-period-label").textContent = `${period.label} · ${shortRangeDate(stats.from)}–${shortRangeDate(stats.today)}`;
  $("drinks-total").textContent = String(stats.total);
  $("drinks-named-total").textContent = String(stats.named);
  $("drinks-distinct-total").textContent = String(stats.distinct);
  $("drinks-named-percent").textContent = stats.total ? `${Math.round((stats.named / stats.total) * 100)}%` : "0%";
  $("drinks-leader").textContent = stats.leader
    ? `${stats.leader.type.label} leads · ${stats.leader.total}`
    : "No drinks logged";

  const container = $("drink-category-stats");
  container.innerHTML = "";
  const sortedList = [...stats.list].sort((a, b) => b.total - a.total);
  for (const category of sortedList) {
    const isLeader = category === stats.leader;
    const fillPercent = category.total > 0 ? Math.max(8, (category.total / stats.max) * 100) : 0;
    const brands = [...category.brands.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const drinkNames = [...category.drinkNames.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const unnamed = category.total - category.named;

    const card = document.createElement("article");
    card.className = "drink-category-card" + (isLeader ? " is-leader" : "");
    card.style.setProperty("--category-color", category.type.color);

    const statRows = (items) => items.map((item) => `
      <div class="brand-stat-row">
        <span>${escapeHtml(item.name)}</span>
        <strong>${item.count}</strong>
      </div>`).join("");
    const brandRows = brands.length > 0 ? `
      <p class="name-list-subhead">By brand</p>
      ${statRows(brands)}` : "";
    const unnamedRow = unnamed > 0 ? `
      <div class="brand-stat-row is-unnamed">
        <span>Not specified</span>
        <strong>${unnamed}</strong>
      </div>` : "";
    const drinkRows = (drinkNames.length > 0 || unnamedRow) ? `
      <p class="name-list-subhead">By drink</p>
      ${statRows(drinkNames)}${unnamedRow}` : "";
    const emptyRow = category.total === 0 ? `<p class="category-empty">Nothing logged in this period.</p>` : "";

    card.innerHTML = `
      <div class="category-card-content">
        <div class="category-card-heading">
          <div>
            <div class="category-title-line">
              <h3>${category.type.label}</h3>
              ${isLeader ? '<span class="leader-chip">Leader</span>' : ""}
            </div>
            <p><strong>${category.total}</strong> drink${s(category.total)} · <strong>${category.drinkNames.size}</strong> named option${s(category.drinkNames.size)}</p>
          </div>
        </div>
        <div class="category-name-list">${brandRows}${drinkRows}${emptyRow}</div>
      </div>
      <div class="thermometer-wrap" aria-label="${category.type.label}: ${category.total} drinks">
        <span class="thermometer-value">${category.total}</span>
        <div class="thermometer-tube"><span style="height:${fillPercent.toFixed(1)}%"></span></div>
        <div class="thermometer-bulb"></div>
      </div>`;
    container.appendChild(card);
  }
}

$("btn-open-drinks").addEventListener("click", () => showScreen("screen-drinks"));
$("btn-drinks-back").addEventListener("click", () => showScreen("screen-home"));
document.querySelectorAll(".period-option").forEach((button) => {
  button.addEventListener("click", () => {
    state.statsPeriod = button.dataset.period;
    renderDrinkInsights();
  });
});

// ------------------- settings -------------------

function renderSettings() {
  const data = getData();
  const type = GOAL_TYPES[data.settings.goalType];
  document.querySelectorAll(".goal-type-option").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.goalType === data.settings.goalType);
  });
  $("settings-goal-label").textContent = type.label;
  $("settings-goal-value").textContent = String(data.settings[type.field]);
  $("settings-share-url").checked = data.settings.shareIncludeUrl;
  $("confirm-delete-all").classList.add("hidden");
  state.deleteAllArmed = false;
}

$("btn-open-settings").addEventListener("click", () => showScreen("screen-settings"));
$("btn-settings-back").addEventListener("click", () => showScreen("screen-home"));

document.querySelectorAll(".goal-type-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    const data = getData();
    data.settings.goalType = btn.dataset.goalType;
    setData(data);
    renderSettings();
  });
});

function adjustGoalValue(delta) {
  const data = getData();
  const type = GOAL_TYPES[data.settings.goalType];
  const next = Math.min(type.max, Math.max(type.min, data.settings[type.field] + delta));
  data.settings[type.field] = next;
  setData(data);
  $("settings-goal-value").textContent = String(next);
}
$("btn-goal-dec").addEventListener("click", () => adjustGoalValue(-1));
$("btn-goal-inc").addEventListener("click", () => adjustGoalValue(1));

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
      if (!d) return null;
      const names = [...new Set((d.entries || []).map((e) => [e.brand, e.drink].map((part) => part.trim()).filter(Boolean).join(" ")).filter(Boolean))];
      return `${type.label} x${d.count}${names.length ? ` (${names.join(", ")})` : ""}`;
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
