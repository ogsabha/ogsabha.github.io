// Firebase (about 300 KB) is loaded lazily by connectFirebase(), never at the top of this file,
// so menu, timetable and clock render without waiting for it.
let initializeApp, getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, increment, writeBatch,
  getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged;
const PAGE = document.body.dataset.page || "food";

/* ---------------------------------------------------------------
   Og Sabha: the free student hub for Indian colleges
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

/* ---------- firebase (lazy) ---------- */
const FB_URL = "https://www.gstatic.com/firebasejs/10.14.1/";
let ready = false;
let db, auth;
const fbHooks = [];
// Runs fn now if Firebase is connected, otherwise as soon as it is.
const whenFirebase = (fn) => {
  if (!ready) { fbHooks.push(fn); return; }
  try { fn(); } catch (e) { console.error(e); }
};
const idle = (fn, timeout = 1500) => ("requestIdleCallback" in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 300));

let fbPromise = null;
function connectFirebase() {
  if (fbPromise) return fbPromise;
  fbPromise = Promise.all([
    import(FB_URL + "firebase-app.js"),
    import(FB_URL + "firebase-firestore.js"),
    import(FB_URL + "firebase-auth.js")
  ]).then(([a, f, au]) => {
    ({ initializeApp } = a);
    ({ getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
       query, where, onSnapshot, serverTimestamp, increment, writeBatch } = f);
    ({ getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged } = au);
    const fbApp = initializeApp(firebaseConfig);
    db = getFirestore(fbApp);
    auth = getAuth(fbApp);
    ready = true;
    fbHooks.splice(0).forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }).catch((e) => {
    console.error("Firebase failed to load:", e);
    const note = $("setup-note");
    if (note) {
      note.hidden = false;
      note.textContent = "Could not reach Firebase (check your internet or ad blocker). The menu and timetable still work, but ratings, live teacher status, the wall and gigs are off.";
    }
  });
  return fbPromise;
}

let currentUser = null; // staff only (email login)
let me = null;          // anyone signed in, including anonymous visitors
let anonFailed = false;
let lastAuthError = "";

// Resolves with the signed-in user (anonymous or staff). Connects Firebase first if needed.
let signInPromise = null;
function ensureMe() {
  if (me) return Promise.resolve(me);
  if (!signInPromise) {
    signInPromise = connectFirebase()
      .then(() => {
        if (!ready) return null;
        return signInAnonymously(auth).then((cred) => { me = cred.user; anonFailed = false; return me; });
      })
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

// The menu and timetable are written into the page by build_pages.py (no network request).
// Fallback: fetch from data/ first, then the main folder.
async function loadJSON(name) {
  const inline = document.getElementById("data-" + name.replace(".json", ""));
  if (inline) { try { return JSON.parse(inline.textContent); } catch { /* fall through to fetch */ } }
  for (const path of [`data/${name}`, name]) {
    try { const r = await fetch(path); if (r.ok) return await r.json(); } catch { /* try next */ }
  }
  throw new Error(`Could not load ${name}`);
}
function showLoadError(err) {
  console.error(err);
  const n = $("setup-note");
  n.hidden = false;
  n.textContent = "Could not load the menu, timetable or bus file. Check that the JSON files are uploaded and have no typos.";
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

// Time-of-day greeting chip.
function greet() {
  const h = new Date().getHours();
  const hi = h < 5 ? "late night? 🦉" : h < 12 ? "good morning ☀️" : h < 17 ? "good afternoon 🌤️" : h < 21 ? "good evening 🌆" : "night owl 🌙";
  $("greet").textContent = `${hi} · ${todayName()}`;
}

/* =================================================================
   FOOD
   build_pages.py already wrote the clock, the day chips, the meal buttons and the menu data into the HTML,
   so this code only fills in text and keeps the clock running. Renders only change what changed.
================================================================= */
let foodDay = todayName();
let foodMeal = null;
let mealPicked = false;
const F = {};          // element refs for the food page
const setText = (n, t) => { if (n && n.textContent !== t) n.textContent = t; };

async function initFood() {
  menu = await loadJSON("menu.json");
  buildFood();
  pickDefaultMeal();
  renderFood();
  watchClock();
  tickClock();

  // ratings come from Firebase, which loads after the page is already usable
  whenFirebase(() => {
    onSnapshot(query(collection(db, "ratings"), where("date", "==", todayStr())), (snap) => {
      ratingStats = {};
      snap.forEach((d) => {
        const r = d.data();
        const s = (ratingStats[r.meal] ||= { sum: 0, count: 0 });
        s.sum += r.stars;
        s.count += 1;
      });
      scheduleFoodRender();
    }, (err) => console.warn("Could not read ratings:", err.code));
    renderFood();
  });

  setInterval(() => { if (document.hidden) return; if (!mealPicked) pickDefaultMeal(); renderFood(); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (!mealPicked) pickDefaultMeal();
    renderFood();
    tickClock();
  });
}

// Several rating updates in one frame cause one render.
function scheduleFoodRender() {
  if (F.raf) return;
  F.raf = requestAnimationFrame(() => { F.raf = 0; renderFood(); });
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

// Finds the elements that build_pages.py wrote, and wires one click handler for the whole panel.
function buildFood() {
  const root = $("food");
  F.root = root;
  F.feature = $("food-feature");
  F.dchips = [...root.querySelectorAll(".dchip")];
  F.plate = $("food-plate");
  F.plateName = F.plate.querySelector(".plate-name");
  F.svg = F.plate.querySelector(".bw");
  F.hh = F.svg.querySelector(".bh");
  F.mm = F.svg.querySelector(".bm");
  F.ss = F.svg.querySelector(".bs");
  F.badge = F.feature.querySelector(".badge");
  F.h2 = F.feature.querySelector("h2");
  F.whenMain = F.feature.querySelector(".when-main");
  F.whenSub = F.feature.querySelector(".when small");
  F.desc = F.feature.querySelector(".desc");
  F.rateInfo = F.feature.querySelector(".rate .muted");
  F.stars = F.feature.querySelector(".stars");
  const byMeal = (sel, m) => root.querySelector(`${sel}[data-meal="${m.name}"]`);
  F.railBtns = menu.meals.map((m) => byMeal(".rail-btn", m));
  F.dots = menu.meals.map((m) => byMeal(".dots button", m));
  F.tiles = menu.meals.map((m) => {
    const btn = byMeal(".tile", m);
    return btn && { m, btn, sub: btn.querySelector(".tile-sub"), more: btn.querySelector(".tile-more"), note: btn.querySelector(".tile-foot span") };
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-day],[data-meal]");
    if (!b || !root.contains(b)) return;
    if (b.dataset.day) setFoodDay(b.dataset.day);
    else pickMeal(b.dataset.meal, b.classList.contains("tile"));
  });

  wirePlate();
}

// Tilt toward the pointer, tap to spin the seconds hand. Used by the Food plate and the Classes watch (both are F.plate).
function wirePlate() {
  let tiltRaf = 0, tx = 0, ty = 0;
  F.plate.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") F.rect = F.plate.getBoundingClientRect(); });
  F.plate.addEventListener("pointermove", (e) => {
    if (reduceMotion || e.pointerType === "touch") return;
    const r = (F.rect ||= F.plate.getBoundingClientRect());
    tx = (e.clientX - r.left) / r.width - 0.5;
    ty = (e.clientY - r.top) / r.height - 0.5;
    if (tiltRaf) return;
    tiltRaf = requestAnimationFrame(() => {
      tiltRaf = 0;
      F.plate.style.setProperty("--ry", `${(tx * 18).toFixed(1)}deg`);
      F.plate.style.setProperty("--rx", `${(-ty * 18).toFixed(1)}deg`);
    });
  });
  F.plate.addEventListener("pointerleave", () => {
    F.rect = null;
    F.plate.style.setProperty("--rx", "0deg");
    F.plate.style.setProperty("--ry", "0deg");
  });
  F.plate.addEventListener("click", spinSecondHand);
  F.plate.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); spinSecondHand(); } });
}

