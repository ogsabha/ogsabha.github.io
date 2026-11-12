// Og Sabha: main app script (loaded by index.html as a module).
// Service worker lives in sw.js. This file is the app: menu, timetable, wall, gigs, login.

// ---------------------------------------------------------------------------
// 1. FIREBASE CONFIG. Paste yours from Firebase console > Project settings > Your apps > Web app.
//    (Already filled in for the og-sabha project.)
// ---------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDAom6PmaYuSN75PrsVRSGzCHHrvbF8Q8c",
  authDomain: "og-sabha.firebaseapp.com",
  projectId: "og-sabha",
  storageBucket: "og-sabha.firebasestorage.app",
  messagingSenderId: "692594007498",
  appId: "1:692594007498:web:819205fd17a8add28c8333",
  measurementId: "G-M7V4TTLWLK",
};
const STAFF_EMAILS = ["sabhaog@gmail.com"]; // must match isStaff() in firestore.rules
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const configured = !String(firebaseConfig.apiKey).startsWith("PASTE") && !String(firebaseConfig.appId).startsWith("PASTE");

// ---------------------------------------------------------------------------
// 2. Small helpers
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const dayName = (d = new Date()) => WEEK[(d.getDay() + 6) % 7];
const mins = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const t12 = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return `${(h % 12) || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const rng = (a, b) => `${t12(a)} to ${t12(b)}`;
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const millis = (t) => (t && t.toMillis ? t.toMillis() : Date.now());
const shortDate = (ms) => new Date(ms).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function dateOf(day) {
  const d = new Date();
  d.setDate(d.getDate() + WEEK.indexOf(day) - WEEK.indexOf(dayName()));
  return ymd(d);
}
async function loadJSON(name) {
  for (const p of ["data/" + name, name]) {
    try { const r = await fetch(p, { cache: "no-cache" }); if (r.ok) return await r.json(); } catch {}
  }
  return null;
}
function counter(inputId, countId, max) {
  const i = $(inputId), c = $(countId);
  if (!i || !c) return;
  const f = () => { c.textContent = `${i.value.length} / ${max}`; };
  i.addEventListener("input", f); f();
}

// ---------------------------------------------------------------------------
// 3. State
// ---------------------------------------------------------------------------
let menu = null, tt = null;
let db = null, auth = null, user = null, staff = false, fs = null, fa = null;
let selDay = dayName(), selMeal = 0, selClass = "", selClassDay = dayName();
let ratings = {}, myRatings = {}, att = {};
let unsub = { ratings: null, notices: null, att: null, posts: null, pending: null, gigs: null, mine: null, gigPending: null };
let gigs = [], mineGigs = [], pendingGigs = [], gigKind = "all", gigCat = "All";
let applyGig = null;

const CATS = ["Design", "Coding & tech", "Photo & video", "Tutoring", "Writing & editing", "Music & events", "Errands & help", "Other"];
const CAT_COL = { "Design": "#ffd6e7", "Coding & tech": "#cfe3ff", "Photo & video": "#e3d4ff", "Tutoring": "#d4f5dc", "Writing & editing": "#fff1b8", "Music & events": "#ffdcc2", "Errands & help": "#d9f0f0", "Other": "#e6e6e6" };
const MEAL_ICON = { Breakfast: "🥞", Lunch: "🍛", Snacks: "🥟", Dinner: "🍽️" };
const HEADLINES = {
  food: "good food, on time.",
  classes: "which hour\nis this?",
  wall: "say it.\nunsaid, unseen.",
  gigs: "turn skills into\npocket money.",
  about: "made by\nstudents.",
};
const QUOTES = [
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["It always seems impossible until it's done.", "Nelson Mandela"],
  ["Well begun is half done.", "Aristotle"],
  ["An investment in knowledge pays the best interest.", "Benjamin Franklin"],
  ["Education is the most powerful weapon which you can use to change the world.", "Nelson Mandela"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
  ["The expert in anything was once a beginner.", "Helen Hayes"],
];

// ---------------------------------------------------------------------------
// 4. Tabs
// ---------------------------------------------------------------------------
const TABS = ["food", "classes", "wall", "gigs", "about"];
function showTab(name, updateHash = true) {
  if (!TABS.includes(name)) name = "food";
  document.querySelectorAll("nav .tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("main .panel").forEach((p) => p.classList.toggle("active", p.id === name));
  document.body.dataset.theme = name;
  const h1 = $("h1-line");
  if (h1) h1.textContent = HEADLINES[name];
  if (updateHash && location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
}
function initTabs() {
  document.querySelectorAll("nav .tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1), false));
  showTab(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "food", false);
}

// ---------------------------------------------------------------------------
// 5. Food
// ---------------------------------------------------------------------------
function currentMealIndex() {
  if (!menu) return 0;
  const n = nowMins();
  const i = menu.meals.findIndex((m) => n < mins(m.end));
  return i === -1 ? menu.meals.length - 1 : i;
}
function mealLive(m) { return selDay === dayName() && nowMins() >= mins(m.start) && nowMins() < mins(m.end); }
function splitVeg(text) {
  const m = /\(Veg:\s*([^)]*)\)/.exec(text || "");
  return { main: (text || "").replace(/\s*\(Veg:[^)]*\)/, "").trim(), veg: m ? m[1].trim() : "" };
}
function avgOf(mealName) {
  const r = ratings[mealName];
  return r && r.n ? { avg: r.sum / r.n, n: r.n } : null;
}
function renderFood() {
  if (!menu) return;
  const meals = menu.meals;
  const today = dayName();
  $("day-nav").innerHTML = WEEK.map((d) => `<button type="button" class="dchip${d === selDay ? " active" : ""}" data-day="${d}">${d === today ? "today" : d.slice(0, 3).toLowerCase()}</button>`).join("");
  const sel = $("day-select");
  if (sel) { sel.innerHTML = WEEK.map((d) => `<option${d === selDay ? " selected" : ""}>${d}</option>`).join(""); }

  const dayMenu = menu.days[selDay] || {};
  const m = meals[selMeal];
  const { main, veg } = splitVeg(dayMenu[m.name]);
  const live = mealLive(m);
  const a = avgOf(m.name);
  const mine = myRatings[m.name] || 0;
  const date = dateOf(selDay);
  let rateNote;
  if (!db) rateNote = "Ratings switch on when Firebase is connected.";
  else if (!canRate(m)) rateNote = "Rating opens when the meal starts.";
  else rateNote = a ? `${a.avg.toFixed(1)} average from ${a.n} rating${a.n === 1 ? "" : "s"}${mine ? `, you gave ${mine}` : ""}` : "No ratings yet. Be the first.";

  $("food-feature").innerHTML = `
    <div class="stage">
      <div class="slab"></div>
      <div class="plate-art big"><span class="plate-name">${esc(m.name.toLowerCase())}</span></div>
      <div class="rail">${meals.map((x, i) => `<button type="button" class="rail-btn${i === selMeal ? " on" : ""}" data-meal="${i}">${esc(x.name)}</button>`).join("")}</div>
    </div>
    <div class="copy">
      <span class="badge${live ? " pulse" : ""}">${live ? "serving now" : esc(selDay === today ? "today" : selDay)}</span>
      <h2>${esc(main || "Menu not added")}</h2>
      ${veg ? `<p class="desc">Veg: ${esc(veg)}</p>` : ""}
      <p class="when">${esc(rng(m.start, m.end))}<small>approx. ${esc(m.name.toLowerCase())} time</small></p>
      <div class="rate">
        <div class="stars" role="group" aria-label="Rate this meal" data-date="${date}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" class="${n <= mine ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}</div>
        <p class="muted">${esc(rateNote)}</p>
      </div>
    </div>`;

  $("food-list").innerHTML = meals.map((x, i) => {
    const t = splitVeg(dayMenu[x.name]);
    const ra = avgOf(x.name);
    return `<button type="button" class="tile${i === selMeal ? " on" : ""}" data-meal="${i}">
      <span class="plate-art"><span class="plate-name">${MEAL_ICON[x.name] || "🍴"}</span></span>
      <span class="tile-time">${esc(t12(x.start))}</span>
      <span class="tile-name">${esc(x.name)}</span>
      <span class="tile-sub">${esc(t.main)}</span>
      <span class="tile-foot">${mealLive(x) ? "● serving now" : ""}<span>${ra ? "★ " + ra.avg.toFixed(1) : ""}</span></span>
    </button>`;
  }).join("");
  $("food-dots").innerHTML = meals.map((x, i) => `<button type="button" class="${i === selMeal ? "on" : ""}" data-meal="${i}" aria-label="${esc(x.name)}"></button>`).join("");
}
function canRate(m) {
  const d = dateOf(selDay), t = ymd(new Date());
  return d < t || (d === t && nowMins() >= mins(m.start));
}
function subscribeRatings() {
  if (unsub.ratings) { unsub.ratings(); unsub.ratings = null; }
  ratings = {}; myRatings = {};
  if (!db) return;
  const date = dateOf(selDay);
  const q = fs.query(fs.collection(db, "ratings"), fs.where("date", "==", date));
  unsub.ratings = fs.onSnapshot(q, (snap) => {
    ratings = {}; myRatings = {};
    snap.forEach((d) => {
      const r = d.data();
      const o = (ratings[r.meal] ||= { sum: 0, n: 0 });
      o.sum += r.stars; o.n += 1;
      if (user && d.id.endsWith("_" + user.uid)) myRatings[r.meal] = r.stars;
    });
    renderFood();
  }, () => {});
}
async function rate(n) {
  const m = menu.meals[selMeal];
  if (!db || !user || !canRate(m)) return;
  const date = dateOf(selDay);
  try {
    await fs.setDoc(fs.doc(db, "ratings", `${date}_${m.name}_${user.uid}`), { date, meal: m.name, stars: n });
  } catch { /* rules rejected it; ignore */ }
}
function initFood() {
  const food = $("food");
  food.addEventListener("click", (e) => {
    const day = e.target.closest("[data-day]");
    const meal = e.target.closest("[data-meal]");
    const star = e.target.closest("[data-star]");
    if (day) { selDay = day.dataset.day; selMeal = selDay === dayName() ? currentMealIndex() : 0; subscribeRatings(); renderFood(); }
    else if (meal) { selMeal = Number(meal.dataset.meal); renderFood(); }
    else if (star) rate(Number(star.dataset.star));
  });
  const sel = $("day-select");
  if (sel) sel.addEventListener("change", () => { selDay = sel.value; subscribeRatings(); renderFood(); });
  selMeal = currentMealIndex();
  renderFood();
  subscribeRatings();
}

// ---------------------------------------------------------------------------
// 6. Classes
// ---------------------------------------------------------------------------
const periodOf = (no) => tt.periods.find((p) => p.no === no);
function slotsFor(cls, day) { return ((tt.classes[cls] || {})[day] || []).slice().sort((a, b) => a.period - b.period); }
function currentSlot(cls) {
  const day = dayName(), n = nowMins();
  const slots = slotsFor(cls, day);
  let cur = null, next = null;
  for (const s of slots) {
    const p = periodOf(s.period);
    if (n >= mins(p.start) && n < mins(p.end)) cur = { s, p };
    else if (n < mins(p.start) && !next) next = { s, p };
  }
  return { cur, next, slots };
}
function renderNow() {
  const strip = $("now-strip");
  if (!menu || !tt) { strip.innerHTML = ""; return; }
  const day = dayName(), n = nowMins();
  const live = menu.meals.find((m) => n >= mins(m.start) && n < mins(m.end));
  const upcoming = menu.meals.find((m) => n < mins(m.start));
  const shown = live || upcoming;
  const mealHtml = shown
    ? `<span class="k">${live ? "Now in the mess" : "Next meal"}</span><strong>${esc(shown.name)}, ${esc(t12(shown.start))}</strong><span class="muted">${esc(splitVeg((menu.days[day] || {})[shown.name]).main)}</span>`
    : `<span class="k">Mess</span><strong>Kitchen is closed</strong><span class="muted">See you at breakfast.</span>`;
  let classHtml;
  if (!selClass) classHtml = `<span class="k">Class</span><strong>Pick your class</strong>`;
  else {
    const { cur, next, slots } = currentSlot(selClass);
    if (cur) classHtml = `<span class="k">${esc(selClass)} now</span><strong>${esc(cur.s.subject)}</strong><span class="muted">${esc(cur.s.teacher)}, period ${cur.s.period}</span>`;
    else if (next) classHtml = `<span class="k">${esc(selClass)} next</span><strong>${esc(next.s.subject)}</strong><span class="muted">${esc(t12(next.p.start))}, ${esc(next.s.teacher)}</span>`;
    else classHtml = `<span class="k">${esc(selClass)}</span><strong>${slots.length ? "Classes are over" : "No classes today"}</strong><span class="muted">${slots.length ? "Rest up." : "Enjoy."}</span>`;
  }
  strip.innerHTML = `<div>${mealHtml}</div><div>${classHtml}</div>`;
}
function renderClassNow() {
  const box = $("class-now");
  if (!tt || !selClass) { box.innerHTML = ""; return; }
  const n = nowMins();
  const { cur, next, slots } = currentSlot(selClass);
  if (cur) {
    const start = mins(cur.p.start), end = mins(cur.p.end);
    const pct = Math.round(((n - start) / (end - start)) * 100);
    box.innerHTML = `<div class="card live"><span class="badge pulse">Right now, period ${cur.s.period}</span>
      <h3>${esc(cur.s.subject)}</h3><p class="muted">${esc(cur.s.teacher)} · ${esc(rng(cur.p.start, cur.p.end))}</p>
      <div class="bar"><i style="--w:${pct}%"></i></div><p class="muted">${end - n} min left</p></div>`;
  } else if (dayName() !== "Sunday" && n >= 13 * 60 + 15 && n < 14 * 60 + 15) {
    box.innerHTML = `<div class="card"><span class="badge grey">Lunch break</span><p class="muted">Classes resume at 2:15 PM.</p></div>`;
  } else if (next) {
    box.innerHTML = `<div class="card"><span class="badge">Next up</span><h3>${esc(next.s.subject)}</h3><p class="muted">${esc(next.s.teacher)} · starts ${esc(t12(next.p.start))}</p></div>`;
  } else {
    box.innerHTML = `<div class="card"><span class="badge grey">${slots.length ? "Done for today" : "No classes today"}</span></div>`;
  }
}
function renderClassTable() {
  const box = $("class-table");
  if (!tt || !selClass) { box.innerHTML = ""; return; }
  $("day-chips").innerHTML = WEEK.map((d) => `<button type="button" class="${d === selClassDay ? "active" : ""}${d === dayName() ? " today" : ""}" data-cday="${d}">${d.slice(0, 3)}</button>`).join("");
  const slots = slotsFor(selClass, selClassDay);
  if (!slots.length) { box.innerHTML = `<p class="muted">${selClassDay === "Sunday" ? "Sunday is a day off." : "No classes this day."}</p>`; return; }
  const isToday = selClassDay === dayName();
  const { cur } = currentSlot(selClass);
  const rows = slots.map((s) => {
    const p = periodOf(s.period);
    const isCur = isToday && cur && cur.s.period === s.period;
    const real = isToday && s.teacher !== "-" && s.teacher !== "Whole class";
    const st = att[s.period];
    let badge = "";
    if (real) {
      if (st === "in") badge = `<span class="badge good">Teacher in class</span>`;
      else if (st === "out") badge = `<span class="badge bad">Teacher away</span>`;
      else if (isCur) badge = `<span class="badge grey">Not marked yet</span>`;
    }
    const acts = staff && real ? `<div class="actions"><button type="button" class="ghost" data-att="in" data-period="${s.period}">In</button><button type="button" class="ghost" data-att="out" data-period="${s.period}">Away</button></div>` : "";
    return `<tr${isCur ? ' class="current"' : ""}><td class="muted">P${s.period}<br>${esc(t12(p.start))}</td><td><strong>${esc(s.subject)}</strong><div class="muted">${esc(s.teacher)}</div>${badge}${acts}</td></tr>`;
  }).join("");
  box.innerHTML = `<table><tbody>${rows}</tbody></table>`;
}
function renderQuote() {
  const day = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 864e5);
  const q = QUOTES[day % QUOTES.length];
  $("quote-text").textContent = q[0];
  $("quote-by").textContent = q[1];
}
function subscribeClass() {
  for (const k of ["notices", "att"]) if (unsub[k]) { unsub[k](); unsub[k] = null; }
  att = {};
  $("notice-list").innerHTML = "";
  $("notice-to").textContent = selClass;
  if (!db || !selClass) return;
  unsub.notices = fs.onSnapshot(fs.query(fs.collection(db, "notices"), fs.where("cls", "==", selClass)), (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => millis(b.createdAt) - millis(a.createdAt)).slice(0, 5);
    $("notice-list").innerHTML = items.map((n) => `<div class="card"><p class="notice-head">Notice for ${esc(n.cls)} · ${esc(shortDate(millis(n.createdAt)))}</p><p>${esc(n.text)}</p>${staff ? `<div class="actions"><button type="button" class="ghost" data-delnotice="${n.id}">Delete</button></div>` : ""}</div>`).join("");
  }, () => {});
  unsub.att = fs.onSnapshot(fs.query(fs.collection(db, "attendance"), fs.where("cls", "==", selClass), fs.where("date", "==", ymd(new Date()))), (snap) => {
    att = {};
    snap.forEach((d) => { const a = d.data(); att[a.period] = a.status; });
    renderClassTable();
  }, () => {});
}
async function markAttendance(period, status) {
  if (!db || !staff) return;
  const date = ymd(new Date());
  await fs.setDoc(fs.doc(db, "attendance", `${slug(selClass)}_${date}_${period}`), { cls: selClass, date, period: Number(period), status, by: user.email || "", at: fs.serverTimestamp() });
}
function initClasses() {
  if (!tt) return;
  const names = Object.keys(tt.classes);
  selClass = store.get("og-class", names[0]);
  if (!names.includes(selClass)) selClass = names[0];
  const sel = $("class-select");
  sel.innerHTML = names.map((n) => `<option${n === selClass ? " selected" : ""}>${esc(n)}</option>`).join("");
  sel.addEventListener("change", () => { selClass = sel.value; store.set("og-class", selClass); subscribeClass(); renderAllClass(); });
  $("classes").addEventListener("click", (e) => {
    const d = e.target.closest("[data-cday]");
    const a = e.target.closest("[data-att]");
    const del = e.target.closest("[data-delnotice]");
    if (d) { selClassDay = d.dataset.cday; renderClassTable(); }
    else if (a) markAttendance(a.dataset.period, a.dataset.att);
    else if (del && staff) fs.deleteDoc(fs.doc(db, "notices", del.dataset.delnotice));
  });
  counter("notice-text", "notice-count", 400);
  $("notice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("notice-text").value.trim();
    if (!text || !staff) return;
    try {
      await fs.addDoc(fs.collection(db, "notices"), { cls: selClass, text, createdAt: fs.serverTimestamp() });
      $("notice-text").value = ""; $("notice-count").textContent = "0 / 400";
      $("notice-msg").textContent = "Published.";
    } catch { $("notice-msg").textContent = "Could not publish. Are you logged in as staff?"; }
  });
  renderQuote();
  renderAllClass();
  subscribeClass();
}
function renderAllClass() { renderClassNow(); renderClassTable(); renderNow(); }

// ---------------------------------------------------------------------------
// 7. Wall
// ---------------------------------------------------------------------------
function postCard(p, mode) {
  const reported = store.get("og-reported-posts", []).includes(p.id);
  const acts = mode === "pending"
    ? `<button type="button" data-approve="${p.id}">Approve</button><button type="button" class="ghost" data-delpost="${p.id}">Delete</button>`
    : `<button type="button" class="ghost" data-report="${p.id}"${reported ? " disabled" : ""}>${reported ? "Reported" : "Report"}</button>${staff ? `<button type="button" class="ghost" data-delpost="${p.id}">Delete</button>` : ""}`;
  return `<div class="card"><p>${esc(p.text)}</p><p class="muted">${esc(shortDate(millis(p.createdAt)))}</p><div class="actions">${acts}</div></div>`;
}
let posts = [], pendingPosts = [];
function renderPosts() {
  const visible = posts.filter((p) => staff || (p.reports || 0) < 3).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  $("post-list").innerHTML = visible.length ? visible.map((p) => postCard(p, "live")).join("") : `<p class="muted">Nothing here yet. The first whisper is yours.</p>`;
  $("pending-box").hidden = !(staff && pendingPosts.length);
  $("pending-list").innerHTML = pendingPosts.sort((a, b) => millis(a.createdAt) - millis(b.createdAt)).map((p) => postCard(p, "pending")).join("");
}
function subscribePosts() {
  if (!db) { renderPosts(); return; }
  if (unsub.posts) unsub.posts();
  unsub.posts = fs.onSnapshot(fs.query(fs.collection(db, "posts"), fs.where("approved", "==", true)), (snap) => {
    posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPosts();
  }, () => {});
}
function subscribePending() {
  if (unsub.pending) { unsub.pending(); unsub.pending = null; }
  pendingPosts = [];
  if (!db || !staff) { renderPosts(); return; }
  unsub.pending = fs.onSnapshot(fs.query(fs.collection(db, "posts"), fs.where("approved", "==", false)), (snap) => {
    pendingPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPosts();
  }, () => {});
}
async function reportDoc(col, id) {
  if (!db || !user) return;
  const key = col === "posts" ? "og-reported-posts" : "og-reported-gigs";
  const list = store.get(key, []);
  if (list.includes(id)) return;
  const batch = fs.writeBatch(db);
  batch.update(fs.doc(db, col, id), { reports: fs.increment(1) });
  batch.set(fs.doc(db, col, id, "reports", user.uid), { createdAt: fs.serverTimestamp() });
  try { await batch.commit(); store.set(key, [...list, id]); } catch { /* already reported or rejected */ }
  col === "posts" ? renderPosts() : renderGigs();
}
function initWall() {
  counter("post-text", "post-count", 300);
  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("post-text").value.trim();
    const msg = $("post-msg");
    if (!text) return;
    if (!db || !user) { msg.textContent = "Not connected yet. Try again in a moment."; return; }
    try {
      await fs.addDoc(fs.collection(db, "posts"), { text, approved: false, reports: 0, createdAt: fs.serverTimestamp() });
      $("post-text").value = ""; $("post-count").textContent = "0 / 300";
      msg.textContent = "Received. It will appear once an admin approves it.";
    } catch { msg.textContent = "Could not post. Please try again."; }
  });
  $("wall").addEventListener("click", async (e) => {
    const go = e.target.closest("[data-go]");
    const rep = e.target.closest("[data-report]");
    const app = e.target.closest("[data-approve]");
    const del = e.target.closest("[data-delpost]");
    if (e.target.closest("#wp-down")) $("post-form").scrollIntoView({ behavior: "smooth" });
    else if (go) { const t = $(go.dataset.go); if (t) t.scrollIntoView({ behavior: "smooth" }); document.querySelectorAll(".wp-dot").forEach((d) => d.classList.toggle("on", d === go)); }
    else if (rep) reportDoc("posts", rep.dataset.report);
    else if (app && staff) fs.updateDoc(fs.doc(db, "posts", app.dataset.approve), { approved: true });
    else if (del && staff) fs.deleteDoc(fs.doc(db, "posts", del.dataset.delpost));
  });
  renderPosts();
  subscribePosts();
}

// ---------------------------------------------------------------------------
// 8. Gigs
// ---------------------------------------------------------------------------
function gigCard(g, mode) {
  const own = user && g.ownerUid === user.uid;
  const reported = store.get("og-reported-gigs", []).includes(g.id);
  const kindLabel = g.kind === "offer" ? "✋ Offering" : "🔍 Wanted";
  const status = g.status === "closed" ? `<span class="badge grey">Closed</span>` : "";
  const wait = g.approved ? "" : `<span class="badge grey">Waiting for approval</span>`;
  let acts = "";
  if (mode === "pending") acts = `<button type="button" data-gapprove="${g.id}">Approve</button><button type="button" class="ghost" data-gdel="${g.id}">Delete</button>`;
  else if (mode === "mine") acts = `<button type="button" class="ghost" data-gtoggle="${g.id}">${g.status === "closed" ? "Reopen" : "Close"}</button><button type="button" class="ghost" data-gresp="${g.id}">Replies</button><button type="button" class="ghost" data-gdel="${g.id}">Delete</button>`;
  else {
    if (!own && g.status !== "closed") acts += `<button type="button" data-gapply="${g.id}">${g.kind === "offer" ? "Hire" : "Apply"}</button>`;
    if (own) acts += `<button type="button" class="ghost" data-gresp="${g.id}">Replies</button>`;
    if (!own) acts += `<button type="button" class="ghost" data-greport="${g.id}"${reported ? " disabled" : ""}>${reported ? "Reported" : "Report"}</button>`;
    if (staff) acts += `<button type="button" class="ghost" data-gdel="${g.id}">Delete</button>`;
  }
  return `<div class="card gig${g.status === "closed" ? " closed" : ""}" data-gid="${g.id}">
    <span class="badge">${kindLabel}</span> <span class="badge grey">${esc(g.category)}</span> ${status} ${wait}
    <h3>${esc(g.title)}</h3><p>${esc(g.details)}</p>
    <p class="muted">${g.pay ? esc(g.pay) + " · " : ""}${esc(g.name || "Anonymous")} · ${esc(shortDate(millis(g.createdAt)))}</p>
    <div class="actions">${acts}</div><div class="resp-box"></div></div>`;
}
function renderGigs() {
  const vis = gigs.filter((g) => (gigKind === "all" || g.kind === gigKind) && (gigCat === "All" || g.category === gigCat) && (staff || (g.reports || 0) < 3))
    .sort((a, b) => (a.status === "closed") - (b.status === "closed") || millis(b.createdAt) - millis(a.createdAt));
  $("gig-list").innerHTML = vis.length ? vis.map((g) => gigCard(g, "board")).join("") : `<p class="muted">No gigs here yet.</p>`;
  const mine = mineGigs.filter((g) => !g.approved || true).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  $("gig-mine-box").hidden = !mine.length;
  $("gig-mine").innerHTML = mine.map((g) => gigCard(g, "mine")).join("");
  $("gig-pending-box").hidden = !(staff && pendingGigs.length);
  $("gig-pending").innerHTML = pendingGigs.map((g) => gigCard(g, "pending")).join("");
  const live = gigs.filter((g) => g.status !== "closed").length;
  $("gig-stat").textContent = `${live} live`;
  $("gig-stat-sub").textContent = live ? "Fresh gigs from your classmates." : "Be the first to post.";
  $("gig-avatars").innerHTML = gigs.slice(0, 5).map((g, i) => `<span style="--c:${CAT_COL[g.category] || "#eee"}">${esc((g.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>`).join("") + (gigs.length > 5 ? `<span class="more">+${gigs.length - 5}</span>` : "");
  renderArc();
}
function renderArc() {
  const count = (c) => gigs.filter((g) => c === "All" || g.category === c).length;
  $("gig-arc").innerHTML = ["All", ...CATS].map((c) => `<button type="button" class="chip-g${c === gigCat ? " on" : ""}" data-gcat="${esc(c)}">${esc(c)} <span>${count(c)}</span></button>`).join("");
}
function subscribeGigs() {
  if (!db) { renderGigs(); return; }
  if (unsub.gigs) unsub.gigs();
  unsub.gigs = fs.onSnapshot(fs.query(fs.collection(db, "gigs"), fs.where("approved", "==", true)), (snap) => {
    gigs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGigs();
  }, () => {});
}
function subscribeMine() {
  if (unsub.mine) { unsub.mine(); unsub.mine = null; }
  mineGigs = [];
  if (!db || !user) { renderGigs(); return; }
  unsub.mine = fs.onSnapshot(fs.query(fs.collection(db, "gigs"), fs.where("ownerUid", "==", user.uid)), (snap) => {
    mineGigs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGigs();
  }, () => {});
}
function subscribeGigPending() {
  if (unsub.gigPending) { unsub.gigPending(); unsub.gigPending = null; }
  pendingGigs = [];
  if (!db || !staff) { renderGigs(); return; }
  unsub.gigPending = fs.onSnapshot(fs.query(fs.collection(db, "gigs"), fs.where("approved", "==", false)), (snap) => {
    pendingGigs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGigs();
  }, () => {});
}
async function showReplies(id, card) {
  const box = card.querySelector(".resp-box");
  if (box.dataset.open) { box.innerHTML = ""; delete box.dataset.open; return; }
  try {
    const snap = await fs.getDocs(fs.collection(db, "gigs", id, "responses"));
    const items = snap.docs.map((d) => d.data()).sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
    box.innerHTML = items.length ? items.map((r) => `<div class="resp"><p><strong>${esc(r.name)}</strong></p><p>${esc(r.message)}</p><p class="muted">Reach them: ${esc(r.contact)}</p></div>`).join("") : `<div class="resp"><p class="muted">No replies yet.</p></div>`;
    box.dataset.open = "1";
  } catch { box.innerHTML = `<div class="resp"><p class="muted">Could not load replies.</p></div>`; }
}
function openApply(g) {
  applyGig = g;
  $("apply-title").textContent = g.kind === "offer" ? "Hire for this skill" : "Apply for this gig";
  $("apply-sub").textContent = g.title;
  $("apply-msg-label").textContent = g.kind === "offer" ? "What do you need?" : "Why you?";
  $("apply-status").textContent = "";
  $("apply-name").value = store.get("og-apply-name", "");
  $("apply-contact").value = store.get("og-apply-contact", "");
  $("apply-dialog").showModal();
}
function initGigs() {
  $("gig-cat").innerHTML = CATS.map((c) => `<option>${esc(c)}</option>`).join("");
  $("gig-cat-filter").innerHTML = ["All", ...CATS].map((c) => `<option>${esc(c)}</option>`).join("");
  $("gig-cat-filter").addEventListener("change", (e) => { gigCat = e.target.value; renderGigs(); });
  counter("gig-details", "gig-count", 300);
  $("gigs").addEventListener("click", async (e) => {
    const t = (sel) => e.target.closest(sel);
    const seg = t(".seg-btn"), cat = t("[data-gcat]"), card = t("[data-gid]");
    if (seg) { gigKind = seg.dataset.kind; document.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b === seg)); renderGigs(); return; }
    if (cat) { gigCat = cat.dataset.gcat; $("gig-cat-filter").value = gigCat; renderGigs(); return; }
    if (t("#gig-cta-post")) { $("gig-compose").open = true; $("gig-compose").scrollIntoView({ behavior: "smooth" }); return; }
    if (t("#gig-cta-browse")) { $("gig-board").scrollIntoView({ behavior: "smooth" }); return; }
    const all = [...gigs, ...mineGigs, ...pendingGigs];
    const pick = (a) => { const b = t(`[data-${a}]`); return b ? { id: b.dataset[a], g: all.find((x) => x.id === b.dataset[a]) } : null; };
    let h;
    if ((h = pick("gapply"))) openApply(h.g);
    else if ((h = pick("greport"))) reportDoc("gigs", h.id);
    else if ((h = pick("gresp"))) showReplies(h.id, card);
    else if ((h = pick("gtoggle"))) fs.updateDoc(fs.doc(db, "gigs", h.id), { status: h.g.status === "closed" ? "open" : "closed" });
    else if ((h = pick("gapprove")) && staff) fs.updateDoc(fs.doc(db, "gigs", h.id), { approved: true });
    else if ((h = pick("gdel"))) { if (confirm("Delete this gig?")) fs.deleteDoc(fs.doc(db, "gigs", h.id)); }
  });
  $("gig-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("gig-msg");
    if (!db || !user) { msg.textContent = "Not connected yet. Try again in a moment."; return; }
    const data = {
      kind: $("gig-kind").value, title: $("gig-title").value.trim(), category: $("gig-cat").value,
      details: $("gig-details").value.trim(), pay: $("gig-pay").value.trim(), name: $("gig-name").value.trim(),
      ownerUid: user.uid, approved: false, reports: 0, status: "open", createdAt: fs.serverTimestamp(),
    };
    try {
      await fs.addDoc(fs.collection(db, "gigs"), data);
      $("gig-form").reset(); $("gig-count").textContent = "0 / 300";
      msg.textContent = "Posted. It shows on the board once an admin approves it.";
    } catch { msg.textContent = "Could not post. Check the title (3+ letters) and try again."; }
  });
  $("apply-cancel").addEventListener("click", () => $("apply-dialog").close());
  $("apply-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = $("apply-status");
    if (!db || !user || !applyGig) return;
    const name = $("apply-name").value.trim(), contact = $("apply-contact").value.trim();
    try {
      await fs.setDoc(fs.doc(db, "gigs", applyGig.id, "responses", user.uid), {
        name, message: $("apply-message").value.trim(), contact, applicantUid: user.uid, createdAt: fs.serverTimestamp(),
      });
      store.set("og-apply-name", name); store.set("og-apply-contact", contact);
      st.textContent = "Sent. Only the poster can see this.";
      setTimeout(() => $("apply-dialog").close(), 1200);
    } catch { st.textContent = "Could not send. The gig may be closed."; }
  });
  renderGigs();
  subscribeGigs();
  initGlobe();
}
function initGlobe() {
  const c = $("gig-globe");
  if (!c || !c.getContext) return;
  const ctx = c.getContext("2d");
  const pts = [];
  for (let i = 0; i < 260; i++) { const y = 1 - (i / 259) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let a = 0;
  function draw() {
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth || 300, h = c.clientHeight || 300;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) * 0.38, cx = w / 2, cy = h / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const [x, y, z] of pts) {
      const X = x * ca + z * sa, Z = -x * sa + z * ca;
      ctx.globalAlpha = 0.25 + 0.75 * ((Z + 1) / 2);
      ctx.fillStyle = "#111";
      ctx.beginPath(); ctx.arc(cx + X * R, cy + y * R, 1.2 + (Z + 1) * 0.9, 0, 6.283); ctx.fill();
    }
    a += 0.004;
    if (!reduce && document.body.dataset.theme === "gigs") requestAnimationFrame(draw);
    else if (!reduce) setTimeout(() => requestAnimationFrame(draw), 400);
  }
  draw();
}

