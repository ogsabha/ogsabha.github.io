// Firebase is loaded with dynamic imports so that, if the CDN is blocked or slow, the rest of the
// app (menu, timetable, tabs) still starts. Only ratings, wall and gigs need Firebase.
let fb = {};
try {
  fb = {
    ...(await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js")),
    ...(await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js")),
    ...(await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js"))
  };
} catch (e) { console.error("Firebase failed to load:", e); }
const {
  initializeApp, getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, increment, writeBatch,
  getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged
} = fb;

/* ---------------------------------------------------------------
   Og Sabha: DCSMAT Vagamon student hub
   Sections: core + tabs, Food, Classes, Wall, Gigs (with globe), staff login.
---------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDAom6PmaYuSN75PrsVRSGzCHHrvbF8Q8c",
  authDomain: "og-sabha.firebaseapp.com",
  projectId: "og-sabha",
  storageBucket: "og-sabha.firebasestorage.app",
  messagingSenderId: "692594007498",
  appId: "1:692594007498:web:819205fd17a8add28c8333"
};

// Add more words you want blocked on the wall and gigs board (lowercase).
const BAD_WORDS = ["idiot", "stupid", "slut", "bitch"];

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayName = () => DAYS[new Date().getDay()];
const fmt12 = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
};
const parts12 = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return { t: `${h % 12 || 12}:${pad(m)}`, ap: h >= 12 ? "PM" : "AM" };
};
const fmtDur = (min) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min} min`);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const isPhone = () => matchMedia("(max-width: 759px)").matches;

const store = {
  get(k, fallback = null) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
};

// Builds DOM safely. Text is always set as text, never as HTML.
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, props = {}, ...kids) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v; else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid) e.append(kid);
  return e;
}

/* ---------- firebase ---------- */
const ready = !!initializeApp && !firebaseConfig.apiKey.startsWith("PASTE");
let db, auth;
if (ready) {
  const fbApp = initializeApp(firebaseConfig);
  db = getFirestore(fbApp);
  auth = getAuth(fbApp);
} else {
  const note = $("setup-note");
  note.hidden = false;
  if (!initializeApp) note.textContent = "Could not reach Firebase (check your internet or ad blocker). The menu and timetable still work, but ratings, the wall and gigs are off.";
}

let currentUser = null; // staff only (email login)
let me = null;          // anyone signed in, including anonymous visitors
let anonFailed = false;
let lastAuthError = "";

// Resolves with the signed-in user (anonymous or staff). Waits for / retries the anonymous
// sign-in instead of giving up, so a slow connection no longer shows "Still connecting".
let signInPromise = null;
function ensureMe() {
  if (me) return Promise.resolve(me);
  if (!ready) return Promise.resolve(null);
  if (!signInPromise) {
    signInPromise = signInAnonymously(auth)
      .then((cred) => { me = cred.user; anonFailed = false; return me; })
      .catch((err) => { anonFailed = true; lastAuthError = err.code || String(err); console.error("Anonymous sign-in failed:", lastAuthError); return null; })
      .finally(() => { signInPromise = null; });
  }
  return signInPromise;
}
const authProblem = () => lastAuthError === "auth/operation-not-allowed"
  ? "Sign-in is switched off on the server. Please tell the Og Sabha team."
  : "Could not connect. Check your internet and try again.";

/* ---------- shared data + state (declared up front so every function can see them) ---------- */
let menu = null;
let tt = null;
let ratingStats = {};   // meal -> { sum, count } for today
let attendance = {};    // "Class_3" -> true/false for today

const MEAL_EMOJI = { Breakfast: "🍳", Lunch: "🍛", Snacks: "🍟", Dinner: "🌙" };
const TAB_EMOJI = { food: ["🍛", "🍟", "🧁"], classes: ["📚", "✏️", "💡"], wall: ["💬", "🤫", "🌙"], gigs: ["🛠️", "💸", "🎨"], about: ["👋", "✨", "💛"] };
const TAB_LINES = {
  food: "eat up.",
  classes: "your day,\nat a glance.",
  wall: "the walls\nare listening.",
  gigs: "turn skills into\npocket money.",
  about: "made by students,\nfor students."
};
const TAB_SUBS = {
  food: "Today's menu, what's being served now, and how it actually tastes.",
  classes: "Stay on top of your day: who is teaching, and when.",
  wall: "Say what you can't say out loud. Anonymous, always kind.",
  gigs: "Need a hand? Got a skill? Post it, get hired, earn a little.",
  about: "The story behind Og Sabha, and how to reach us."
};
const THEME_COLORS = { food: "#FFFFFF", classes: "#C8D8BC", wall: "#0b0908", gigs: "#4A1604", about: "#000000" };
const TABS = Object.keys(TAB_LINES);

// Looks in data/ first, then the main folder, so it works wherever the JSON files were uploaded.
async function loadJSON(name) {
  for (const path of [`data/${name}`, name]) {
    try { const r = await fetch(path); if (r.ok) return await r.json(); } catch { /* try next */ }
  }
  throw new Error(`Could not load ${name}`);
}
function showLoadError(err) {
  console.error(err);
  const n = $("setup-note");
  n.hidden = false;
  n.textContent = "Could not load the menu or timetable file. Check that the JSON files are uploaded and have no typos.";
}

function burst(x, y, emojis, n = 10) {
  if (reduceMotion) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = "burst";
    p.textContent = emojis[i % emojis.length];
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    document.body.append(p);
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 90;
    p.animate([
      { transform: "translate(-50%,-50%) scale(.4)", opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 30}px)) scale(1.1) rotate(${Math.random() * 120 - 60}deg)`, opacity: 0 }
    ], { duration: 650 + Math.random() * 400, easing: "cubic-bezier(.2,.8,.3,1)" }).onfinish = () => p.remove();
  }
}

// Each wall post / gig gets a stable colour index from its id.
function noteColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}
function postTime(p) {
  const s = p.createdAt?.seconds;
  return s ? new Date(s * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "just now";
}
const newestFirst = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
const goTo = (id, block = "start") => { const t = $(id); if (t && !t.hidden) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block }); };

/* ---------- the "right now" strip (shown on the Classes tab) ---------- */
function renderNow() {
  const box = $("now-strip");
  if (!box || !menu || !tt) return;
  const nm = nowMin(), today = todayName();
  const meal = menu.meals.find((m) => nm >= toMin(m.start) && nm < toMin(m.end));
  const nextMeal = menu.meals.find((m) => toMin(m.start) > nm);
  const mealText = meal ? (menu.days[today] || {})[meal.name]
    : nextMeal ? `${nextMeal.name} at ${fmt12(nextMeal.start)}` : "See tomorrow's menu in the Food tab";
  const slots = (tt.classes[$("class-select").value] || {})[today] || [];
  const per = (no) => tt.periods.find((p) => p.no === no);
  const cur = slots.find((s) => { const p = per(s.period); return p && nm >= toMin(p.start) && nm < toMin(p.end); });
  const nxt = slots.find((s) => { const p = per(s.period); return p && toMin(p.start) > nm; });
  const classTitle = cur ? cur.subject : nxt ? `Next: ${nxt.subject}` : "No more classes today";
  const classSub = cur ? cur.teacher : nxt ? `${fmt12(per(nxt.period).start)} · ${nxt.teacher}` : "";
  box.replaceChildren(
    el("div", {}, el("span", { class: "k", text: "🍽️ In the mess" }),
      el("strong", { text: meal ? `${meal.name} is being served` : "Nothing being served" }),
      el("span", { class: "muted", text: mealText })),
    el("div", {}, el("span", { class: "k", text: "📚 In class" }),
      el("strong", { text: classTitle }),
      el("span", { class: "muted", text: classSub }))
  );
}

/* ---------- tabs ---------- */
function activateTab(name, byUser = false) {
  if (!TABS.includes(name)) return;
  document.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
  document.body.dataset.theme = name; // switches the whole look
  wallActive(name === "wall");
  const h = $("h1-line");
  if (h) {
    h.textContent = TAB_LINES[name];
    h.classList.remove("pop"); void h.offsetWidth; h.classList.add("pop");
  }
  const sub = document.querySelector(".sub");
  if (sub) sub.textContent = TAB_SUBS[name];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[name]);
  if (byUser) {
    window.scrollTo({ top: 0, behavior: "auto" });
    // Remember the tab so a refresh stays on it (and the address bar link opens it).
    store.set("tab", name);
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }
  }
  if (name === "food") tickClock();
}
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    activateTab(btn.dataset.tab, true);
    const r = btn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, TAB_EMOJI[btn.dataset.tab], 8);
  });
});
// Footer links like #gigs and #wall open that tab.
function openFromHash() {
  let name = location.hash.replace("#", "");
  if (!TABS.includes(name)) name = store.get("tab", "");   // no link in the address: reopen the last tab
  if (TABS.includes(name)) { activateTab(name); window.scrollTo(0, 0); }
}
window.addEventListener("hashchange", openFromHash);

// Time-of-day greeting chip.
function greet() {
  const h = new Date().getHours();
  const hi = h < 5 ? "late night? 🦉" : h < 12 ? "good morning ☀️" : h < 17 ? "good afternoon 🌤️" : h < 21 ? "good evening 🌆" : "night owl 🌙";
  $("greet").textContent = `${hi} · ${todayName()}`;
}

/* =================================================================
   FOOD
================================================================= */
let foodDay = todayName();
let foodMeal = null;
let mealPicked = false;
const F = {};          // element refs for the feature card
let clockLaps = 0, lastSec = -1;

async function initFood() {
  menu = await loadJSON("menu.json");
  const sel = $("day-select");
  DAYS.forEach((d) => sel.append(el("option", { value: d, text: d })));
  sel.value = foodDay;
  sel.addEventListener("change", () => setFoodDay(sel.value));
  buildFood();
  pickDefaultMeal();
  renderFood();

  if (ready) {
    onSnapshot(query(collection(db, "ratings"), where("date", "==", todayStr())), (snap) => {
      ratingStats = {};
      snap.forEach((d) => {
        const r = d.data();
        const s = (ratingStats[r.meal] ||= { sum: 0, count: 0 });
        s.sum += r.stars;
        s.count += 1;
      });
      renderFood();
    }, (err) => console.warn("Could not read ratings:", err.code));
  }
  setInterval(() => { if (!mealPicked) pickDefaultMeal(); renderFood(); }, 60000);
  setInterval(tickClock, 1000);
}

function setFoodDay(d) {
  foodDay = d;
  mealPicked = false;
  pickDefaultMeal();
  renderFood();
}

// Picks the meal being served, else the next one, else the last one of the day.
function pickDefaultMeal() {
  if (!menu) return;
  if (foodDay !== todayName()) { foodMeal = menu.meals[0].name; return; }
  const nm = nowMin();
  const live = menu.meals.find((m) => nm >= toMin(m.start) && nm < toMin(m.end));
  const next = menu.meals.find((m) => toMin(m.start) > nm);
  foodMeal = (live || next || menu.meals[menu.meals.length - 1]).name;
}

function pickMeal(name, scroll = false) {
  foodMeal = name;
  mealPicked = true;
  renderFood();
  if (scroll && isPhone()) F.feature.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
}

function mealStatus(m, isToday, nm) {
  if (!isToday) return { kind: "other" };
  const s = toMin(m.start), e = toMin(m.end);
  if (nm >= s && nm < e) return { kind: "live", left: e - nm };
  if (nm < s) return { kind: "soon", inMin: s - nm };
  return { kind: "done" };
}

// Analog clock face drawn on the big plate.
function buildClock() {
  const svg = svgEl("svg", { viewBox: "0 0 100 100", class: "bw", "aria-hidden": "true" });
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 * Math.PI) / 180;
    const big = i % 5 === 0;
    const r1 = big ? 41.5 : 44.5, r2 = 47.5;
    svg.append(svgEl("line", {
      class: big ? "tb" : "ts",
      x1: (50 + r1 * Math.sin(a)).toFixed(2), y1: (50 - r1 * Math.cos(a)).toFixed(2),
      x2: (50 + r2 * Math.sin(a)).toFixed(2), y2: (50 - r2 * Math.cos(a)).toFixed(2)
    }));
  }
  for (let h = 1; h <= 12; h++) {
    const a = (h * 30 * Math.PI) / 180;
    svg.append(svgEl("text", {
      class: "n", x: (50 + 34 * Math.sin(a)).toFixed(2), y: (50 - 34 * Math.cos(a)).toFixed(2), text: String(h)
    }));
  }
  F.hh = svgEl("line", { class: "bh", x1: 50, y1: 54, x2: 50, y2: 31 });
  F.mm = svgEl("line", { class: "bm", x1: 50, y1: 56, x2: 50, y2: 19 });
  F.ss = svgEl("line", { class: "bs", x1: 50, y1: 60, x2: 50, y2: 14 });
  svg.append(F.hh, F.mm, F.ss, svgEl("circle", { class: "bd", cx: 50, cy: 50, r: 2.4 }));
  F.svg = svg;
  return svg;
}

function tickClock() {
  if (!F.ss || document.body.dataset.theme !== "food") return;
  const d = new Date();
  const h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  if (s < lastSec) clockLaps++;
  lastSec = s;
  F.hh.style.transform = `rotate(${h * 30 + m * 0.5}deg)`;
  F.mm.style.transform = `rotate(${m * 6 + s * 0.1}deg)`;
  F.ss.style.transform = `rotate(${clockLaps * 360 + s * 6}deg)`;
}

function spinSecondHand() {
  const base = clockLaps * 360 + (lastSec < 0 ? 0 : lastSec) * 6;
  if (!reduceMotion && F.ss.animate) {
    F.svg.classList.add("spin");
    F.ss.animate(
      [{ transform: `rotate(${base}deg)` }, { transform: `rotate(${base + 720}deg)` }],
      { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)" }
    ).onfinish = () => F.svg.classList.remove("spin");
  }
  const r = F.plate.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, [MEAL_EMOJI[foodMeal] || "🍽️", "✨", "😋"], 10);
}

function buildFood() {
  // day chips
  const nav = $("day-nav");
  nav.replaceChildren();
  F.dchips = WEEK.map((d) => {
    const b = el("button", {
      type: "button", class: "dchip", text: d.slice(0, 3), "aria-label": d,
      onclick: () => { $("day-select").value = d; setFoodDay(d); }
    });
    nav.append(b);
    return b;
  });

  // the feature card: plate + clock on the left, details on the right
  F.plateName = el("span", { class: "plate-name" });
  F.plate = el("div", { class: "plate-art big", role: "button", tabindex: "0", "aria-label": "Tap the clock" },
    el("div", { class: "bwrap" }, buildClock()), F.plateName);
  F.rail = el("div", { class: "rail", role: "group", "aria-label": "Meal" });
  F.railBtns = menu.meals.map((m) => {
    const b = el("button", { type: "button", class: "rail-btn", text: m.name.toLowerCase(), onclick: () => pickMeal(m.name) });
    F.rail.append(b);
    return b;
  });
  F.badge = el("span", { class: "badge" });
  F.h2 = el("h2");
  F.whenMain = document.createTextNode("");
  F.whenSub = el("small");
  F.when = el("p", { class: "when" }, F.whenMain, F.whenSub);
  F.desc = el("p", { class: "desc" });
  F.rateInfo = el("p", { class: "muted" });
  F.stars = el("div", { class: "stars" });
  F.rate = el("div", { class: "rate" }, F.rateInfo, F.stars);

  F.feature = $("food-feature");
  F.feature.replaceChildren(
    el("div", { class: "stage" }, el("div", { class: "slab" }), F.plate, F.rail),
    el("div", { class: "copy" }, F.badge, F.h2, F.when, F.desc, F.rate,
      el("a", { class: "darkbtn", href: "mess-menu.html", text: "Full weekly menu" }))
  );

  // tilt toward the pointer, tap to spin the seconds hand
  F.plate.addEventListener("pointermove", (e) => {
    if (reduceMotion) return;
    const r = F.plate.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    F.plate.style.setProperty("--ry", `${(x * 18).toFixed(1)}deg`);
    F.plate.style.setProperty("--rx", `${(-y * 18).toFixed(1)}deg`);
  });
  F.plate.addEventListener("pointerleave", () => {
    F.plate.style.setProperty("--rx", "0deg");
    F.plate.style.setProperty("--ry", "0deg");
  });
  F.plate.addEventListener("click", spinSecondHand);
  F.plate.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); spinSecondHand(); } });
  tickClock();
}

const dishOf = (day, meal) => (menu.days[day] || {})[meal] || "Not added yet";
const firstDish = (txt) => {
  const s = txt.split(/[,(\/]/)[0].trim();
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
};

function renderFood() {
  if (!menu || !F.feature) return;
  const day = foodDay;
  const isToday = day === todayName();
  const nm = nowMin();

  $("day-select").value = day;
  F.dchips.forEach((b, i) => {
    b.classList.toggle("active", WEEK[i] === day);
    b.setAttribute("aria-pressed", String(WEEK[i] === day));
  });

  const m = menu.meals.find((x) => x.name === foodMeal) || menu.meals[0];
  const st = mealStatus(m, isToday, nm);
  F.railBtns.forEach((b, i) => b.classList.toggle("on", menu.meals[i].name === m.name));

  const dish = dishOf(day, m.name);
  F.plateName.textContent = firstDish(dish);
  F.badge.textContent = st.kind === "live" ? "Serving now" : st.kind === "soon" ? "Up next" : st.kind === "done" ? "Served earlier" : `${day}'s menu`;
  F.badge.classList.toggle("pulse", st.kind === "live");
  F.h2.textContent = m.name.toLowerCase();
  F.whenMain.textContent = `${fmt12(m.start)} – ${fmt12(m.end)}`;
  F.whenSub.textContent = st.kind === "live" ? `ends in ${fmtDur(st.left)}`
    : st.kind === "soon" ? `starts in ${fmtDur(st.inMin)}`
    : st.kind === "done" ? "served earlier today" : `on ${day}`;
  F.desc.textContent = dish;

  // ratings
  F.stars.replaceChildren();
  const stats = ratingStats[m.name];
  if (!ready || !isToday) {
    F.rateInfo.textContent = isToday ? "" : "Ratings open on the day itself.";
  } else {
    F.rateInfo.textContent = stats ? `★ ${(stats.sum / stats.count).toFixed(1)} · ${stats.count} rating${stats.count > 1 ? "s" : ""} today` : "No ratings yet today";
    if (nm >= toMin(m.start)) {
      const mine = Number(store.get(`rated_${todayStr()}_${m.name}`, 0));
      for (let i = 1; i <= 5; i++) {
        F.stars.append(el("button", {
          type: "button", class: i <= mine ? "on" : "", "aria-label": `${i} star${i > 1 ? "s" : ""}`, text: "★",
          onclick: (e) => { burst(e.clientX, e.clientY, ["⭐", "✨", "🎉"], 12); rate(m.name, i); }
        }));
      }
    } else {
      F.rateInfo.textContent = "Rating opens when the meal starts.";
    }
  }

  // meal tiles
  const list = $("food-list");
  list.replaceChildren();
  menu.meals.forEach((x) => {
    const xs = mealStatus(x, isToday, nm);
    const xStats = ratingStats[x.name];
    const d = dishOf(day, x.name);
    const note = ready && isToday && xStats ? `★ ${(xStats.sum / xStats.count).toFixed(1)} (${xStats.count})` : xs.kind === "live" ? "● serving now" : "";
    list.append(el("button", {
      type: "button", class: "tile" + (x.name === m.name ? " on" : ""), onclick: () => pickMeal(x.name, true)
    },
      el("span", { class: "plate-art" }, el("span", { class: "plate-name", text: MEAL_EMOJI[x.name] || "🍽️" })),
      el("span", { class: "tile-time", text: fmt12(x.start) }),
      el("span", { class: "tile-name", text: x.name }),
      el("span", { class: "tile-sub", text: d }),
      el("span", { class: "tile-more", text: d }),
      el("span", { class: "tile-foot" }, el("span", { text: note }), el("span", { "aria-hidden": "true", text: "view →" }))
    ));
  });

  // dots (desktop)
  const dots = $("food-dots");
  dots.replaceChildren();
  menu.meals.forEach((x) => dots.append(el("button", {
    type: "button", class: x.name === m.name ? "on" : "", "aria-label": x.name, onclick: () => pickMeal(x.name)
  })));

  renderNow();
}

async function rate(meal, stars) {
  const date = todayStr();
  const user = await ensureMe();
  if (!user) { alert(authProblem()); return; }
  try {
    // One document per person per meal per day. The id must end with your login id, because the rules check that.
    await setDoc(doc(db, "ratings", `${date}_${meal}_${user.uid}`), { date, meal, stars });
    store.set(`rated_${date}_${meal}`, stars);
    renderFood();
  } catch (e) {
    console.error(e);
    alert("Could not save your rating. Try again.");
  }
}

/* =================================================================
   CLASSES
================================================================= */
let classDay = todayName();
let notices = [];
let unsubNotices = null;

const QUOTES = [
  ["Showing up is half the marks. The other half is the notes.", "back bench philosopher"],
  ["Nobody remembers the lecture you skipped. Everybody remembers the viva you panicked in.", "a tired senior"],
  ["Learn one thing today and you are already ahead of yesterday's you.", "Og Sabha"],
  ["A full attendance sheet is the cheapest marks you will ever earn.", "someone who learned late"],
  ["Ask the doubt. Three other people are waiting for you to ask it.", "the quiet row"],
  ["Deadlines are friendly until the night before.", "every hostel, always"],
  ["Small notes, every day, beat one big panic every semester.", "a calm topper"],
  ["The library is the one place where silence is free and useful.", "Og Sabha"],
  ["Get the basics right and the hard parts get shorter.", "an old lab instructor"],
  ["You do not need motivation. You need the first ten minutes.", "Og Sabha"],
  ["Group study works when the group studies.", "a wise classmate"],
  ["Be kind to the teacher who never gives up on the last bench.", "Og Sabha"]
];
const dayOfYear = () => Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / 864e5);

function renderQuote() {
  const [text, by] = QUOTES[dayOfYear() % QUOTES.length];
  $("quote-text").textContent = text;
  $("quote-by").textContent = by;
}

async function initClasses() {
  tt = await loadJSON("timetable.json");
  const sel = $("class-select");
  Object.keys(tt.classes).forEach((c) => sel.append(el("option", { value: c, text: c })));
  const saved = store.get("myClass");
  if (saved && tt.classes[saved]) sel.value = saved;
  sel.addEventListener("change", () => { store.set("myClass", sel.value); subscribeNotices(); renderClasses(); });

  const chips = $("day-chips");
  chips.replaceChildren();
  F.cchips = WEEK.map((d) => {
    const b = el("button", {
      type: "button", class: "chip-day" + (d === todayName() ? " today" : ""), text: d.slice(0, 3), "aria-label": d,
      onclick: () => { classDay = d; renderClasses(); }
    });
    b.classList.add("day-chip");
    chips.append(b);
    return b;
  });

  renderQuote();
  initNoticeForm();
  subscribeNotices();
  renderClasses();

  if (ready) {
    onSnapshot(query(collection(db, "attendance"), where("date", "==", todayStr())), (snap) => {
      attendance = {};
      snap.forEach((d) => { const a = d.data(); attendance[`${a.cls}_${a.period}`] = a.present; });
      renderClasses();
    }, (err) => console.warn("Could not read attendance:", err.code));
  }
  setInterval(renderClasses, 30000);
}

function statusBadge(cls, period) {
  const v = attendance[`${cls}_${period}`];
  if (v === true) return el("span", { class: "badge good", text: "Teacher present" });
  if (v === false) return el("span", { class: "badge bad", text: "Teacher absent" });
  return el("span", { class: "badge grey", text: "Not reported yet" });
}

function renderClasses() {
  if (!tt) return;
  const cls = $("class-select").value;
  const isToday = classDay === todayName();
  const slots = (tt.classes[cls] || {})[classDay] || [];
  const periodOf = (no) => tt.periods.find((p) => p.no === no);
  const nm = nowMin();

  // The day chips live inside #day-chips; style them like the old pill buttons.
  (F.cchips || []).forEach((b, i) => b.classList.toggle("active", WEEK[i] === classDay));

  const current = isToday ? slots.find((s) => { const p = periodOf(s.period); return p && nm >= toMin(p.start) && nm < toMin(p.end); }) : null;
  const next = isToday ? slots.find((s) => { const p = periodOf(s.period); return p && toMin(p.start) > nm; }) : null;

  renderNow();
  renderNotices();

  const nowBox = $("class-now");
  nowBox.replaceChildren();
  if (!isToday) {
    nowBox.append(el("div", { class: "card" },
      el("h3", { text: `📅 ${classDay}` }),
      el("p", { class: "muted", text: slots.length ? `${slots.length} period${slots.length > 1 ? "s" : ""} on ${classDay}.` : `No classes on ${classDay}.` })
    ));
  } else if (current) {
    const p = periodOf(current.period);
    const startM = toMin(p.start), endM = toMin(p.end);
    const pct = Math.round(((nm - startM) / (endM - startM)) * 100);
    nowBox.append(el("div", { class: "card live" },
      el("div", { class: "row" }, el("h3", { text: "🔴 Now" }), ready ? statusBadge(cls, current.period) : null),
      el("p", { text: `Period ${current.period} · ${current.subject}` }),
      el("p", { class: "muted", text: `${current.teacher} · ${fmt12(p.start)} – ${fmt12(p.end)} · ${endM - nm} min left` }),
      el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: `--w:${pct}%` }))
    ));
  } else {
    nowBox.append(el("div", { class: "card" },
      el("h3", { text: "😴 No class right now" }),
      next
        ? el("p", { class: "muted", text: `Next: ${next.subject} with ${next.teacher} at ${fmt12(periodOf(next.period).start)}` })
        : el("p", { class: "muted", text: slots.length ? "No more classes today." : "No classes today." })
    ));
  }

  const table = $("class-table");
  table.replaceChildren();
  if (!slots.length) {
    table.append(el("p", { class: "muted", text: `No classes on ${classDay}.` }));
    return;
  }

  const tl = el("ol", { class: "timeline" });
  [...slots].sort((a, b) => a.period - b.period).forEach((s) => {
    const p = periodOf(s.period);
    const tp = p ? parts12(p.start) : { t: `P${s.period}`, ap: "" };
    const card = el("div", { class: "slot-card" },
      el("strong", { text: s.subject }),
      el("p", { class: "muted", text: s.teacher })
    );
    if (ready && isToday) {
      card.append(statusBadge(cls, s.period));
      if (currentUser) {
        card.append(el("div", { class: "actions" },
          el("button", { text: "Mark present", onclick: () => setAttendance(cls, s.period, true) }),
          el("button", { class: "danger", text: "Mark absent", onclick: () => setAttendance(cls, s.period, false) }),
          el("button", { class: "ghost", text: "Clear", onclick: () => clearAttendance(cls, s.period) })
        ));
      }
    }
    tl.append(el("li", { class: "slot" + (s === current ? " current" : "") },
      el("div", { class: "slot-time" }, el("b", { text: tp.t }), el("span", { text: tp.ap }), el("em", { text: `Period ${s.period}` })),
      el("div", { class: "dot" }),
      card
    ));
  });
  table.append(tl);
}

