// Firebase (about 300 KB) is loaded lazily by connectFirebase(), never at the top of this file,
// so menu, timetable and clock render without waiting for it.
let initializeApp, getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, increment, writeBatch,
  getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged;
const PAGE = document.body.dataset.page || "food";

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

  // tilt toward the pointer (mouse only, one style write per frame), tap to spin the seconds hand
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
  burst(r.left + r.width / 2, r.top + r.height / 2, [MEAL_EMOJI[foodMeal] || "🍽️", "✨", "😋"], 10);
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
  [tt, menu] = await Promise.all([loadJSON("timetable.json"), menu || loadJSON("menu.json")]);
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

  whenFirebase(() => {
    subscribeNotices();
    onSnapshot(query(collection(db, "attendance"), where("date", "==", todayStr())), (snap) => {
      attendance = {};
      snap.forEach((d) => { const a = d.data(); attendance[`${a.cls}_${a.period}`] = a.present; });
      renderClasses();
    }, (err) => console.warn("Could not read attendance:", err.code));
  });
  setInterval(() => { if (!document.hidden) renderClasses(); }, 30000);
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
   WALL: a confession evidence board.
   - Every approved post is a pinned file. Red string links them. Words are blacked out until you open the file.
   - Tap or press Enter on a file to declassify it. Drag it (mouse) and the strings follow.
   - A dark room with one light: it follows the pointer, rests on the open file, and drifts back to the lamp when idle.
   - "Lights" makes the room bright. Reduced motion turns off the string draw-in and flip animation.
================================================================= */
let approvedPosts = [];
let pendingPosts = [];
let unsubPending = null;
const reportedKey = "reportedPosts";
const reportedSet = () => { try { return new Set(JSON.parse(store.get(reportedKey, "[]"))); } catch { return new Set(); } };
const idHash = (id) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
const WL = { lamp: store.get("wlLamp") === "1", cx: 0, cy: 0, x: 0, y: 0, last: 0, focus: null, pos: {}, drawn: false, intro: 0, raf: 0 };

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
    if (Date.now() - last < 60000) { msg.textContent = "Please wait a minute between posts."; return; }
    const lower = body.toLowerCase();
    if (BAD_WORDS.some((w) => lower.includes(w))) { msg.textContent = "Please remove rude words and try again."; return; }

    try {
      await addDoc(collection(db, "posts"), { text: body, approved: false, reports: 0, createdAt: serverTimestamp() });
      store.set("lastPost", Date.now());
      text.value = "";
      $("post-count").textContent = "0 / 300";
      msg.textContent = "Filed. A person reads it before it goes on the board.";
      const s = $("wl-stamp"); s.classList.remove("on"); void s.offsetWidth; s.classList.add("on");
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
  initWallScene();
}

function syncWallButtons() {
  const b = $("wl-lamp");
  if (b) { b.textContent = WL.lamp ? "Lights: on" : "Lights: dim"; b.setAttribute("aria-pressed", String(WL.lamp)); }
}
const wallHint = (t) => { const h = $("wl-hint"); if (h) h.textContent = t; };