// The clock only runs while the page is visible and the plate is on screen.
function watchClock() {
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver((entries) => {
    F.onScreen = entries[entries.length - 1].isIntersecting;
    F.plate.classList.toggle("paused", !F.onScreen);   // also pauses the floating animation
    if (F.onScreen) tickClock();
  }).observe(F.plate);
}

function tickClock() {
  clearTimeout(F.clockTimer);
  if (!F.ss || document.hidden || F.onScreen === false) return;
  const d = new Date();
  const h = d.getHours() % 12, m = d.getMinutes(), s = d.getSeconds();
  // the seconds hand only ever turns forward, so it never spins backwards at 59 -> 0
  F.angle = F.prevS === undefined ? s * 6 : F.angle + ((s - F.prevS + 60) % 60) * 6;
  F.prevS = s;
  if (F.lastMin !== m) {
    F.lastMin = m;
    F.hh.style.transform = `rotate(${h * 30 + m * 0.5}deg)`;
    F.mm.style.transform = `rotate(${m * 6}deg)`;
  }
  F.ss.style.transform = `rotate(${F.angle}deg)`;
  F.clockTimer = setTimeout(tickClock, 1000 - d.getMilliseconds() + 8);   // lands just after each second
}

function spinSecondHand() {
  const base = F.angle || 0;
  if (!reduceMotion && F.ss.animate) {
    F.svg.classList.add("spin");
    F.ss.animate(
      [{ transform: `rotate(${base}deg)` }, { transform: `rotate(${base + 720}deg)` }],
      { duration: 1100, easing: "cubic-bezier(.2,.8,.2,1)" }
    ).onfinish = () => F.svg.classList.remove("spin");
  }
  const r = F.plate.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2, PAGE === "classes" ? ["📚", "✨", "🎓"] : [MEAL_EMOJI[foodMeal] || "🍽️", "✨", "😋"], 10);
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

  F.dchips.forEach((b) => {
    const on = b.dataset.day === day;
    b.classList.toggle("active", on);
    if (b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on));
  });

  const m = menu.meals.find((x) => x.name === foodMeal) || menu.meals[0];
  const st = mealStatus(m, isToday, nm);
  F.railBtns.forEach((b, i) => b && b.classList.toggle("on", menu.meals[i].name === m.name));

  const dish = dishOf(day, m.name);
  setText(F.plateName, firstDish(dish));
  setText(F.badge, st.kind === "live" ? "Serving now" : st.kind === "soon" ? "Up next" : st.kind === "done" ? "Served earlier" : `${day}'s menu`);
  F.badge.classList.toggle("pulse", st.kind === "live");
  setText(F.h2, m.name.toLowerCase());
  setText(F.whenMain, `${fmt12(m.start)} – ${fmt12(m.end)}`);
  setText(F.whenSub, st.kind === "live" ? `ends in ${fmtDur(st.left)}`
    : st.kind === "soon" ? `starts in ${fmtDur(st.inMin)}`
    : st.kind === "done" ? "served earlier today" : `on ${day}`);
  setText(F.desc, dish);

  // ratings (the stars are only rebuilt when something about them changed)
  const stats = ratingStats[m.name];
  const canRate = ready && isToday && nm >= toMin(m.start);
  const mine = canRate ? Number(store.get(`rated_${todayStr()}_${m.name}`, 0)) : 0;
  const starsKey = `${canRate ? 1 : 0}|${m.name}|${mine}`;
  if (starsKey !== F.starsKey) {
    F.starsKey = starsKey;
    const stars = [];
    if (canRate) {
      for (let i = 1; i <= 5; i++) {
        stars.push(el("button", {
          type: "button", class: i <= mine ? "on" : "", "aria-label": `${i} star${i > 1 ? "s" : ""}`, text: "★",
          onclick: (e) => { burst(e.clientX, e.clientY, ["⭐", "✨", "🎉"], 12); rate(m.name, i); }
        }));
      }
    }
    F.stars.replaceChildren(...stars);
  }
  let info = "";
  if (!ready || !isToday) info = isToday ? "" : "Ratings open on the day itself.";
  else if (!canRate) info = "Rating opens when the meal starts.";
  else info = stats ? `★ ${(stats.sum / stats.count).toFixed(1)} · ${stats.count} rating${stats.count > 1 ? "s" : ""} today` : "No ratings yet today";
  setText(F.rateInfo, info);

  // meal tiles and dots
  F.tiles.forEach((t) => {
    if (!t) return;
    const xs = mealStatus(t.m, isToday, nm);
    const xStats = ratingStats[t.m.name];
    const d = dishOf(day, t.m.name);
    const note = ready && isToday && xStats ? `★ ${(xStats.sum / xStats.count).toFixed(1)} (${xStats.count})` : xs.kind === "live" ? "● serving now" : "";
    t.btn.classList.toggle("on", t.m.name === m.name);
    setText(t.sub, d);
    setText(t.more, d);
    setText(t.note, note);
  });
  F.dots.forEach((b, i) => b && b.classList.toggle("on", menu.meals[i].name === m.name));
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
   CLASSES (same layout as Food: watch, period details, period tiles)