async function setAttendance(cls, period, present) {
  const date = todayStr();
  try {
    await setDoc(doc(db, "attendance", `${date}_${cls}_${period}`), { date, cls, period, present });
  } catch (e) {
    console.error(e);
    alert("You are not allowed to change this. Log in with a staff account.");
  }
}
async function clearAttendance(cls, period) {
  try { await deleteDoc(doc(db, "attendance", `${todayStr()}_${cls}_${period}`)); }
  catch (e) { console.error(e); alert("Could not clear."); }
}

/* ---------- class notices (staff post, everyone in the class reads) ---------- */
function subscribeNotices() {
  unsubNotices?.(); unsubNotices = null; notices = [];
  if (!ready || !tt) { renderNotices(); return; }
  const cls = $("class-select").value;
  unsubNotices = onSnapshot(
    query(collection(db, "notices"), where("cls", "==", cls)),
    (snap) => { notices = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderNotices(); },
    (err) => console.warn("Could not read notices:", err.code)
  );
  renderNotices();
}

function renderNotices() {
  const list = $("notice-list");
  if (!list) return;
  const staff = !!currentUser;
  $("notice-compose").hidden = !staff;
  $("notice-to").textContent = $("class-select").value || "";
  list.replaceChildren();
  [...notices].sort(newestFirst).slice(0, 5).forEach((n) => {
    list.append(el("div", { class: "card" },
      el("p", { class: "notice-head", text: `Notice · ${postTime(n)}` }),
      el("p", { text: n.text }),
      staff ? el("div", { class: "actions" }, el("button", { class: "danger", text: "Delete", onclick: () => removeNotice(n.id) })) : null
    ));
  });
}