function initWallScene() {
  const room = $("wl-room"), fx = $("wl-fx");
  document.body.classList.toggle("wl-lamp", WL.lamp);
  syncWallButtons();
  wallHint(matchMedia("(pointer: coarse)").matches ? "Tap a file to read it in full." : "Click a file to read it in full. Drag files to rearrange the strings.");

  const toggleLights = () => {
    WL.lamp = !WL.lamp;
    store.set("wlLamp", WL.lamp ? "1" : "0");
    document.body.classList.toggle("wl-lamp", WL.lamp);
    syncWallButtons();
  };
  $("wl-lamp").addEventListener("click", toggleLights);
  $("wl-lampsvg").addEventListener("click", toggleLights);
  $("wl-down").addEventListener("click", () => goTo("post-form", "center"));
  $("wl-random").addEventListener("click", () => {
    const cards = [...document.querySelectorAll("#post-list .wl-card")];
    if (!cards.length) { wallHint("The board is empty. Be the first to file one."); return; }
    const c = cards[Math.floor(Math.random() * cards.length)];
    c.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    setTimeout(() => { if (!c.classList.contains("open")) toggleCard(c); }, reduceMotion ? 0 : 450);
  });

  const aim = (x, y) => { WL.cx = x; WL.cy = y; WL.last = performance.now(); };
  room.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") aim(e.clientX, e.clientY); });
  room.addEventListener("touchmove", (e) => { const t = e.touches[0]; if (t) aim(t.clientX, t.clientY - 60); }, { passive: true });
  room.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t) aim(t.clientX, t.clientY - 60); }, { passive: true });

  tickFlipClock(); setInterval(tickFlipClock, 10000);
  addEventListener("resize", drawStrings);
  if ("ResizeObserver" in window) new ResizeObserver(drawStrings).observe($("post-list"));

  const frame = (now) => {
    WL.raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const rr = room.getBoundingClientRect();
    if (rr.bottom < 0 || rr.top > innerHeight) return;
    let tx = WL.cx, ty = WL.cy;
    if (WL.focus && WL.focus.isConnected) { const r = WL.focus.getBoundingClientRect(); tx = r.left + r.width / 2; ty = r.top + r.height / 2; }
    else if (now - WL.last > 3000) {
      const h = $("wl-lamphead")?.getBoundingClientRect();
      tx = h && h.width ? h.left + h.width / 2 - 70 : rr.left + rr.width * 0.7;
      ty = h && h.width ? h.top + h.height / 2 + 150 : rr.top + 160;
    }
    const k = reduceMotion ? 1 : 0.12;
    WL.x += (tx - rr.left - WL.x) * k; WL.y += (ty - rr.top - WL.y) * k;
    const r = Math.max(150, Math.min(280, Math.min(innerWidth, innerHeight) * 0.34)) * (reduceMotion ? 1 : 1 + 0.02 * Math.sin(now / 110));
    fx.style.setProperty("--tx", WL.x.toFixed(1) + "px"); fx.style.setProperty("--ty", WL.y.toFixed(1) + "px"); fx.style.setProperty("--r", r.toFixed(0) + "px");
  };
  WL.x = room.getBoundingClientRect().width * 0.65; WL.y = 220;
  WL.raf = requestAnimationFrame(frame);
}

function tickFlipClock() {
  const f = $("wl-flip"); if (!f) return;
  const d = new Date(), v = [d.getHours(), d.getMinutes()].map((n) => String(n).padStart(2, "0"));
  f.querySelectorAll("b").forEach((b, i) => {
    if (b.textContent === v[i]) return;
    b.textContent = v[i];
    if (!reduceMotion) { b.classList.remove("fl"); void b.offsetWidth; b.classList.add("fl"); }
  });
  f.setAttribute("aria-label", `Local time ${v[0]}:${v[1]}`);
}

/* ---------- strings between pins ---------- */
let strRaf = 0;
function drawStrings() {
  cancelAnimationFrame(strRaf);
  strRaf = requestAnimationFrame(() => {
    const svg = $("wl-strings"), grid = svg?.parentElement;
    if (!svg || !grid) return;
    const b = grid.getBoundingClientRect();
    svg.setAttribute("viewBox", `0 0 ${b.width} ${b.height}`);
    const pts = [...grid.querySelectorAll(".wl-card .wl-pin")].map((p) => { const r = p.getBoundingClientRect(); return [r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top]; });
    const seg = (a, c, i, cls, sag) => {
      const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2 + sag + Math.hypot(a[0] - c[0], a[1] - c[1]) * 0.07;
      return `<path class="${cls}" pathLength="1" style="--i:${i}" data-a="${i}" data-b="${cls === "chord" ? i + 3 : i + 1}" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}"/>`;
    };
    let out = "";
    for (let i = 0; i < pts.length - 1; i++) out += seg(pts[i], pts[i + 1], i, "s", 10);
    for (let i = 0; i + 3 < pts.length; i += 3) out += seg(pts[i], pts[i + 3], i, "chord", 24);
    svg.innerHTML = out;
    if (!WL.drawn && pts.length > 1) {
      WL.drawn = true;
      if (!reduceMotion) { svg.classList.add("intro"); WL.intro = setTimeout(() => svg.classList.remove("intro"), 1200 + pts.length * 80); }
    }
  });
}
function heatStrings(i, on) {
  document.querySelectorAll("#wl-strings path").forEach((p) => {
    const hit = Number(p.dataset.a) === i || Number(p.dataset.b) === i;
    p.classList.toggle("hot", on && hit);
  });
}