// ---------------------------------------------------------------------------
// 9. Login and Firebase start-up
// ---------------------------------------------------------------------------
function applyAuthUi() {
  const email = user && !user.isAnonymous ? user.email : "";
  staff = !!email && STAFF_EMAILS.includes(email);
  $("notice-compose").hidden = !staff;
  const st = $("auth-status");
  st.innerHTML = email ? `Signed in as ${esc(email)}${staff ? " (staff)" : ""}. <button type="button" class="ghost" id="logout-btn">Log out</button>` : "";
  const out = $("logout-btn");
  if (out) out.addEventListener("click", async () => { await fa.signOut(auth); });
  subscribePending(); subscribeGigPending(); subscribeMine(); subscribeRatings();
  renderPosts(); renderGigs(); renderClassTable();
}
function initLogin() {
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = $("auth-status");
    if (!auth) { st.textContent = "Firebase is not connected yet."; return; }
    try {
      await fa.signInWithEmailAndPassword(auth, $("login-email").value.trim(), $("login-pass").value);
      $("login-pass").value = "";
    } catch { st.textContent = "Login failed. Check the email and password."; }
  });
}
async function startFirebase() {
  if (!configured) { $("setup-note").hidden = false; return; }
  try {
    const [appM, faM, fsM] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js"),
    ]);
    fa = faM; fs = fsM;
    const app = appM.initializeApp(firebaseConfig);
    auth = fa.getAuth(app);
    db = fs.getFirestore(app);
    fa.onAuthStateChanged(auth, (u) => {
      if (!u) { fa.signInAnonymously(auth).catch(() => {}); return; }
      user = u;
      applyAuthUi();
    });
    subscribeRatings(); subscribePosts(); subscribeGigs(); subscribeClass();
  } catch (err) {
    console.error("Firebase failed to start", err);
    db = null;
    $("setup-note").hidden = false;
  }
}

// ---------------------------------------------------------------------------
// 10. Boot
// ---------------------------------------------------------------------------
function greet() {
  const h = new Date().getHours();
  $("greet").textContent = h < 12 ? "good morning" : h < 17 ? "good afternoon" : "good evening";
}
async function boot() {
  initTabs();
  greet();
  initLogin();
  [menu, tt] = await Promise.all([loadJSON("menu.json"), loadJSON("timetable.json")]);
  if (menu) initFood(); else $("food-feature").innerHTML = `<p class="muted">Could not load the menu. Check your connection.</p>`;
  if (tt) initClasses(); else $("class-table").innerHTML = `<p class="muted">Could not load the timetable.</p>`;
  initWall();
  initGigs();
  renderNow();
  setInterval(() => { renderNow(); renderClassNow(); if (menu) renderFood(); }, 30000);
  await startFirebase();
}
boot();

// Installable app + offline support
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