function initNoticeForm() {
  const text = $("notice-text");
  text.addEventListener("input", () => { $("notice-count").textContent = `${text.value.length} / 400`; });
  $("notice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("notice-msg");
    const body = text.value.trim();
    if (!ready || !currentUser) { msg.textContent = "Log in as staff to post notices."; return; }
    if (!body) return;
    try {
      await addDoc(collection(db, "notices"), {
        cls: $("class-select").value, text: body, createdAt: serverTimestamp()
      });
      text.value = "";
      $("notice-count").textContent = "0 / 400";
      msg.textContent = "Notice published.";
    } catch (err) {
      console.error(err);
      msg.textContent = "Not allowed. Only staff accounts listed in the Firestore rules can post notices.";
    }
  });
}
async function removeNotice(id) {
  if (!confirm("Delete this notice?")) return;
  try { await deleteDoc(doc(db, "notices", id)); }
  catch (e) { console.error(e); alert("Not allowed."); }
}

/* =================================================================
   WALL: a haunted wall.
   - Posts sit dim in the dark. A torch beam follows the mouse (or your finger) and wakes whatever it touches.
   - Eyes creep in from the edges and slowly get closer. Shine the light on them, or tap them, to drive them off.
     Ignore them and they lunge.
   - "Turn on the lights" makes everything readable. Sound is opt-in. Reduced motion turns off the creeping bits.
================================================================= */
let approvedPosts = [];
let pendingPosts = [];
let unsubPending = null;
const reportedKey = "reportedPosts";
const reportedSet = () => { try { return new Set(JSON.parse(store.get(reportedKey, "[]"))); } catch { return new Set(); } };