/* ---------- a file on the board ---------- */
function redact(text, seed) {
  let k = seed || 7;
  return text.split(/(\s+)/).map((w) => {
    if (!w.trim() || w.length < 4) return w;
    k = (Math.imul(k, 1103515245) + 12345) >>> 0;
    return (k >>> 8) % 100 < 24 ? el("span", { class: "rd", text: w }) : w;
  });
}
function toggleCard(card) {
  const open = !card.classList.contains("open");
  document.querySelectorAll("#post-list .wl-card.open").forEach((c) => { c.classList.remove("open"); c.setAttribute("aria-expanded", "false"); });
  card.classList.toggle("open", open);
  card.setAttribute("aria-expanded", String(open));
  WL.focus = open ? card : null;
  setTimeout(drawStrings, 280);
}
function wireCard(card, id, idx) {
  let sx = 0, sy = 0, bx = 0, by = 0, down = false, moved = false;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    down = true; moved = false; sx = e.clientX; sy = e.clientY;
    [bx, by] = WL.pos[id] || [0, 0];
    if (e.pointerType !== "touch") card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!down || e.pointerType === "touch") return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true; card.classList.add("drag");
    WL.pos[id] = [bx + dx, by + dy];
    card.style.setProperty("--dx", (bx + dx) + "px"); card.style.setProperty("--dy", (by + dy) + "px");
    drawStrings();
  });
  const end = () => { if (!down) return; down = false; card.classList.remove("drag"); if (!moved) toggleCard(card); drawStrings(); };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", () => { down = false; card.classList.remove("drag"); });
  card.addEventListener("keydown", (e) => { if (e.target === card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleCard(card); } });
  card.addEventListener("pointerenter", () => heatStrings(idx, true));
  card.addEventListener("pointerleave", () => heatStrings(idx, false));
  card.addEventListener("focus", () => heatStrings(idx, true));
  card.addEventListener("blur", () => heatStrings(idx, false));
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
  const visible = approvedPosts.filter((p) => staff || (p.reports || 0) < 3).sort(newestFirst);

  const list = $("post-list");
  const openId = list.querySelector(".wl-card.open")?.dataset.id;
  list.replaceChildren();
  WL.focus = null;
  if (!visible.length) list.append(el("p", { class: "wl-empty", text: "No files yet. Be the first to file a confession." }));
  visible.forEach((p, idx) => {
    const h = idHash(p.id);
    const done = reported.has(p.id);
    const actions = el("div", { class: "wl-act" },
      el("button", { type: "button", class: "wl-mini", text: done ? "Reported" : "Report", disabled: done ? "" : null, onclick: () => reportPost(p.id) }),
      staff ? el("button", { type: "button", class: "wl-mini danger", text: `Delete (${p.reports || 0} reports)`, onclick: () => removePost(p.id) }) : null
    );
    const [dx, dy] = WL.pos[p.id] || [0, 0];
    const card = el("article", {
      class: `wl-card k${h % 4}`, tabindex: "0", role: "button", "aria-expanded": "false", "data-id": p.id,
      style: `--rot:${((((h >> 3) % 9) - 4) * 0.7).toFixed(2)}deg;--dx:${dx}px;--dy:${dy}px`
    },
      el("i", { class: "wl-pin" }),
      el("p", { class: "wl-text" }, redact(p.text, h)),
      el("p", { class: "wl-meta", text: `File ${String(visible.length - idx).padStart(3, "0")}, ${postTime(p)}` }),
      actions);
    wireCard(card, p.id, idx);
    list.append(card);
    if (p.id === openId) { card.classList.add("open"); card.setAttribute("aria-expanded", "true"); WL.focus = card; }
  });
  $("wl-count").textContent = visible.length ? `${visible.length} ${visible.length === 1 ? "confession" : "confessions"} on file` : "";
  drawStrings();

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