================================================================= */
let classDay = todayName();
let notices = [];
let unsubNotices = null;
const AX = { idx: 0, touched: false, key: "", S: null };

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

const axPer = (no) => tt.periods.find((p) => p.no === no);
const axTeachers = (slots) => [...new Set(slots.flatMap((s) => (s.teacher || "").split(" / ")).map((t) => t.trim()).filter((t) => t && t !== "-" && t !== "Whole class"))];
const axPlural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const clTeacher = (t) => (!t || t === "-" ? "" : t);

function axState() {
  const cls = $("class-select").value, isToday = classDay === todayName(), nm = nowMin();
  const rows = [...((tt.classes[cls] || {})[classDay] || [])].sort((a, b) => a.period - b.period)
    .map((s) => ({ s, p: axPer(s.period) })).filter((r) => r.p)
    .map((r) => { const st = toMin(r.p.start), en = toMin(r.p.end); return { ...r, st, en, state: !isToday ? "plan" : nm >= en ? "past" : nm >= st ? "live" : "next" }; });
  return { cls, isToday, nm, rows, live: rows.find((r) => r.state === "live") || null, upcoming: rows.find((r) => r.state === "next") || null };
}

async function initClasses() {
  [tt, menu] = await Promise.all([loadJSON("timetable.json"), menu || loadJSON("menu.json")]);
  const sel = $("class-select");
  Object.keys(tt.classes).forEach((c) => sel.append(el("option", { value: c, text: c })));
  const saved = store.get("myClass");
  if (saved && tt.classes[saved]) sel.value = saved;
  sel.addEventListener("change", () => { store.set("myClass", sel.value); subscribeNotices(); renderClasses(); });

  // class chips (the hidden <select> above keeps the chosen class)
  $("class-chips").replaceChildren(...Object.keys(tt.classes).map((c) => el("button", {
    type: "button", class: "cl-cchip", "data-class": c, text: c, "aria-pressed": "false",
    onclick: () => { if (sel.value !== c) { sel.value = c; sel.dispatchEvent(new Event("change")); } }
  })));

  // day chips are written into the page; here they get their click and a dot for today
  F.cdays = [...document.querySelectorAll("#day-chips .dchip")];
  F.cdays.forEach((b) => {
    if (b.dataset.day === todayName()) b.classList.add("today");
    b.addEventListener("click", () => { classDay = b.dataset.day; renderClasses(); });
  });

  // the live watch (same code as the Food plate)
  F.plate = $("cl-watch");
  F.svg = F.plate.querySelector(".bw");
  F.hh = F.svg.querySelector(".bh");
  F.mm = F.svg.querySelector(".bm");
  F.ss = F.svg.querySelector(".bs");
  wirePlate();

  renderQuote();
  initNoticeForm();
  subscribeNotices();
  renderClasses();
  watchClock();
  tickClock();
  // on phones the day strip scrolls sideways: start with today's chip in view
  const strip = $("day-chips"), on = strip.querySelector(".dchip.active");
  if (on && strip.scrollWidth > strip.clientWidth) strip.scrollLeft = on.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft - (strip.clientWidth - on.offsetWidth) / 2;

  whenFirebase(() => {
    subscribeNotices();
    onSnapshot(query(collection(db, "attendance"), where("date", "==", todayStr())), (snap) => {
      attendance = {};
      snap.forEach((d) => { const a = d.data(); attendance[`${a.cls}_${a.period}`] = a.present; });
      renderClasses();
    }, (err) => console.warn("Could not read attendance:", err.code));
  });
  setInterval(() => { if (!document.hidden) renderClasses(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) return; renderClasses(); tickClock(); });
}

// Rail, tiles and dots are rebuilt only when the class or the day changes; everything else just updates in place.
function clBuild(S) {
  F.clKey = `${S.cls}|${classDay}`;
  F.actKey = "";
  const pick = (i, scroll) => {
    AX.idx = i; AX.touched = true; renderClasses();
    if (scroll && isPhone()) $("cl-feature").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  };
  F.clRail = S.rows.map((r, i) => el("button", { type: "button", class: "cl-rb", text: `P${r.s.period}`, "aria-label": `Period ${r.s.period}`, onclick: () => pick(i) }));
  F.clDots = S.rows.map((r, i) => el("button", { type: "button", "aria-label": `Period ${r.s.period}`, onclick: () => pick(i) }));
  F.clTiles = S.rows.map((r, i) => {
    const t = parts12(r.p.start);
    const btn = el("button", { type: "button", class: "cl-tile", "aria-label": `Period ${r.s.period}: ${r.s.subject}, ${t.t} ${t.ap}`, onclick: () => pick(i, true) },
      el("span", { class: "cl-tp", text: `P${r.s.period}`, "aria-hidden": "true" }),
      el("span", { class: "cl-tt", text: `${t.t} ${t.ap}` }),
      el("span", { class: "cl-tn", text: r.s.subject }),
      el("span", { class: "cl-ts", text: clTeacher(r.s.teacher) || (r.s.teacher === "-" ? "Free period" : "") }),
      el("span", { class: "cl-tf" }, el("span"), el("span", { "aria-hidden": "true", text: "view →" })));
    return { btn, note: btn.querySelector(".cl-tf span") };
  });
  $("cl-rail").replaceChildren(...F.clRail);
  $("cl-dots").replaceChildren(...F.clDots);
  const n = S.rows.length;
  const list = $("cl-list");
  list.style.setProperty("--cols", String(n <= 4 ? Math.max(1, n) : 3));
  if (!n) list.replaceChildren(el("div", { class: "cl-empty" }, el("strong", { text: `No classes on ${classDay}.` }), el("br"), `Nothing scheduled for ${S.cls}.`));
  else list.replaceChildren(...F.clTiles.map((t) => t.btn));
}