const EYE_LIFE = 13000;
const idHash = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const WL = {
  on: false, lamp: store.get("wlLamp") === "1",
  x: innerWidth / 2, y: innerHeight * 0.4, tx: innerWidth / 2, ty: innerHeight * 0.4, r: 190,
  lastInput: 0, focusEl: null, raf: 0, tick: 0, dipUntil: 0,
  eyes: [], eyeTimer: 0, beatTimer: 0, dread: 0, posts: [],
  fx: null, pulse: null, eyesBox: null, watcher: null, title: null, look: 0
};

/* ---------- sound (opt-in): a low drone, plus a heartbeat that quickens when something is close ---------- */
const Snd = {
  ctx: null, master: null, filt: null, on: false, active: true,
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    if (!this.ctx) {
      const c = (this.ctx = new AC());
      this.master = c.createGain(); this.master.gain.value = 0; this.master.connect(c.destination);
      this.filt = c.createBiquadFilter(); this.filt.type = "lowpass"; this.filt.frequency.value = 150; this.filt.Q.value = 3; this.filt.connect(this.master);
      [[46, "sawtooth", 0.16], [46.7, "sawtooth", 0.16], [92.3, "sine", 0.1], [138, "triangle", 0.03]].forEach(([f, type, g]) => {
        const o = c.createOscillator(), og = c.createGain();
        o.type = type; o.frequency.value = f; og.gain.value = g;
        o.connect(og); og.connect(this.filt); o.start();
      });
      const lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 0.07; lg.gain.value = 60; lfo.connect(lg); lg.connect(this.filt.frequency); lfo.start();
    }
    this.ctx.resume?.();
    this.on = true; this.apply();
    return true;
  },
  stop() { this.on = false; this.apply(); },
  apply() { if (this.master) this.master.gain.setTargetAtTime(this.on && this.active ? 0.55 : 0, this.ctx.currentTime, 0.4); },
  setActive(a) { this.active = a; this.apply(); },
  tense(d) { if (this.filt && this.on) this.filt.frequency.setTargetAtTime(150 + d * 260, this.ctx.currentTime, 0.5); },
  thump(s = 0.6) {
    if (!this.on || !this.active || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    [0, 0.19].forEach((dt, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(95, t + dt); o.frequency.exponentialRampToValueAtTime(48, t + dt + 0.16);
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, s * (i ? 0.6 : 1) * 0.9), t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.2);
      o.connect(g); g.connect(this.master); o.start(t + dt); o.stop(t + dt + 0.25);
    });
  }
};

/* ---------- setup ---------- */
function initWall() {
  const text = $("post-text");
  text.addEventListener("input", () => { $("post-count").textContent = `${text.value.length} / 300`; });

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("post-msg");
    const body = text.value.trim();
    if (!ready) { msg.textContent = "The wall is not connected yet."; return; }
    if (!body) return;
    if (!(await ensureMe())) { msg.textContent = authProblem(); return; }

    const last = Number(store.get("lastPost", 0));
    if (Date.now() - last < 60000) { msg.textContent = "Please wait a minute between posts."; return; }
    const lower = body.toLowerCase();
    if (BAD_WORDS.some((w) => lower.includes(w))) { msg.textContent = "Please remove rude words and try again."; return; }

    try {
      await addDoc(collection(db, "posts"), { text: body, approved: false, reports: 0, createdAt: serverTimestamp() });
      store.set("lastPost", Date.now());
      text.value = "";
      $("post-count").textContent = "0 / 300";
      msg.textContent = "The wall heard you. It will appear once a person approves it.";
      carve();
    } catch (err) {
      console.error(err);
      msg.textContent = "Could not post. Try again later.";
    }
  });

  if (ready) {
    onSnapshot(query(collection(db, "posts"), where("approved", "==", true)), (snap) => {
      approvedPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderWall();
    }, (err) => console.warn("Could not read posts:", err.code));
  } else {
    $("post-list").append(el("p", { class: "wl-empty", text: "Posts will show here once Firebase is connected." }));
  }

  initWallScene();
}

// A scratch across the form, then something notices.
function carve() {
  const f = $("post-form");
  f.classList.remove("carved"); void f.offsetWidth; f.classList.add("carved");
  setTimeout(() => f.classList.remove("carved"), 1100);
  Snd.thump(0.8);
  pulse(0.5);
  setTimeout(() => spawnEye(), 1500);
}

function syncWallButtons() {
  const lamp = $("wl-lamp"), snd = $("wl-sound");
  if (lamp) { lamp.textContent = WL.lamp ? "Turn off the lights" : "Turn on the lights"; lamp.setAttribute("aria-pressed", String(WL.lamp)); }
  if (snd) { snd.textContent = Snd.on ? "Sound: on" : "Sound: off"; snd.setAttribute("aria-pressed", String(Snd.on)); }
}
function setHint(t) { const h = $("wl-hint"); if (h) h.textContent = t; }
const aim = (x, y) => { WL.tx = x; WL.ty = y; WL.lastInput = performance.now(); };
const sizeTorch = () => { WL.r = Math.max(125, Math.min(230, Math.min(innerWidth, innerHeight) * 0.32)); };