/* =================================================================
   BUS
   bus.json is written into the page by build_pages.py. KSRTC-style page: animated road and bus (tap to honk),
   an LED destination board with a live countdown, direction tabs, tap a trip to see its stops, pin one as "my bus".
================================================================= */
let bus = null;
const BS = { dir: null, open: null, pin: store.get("busPin", ""), target: null, pinTarget: null, ac: null };
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

  $("bus").addEventListener("click", (e) => {
    const tab = e.target.closest(".kb-tab");
    const trip = e.target.closest(".kb-trip-btn");
    const pin = e.target.closest(".kb-pin");
    const unpin = e.target.closest(".kb-unpin");
    if (tab) { BS.dir = tab.dataset.dir; BS.open = null; store.set("busDir", BS.dir); renderBus(); }
    else if (pin) { BS.pin = pin.dataset.key; store.set("busPin", BS.pin); burst(e.clientX, e.clientY, ["🚌", "⭐", "✨"], 8); renderBus(); }
    else if (unpin) { BS.pin = ""; store.set("busPin", ""); renderBus(); }
    else if (trip) { const k = trip.dataset.key; BS.open = BS.open === k ? null : k; renderBus(); }
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

function renderBus() {
  if (!bus) return;
  const s = secNow();
  const af = document.activeElement;
  const refocus = af && af.classList && (af.classList.contains("kb-trip-btn") ? `.kb-trip-btn[data-key="${af.dataset.key}"]`
    : af.classList.contains("kb-tab") ? `.kb-tab[data-dir="${af.dataset.dir}"]` : null);
  const dirs = Object.keys(bus.directions);
  const trips = busSorted(BS.dir);
  const next = trips.find((t) => busSecs(t) >= s);

  // big headline on the hero shows where the selected direction goes
  const jd = $("jp-dest");
  if (jd) { const nm = BS.dir.replace(/^To\s+/i, ""); jd.textContent = nm + "."; jd.classList.toggle("long", nm.length > 9); }

  // direction tabs
  $("bus-dirs").replaceChildren(...dirs.map((d) => {
    const left = bus.directions[d].filter((t) => busSecs(t) >= s).length;
    return el("button", {
      type: "button", class: "kb-tab", role: "tab", "data-dir": d, "aria-selected": String(d === BS.dir)
    }, el("span", { text: d }), el("small", { text: left ? `${left} left today` : "done today" }));
  }));

  // LED board
  const led = $("bus-now");
  led.classList.toggle("none", !next);
  BS.target = next ? busSecs(next) : null;
  let destText, sub;
  if (next) {
    destText = `${next.route}  ✦  ${BS.dir}  ✦  `;
    sub = next.via ? `VIA ${next.via.toUpperCase()}` : "FROM DC COLLEGE STOP";
  } else {
    destText = `NO MORE BUSES TODAY  ✦  `;
    sub = trips.length ? `FIRST BUS TOMORROW: ${fmt12(trips[0].time)} · ${trips[0].route}`.toUpperCase() : "";
  }
  led.replaceChildren(
    el("span", { class: "kb-tag", text: `Next bus · ${BS.dir}${next && next.check ? " · unconfirmed" : ""}` }),
    el("div", { class: "kb-dest", "aria-hidden": "true" }, el("span", { class: "kb-marq" }, el("span", { text: destText }), el("span", { text: destText }))),
    el("span", { class: "sr-only", text: next ? `${next.route}, ${fmt12(next.time)}` : "No more buses today" }),
    next ? el("div", { class: "kb-row" },
      el("strong", { class: "kb-time", text: fmt12(next.time) }),
      el("span", { class: "kb-count", id: "kb-count" })) : null,
    next ? el("div", { class: "kb-track", id: "kb-track", "aria-hidden": "true" }, el("i", { class: "kb-trackbus", text: "🚌" })) : null,
    el("span", { class: "kb-via", text: sub })
  );
  // the sign on the bus shows the same destination
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
      const gone = busSecs(pt_) < s;
      BS.pinTarget = gone ? null : busSecs(pt_);
      mine.append(el("div", { class: "kb-ticket" },
        el("span", { class: "k", text: "★ MY BUS" }),
        el("div", { class: "row" },
          el("div", {}, el("strong", { text: `${fmt12(pt_.time)} · ${pt_.route}` }), el("span", { class: "muted", text: `${pd}${pt_.via ? ` · via ${pt_.via}` : ""}` })),
          el("span", { class: "kb-ticket-count", id: "kb-pin-count", text: gone ? "left" : "" })),
        el("div", { class: "actions" }, el("button", { type: "button", class: "kb-unpin", text: "Unpin" }))
      ));
    }
  }

  // trip list
  const ol = el("ol", { class: "kb-list" });
  trips.forEach((t) => {
    const key = pinKey(BS.dir, t);
    const isNext = t === next, gone = busSecs(t) < s, open = BS.open === key, pinned = BS.pin === key;
    const stops = stopsOf(t);
    const chain = [el("span", { class: "kb-stop me", text: "DC College" })];
    stops.forEach((st, i) => {
      chain.push(el("span", { class: "kb-arrow", "aria-hidden": "true", text: "➜" }));
      chain.push(el("span", { class: "kb-stop" + (i === stops.length - 1 ? " end" : ""), text: st }));
    });
    ol.append(el("li", { class: ["kb-trip", isNext && "next", gone && "gone", open && "open", pinned && "pinned"].filter(Boolean).join(" ") },
      el("button", { type: "button", class: "kb-trip-btn", "data-key": key, "aria-expanded": String(open) },
        el("time", { datetime: t.time, text: fmt12(t.time) }),
        el("span", {}, t.route, t.via ? el("span", { class: "via", text: `via ${t.via}` }) : null),
        el("span", {},
          pinned ? el("span", { class: "badge star", text: "★ pinned" })
            : t.check ? el("span", { class: "badge", text: "unconfirmed" })
            : isNext ? el("span", { class: "badge", text: "next" }) : null,
          " ", el("span", { class: "chev", "aria-hidden": "true", text: "▼" }))),
      el("div", { class: "kb-more" },
        el("span", { class: "k", text: "Stops on this service" }),
        el("div", { class: "kb-stops" }, chain),
        gone ? null : pinned ? el("button", { type: "button", class: "kb-unpin", text: "Unpin this bus" })
          : el("button", { type: "button", class: "kb-pin", "data-key": key, text: "★ Pin as my bus" }))
    ));
  });
  $("bus-lists").replaceChildren(el("section", { class: "bus-col" }, ol));
  if (refocus) document.querySelector(refocus)?.focus({ preventScroll: true });
  tickBus();
}

// Runs every second: only the countdown text and the little bus on the board change.
function tickBus() {
  if (!bus) return;
  const s = secNow();
  const c = $("kb-count");
  if (c && BS.target != null) {
    const left = BS.target - s;
    if (left < -1) { renderBus(); return; }               // it has gone: show the next one
    c.textContent = left <= 0 ? "leaving now" : `in ${fmtCount(left)}`;
    const tr = $("kb-track");
    if (tr) tr.style.setProperty("--p", String(Math.min(1, Math.max(0, 1 - left / 3600)).toFixed(3)));   // bus rolls in over the last hour
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