function clFeature(S) {
  const r = S.rows[AX.idx];
  const badge = $("cl-badge"), att = $("cl-att"), prog = $("cl-prog");
  F.clRail.forEach((b, i) => { b.classList.toggle("on", i === AX.idx); b.setAttribute("aria-pressed", String(i === AX.idx)); });
  F.clDots.forEach((b, i) => b.classList.toggle("on", i === AX.idx));
  prog.hidden = true;
  if (!r) {
    setText(badge, "Free day"); badge.className = "cl-badge live";
    setText($("cl-h2"), "No classes");
    setText($("cl-when"), classDay);
    setText($("cl-when-sub"), `nothing scheduled for ${S.cls}`);
    setText($("cl-desc"), "A free day. Rest, catch up and plan the week.");
    setText($("cl-wname"), "free day");
    att.hidden = true; $("cl-actions").replaceChildren(); F.actKey = "";
    return;
  }
  const live = r.state === "live", teacher = clTeacher(r.s.teacher);
  setText(badge, live ? "Live now" : r.state === "next" ? "Up next" : r.state === "past" ? "Finished" : `${classDay}'s plan`);
  badge.className = "cl-badge" + (live ? " live" : "");
  setText($("cl-h2"), r.s.subject);
  setText($("cl-when"), `${fmt12(r.p.start)} – ${fmt12(r.p.end)}`);
  setText($("cl-when-sub"), live ? `ends in ${fmtDur(r.en - S.nm)}` : r.state === "next" ? `starts in ${fmtDur(r.st - S.nm)}`
    : r.state === "past" ? "finished earlier today" : `${fmtDur(r.en - r.st)} on ${classDay}`);
  setText($("cl-desc"), teacher ? (r.s.teacher === "Whole class" ? "Whole class" : `with ${teacher}`) : "No teacher for this period.");
  setText($("cl-wname"), `period ${r.s.period}`);
  if (live) { prog.hidden = false; prog.firstChild.style.setProperty("--w", `${Math.round(((S.nm - r.st) / (r.en - r.st)) * 100)}%`); }

  // teacher present / absent (today only), plus staff controls
  const showAtt = ready && S.isToday && teacher && r.s.teacher !== "Whole class";
  att.hidden = !showAtt;
  if (showAtt) {
    const v = attendance[`${S.cls}_${r.s.period}`];
    att.className = "cl-att " + (v === true ? "good" : v === false ? "bad" : "grey");
    setText(att, v === true ? "Teacher present" : v === false ? "Teacher absent" : "Not reported yet");
  }
  const staff = !!(ready && S.isToday && currentUser);
  const key = staff ? `${S.cls}|${r.s.period}` : "";
  if (key !== F.actKey) {
    F.actKey = key;
    $("cl-actions").replaceChildren(...(staff ? [
      el("button", { type: "button", text: "Mark present", onclick: () => setAttendance(S.cls, r.s.period, true) }),
      el("button", { type: "button", class: "danger", text: "Mark absent", onclick: () => setAttendance(S.cls, r.s.period, false) }),
      el("button", { type: "button", class: "ghost", text: "Clear", onclick: () => clearAttendance(S.cls, r.s.period) })
    ] : []));
  }
}

function clTiles(S) {
  S.rows.forEach((r, i) => {
    const t = F.clTiles[i];
    const v = ready && S.isToday ? attendance[`${S.cls}_${r.s.period}`] : undefined;
    t.btn.classList.toggle("on", i === AX.idx);
    t.btn.classList.toggle("live", r.state === "live");
    t.btn.classList.toggle("past", r.state === "past");
    t.btn.setAttribute("aria-pressed", String(i === AX.idx));
    setText(t.note, v === true ? "✓ teacher in" : v === false ? "✕ teacher absent"
      : r.state === "live" ? `● live · ${r.en - S.nm} min left` : r.state === "next" ? `in ${fmtDur(r.st - S.nm)}`
      : r.state === "past" ? "done" : fmtDur(r.en - r.st));
  });
  const n = S.rows.length;
  setText($("cl-sum"), n ? `${axPlural(n, "period")} · ${fmt12(S.rows[0].p.start)} – ${fmt12(S.rows[n - 1].p.end)} · ${axPlural(axTeachers(S.rows.map((r) => r.s)).length, "teacher")}` : "");
}