function initWallScene() {
  WL.fx = $("wl-fx"); WL.pulse = $("wl-pulse"); WL.eyesBox = $("wl-eyes");
  WL.watcher = $("wl-watcher"); WL.title = document.querySelector(".wl-title");
  document.body.classList.toggle("wl-lamp", WL.lamp);
  syncWallButtons();
  setHint(matchMedia("(pointer: coarse)").matches
    ? "Something is watching. Drag your finger to move the light. Tap its eyes."
    : "Something is watching. Move the light over its eyes.");

  $("wl-lamp").addEventListener("click", () => {
    WL.lamp = !WL.lamp;
    store.set("wlLamp", WL.lamp ? "1" : "0");
    document.body.classList.toggle("wl-lamp", WL.lamp);
    if (WL.lamp) { clearEyes(); setHint("The lights are on. It is still there."); }
    syncWallButtons();
  });
  $("wl-sound").addEventListener("click", () => {
    if (Snd.on) Snd.stop();
    else if (!Snd.start()) setHint("This browser cannot play the sound.");
    syncWallButtons();
  });
  $("wl-down").addEventListener("click", () => goTo("post-form", "center"));

  window.addEventListener("pointermove", (e) => { if (WL.on && e.pointerType !== "touch") aim(e.clientX, e.clientY); });
  const onTouch = (e) => { const t = WL.on && e.touches[0]; if (t) aim(t.clientX, t.clientY - 70); }; // beam sits just above the fingertip
  window.addEventListener("touchstart", onTouch, { passive: true });
  window.addEventListener("touchmove", onTouch, { passive: true });
  // while you type, the light rests on the box you are writing in
  document.addEventListener("focusin", (e) => { if (WL.on && e.target.matches?.("#post-text")) WL.focusEl = e.target; });
  document.addEventListener("focusout", () => { WL.focusEl = null; });
  window.addEventListener("resize", sizeTorch);
  sizeTorch();
}

/* ---------- whispers: faint words flash in the dark, now and then ---------- */
const WHISPERS = ["behind you", "we can see you", "it read this too", "don't turn around", "still here", "you are not alone in here", "it heard that", "keep the light on"];
let whisperTimer = 0;
function scheduleWhisper() {
  clearTimeout(whisperTimer);
  if (!WL.on || reduceMotion) return;
  whisperTimer = setTimeout(() => {
    if (WL.on && !WL.lamp && !document.hidden) {
      const w = document.createElement("div");
      w.className = "wl-whisper";
      w.setAttribute("aria-hidden", "true");
      w.textContent = WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
      w.style.left = (6 + Math.random() * 62) + "%";
      w.style.top = (14 + Math.random() * 68) + "%";
      w.style.setProperty("--r", (Math.random() * 14 - 7).toFixed(1) + "deg");
      document.body.append(w);
      setTimeout(() => w.remove(), 2000);
    }
    scheduleWhisper();
  }, 12000 + Math.random() * 18000);
}

// Called from activateTab.
function wallActive(on) {
  if (WL.on === on) return;
  WL.on = on;
  Snd.setActive(on);
  cancelAnimationFrame(WL.raf); clearTimeout(WL.eyeTimer); clearTimeout(WL.beatTimer); clearTimeout(whisperTimer);
  if (on) {
    WL.lastInput = performance.now();
    WL.raf = requestAnimationFrame(wallFrame);
    scheduleEye(); beat(); scheduleWhisper();
  } else {
    clearEyes();
  }
}

/* ---------- the loop: torch, what it lights, eyes, dread ---------- */
function wallFrame(now) {
  if (!WL.on) return;
  WL.raf = requestAnimationFrame(wallFrame);
  if (document.hidden || !WL.fx) return;
  WL.tick++;
  const t = now || performance.now();

  let tx = WL.tx, ty = WL.ty;
  if (WL.focusEl && WL.focusEl.isConnected) {
    const r = WL.focusEl.getBoundingClientRect();
    tx = r.left + r.width / 2; ty = r.top + Math.min(r.height / 2, 150);
  } else if (t - WL.lastInput > 3000 && !reduceMotion) {
    tx = innerWidth * (0.5 + 0.28 * Math.sin(t / 2300)); ty = innerHeight * (0.45 + 0.22 * Math.sin(t / 1700 + 1)); // nobody holding it: it drifts
  }
  const k = reduceMotion ? 1 : 0.1;
  WL.x += (tx - WL.x) * k; WL.y += (ty - WL.y) * k;

  let r = WL.r;
  if (!reduceMotion) {
    r *= 1 + 0.025 * Math.sin(t / 90) + 0.02 * Math.sin(t / 37);
    if (t < WL.dipUntil) r *= 0.62; else if (Math.random() < 0.004) WL.dipUntil = t + 140; // now and then the beam stutters
  }
  const fx = WL.fx.style;
  fx.setProperty("--tx", `${WL.x.toFixed(1)}px`); fx.setProperty("--ty", `${WL.y.toFixed(1)}px`); fx.setProperty("--r", `${r.toFixed(0)}px`);
  if (WL.title) {
    WL.title.style.setProperty("--gx", ((WL.x / innerWidth - 0.5) * 2).toFixed(2));
    WL.title.style.setProperty("--gy", ((WL.y / innerHeight - 0.5) * 2).toFixed(2));
  }
  if (WL.tick % 2) return;

  const reach = WL.r * 0.9;
  for (const p of WL.posts) {
    const b = p.getBoundingClientRect();
    if (b.bottom < 0 || b.top > innerHeight) { p.classList.remove("lit"); continue; }
    const dx = Math.max(b.left - WL.x, 0, WL.x - b.right), dy = Math.max(b.top - WL.y, 0, WL.y - b.bottom);
    p.classList.toggle("lit", Math.hypot(dx, dy) < reach);
  }

  if (WL.watcher) {
    const b = WL.watcher.getBoundingClientRect();
    if (b.bottom > 0 && b.top < innerHeight) {
      const cx = b.left + b.width / 2, cy = b.top + b.height * 0.25;
      WL.watcher.classList.toggle("lit", Math.hypot(cx - WL.x, cy - WL.y) < reach);
      const look = Math.max(-1, Math.min(1, (WL.x - cx) / (innerWidth * 0.45)));
      if (Math.abs(look - WL.look) > 0.03) { WL.look = look; WL.watcher.style.setProperty("--look", look.toFixed(2)); }
    }
  }

  const nowMs = performance.now();
  let dread = 0;
  for (const it of [...WL.eyes]) {
    const b = it.e.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const dx = WL.x - cx, dy = WL.y - cy, d = Math.hypot(dx, dy) || 1;
    it.e.style.setProperty("--px", (dx / d).toFixed(2)); it.e.style.setProperty("--py", (dy / d).toFixed(2));
    const age = nowMs - it.born;
    if (age > 700 && d < reach * 0.8) { fleeEye(it); setHint("It will be back."); continue; }
    dread = Math.max(dread, Math.min(1, age / EYE_LIFE));
  }
  WL.dread += (dread - WL.dread) * 0.1;
  Snd.tense(WL.dread);
}

/* ---------- eyes ---------- */
function scheduleEye() {
  clearTimeout(WL.eyeTimer);
  if (!WL.on || reduceMotion) return;
  WL.eyeTimer = setTimeout(() => { spawnEye(); scheduleEye(); }, 6000 + Math.random() * 7000);
}
function spawnEye() {
  if (!WL.on || WL.lamp || reduceMotion || document.hidden || !WL.eyesBox) return;
  if (WL.eyes.length >= (isPhone() ? 1 : 2)) return;
  const s = isPhone() ? 46 : 60, w = innerWidth, h = innerHeight, side = Math.random();
  let x, y;
  if (side < 0.4) { x = 0.07 + Math.random() * 0.1; y = 0.2 + Math.random() * 0.6; }
  else if (side < 0.8) { x = 0.83 + Math.random() * 0.1; y = 0.2 + Math.random() * 0.6; }
  else { x = 0.15 + Math.random() * 0.7; y = Math.random() < 0.5 ? 0.1 : 0.9; }
  const px = Math.min(Math.max(x * w, s), w - s), py = Math.min(Math.max(y * h, s), h - s);
  const e = el("div", { class: "wl-eye", style: `--x:${px}px;--y:${py}px;--s:${s}px` },
    el("span", { class: "eb" }, el("b")), el("span", { class: "eb" }, el("b")));
  const it = { e, born: performance.now(), gone: false };
  e.addEventListener("click", () => { fleeEye(it); setHint("It will be back."); });
  WL.eyesBox.append(e); WL.eyes.push(it);
  requestAnimationFrame(() => requestAnimationFrame(() => e.classList.add("in")));
  it.timer = setTimeout(() => lungeEye(it), EYE_LIFE);
  Snd.thump(0.35);
}
function dropEye(it) { it.gone = true; clearTimeout(it.timer); WL.eyes = WL.eyes.filter((x) => x !== it); setTimeout(() => it.e.remove(), 400); }
function fleeEye(it) {
  if (it.gone) return;
  it.e.style.transform = getComputedStyle(it.e).transform; // freeze at the current size, then fade
  it.e.classList.add("out");
  dropEye(it);
}
function lungeEye(it) { // it got too close
  if (it.gone) return;
  it.e.classList.add("lunge");
  dropEye(it);
  pulse(0.75); Snd.thump(1);
  setHint("It was right there.");
}
function clearEyes() { [...WL.eyes].forEach((it) => { it.gone = true; clearTimeout(it.timer); it.e.remove(); }); WL.eyes = []; WL.dread = 0; }

/* ---------- heartbeat (the red vignette, and the thump when sound is on) ---------- */
function pulse(strength) {
  const p = WL.pulse;
  if (!p || reduceMotion) return;
  p.style.setProperty("--pi", strength.toFixed(2));
  p.classList.remove("b"); void p.offsetWidth; p.classList.add("b");
}
function beat() {
  clearTimeout(WL.beatTimer);
  if (!WL.on) return;
  const d = WL.dread;
  if (d > 0.12) { pulse(Math.min(0.2 + d * 0.45, 0.65)); Snd.thump(0.4 + d * 0.6); }
  WL.beatTimer = setTimeout(beat, 1500 - 900 * d);
}

/* ---------- posts ---------- */
function subscribePending() {
  if (unsubPending) { unsubPending(); unsubPending = null; }
  pendingPosts = [];
  if (ready && currentUser) {
    unsubPending = onSnapshot(
      query(collection(db, "posts"), where("approved", "==", false)),
      (snap) => { pendingPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderWall(); },
      (err) => console.warn("Not allowed to read pending posts:", err.code)
    );
  }
  renderWall();
}

function renderWall() {
  if (!ready) return;
  const staff = !!currentUser;
  const reported = reportedSet();

  // Students never see posts with 3+ reports. Staff still do, with the count.
  const visible = approvedPosts.filter((p) => staff || (p.reports || 0) < 3).sort(newestFirst);

  const list = $("post-list");
  list.replaceChildren();
  if (!visible.length) list.append(el("p", { class: "wl-empty", text: "Nothing on the wall yet. It is waiting for you." }));
  visible.forEach((p) => {
    const h = idHash(p.id);
    const done = reported.has(p.id);
    const actions = el("div", { class: "wl-act" },
      el("button", { type: "button", class: "wl-mini", text: done ? "Hushed" : "Hush", disabled: done ? "" : null, onclick: () => reportPost(p.id) }),
      staff ? el("button", { type: "button", class: "wl-mini danger", text: `Delete (${p.reports || 0} reports)`, onclick: () => removePost(p.id) }) : null
    );
    const card = el("article", { class: `wl-post v${h % 4}`, style: `--rot:${((((h >> 3) % 9) - 4) * 0.45).toFixed(2)}deg` },
      el("p", { class: "wl-text", text: p.text }),
      el("p", { class: "wl-meta", text: `heard ${postTime(p)}` }),
      actions);
    // touch it and it stirs
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      card.classList.remove("stir"); void card.offsetWidth; card.classList.add("stir");
    });
    list.append(card);
  });
  WL.posts = [...list.querySelectorAll(".wl-post")];
  $("wl-count").textContent = visible.length ? `${visible.length} ${visible.length === 1 ? "voice" : "voices"} on the wall` : "";

  $("pending-box").hidden = !staff;
  const pl = $("pending-list");
  pl.replaceChildren();
  if (staff) {
    if (!pendingPosts.length) pl.append(el("p", { class: "muted", text: "Nothing waiting." }));
    [...pendingPosts].sort((a, b) => -newestFirst(a, b)).forEach((p) => {
      pl.append(el("div", { class: "wl-pend" },
        el("p", { text: p.text }),
        el("div", { class: "wl-act" },
          el("button", { type: "button", class: "wl-mini", text: "Approve", onclick: () => approvePost(p.id) }),
          el("button", { type: "button", class: "wl-mini danger", text: "Delete", onclick: () => removePost(p.id) })
        )
      ));
    });
  }
}

// The rules allow one report per person: the report counter and a posts/{id}/reports/{uid} marker must be written together.
async function reportPost(id) {
  if (!(await ensureMe())) { alert(authProblem()); return; }
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "posts", id), { reports: increment(1) });
    batch.set(doc(db, "posts", id, "reports", me.uid), { createdAt: serverTimestamp() });
    await batch.commit();
    markReported(id);
  } catch (e) {
    console.error(e);
    if (e.code === "permission-denied") { markReported(id); alert("You have already reported this one."); }
    else alert("Could not report.");
  }
}
function markReported(id) {
  const set = reportedSet(); set.add(id);
  store.set(reportedKey, JSON.stringify([...set]));
  renderWall();
}
async function approvePost(id) {
  try { await updateDoc(doc(db, "posts", id), { approved: true }); }
  catch (e) { console.error(e); alert("Not allowed."); }
}
async function removePost(id) {
  if (!confirm("Delete this post?")) return;
  try { await deleteDoc(doc(db, "posts", id)); }
  catch (e) { console.error(e); alert("Not allowed."); }
}

/* =================================================================
   GIGS (skill board: "wanted" jobs and "offering" skills)
   - Posts wait for staff approval, like the wall.
   - Replies are private: only the person who posted (and staff) can read them.
   - Visitors get an invisible anonymous Firebase login so the rules can tell
     "who posted what". Turn on Authentication > Sign-in method > Anonymous.
================================================================= */
const GIG_CATS = ["Design", "Coding & tech", "Photo & video", "Tutoring", "Writing & editing", "Music & events", "Errands & help", "Other"];
const GIG_COLORS = ["#ffb27a", "#ffd37a", "#ff9a8a", "#9fe0c4", "#ffc2e0", "#b7c4ff", "#ffe6a8", "#d9c4ff"];
const GIG_POS = [[15, 14], [50, 5], [85, 14], [6, 42], [94, 42], [31, 84], [69, 84], [50, 96]]; // chip positions around the globe (% of the stage)
const GIG_KIND = { wanted: "🔍 Wanted", offer: "✋ Offering" };
let gigsApproved = [];
let gigsPending = [];
let myGigs = [];
let gigResponses = {}; // gigId -> [reply, ...] (only loaded for your own gigs)
let gigFilter = { kind: "all", cat: "all" };
let applyTarget = null;
let unsubGigsPending = null;
let unsubMine = null;
const unsubResponses = new Map();
const reportedGigsKey = "reportedGigs";
const reportedGigs = () => { try { return new Set(JSON.parse(store.get(reportedGigsKey, "[]"))); } catch { return new Set(); } };
const appliedKey = (id) => `applied_${id}`;

function initGigs() {
  const filterSel = $("gig-cat-filter");
  filterSel.append(el("option", { value: "all", text: "All categories" }));
  GIG_CATS.forEach((c) => {
    filterSel.append(el("option", { value: c, text: c }));
    $("gig-cat").append(el("option", { value: c, text: c }));
  });
  filterSel.addEventListener("change", () => setGigCat(filterSel.value));

  document.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      gigFilter.kind = b.dataset.kind;
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderGigs();
    }));

  $("gig-cta-post").addEventListener("click", () => {
    const d = $("gig-compose");
    d.open = true;
    d.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    setTimeout(() => $("gig-title").focus({ preventScroll: true }), 350);
  });
  $("gig-cta-browse").addEventListener("click", () => goTo("gig-board"));

  const details = $("gig-details");
  details.addEventListener("input", () => { $("gig-count").textContent = `${details.value.length} / 300`; });
  $("gig-name").value = store.get("gigName", "");

  $("gig-form").addEventListener("submit", submitGig);
  $("apply-form").addEventListener("submit", submitApplication);
  $("apply-cancel").addEventListener("click", () => $("apply-dialog").close());

  renderGigChips();
  if (ready) {
    onSnapshot(query(collection(db, "gigs"), where("approved", "==", true)), (snap) => {
      gigsApproved = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderGigs();
    }, (err) => console.warn("Could not read gigs:", err.code));
  } else {
    $("gig-list").append(el("p", { class: "muted", text: "The board will show here once Firebase is connected." }));
  }
}

function setGigCat(cat) {
  gigFilter.cat = cat;
  $("gig-cat-filter").value = cat;
  renderGigs();
}

// Category chips around the globe, with live counts.
function renderGigChips() {
  const box = $("gig-arc");
  if (!box) return;
  box.replaceChildren();
  GIG_CATS.forEach((c, i) => {
    const n = gigsApproved.filter((g) => g.category === c && g.status !== "closed").length;
    box.append(el("button", {
      type: "button",
      class: "chip-g" + (gigFilter.cat === c ? " on" : ""),
      style: `--c:${GIG_COLORS[i]};--x:${GIG_POS[i][0]};--y:${GIG_POS[i][1]}`,
      "aria-pressed": String(gigFilter.cat === c),
      onclick: () => setGigCat(gigFilter.cat === c ? "all" : c)
    }, el("i"), c, " ", el("em", { text: String(n) })));
  });
}

function renderGigStats() {
  const live = gigsApproved.filter((g) => g.status !== "closed");
  const names = [];
  live.forEach((g) => { const nm = (g.name || "").trim(); if (nm && !names.includes(nm)) names.push(nm); });
  const av = $("gig-avatars");
  av.replaceChildren();
  names.slice(0, 4).forEach((nm, i) => av.append(el("span", { style: `--c:${GIG_COLORS[i]}`, text: nm[0].toUpperCase() })));
  if (names.length > 4) av.append(el("span", { class: "more", text: `+${names.length - 4}` }));
  $("gig-stat").textContent = `${live.length} live`;
  $("gig-stat-sub").textContent = live.length ? "Posted by your classmates. Tap a category to filter." : "Be the first to post.";
}