function renderClasses() {
  if (!tt) return;
  const S = AX.S = axState();
  const key = `${S.cls}|${classDay}`;
  if (AX.key !== key) { AX.key = key; AX.touched = false; }
  if (!AX.touched) AX.idx = S.live ? S.rows.indexOf(S.live) : S.upcoming ? S.rows.indexOf(S.upcoming) : S.isToday ? Math.max(0, S.rows.length - 1) : 0;
  AX.idx = Math.max(0, Math.min(S.rows.length - 1, AX.idx));
  if (F.clKey !== key) clBuild(S);
  F.cdays.forEach((b) => { const on = b.dataset.day === classDay; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
  document.querySelectorAll(".cl-cchip").forEach((b) => { const on = b.dataset.class === S.cls; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
  clFeature(S); clTiles(S); renderNotices();
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
    list.append(el("div", { class: "ax-notice" },
      el("p", { class: "ax-tag", text: `Notice · ${postTime(n)}` }),
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
   WALL: the last bench.
   Pick a topic, write the note, a person reads it, then it goes on the wall.
   Posting, the one-minute wait, the word filter, reports and staff approval are unchanged.
================================================================= */
let approvedPosts = [];
let pendingPosts = [];
let wallShuffle = false, wallSeed = 0;
let unsubPending = null;
const reportedKey = "reportedPosts";
const reportedSet = () => { try { return new Set(JSON.parse(store.get(reportedKey, "[]"))); } catch { return new Set(); } };

const idHash = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const CF = {};

const SINS = {
  bunk: "Which class did you skip, and where did you go instead?",
  proxy: "Whose attendance did you sign, and would you do it again?",
  copy: "What did you copy, and did anyone ever find out?",
  crush: "What have you never told them? Leave out the name.",
  food: "What did you waste, and how much of it?",
  worse: "Say the thing you have been carrying."
};

function initConfession() {
  const frame = $("cf-frame"), card = $("cf-card"), text = $("post-text");
  if (!frame || !card || !text) return;
  const meter = $("cf-meter"), meterTxt = $("cf-meter-txt"), base = text.getAttribute("placeholder");
  const steps = [...frame.querySelectorAll(".cn-step")];
  let done = false;
  const setStep = (n) => {
    frame.dataset.step = String(n);
    steps.forEach((s, i) => { if (i + 1 === n) s.setAttribute("aria-current", "step"); else s.removeAttribute("aria-current"); });
  };
  const picked = () => frame.querySelector('input[name="cf-sin"]:checked');
  const sync = () => {
    const n = text.value.length;
    meter.style.setProperty("--g", (n / 300).toFixed(3));
    meterTxt.textContent = n === 0 ? "Nothing written yet." : n < 80 ? "Short and sweet." : n < 200 ? "Getting long." : "Almost at the limit.";
    if (!done) setStep(n ? 2 : picked() ? 2 : 1);
  };
  const reopen = () => { if (done) { done = false; card.classList.remove("confessed"); } };
  text.addEventListener("input", () => { reopen(); sync(); });
  frame.addEventListener("change", (e) => {
    if (e.target.name !== "cf-sin") return;
    reopen();
    text.placeholder = `${SINS[e.target.value] || base} Don't name anyone.`;
    sync();
  });
  // after a successful post: the wax seal comes down on the slip
  CF.done = () => {
    done = true;
    card.classList.remove("confessed"); void card.offsetWidth; card.classList.add("confessed");
    const c = picked(); if (c) c.checked = false;
    text.placeholder = base;
    sync(); setStep(3);
    const r = card.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, ["🫧", "💗", "✨", "🤫"], 14);
    navigator.vibrate?.(30);
  };
  $("wl-down")?.addEventListener("click", () => {
    goTo("post-form", "start");
    setTimeout(() => text.focus({ preventScroll: true }), reduceMotion ? 0 : 450);
  });
  $("cf-read")?.addEventListener("click", () => goTo("wl-posts-head", "start"));
  const clock = $("cf-clock"), t0 = Date.now();
  if (clock) setInterval(() => {
    if (document.hidden) return;
    const s = Math.floor((Date.now() - t0) / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }, 1000);
}

/* ---------- play: jellyfish, headline words, prompt dice, tilt, shuffle ---------- */
function initWallFx() {
  const hero = $("cn-hero"), jelly = $("cn-jelly"), word = $("cn-word"), btn = $("cn-cloud"), text = $("post-text"), slip = $("cf-card");
  const fine = matchMedia("(hover: hover)").matches;
  const WORDS = ["Unsigned", "Unsaid", "Untold", "Unheard"];
  let wi = 0, timer = null;
  const nextWord = () => {
    if (!word) return;
    wi = (wi + 1) % WORDS.length;
    word.textContent = WORDS[wi];
    word.classList.remove("swap"); void word.offsetWidth; word.classList.add("swap");
  };
  const arm = () => { clearInterval(timer); if (!reduceMotion) timer = setInterval(() => { if (!document.hidden) nextWord(); }, 4200); };
  arm();

  /* the jellyfish: a spring that drifts on its own, or chases the pointer when the toggle is on */
  const tents = [...document.querySelectorAll("#cn-jelly path[data-k]")].map((p) => ({
    p, x0: +p.dataset.x, y0: +p.dataset.y, len: +p.dataset.l, amp: +p.dataset.a, sp: +p.dataset.s, ph: +p.dataset.ph
  }));
  const N = 14;
  const draw = (time, vx, vy) => {
    for (const o of tents) {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        pts.push([o.x0 + o.amp * t * Math.sin(time * o.sp + o.ph - t * 4.2) - vx * t * t * 3.4, o.y0 + o.len * t - vy * t * t * 1.6]);
      }
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < N; i++) d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${((pts[i][0] + pts[i + 1][0]) / 2).toFixed(1)} ${((pts[i][1] + pts[i + 1][1]) / 2).toFixed(1)}`;
      d += `L${pts[N][0].toFixed(1)} ${pts[N][1].toFixed(1)}`;
      o.p.setAttribute("d", d);
    }
  };
  let x = 0, y = 0, vx = 0, vy = 0, mx = 0, px = 0, py = 0, follow = false, on = false, raf = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const frame = (ms) => {
    raf = 0;
    const time = ms / 1000, W = hero.clientWidth, H = hero.clientHeight;
    let tx, ty;
    if (follow) { tx = clamp(px - W / 2, -W * 0.42, W * 0.42); ty = clamp(py - H * 0.38, -H * 0.18, H * 0.34); }
    else { tx = mx * 28; ty = Math.sin(time * 0.9) * 14; }
    vx += (tx - x) * 0.012; vy += (ty - y) * 0.012; vx *= 0.9; vy *= 0.9; x += vx; y += vy;
    jelly.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), ${y.toFixed(1)}px) rotate(${clamp(vx * 0.9, -14, 14).toFixed(2)}deg)`;
    draw(time, vx, vy);
    if (on) raf = requestAnimationFrame(frame);
  };
  const run = () => { if (!on && !reduceMotion) { on = true; raf = requestAnimationFrame(frame); } };
  const stop = () => { on = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
  if (hero && jelly && tents.length) {
    if (reduceMotion) draw(0, 0, 0);
    else {
      if ("IntersectionObserver" in window) new IntersectionObserver((es) => es.forEach((en) => (en.isIntersecting ? run() : stop()))).observe(hero);
      else run();
      document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));
    }
    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top;
      mx = (px / r.width) * 2 - 1;
      hero.style.setProperty("--mx", mx.toFixed(3)); hero.style.setProperty("--my", ((py / r.height) * 2 - 1).toFixed(3));
    });
    hero.addEventListener("pointerleave", () => { mx = 0; hero.style.setProperty("--mx", 0); hero.style.setProperty("--my", 0); });
  }
  $("cn-follow")?.addEventListener("change", (e) => {
    follow = e.target.checked;
    const t = $("cn-follow-txt"); if (t) t.textContent = follow ? "ON" : "OFF";
  });
  btn?.addEventListener("click", (e) => {
    const svg = btn.querySelector("svg"), r = btn.getBoundingClientRect();
    burst(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 3, ["🫧", "💗", "✨"], 10);
    svg?.classList.remove("kick"); void svg?.getBoundingClientRect(); svg?.classList.add("kick");
    vy -= 16; nextWord(); arm();
  });
  $("cn-round")?.addEventListener("click", () => goTo("post-form", "start"));

  $("cn-dice")?.addEventListener("click", () => {
    const keys = Object.keys(SINS), k = keys[Math.floor(Math.random() * keys.length)];
    const radio = document.querySelector(`input[name="cf-sin"][value="${k}"]`);
    if (radio) { radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true })); }
    text?.focus({ preventScroll: true });
  });
  text?.addEventListener("input", () => {
    if (text.value.length >= 300 && slip) { slip.classList.remove("full"); void slip.offsetWidth; slip.classList.add("full"); }
  });

  const list = $("post-list");
  if (list && !reduceMotion && fine) {
    list.addEventListener("pointermove", (e) => {
      const c = e.target.closest?.(".cn-post"); if (!c) return;
      const r = c.getBoundingClientRect(), ax = (e.clientX - r.left) / r.width, ay = (e.clientY - r.top) / r.height;
      c.style.setProperty("--ry", `${((ax - 0.5) * 8).toFixed(2)}deg`);
      c.style.setProperty("--rx", `${((0.5 - ay) * 8).toFixed(2)}deg`);
      c.style.setProperty("--px", `${(ax * 100).toFixed(1)}%`);
      c.style.setProperty("--py", `${(ay * 100).toFixed(1)}%`);
    });
    list.addEventListener("pointerout", (e) => {
      const c = e.target.closest?.(".cn-post");
      if (c && !c.contains(e.relatedTarget)) { c.style.setProperty("--rx", "0deg"); c.style.setProperty("--ry", "0deg"); c.style.setProperty("--py", "-60%"); }
    });
  }
  const sortBtns = [...document.querySelectorAll(".cn-sortb")];
  sortBtns.forEach((b) => b.addEventListener("click", () => {
    wallShuffle = b.dataset.sort === "shuffle";
    wallSeed = Math.floor(Math.random() * 1e9);
    sortBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderWall();
  }));
}