// Called whenever the login state changes: (re)loads your own gigs, and pending gigs for staff.
function subscribeGigs() {
  unsubGigsPending?.(); unsubGigsPending = null; gigsPending = [];
  unsubMine?.(); unsubMine = null; myGigs = [];
  unsubResponses.forEach((u) => u()); unsubResponses.clear(); gigResponses = {};
  if (!ready) return;

  if (currentUser) {
    unsubGigsPending = onSnapshot(
      query(collection(db, "gigs"), where("approved", "==", false)),
      (snap) => { gigsPending = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderGigs(); },
      (err) => console.warn("Not allowed to read pending gigs:", err.code)
    );
  }
  if (me) {
    unsubMine = onSnapshot(
      query(collection(db, "gigs"), where("ownerUid", "==", me.uid)),
      (snap) => { myGigs = snap.docs.map((d) => ({ id: d.id, ...d.data() })); watchResponses(); renderGigs(); },
      (err) => console.warn("Could not read your gigs:", err.code)
    );
  }
  renderGigs();
}

function watchResponses() {
  const ids = new Set(myGigs.filter((g) => g.approved).map((g) => g.id));
  for (const [id, un] of unsubResponses) {
    if (!ids.has(id)) { un(); unsubResponses.delete(id); delete gigResponses[id]; }
  }
  ids.forEach((id) => {
    if (unsubResponses.has(id)) return;
    unsubResponses.set(id, onSnapshot(
      collection(db, "gigs", id, "responses"),
      (snap) => {
        gigResponses[id] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst);
        renderGigs();
      },
      (err) => console.warn("Could not read replies:", err.code)
    ));
  });
}

async function submitGig(e) {
  e.preventDefault();
  const msg = $("gig-msg");
  if (!ready) { msg.textContent = "The board is not connected yet."; return; }
  if (!(await ensureMe())) { msg.textContent = authProblem(); return; }

  const data = {
    kind: $("gig-kind").value,
    title: $("gig-title").value.trim(),
    category: $("gig-cat").value,
    details: $("gig-details").value.trim(),
    pay: $("gig-pay").value.trim(),
    name: $("gig-name").value.trim()
  };
  if (!data.title || !data.details) return;
  if (Date.now() - Number(store.get("lastGig", 0)) < 120000) { msg.textContent = "Please wait a couple of minutes between posts."; return; }
  const lower = Object.values(data).join(" ").toLowerCase();
  if (BAD_WORDS.some((w) => lower.includes(w))) { msg.textContent = "Please remove rude words and try again."; return; }

  try {
    await addDoc(collection(db, "gigs"), {
      ...data, ownerUid: me.uid, approved: false, reports: 0, status: "open", createdAt: serverTimestamp()
    });
    store.set("lastGig", Date.now());
    store.set("gigName", data.name);
    ["gig-title", "gig-details", "gig-pay"].forEach((id) => { $(id).value = ""; });
    $("gig-count").textContent = "0 / 300";
    msg.textContent = "Posted! It will show on the board after it is approved. You can track it under Your posts.";
    burst(innerWidth / 2, innerHeight / 2, ["🛠️", "💸", "✨"], 14);
  } catch (err) {
    console.error(err);
    msg.textContent = "Could not post. Try again later.";
  }
}

function openApply(g) {
  applyTarget = g;
  const wanted = g.kind === "wanted";
  $("apply-title").textContent = wanted ? "Apply for this gig" : "Message this person";
  $("apply-sub").textContent = g.title;
  $("apply-msg-label").textContent = wanted ? "Why are you a good fit?" : "What do you need?";
  $("apply-name").value = store.get("gigApplyName", "");
  $("apply-contact").value = store.get("gigApplyContact", "");
  $("apply-message").value = "";
  $("apply-status").textContent = "";
  $("apply-dialog").showModal();
}

async function submitApplication(e) {
  e.preventDefault();
  const st = $("apply-status");
  if (!ready || !me || !applyTarget) { st.textContent = "Not connected. Try again in a moment."; return; }
  const data = {
    name: $("apply-name").value.trim(),
    message: $("apply-message").value.trim(),
    contact: $("apply-contact").value.trim()
  };
  if (!data.name || !data.message || data.contact.length < 3) return;
  const lower = `${data.name} ${data.message}`.toLowerCase();
  if (BAD_WORDS.some((w) => lower.includes(w))) { st.textContent = "Please remove rude words and try again."; return; }

  try {
    // One reply per person per gig (the doc id is your anonymous id), so sending again just updates it.
    await setDoc(doc(db, "gigs", applyTarget.id, "responses", me.uid), {
      ...data, applicantUid: me.uid, createdAt: serverTimestamp()
    });
    store.set(appliedKey(applyTarget.id), "1");
    store.set("gigApplyName", data.name);
    store.set("gigApplyContact", data.contact);
    $("apply-dialog").close();
    burst(innerWidth / 2, innerHeight / 2, ["🎉", "✨", "🤝"], 14);
    renderGigs();
  } catch (err) {
    console.error(err);
    st.textContent = "Could not send. This gig may have just been closed.";
  }
}

// 10-digit Indian numbers (or full international ones) get a WhatsApp shortcut.
function phoneLink(contact) {
  if (!/^[+\d\s-]{10,16}$/.test(contact.trim())) return null;
  const d = contact.replace(/\D/g, "");
  if (d.length < 10 || d.length > 13) return null;
  return `https://wa.me/${d.length === 10 ? "91" + d : d}`;
}

function gigCard(g, staff, reported) {
  const mine = !!me && g.ownerUid === me.uid;
  const closed = g.status === "closed";
  const applied = store.get(appliedKey(g.id)) === "1";
  const wanted = g.kind === "wanted";

  const actions = el("div", { class: "actions" });
  if (mine) actions.append(el("span", { class: "badge grey", text: "Your post" }));
  else if (closed) actions.append(el("span", { class: "badge grey", text: wanted ? "Filled" : "Not available" }));
  else actions.append(el("button", {
    text: applied ? "Sent ✓ (update)" : wanted ? "Apply" : "Hire / message",
    onclick: () => openApply(g)
  }));
  if (!mine) {
    actions.append(el("button", {
      class: "ghost",
      text: reported.has(g.id) ? "Reported" : "Report",
      disabled: reported.has(g.id) ? "" : null,
      onclick: () => reportGig(g.id)
    }));
  }
  if (staff) actions.append(el("button", { class: "danger", text: `Delete (${g.reports || 0} reports)`, onclick: () => removeGig(g.id) }));

  return el("div", { class: `card gig post c${noteColor(g.id)}${closed ? " closed" : ""}` },
    el("div", { class: "row" },
      el("span", { class: "badge", text: GIG_KIND[g.kind] || g.kind }),
      el("span", { class: "badge", text: g.category })
    ),
    el("h3", { text: g.title }),
    el("p", { text: g.details }),
    el("p", { class: "muted", text: `${g.name || "A student"}${g.pay ? ` · ${g.pay}` : ""} · ${postTime(g)}` }),
    actions
  );
}

function replyRow(g, r) {
  const wa = phoneLink(r.contact);
  return el("div", { class: "resp" },
    el("strong", { text: r.name }),
    el("p", { text: r.message }),
    el("p", { class: "muted", text: `${r.contact} · ${postTime(r)}` }),
    el("div", { class: "actions" },
      wa ? el("a", { class: "btnlink", href: wa, target: "_blank", rel: "noopener noreferrer", text: "WhatsApp" }) : null,
      el("button", { class: "ghost", text: "Dismiss", onclick: () => removeResponse(g.id, r.id) })
    )
  );
}

function renderGigs() {
  renderGigChips();
  renderGigStats();
  if (!ready) return;
  const staff = !!currentUser;
  const reported = reportedGigs();

  // Public board
  const list = $("gig-list");
  list.replaceChildren();
  const shown = gigsApproved
    .filter((g) => staff || (g.reports || 0) < 3)
    .filter((g) => gigFilter.kind === "all" || g.kind === gigFilter.kind)
    .filter((g) => gigFilter.cat === "all" || g.category === gigFilter.cat)
    .sort((a, b) => ((a.status === "closed") - (b.status === "closed")) || newestFirst(a, b));
  if (!shown.length) list.append(el("p", { class: "muted", text: "Nothing here yet. Post the first one." }));
  shown.forEach((g) => list.append(gigCard(g, staff, reported)));

  // Your own posts, with the private replies
  $("gig-mine-box").hidden = !myGigs.length;
  const mine = $("gig-mine");
  mine.replaceChildren();
  [...myGigs].sort(newestFirst).forEach((g) => {
    const replies = gigResponses[g.id] || [];
    const closed = g.status === "closed";
    const [label, tone] = !g.approved ? ["Waiting for approval", "grey"] : closed ? ["Closed", "grey"] : ["Live", "good"];
    mine.append(el("div", { class: "card" },
      el("div", { class: "row" },
        el("h3", { text: g.title }),
        el("span", { class: `badge ${tone}`, text: label })
      ),
      el("p", { class: "muted", text: `${GIG_KIND[g.kind]} · ${g.category} · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` }),
      replies.map((r) => replyRow(g, r)),
      el("div", { class: "actions" },
        g.approved ? el("button", {
          class: "ghost",
          text: closed ? "Reopen" : g.kind === "wanted" ? "Mark filled" : "Close",
          onclick: () => setGigStatus(g.id, closed ? "open" : "closed")
        }) : null,
        el("button", { class: "danger", text: "Delete", onclick: () => removeGig(g.id) })
      )
    ));
  });

  // Staff approval queue
  $("gig-pending-box").hidden = !staff;
  const pl = $("gig-pending");
  pl.replaceChildren();
  if (staff) {
    if (!gigsPending.length) pl.append(el("p", { class: "muted", text: "Nothing waiting." }));
    [...gigsPending].sort((a, b) => -newestFirst(a, b)).forEach((g) => {
      pl.append(el("div", { class: "card" },
        el("span", { class: "badge", text: `${GIG_KIND[g.kind] || g.kind} · ${g.category}` }),
        el("h3", { text: g.title }),
        el("p", { text: g.details }),
        el("p", { class: "muted", text: `${g.name || "A student"}${g.pay ? ` · ${g.pay}` : ""}` }),
        el("div", { class: "actions" },
          el("button", { text: "Approve", onclick: () => approveGig(g.id) }),
          el("button", { class: "danger", text: "Delete", onclick: () => removeGig(g.id) })
        )
      ));
    });
  }
}

async function reportGig(id) {
  try {
    if (!(await ensureMe())) { alert(authProblem()); return; }
    // The rules allow one report per person: the counter and a gigs/{id}/reports/{uid} marker are written together.
    const batch = writeBatch(db);
    batch.update(doc(db, "gigs", id), { reports: increment(1) });
    batch.set(doc(db, "gigs", id, "reports", me.uid), { createdAt: serverTimestamp() });
    await batch.commit();
    const set = reportedGigs(); set.add(id);
    store.set(reportedGigsKey, JSON.stringify([...set]));
    renderGigs();
  } catch (e) {
    console.error(e);
    if (e.code === "permission-denied") {
      const set = reportedGigs(); set.add(id);
      store.set(reportedGigsKey, JSON.stringify([...set]));
      renderGigs(); alert("You have already reported this one.");
    } else alert("Could not report.");
  }
}
async function approveGig(id) {
  try { await updateDoc(doc(db, "gigs", id), { approved: true }); }
  catch (e) { console.error(e); alert("Not allowed."); }
}
async function setGigStatus(id, status) {
  try { await updateDoc(doc(db, "gigs", id), { status }); }
  catch (e) { console.error(e); alert("Could not update."); }
}
async function removeResponse(gigId, respId) {
  try { await deleteDoc(doc(db, "gigs", gigId, "responses", respId)); }
  catch (e) { console.error(e); alert("Could not remove."); }
}
async function removeGig(id) {
  if (!confirm("Delete this post and all its replies?")) return;
  try {
    // Firestore does not delete sub-collections automatically, so clear the replies first.
    const replies = await getDocs(collection(db, "gigs", id, "responses"));
    await Promise.all(replies.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "gigs", id));
  } catch (e) { console.error(e); alert("Not allowed."); }
}

/* ---------- the glowing globe behind the category chips ---------- */
function initGlobe() {
  const cv = $("gig-globe");
  if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d");
  const N = 900, pts = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), t = ga * i;
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  let rot = 0, tilt = 0.38, w = 0, h = 0, dpr = 1, drag = null;
  cv.style.touchAction = "pan-y";

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }

  function draw() {
    if (!w || !h) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const cx = cv.width / 2, cy = cv.height / 2, R = Math.min(cv.width, cv.height) * 0.4;

    // glow + body
    let g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.7);
    g.addColorStop(0, "rgba(255,170,100,.55)"); g.addColorStop(0.55, "rgba(255,120,50,.16)"); g.addColorStop(1, "rgba(255,120,50,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, "rgba(255,190,130,.28)"); g.addColorStop(1, "rgba(90,25,5,.35)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // dotted surface
    const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
    for (const [x, y, z] of pts) {
      const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
      const y2 = y * ct - z1 * st, z2 = y * st + z1 * ct;
      if (z2 < -0.15) continue;
      ctx.fillStyle = `rgba(255,236,214,${(0.18 + 0.82 * ((z2 + 1) / 2)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(cx + x1 * R, cy + y2 * R, (1 + z2 * 0.9) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // rim + a tilted orbit ring with a small moon
    ctx.strokeStyle = "rgba(255,255,255,.28)"; ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.38);
    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.beginPath(); ctx.ellipse(0, 0, R * 1.32, R * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
    const ma = rot * 2.4;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(Math.cos(ma) * R * 1.32, Math.sin(ma) * R * 0.36, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function loop() {
    if (!document.hidden && cv.clientWidth > 0) {
      if (cv.clientWidth !== w || cv.clientHeight !== h) size();
      if (!drag) rot += 0.003;
      draw();
    }
    requestAnimationFrame(loop);
  }

  cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX }; cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener("pointermove", (e) => {
    if (!drag) return;
    rot += (e.clientX - drag.x) * 0.01; drag.x = e.clientX;
    if (reduceMotion) draw();
  });
  const stop = () => { drag = null; };
  cv.addEventListener("pointerup", stop);
  cv.addEventListener("pointercancel", stop);

  size();
  if (reduceMotion) {
    draw();
    new ResizeObserver(() => { size(); draw(); }).observe(cv);
  } else {
    requestAnimationFrame(loop);
  }
}

/* =================================================================
   STAFF LOGIN
================================================================= */
function renderAuth() {
  const box = $("auth-status");
  box.replaceChildren();
  $("login-form").hidden = !!currentUser;
  if (currentUser) {
    box.append(
      el("span", { text: `Logged in as ${currentUser.email} ` }),
      el("button", { class: "ghost", text: "Log out", onclick: () => signOut(auth) })
    );
  }
}

if (ready) {
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, $("login-email").value, $("login-pass").value);
      $("login-pass").value = "";
    } catch (err) {
      console.error(err);
      alert("Wrong email or password.");
    }
  });
  onAuthStateChanged(auth, (u) => {
    if (!u) {
      // Give every visitor a silent anonymous id so the gigs board knows who posted what.
      ensureMe();
    }
    me = u;
    currentUser = u && !u.isAnonymous ? u : null; // only email logins count as staff
    renderAuth();
    renderClasses();
    renderNotices();
    subscribePending();
    subscribeGigs();
  });
} else {
  $("login-form").hidden = true;
}

/* ---------- ABOUT: three-step story, 01 --- 03 ---------- */
const ABOUT_STEPS = [
  { k: "Our story", t: "Og Sabha", p: "Made by the UG 2026 batch of DCSMAT, Vagamon. We got tired of asking \u201cwhat\u2019s for lunch?\u201d and \u201cwhich hour is this?\u201d, so we built one place for both." },
  { k: "What you can do", t: "Four tabs", p: "Food: today\u2019s mess menu and meal ratings. Classes: your live timetable and notices. Wall: post anonymously, every post is checked first. Gigs: offer a skill or hire a classmate." },
  { k: "Say hello", t: "Contact", p: "Found a mistake or want to join the team? Message us on Instagram: @og.sabhaaa" }
];
function initAbout() {
  const root = $("ab2");
  if (!root) return;
  let i = 0, busy = 0;
  const show = (n) => {
    n = (n + ABOUT_STEPS.length) % ABOUT_STEPS.length;
    if (n === i && root.dataset.ready) return;
    root.dataset.ready = "1";
    clearTimeout(busy);
    root.classList.add("swap");
    busy = setTimeout(() => {
      i = n;
      const s = ABOUT_STEPS[i];
      $("ab2-kicker").textContent = s.k; $("ab2-title").textContent = s.t; $("ab2-text").textContent = s.p;
      $("ab2-n").textContent = pad(i + 1);
      root.dataset.i = String(i);
      root.style.setProperty("--p", String(i + 1));
      root.querySelectorAll(".ab2-links button").forEach((b) => b.classList.toggle("on", Number(b.dataset.go) === i));
      root.classList.remove("swap");
    }, reduceMotion ? 0 : 280);
  };
  $("ab2-next").addEventListener("click", () => show(i + 1));
  $("ab2-bar").addEventListener("click", () => show(i + 1));
  root.querySelectorAll(".ab2-links button").forEach((b) => b.addEventListener("click", () => show(Number(b.dataset.go))));
  root.style.setProperty("--p", "1");
  root.querySelector(".ab2-links button").classList.add("on");
}

/* ---------- start ---------- */
const safe = (fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } };
safe(greet);
setInterval(greet, 60000);
initFood().catch(showLoadError);
initClasses().catch(showLoadError);
safe(initWall);
safe(initGigs);
safe(initGlobe);
safe(initAbout);
safe(openFromHash);

// Offline support (sw.js is network-first, so updates always arrive).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