/* ---------- setup ---------- */
function initWall() {
  const text = $("post-text");
  text.addEventListener("input", () => { $("post-count").textContent = `${text.value.length} / 300`; });

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("post-msg");
    const body = text.value.trim();
    if (!body) return;
    if (!(await ensureMe())) { msg.textContent = authProblem(); return; }

    const last = Number(store.get("lastPost", 0));
    if (Date.now() - last < 60000) { msg.textContent = "Please wait a minute between notes."; return; }
    const lower = body.toLowerCase();
    if (BAD_WORDS.some((w) => lower.includes(w))) { msg.textContent = "Please remove rude words and try again."; return; }

    try {
      await addDoc(collection(db, "posts"), { text: body, approved: false, reports: 0, createdAt: serverTimestamp() });
      store.set("lastPost", Date.now());
      text.value = "";
      $("post-count").textContent = "0 / 300";
      msg.textContent = "Sent. Your note goes on the wall once a person has read it.";
      CF.done?.();
    } catch (err) {
      console.error(err);
      msg.textContent = "Could not post. Try again later.";
    }
  });

  whenFirebase(() => {
    onSnapshot(query(collection(db, "posts"), where("approved", "==", true)), (snap) => {
      approvedPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderWall();
    }, (err) => console.warn("Could not read posts:", err.code));
  });

  initConfession();
  initWallFx();
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
  const visible = approvedPosts.filter((p) => staff || (p.reports || 0) < 3).sort(wallShuffle ? (a, b) => ((idHash(a.id) ^ wallSeed) >>> 0) - ((idHash(b.id) ^ wallSeed) >>> 0) : newestFirst);

  const list = $("post-list");
  list.replaceChildren();
  if (!visible.length) list.append(el("p", { class: "cn-empty", text: "The wall is empty. Write the first note." }));
  visible.forEach((p) => {
    const h = idHash(p.id);
    const done = reported.has(p.id);
    const actions = el("div", { class: "cn-act" },
      el("button", { type: "button", class: "cn-mini", text: done ? "Reported" : "Report", disabled: done ? "" : null, onclick: () => reportPost(p.id) }),
      staff ? el("button", { type: "button", class: "cn-mini danger", text: `Delete (${p.reports || 0} reports)`, onclick: () => removePost(p.id) }) : null
    );
    list.append(el("article", { class: `cn-post cv${h % 4}`, style: `--rot:${((((h >> 3) % 9) - 4) * 0.45).toFixed(2)}deg` },
      el("p", { class: "cn-text", text: p.text }),
      el("p", { class: "cn-meta", text: `Posted ${postTime(p)}` }),
      actions));
  });
  $("wl-count").textContent = visible.length ? `${visible.length} ${visible.length === 1 ? "note" : "notes"} on the wall` : "";

  $("pending-box").hidden = !staff;
  const pl = $("pending-list");
  pl.replaceChildren();
  if (staff) {
    if (!pendingPosts.length) pl.append(el("p", { class: "muted", text: "Nothing waiting." }));
    [...pendingPosts].sort((a, b) => -newestFirst(a, b)).forEach((p) => {
      pl.append(el("div", { class: "cn-pend" },
        el("p", { text: p.text }),
        el("div", { class: "cn-act" },
          el("button", { type: "button", class: "cn-mini", text: "Approve", onclick: () => approvePost(p.id) }),
          el("button", { type: "button", class: "cn-mini danger", text: "Delete", onclick: () => removePost(p.id) })
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
  whenFirebase(() => {
    onSnapshot(query(collection(db, "gigs"), where("approved", "==", true)), (snap) => {
      gigsApproved = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderGigs();
    }, (err) => console.warn("Could not read gigs:", err.code));
  });
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
   STAFF LOGIN (every page has the footer form; Firebase is connected when it is opened or used)
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

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await connectFirebase();
  if (!ready) { alert(authProblem()); return; }
  try {
    await signInWithEmailAndPassword(auth, $("login-email").value, $("login-pass").value);
    $("login-pass").value = "";
  } catch (err) {
    console.error(err);
    alert("Wrong email or password.");
  }
});
$("staff-login")?.addEventListener("toggle", (e) => { if (e.target.open) connectFirebase(); });

whenFirebase(() => {
  onAuthStateChanged(auth, (u) => {
    // The wall and gigs need a silent anonymous id so the rules know who posted what.
    if (!u && (PAGE === "wall" || PAGE === "gigs")) ensureMe();
    me = u;
    currentUser = u && !u.isAnonymous ? u : null; // only email logins count as staff
    renderAuth();
    if (PAGE === "classes") { renderClasses(); renderNotices(); }
    if (PAGE === "wall") subscribePending();
    if (PAGE === "gigs") subscribeGigs();
  });
});

/* ---------- ABOUT: three-step story, 01 --- 03 ---------- */
const ABOUT_STEPS = [
  { k: "Our story", t: "Og Sabha", p: "Made by the UG 2026 batch of college students in India. We got tired of asking \u201cwhat\u2019s for lunch?\u201d and \u201cwhich hour is this?\u201d, so we built one place for both." },
  { k: "What you can do", t: "Five tabs", p: "Food: today\u2019s mess menu and meal ratings. Classes: your live timetable and notices. Bus: the next bus with a live countdown. Wall: post anonymously, every post is checked first. Gigs: offer a skill or hire a classmate." },
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

/* =================================================================
   BUS
   bus.json is written into the page by build_pages.py. Same layout as Food and Classes: a feature panel for the chosen bus
   (direction rail, big time disc, live countdown, stops, pin), a grid of trip tiles and dots. The hero keeps the tap-to-honk bus.
================================================================= */
let bus = null;
const BS = { dir: null, sel: null, touched: false, key: "", pin: store.get("busPin", ""), target: null, pinTarget: null, ac: null, rb: {}, tiles: [], dots: [], stopsKey: "" };
const secNow = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
const fmtCount = (s) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m > 0 ? `${m} min ${pad(r)} s` : `${r} s`;
};
const busSecs = (t) => toMin(t.time) * 60;
const busSorted = (dir) => [...bus.directions[dir]].sort((a, b) => toMin(a.time) - toMin(b.time));
const nextBusIn = (dir, s) => busSorted(dir).find((t) => busSecs(t) >= s);
const pinKey = (dir, t) => `${dir}|${t.time}`;

async function initBus() {
  bus = await loadJSON("bus.json");
  const dirs = Object.keys(bus.directions);
  const saved = store.get("busDir");
  const s = secNow();
  // open on the saved direction, otherwise the one whose next bus leaves first
  BS.dir = dirs.includes(saved) ? saved : dirs.map((d) => [d, nextBusIn(d, s)]).filter(([, t]) => t)
    .sort((a, b) => busSecs(a[1]) - busSecs(b[1]))[0]?.[0] || dirs[0];

  // direction rail (built once; the counts and the highlight are updated in place)
  $("bus-dirs").replaceChildren(...dirs.map((d) => {
    const small = el("small");
    const btn = el("button", { type: "button", class: "kb-rb", "data-dir": d, "aria-pressed": "false" }, el("span", { text: d }), small);
    BS.rb[d] = { btn, small };
    return btn;
  }));

  const pick = (time, scroll) => {
    BS.sel = time; BS.touched = true; renderBus();
    if (scroll && isPhone()) $("bus-now").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  };
  $("bus").addEventListener("click", (e) => {
    const rb = e.target.closest(".kb-rb");
    const tile = e.target.closest(".kb-tile");
    const dot = e.target.closest("#bus-dots button");
    const pinBtn = e.target.closest("#kb-pinbtn");
    const unpin = e.target.closest(".kb-unpin");
    if (rb) { BS.dir = rb.dataset.dir; store.set("busDir", BS.dir); renderBus(); }
    else if (pinBtn) {
      if (BS.pin === pinBtn.dataset.key) { BS.pin = ""; }
      else { BS.pin = pinBtn.dataset.key; burst(e.clientX, e.clientY, ["🚌", "⭐", "✨"], 8); }
      store.set("busPin", BS.pin); renderBus();
    }
    else if (unpin) { BS.pin = ""; store.set("busPin", ""); renderBus(); }
    else if (tile) pick(tile.dataset.time, true);
    else if (dot) pick(dot.dataset.time, false);
  });
  $("kb-bus").addEventListener("click", driveBus);

  renderBus();
  setInterval(() => { if (!document.hidden) renderBus(); }, 20000);
  setInterval(() => { if (!document.hidden) tickBus(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { renderBus(); } });
}

// Two-tone horn, then the bus drives off the right edge and comes back from the left.
function driveBus() {
  const b = $("kb-bus");
  if (!b.classList.contains("go") && !reduceMotion) {
    b.classList.add("go");
    setTimeout(() => b.classList.remove("go"), 2500);
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = BS.ac || (BS.ac = new AC());
    c.resume?.();
    const t = c.currentTime;
    [[392, 0], [311, 0], [392, 0.32], [311, 0.32]].forEach(([f, dt]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.07, t + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.26);
      o.connect(g); g.connect(c.destination); o.start(t + dt); o.stop(t + dt + 0.3);
    });
  } catch { /* sound is optional */ }
}

function stopsOf(t) {
  const via = t.via ? t.via.split(",").map((x) => x.trim()).filter(Boolean) : [];
  return [...via, t.route];
}

// Tiles and dots are rebuilt only when the direction changes; everything else updates in place.
function busBuild(trips) {
  BS.tiles = trips.map((t) => {
    const p = parts12(t.time);
    const btn = el("button", { type: "button", class: "kb-tile", "data-time": t.time, "aria-label": `${p.t} ${p.ap}, ${t.route}` },
      el("span", { class: "kb-tp", "aria-hidden": "true", text: "🚌" }),
      el("span", { class: "kb-tt", text: `${p.t} ${p.ap}` }),
      el("span", { class: "kb-tn", text: t.route }),
      el("span", { class: "kb-ts", text: t.via ? `via ${t.via}` : "From the college" }),
      el("span", { class: "kb-tf" }, el("span"), el("span", { "aria-hidden": "true", text: "view →" })));
    return { t, btn, note: btn.querySelector(".kb-tf span") };
  });
  BS.dots = trips.map((t) => el("button", { type: "button", "data-time": t.time, "aria-label": `${fmt12(t.time)}, ${t.route}` }));
  $("bus-lists").replaceChildren(...BS.tiles.map((x) => x.btn));
  $("bus-dots").replaceChildren(...BS.dots);
  BS.stopsKey = "";
}

function renderBus() {
  if (!bus) return;
  const s = secNow();
  const dirs = Object.keys(bus.directions);
  const trips = busSorted(BS.dir);
  const next = trips.find((t) => busSecs(t) >= s) || null;
  if (BS.key !== BS.dir) { BS.key = BS.dir; BS.touched = false; busBuild(trips); }
  if (!BS.touched || !trips.some((t) => t.time === BS.sel)) BS.sel = (next || trips[0]).time;
  const sel = trips.find((t) => t.time === BS.sel);
  const selKey = pinKey(BS.dir, sel);
  const isNext = sel === next, gone = busSecs(sel) < s, tomorrow = gone && !next && !BS.touched;

  // the big headline on the hero shows where the chosen direction goes
  const jd = $("jp-dest");
  if (jd) { const nm = BS.dir.replace(/^To\s+/i, ""); jd.textContent = nm + "."; jd.classList.toggle("long", nm.length > 9); }

  // direction rail
  dirs.forEach((d) => {
    const r = BS.rb[d], on = d === BS.dir;
    const left = bus.directions[d].filter((t) => busSecs(t) >= s).length;
    r.btn.classList.toggle("on", on);
    r.btn.setAttribute("aria-pressed", String(on));
    setText(r.small, left ? `${left} left today` : "done today");
  });

  // the feature: disc, badge, route, countdown, stops, pin
  const p = parts12(sel.time);
  setText($("kb-d-t"), p.t);
  setText($("kb-d-ap"), p.ap);
  const badge = $("kb-badge");
  setText(badge, tomorrow ? "First bus tomorrow" : isNext ? "Next bus" : gone ? "Left earlier" : "Later today");
  badge.className = "kb-badge" + (isNext ? " live" : "");
  setText($("kb-h"), sel.route);
  setText($("kb-when"), fmt12(sel.time));
  setText($("kb-desc"), `${sel.via ? `Via ${sel.via}.` : "Direct from the college stop."}${sel.check ? " Timing not confirmed yet, check at the stop." : ""}`);
  BS.target = gone ? null : busSecs(sel);
  $("kb-prog").hidden = gone;
  if (gone) setText($("kb-when-sub"), tomorrow ? "no more buses today" : "left earlier today");

  if (BS.stopsKey !== selKey) {
    BS.stopsKey = selKey;
    const stops = stopsOf(sel);
    const chain = [el("span", { class: "kb-stop me", text: "College" })];
    stops.forEach((st, i) => {
      chain.push(el("span", { class: "kb-arrow", "aria-hidden": "true", text: "➜" }));
      chain.push(el("span", { class: "kb-stop" + (i === stops.length - 1 ? " end" : ""), text: st }));
    });
    $("kb-stops").replaceChildren(...chain);
  }
  const pb = $("kb-pinbtn"), pinned = BS.pin === selKey;
  pb.hidden = gone;
  pb.dataset.key = selKey;
  setText(pb, pinned ? "Unpin this bus" : "★ Pin as my bus");

  // tiles and dots
  BS.tiles.forEach((x, i) => {
    const tg = busSecs(x.t) < s, tn = x.t === next, tp = BS.pin === pinKey(BS.dir, x.t), on = x.t === sel;
    x.btn.classList.toggle("on", on);
    x.btn.classList.toggle("next", tn);
    x.btn.classList.toggle("gone", tg);
    x.btn.setAttribute("aria-pressed", String(on));
    setText(x.note, tp ? "★ pinned" : tg ? "left" : tn ? `next · in ${fmtDur(Math.max(1, Math.round((busSecs(x.t) - s) / 60)))}` : x.t.check ? "unconfirmed" : `in ${fmtDur(Math.max(1, Math.round((busSecs(x.t) - s) / 60)))}`);
    BS.dots[i].classList.toggle("on", on);
  });
  const left = trips.filter((t) => busSecs(t) >= s).length;
  setText($("kb-sum"), `${trips.length} buses · ${fmt12(trips[0].time)} – ${fmt12(trips[trips.length - 1].time)} · ${left ? `${left} left today` : "done for today"}`);

  // the sign on the hero bus shows the next destination
  const sign = $("kb-sign");
  if (sign) sign.textContent = (next ? next.route : "KSRTC").toUpperCase().slice(0, 14);

  // pinned bus ticket
  const mine = $("my-bus");
  mine.replaceChildren();
  BS.pinTarget = null;
  if (BS.pin) {
    const [pd, pt] = BS.pin.split("|");
    const pt_ = (bus.directions[pd] || []).find((t) => t.time === pt);
    if (pt_) {
      const g2 = busSecs(pt_) < s;
      BS.pinTarget = g2 ? null : busSecs(pt_);
      mine.append(el("div", { class: "kb-ticket" },
        el("span", { class: "k", text: "★ MY BUS" }),
        el("div", { class: "row" },
          el("div", {}, el("strong", { text: `${fmt12(pt_.time)} · ${pt_.route}` }), el("span", { class: "muted", text: `${pd}${pt_.via ? ` · via ${pt_.via}` : ""}` })),
          el("span", { class: "kb-ticket-count", id: "kb-pin-count", text: g2 ? "left" : "" })),
        el("div", { class: "actions" }, el("button", { type: "button", class: "kb-unpin", text: "Unpin" }))
      ));
    }
  }
  tickBus();
}

// Runs every second: only the countdown text and the progress bar change.
function tickBus() {
  if (!bus) return;
  const s = secNow();
  if (BS.target != null) {
    const left = BS.target - s;
    if (left < -1) { renderBus(); return; }               // it has gone: show the next one
    setText($("kb-when-sub"), left <= 0 ? "leaving now" : `leaves in ${fmtCount(left)}`);
    const pr = $("kb-prog");
    if (pr && pr.firstChild) pr.firstChild.style.setProperty("--w", `${Math.round(Math.min(1, Math.max(0, 1 - left / 3600)) * 100)}%`);   // fills over the last hour
  }
  const pc = $("kb-pin-count");
  if (pc && BS.pinTarget != null) {
    const left = BS.pinTarget - s;
    if (left < -1) { renderBus(); return; }
    pc.textContent = left <= 0 ? "leaving now" : fmtCount(left);
  }
}

/* ---------- start (each page runs only its own section) ---------- */
const safe = (fn) => { try { const r = fn(); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); } };
safe(greet);
setInterval(() => { if (!document.hidden) greet(); }, 60000);
if (PAGE === "food") initFood().catch(showLoadError);
else if (PAGE === "classes") initClasses().catch(showLoadError);
else if (PAGE === "bus") initBus().catch(showLoadError);
else if (PAGE === "wall") safe(initWall);
else if (PAGE === "gigs") { safe(initGigs); safe(initGlobe); }
else if (PAGE === "about") safe(initAbout);

// Firebase: wall and gigs need it straight away. Food and Classes load it once the page has painted.
// About never loads it (unless staff open the login).
if (PAGE === "wall" || PAGE === "gigs") connectFirebase();
else if (PAGE === "food" || PAGE === "classes") {
  const go = () => idle(connectFirebase);
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
}

// Offline support (sw.js is network-first, so updates always arrive).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
