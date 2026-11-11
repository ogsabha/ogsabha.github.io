import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, updateDoc, deleteDoc, getDocs,
  query, where, onSnapshot, serverTimestamp, increment, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

/* ---------------------------------------------------------------
   1. PASTE YOUR FIREBASE CONFIG HERE (Firebase console > Project
      settings > Your apps > Web app). Until you do, the site still
      shows the menu and timetable, but ratings/status/wall are off.
---------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyDAom6PmaYuSN75PrsVRSGzCHHrvbF8Q8c",
  authDomain: "og-sabha.firebaseapp.com",
  projectId: "og-sabha",
  storageBucket: "og-sabha.firebasestorage.app",
  messagingSenderId: "692594007498",
  appId: "1:692594007498:web:819205fd17a8add28c8333"
};

// Add more words you want blocked on the wall (lowercase).
const BAD_WORDS = ["idiot", "stupid", "slut", "bitch"];

const MEAL_EMOJI = { Breakfast: "🍳", Lunch: "🍛", Snacks: "🍟", Dinner: "🌙" };
const TAB_EMOJI = { food: ["🍛", "🍟", "🧁"], classes: [], wall: ["💬", "🤫", "🌙"], gigs: ["🛠️", "💸", "🎨"], about: [] };

/* --------------------------------------------------------------- */

const ready = !firebaseConfig.apiKey.startsWith("PASTE");
let db, auth;
if (ready) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} else {
  document.getElementById("setup-note").hidden = false;
}

/* ---------- small helpers ---------- */
const $ = (id) => document.getElementById(id);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
// Always use college time (India), even if the phone is set to another time zone.
const istParts = () => Object.fromEntries(
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
const nowMin = () => { const p = istParts(); return Number(p.hour) * 60 + Number(p.minute); };
const todayStr = () => { const p = istParts(); return `${p.year}-${p.month}-${p.day}`; };
const todayName = () => istParts().weekday;
const fmt12 = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
};
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
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

let currentUser = null; // staff only (email login)
let me = null;          // anyone signed in, including anonymous visitors
let anonFailed = false;

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

// The "right now" strip under the header: current meal + current class.
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
    el("div", {}, el("span", { class: "k", text: "In the mess" }),
      el("strong", { text: meal ? `${meal.name} is being served` : "Nothing being served" }),
      el("span", { class: "muted", text: mealText })),
    el("div", {}, el("span", { class: "k", text: "In class" }),
      el("strong", { text: classTitle }),
      el("span", { class: "muted", text: classSub }))
  );
}

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-selected", String(b === btn)); });
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
    document.body.dataset.theme = btn.dataset.tab; // switches the whole look
    history.replaceState(null, "", `#${btn.dataset.tab}`);
    window.scrollTo({ top: 0, left: 0, behavior: "instant" }); // every section opens from its top
    const subs = {
      food: "Today's menu, what's being served now, and how it actually tastes.",
      classes: "Every period, every teacher, and a notice from your admins when plans change.",
      wall: "Confess in the dark. No names, no faces, only whispers.",
      gigs: "Post a job or advertise a skill. Replies stay private, and every post is checked before it goes live.",
      about: "Who made this, what it does, and how to reach us."
    };
    const sub = document.querySelector(".sub");
    if (sub) sub.textContent = subs[btn.dataset.tab];
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", { food: "#ffffff", classes: "#c8d8bc", wall: "#080304", gigs: "#7a2a0c", about: "#000000" }[btn.dataset.tab]);
    const r = btn.getBoundingClientRect();
    if (TAB_EMOJI[btn.dataset.tab].length) burst(r.left + r.width / 2, r.top + r.height / 2, TAB_EMOJI[btn.dataset.tab], 8);
  });
});

/* =================================================================
   FOOD
================================================================= */
let menu = null;
let ratingStats = {}; // meal -> { sum, count } for today

async function initFood() {
  menu = await loadJSON("menu.json");
  const sel = $("day-select");
  DAYS.forEach((d) => sel.append(el("option", { value: d, text: d })));
  sel.value = todayName();
  sel.addEventListener("change", renderFood);
  renderFood();
  startWatch();

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
    });
  }
  setInterval(renderFood, 60000);
}

/* ---------- food: the big plate is a live watch ---------- */
let watchTurns = 0, watchLastS = -1; // keeps the second hand turning forward past 12
let spinK = 0;                       // extra dial turns while the watch is "spinning" (0 = live time)
let spinning = false;

function watchFace() {
  let ticks = "";
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0;
    ticks += `<line x1="50" y1="${big ? 7 : 8}" x2="50" y2="${big ? 14 : 10.5}" transform="rotate(${i * 6} 50 50)" class="${big ? "tb" : "ts"}"/>`;
  }
  const wrap = document.createElement("div");
  wrap.className = "bwrap";
  // Static markup only (no user text), so innerHTML is safe here.
  wrap.innerHTML = `<svg class="bw" viewBox="0 0 100 100" aria-hidden="true">${ticks}` +
    `<text x="50" y="22" class="n">12</text><text x="78" y="50.5" class="n">3</text><text x="50" y="79" class="n">6</text><text x="22" y="50.5" class="n">9</text>` +
    `<line class="bh" x1="50" y1="54" x2="50" y2="29"/><line class="bm" x1="50" y1="56" x2="50" y2="17"/>` +
    `<line class="bs" x1="50" y1="62" x2="50" y2="12"/><circle class="bd" cx="50" cy="50" r="3"/></svg>`;
  return wrap;
}

function paintWatches() {
  const hands = document.querySelectorAll(".plate-art.big .bw");
  if (!hands.length) return;
  const sec = new Date().getSeconds();
  const mins = nowMin() + sec / 60; // college time (IST)
  if (sec < watchLastS) watchTurns++;
  watchLastS = sec;
  hands.forEach((svg) => {
    svg.querySelector(".bs").style.transform = `rotate(${watchTurns * 360 + sec * 6 + spinK * 360 * 24}deg)`;
    svg.querySelector(".bm").style.transform = `rotate(${(mins % 60) * 6 + spinK * 360 * 12}deg)`;
    svg.querySelector(".bh").style.transform = `rotate(${((mins / 60) % 12) * 30 + spinK * 360}deg)`;
    svg.classList.toggle("spin", spinning);
  });
}

// Tap the watch: the hands whirl round and settle back on the real time.
function spinWatch() {
  if (spinning) return;
  spinning = true;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { spinning = false; return; }
  const t0 = performance.now(), dur = 1700;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    spinK = ease(t);
    paintWatches();
    if (t < 1) requestAnimationFrame(step);
    else { spinK = 0; paintWatches(); setTimeout(() => { spinning = false; paintWatches(); }, 60); }
  };
  requestAnimationFrame(step);
}

function startWatch() {
  setInterval(() => { if (!spinning) paintWatches(); }, 1000);
  const feat = $("food-feature");
  if (!feat) return;
  feat.addEventListener("click", (e) => { if (e.target.closest(".plate-art.big")) spinWatch(); });
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // Plate tilts towards the pointer.
  feat.addEventListener("pointermove", (e) => {
    const p = feat.querySelector(".plate-art.big");
    if (!p) return;
    const r = p.getBoundingClientRect();
    const x = (e.clientX - (r.left + r.width / 2)) / r.width, y = (e.clientY - (r.top + r.height / 2)) / r.height;
    p.style.setProperty("--ry", `${Math.max(-1, Math.min(1, x)) * 14}deg`);
    p.style.setProperty("--rx", `${Math.max(-1, Math.min(1, y)) * -14}deg`);
  });
  feat.addEventListener("pointerleave", () => {
    const p = feat.querySelector(".plate-art.big");
    if (p) { p.style.setProperty("--rx", "0deg"); p.style.setProperty("--ry", "0deg"); }
  });
}

let featuredMeal = null; // meal picked by tapping a card (resets when the day changes)
const noPhoto = new Set();

// A round plate. Shows food/<meal>.jpg when that photo exists, otherwise the meal's name.
function plateArt(m, big) {
  const p = el("div", { class: "plate-art" + (big ? " big" : "") });
  if (big) { p.append(watchFace(), el("span", { class: "plate-name", text: m.name })); }
  if (!noPhoto.has(m.name)) {
    const img = el("img", { src: `food/${m.name.toLowerCase()}.jpg`, alt: "", loading: "lazy" });
    img.addEventListener("error", () => { noPhoto.add(m.name); img.remove(); });
    p.append(img);
  }
  return p;
}

function renderFood() {
  if (!menu) return;
  const day = $("day-select").value;
  const isToday = day === todayName();
  const nm = nowMin();
  const dayMenu = menu.days[day] || {};
  const liveOf = (m) => isToday && nm >= toMin(m.start) && nm < toMin(m.end);
  const pick = (name) => { featuredMeal = name; renderFood(); };
  const feat = menu.meals.find((m) => m.name === featuredMeal) || menu.meals.find(liveOf)
    || (isToday && menu.meals.find((m) => toMin(m.start) > nm)) || menu.meals[0];

  // day links
  const nav = $("day-nav");
  nav.replaceChildren();
  [1, 2, 3, 4, 5, 6, 0].map((i) => DAYS[i]).forEach((d) => nav.append(el("button", {
    type: "button", class: "dchip" + (d === day ? " active" : ""), text: d.slice(0, 3), "aria-label": d,
    onclick: () => { $("day-select").value = d; featuredMeal = null; renderFood(); }
  })));

  // rating box for the featured meal
  let rateBox = null;
  if (isToday && ready) {
    const stats = ratingStats[feat.name];
    rateBox = el("div", { class: "rate" },
      el("p", { class: "muted", text: stats ? `★ ${(stats.sum / stats.count).toFixed(1)} from ${stats.count} ratings today` : "No ratings yet today" }));
    if (nm >= toMin(feat.start)) {
      const mine = Number(store.get(`rated_${todayStr()}_${feat.name}`, 0));
      const stars = el("div", { class: "stars" });
      for (let i = 1; i <= 5; i++) {
        stars.append(el("button", { type: "button", class: i <= mine ? "on" : "", "aria-label": `${i} star${i > 1 ? "s" : ""}`, text: "★", onclick: () => rate(feat.name, i) }));
      }
      rateBox.append(stars);
    } else rateBox.append(el("p", { class: "muted", text: "Rating opens when the meal starts." }));
  }

  // big feature: plate on a dark panel, headline, description, serving time
  $("food-feature").replaceChildren(
    el("div", { class: "stage" },
      el("div", { class: "slab" }),
      el("div", { class: "rail" }, menu.meals.map((m) => el("button", { type: "button", class: "rail-btn" + (m.name === feat.name ? " on" : ""), text: m.name, onclick: () => pick(m.name) }))),
      plateArt(feat, true)),
    el("div", { class: "copy" },
      liveOf(feat) ? el("span", { class: "badge pulse", text: "Serving now" }) : null,
      el("h2", { text: `${day} ${feat.name}` }),
      el("p", { class: "desc", text: dayMenu[feat.name] || "Not added yet" }),
      el("p", { class: "when" }, `${fmt12(feat.start)} – ${fmt12(feat.end)}`, el("small", { text: "serving time" })),
      rateBox,
      el("a", { class: "darkbtn", href: "mess-menu.html", text: "Full week menu" }))
  );

  // one dark card per meal
  const list = $("food-list");
  list.replaceChildren();
  menu.meals.forEach((m) => {
    const stats = isToday ? ratingStats[m.name] : null;
    list.append(el("button", {
      type: "button", class: "tile" + (m.name === feat.name ? " on" : ""), "aria-pressed": String(m.name === feat.name), onclick: (e) => { burst(e.clientX, e.clientY, ["🍛", "🥞", "🍌", "☕", "🥟"], 6); pick(m.name); }
    },
      plateArt(m, false),
      el("span", { class: "tile-time", text: fmt12(m.start) }),
      el("span", { class: "tile-name", text: m.name }),
      el("span", { class: "tile-sub", text: (dayMenu[m.name] || "Not added yet").split(/[,(]/)[0].trim() }),
      el("span", { class: "tile-foot" },
        el("span", { text: liveOf(m) ? "Serving now" : stats ? `★ ${(stats.sum / stats.count).toFixed(1)}` : "" }),
        el("span", { "aria-hidden": "true", text: "›" }))
    ));
  });

  // dots under the cards
  const dots = $("food-dots");
  dots.replaceChildren();
  menu.meals.forEach((m) => dots.append(el("button", { type: "button", class: m.name === feat.name ? "on" : "", "aria-label": m.name, onclick: () => pick(m.name) })));
  paintWatches();
  renderNow();
}

async function rate(meal, stars) {
  if (!me) { alert("Still connecting. Try again in a few seconds."); return; }
  const date = todayStr();
  try {
    // One document per visitor per meal per day (the rules check the id), so rating again replaces your old rating.
    await setDoc(doc(db, "ratings", `${date}_${meal}_${me.uid}`), { date, meal, stars });
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
let tt = null;
let attendance = {}; // "Class A_3" -> true/false for today
let classDay = null;  // day shown in the timetable (null = today)

async function initClasses() {
  tt = await loadJSON("timetable.json");
  const sel = $("class-select");
  Object.keys(tt.classes).forEach((c) => sel.append(el("option", { value: c, text: c })));
  const saved = store.get("myClass");
  if (saved && tt.classes[saved]) sel.value = saved;
  sel.addEventListener("change", () => { store.set("myClass", sel.value); renderClasses(); });
  renderClasses();

  if (ready) {
    onSnapshot(query(collection(db, "attendance"), where("date", "==", todayStr())), (snap) => {
      attendance = {};
      snap.forEach((d) => { const a = d.data(); attendance[`${a.cls}_${a.period}`] = a.present; });
      renderClasses();
    });
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
  renderNotices();
  const cls = $("class-select").value;
  const slots = (tt.classes[cls] || {})[todayName()] || [];
  const viewDay = classDay || todayName();
  const viewSlots = (tt.classes[cls] || {})[viewDay] || [];
  renderDayChips(viewDay);
  const periodOf = (no) => tt.periods.find((p) => p.no === no);
  const nm = nowMin();

  const current = slots.find((s) => { const p = periodOf(s.period); return p && nm >= toMin(p.start) && nm < toMin(p.end); });
  const next = slots.find((s) => { const p = periodOf(s.period); return p && toMin(p.start) > nm; });

  renderNow();
  const nowBox = $("class-now");
  nowBox.replaceChildren();
  if (current) {
    const p = periodOf(current.period);
    const startM = toMin(p.start), endM = toMin(p.end);
    const pct = Math.round(((nm - startM) / (endM - startM)) * 100);
    nowBox.append(el("div", { class: "card live" },
      el("div", { class: "row" }, el("h3", { text: "Now" }), ready ? statusBadge(cls, current.period) : null),
      el("p", { text: `Period ${current.period} · ${current.subject}` }),
      el("p", { class: "muted", text: `${current.teacher} · ${fmt12(p.start)} – ${fmt12(p.end)} · ${endM - nm} min left` }),
      el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: `--w:${pct}%` }))
    ));
  } else {
    nowBox.append(el("div", { class: "card" },
      el("h3", { text: "No class right now" }),
      next
        ? el("p", { class: "muted", text: `Next: ${next.subject} with ${next.teacher} at ${fmt12(periodOf(next.period).start)}` })
        : el("p", { class: "muted", text: slots.length ? "No more classes today." : "No classes today." })
    ));
  }

  const table = $("class-table");
  table.replaceChildren();
  const isToday = viewDay === todayName();
  if (!viewSlots.length) { table.append(el("p", { class: "muted", text: isToday ? "No classes scheduled today." : `No classes on ${viewDay}.` })); return; }

  const tl = el("ol", { class: "timeline" });
  viewSlots.forEach((s) => {
    const p = periodOf(s.period);
    const isCurrent = isToday && s === current;
    const [clock, ap] = p ? fmt12(p.start).split(" ") : ["", ""];
    const card = el("div", { class: "slot-card" },
      el("strong", { text: s.subject }),
      el("div", { class: "muted", text: s.teacher })
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
    tl.append(el("li", { class: "slot" + (isCurrent ? " current" : "") },
      el("div", { class: "slot-time" }, el("b", { text: clock }), el("span", { text: ap }), el("em", { text: `Period ${s.period}` })),
      el("span", { class: "dot" }),
      card
    ));
  });
  table.append(tl);
}

function renderDayChips(viewDay) {
  const box = $("day-chips");
  box.replaceChildren();
  ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((d) => {
    box.append(el("button", {
      type: "button",
      class: (d === viewDay ? "active " : "") + (d === todayName() ? "today" : ""),
      text: d.slice(0, 3),
      "aria-label": d,
      onclick: () => { classDay = d === todayName() ? null : d; renderClasses(); }
    }));
  });
}

async function setAttendance(cls, period, present) {
  const date = todayStr();
  try {
    await setDoc(doc(db, "attendance", `${date}_${cls}_${period}`), { date, cls, period, present });
  } catch (e) {
    console.error(e);
    alert("You are not allowed to change this. Log in with a class rep account.");
  }
}
async function clearAttendance(cls, period) {
  try { await deleteDoc(doc(db, "attendance", `${todayStr()}_${cls}_${period}`)); }
  catch (e) { console.error(e); alert("Could not clear."); }
}

/* =================================================================
   NOTICES (admins post per class, everyone reads)
================================================================= */
let notices = [];

function initNotices() {
  const t = $("notice-text");
  t.addEventListener("input", () => { $("notice-count").textContent = `${t.value.length} / 400`; });
  $("notice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("notice-msg"), text = t.value.trim(), cls = $("class-select").value;
    if (!text || !currentUser) return;
    try {
      await addDoc(collection(db, "notices"), { cls, text, createdAt: serverTimestamp() });
      t.value = ""; $("notice-count").textContent = "0 / 400";
      msg.textContent = `Published to ${cls}.`;
    } catch (err) {
      console.error(err);
      msg.textContent = "Could not publish. Log in as an admin and try again.";
    }
  });
  if (ready) {
    onSnapshot(collection(db, "notices"),
      (snap) => { notices = snap.docs.map((d) => ({ id: d.id, ...d.data() })); renderNotices(); },
      (err) => console.warn("Could not read notices:", err.code));
  }
}

function renderNotices() {
  if (!ready || !$("notice-list")) return;
  const cls = $("class-select").value;
  $("notice-compose").hidden = !currentUser;
  $("notice-to").textContent = cls;
  const box = $("notice-list");
  box.replaceChildren();
  notices
    .filter((n) => n.cls === cls)
    .sort((a, b) => (b.createdAt?.seconds ?? 9e9) - (a.createdAt?.seconds ?? 9e9))
    .forEach((n) => box.append(el("div", { class: "card" },
      el("p", { class: "notice-head", text: `Notice for ${n.cls} · ${postTime(n)}` }),
      el("p", { text: n.text }),
      currentUser ? el("div", { class: "actions" },
        el("button", { class: "danger", text: "Delete notice", onclick: () => removeNotice(n.id) })) : null
    )));
}

async function removeNotice(id) {
  if (!confirm("Delete this notice?")) return;
  try { await deleteDoc(doc(db, "notices", id)); }
  catch (e) { console.error(e); alert("Not allowed."); }
}

/* =================================================================
   WALL (anonymous posts)
================================================================= */
let approvedPosts = [];
let pendingPosts = [];
let unsubPending = null;
const reportedKey = "reportedPosts";
const reportedSet = () => new Set(JSON.parse(store.get(reportedKey, "[]")));

function initWall() {
  const text = $("post-text");
  text.addEventListener("input", () => { $("post-count").textContent = `${text.value.length} / 300`; });

  $("post-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("post-msg");
    const body = text.value.trim();
    if (!ready) { msg.textContent = "The wall is not connected yet."; return; }
    if (!body) return;
    if (!me) { msg.textContent = anonFailed ? "Posting is unavailable right now." : "Still connecting. Try again in a few seconds."; return; }

    const last = Number(store.get("lastPost", 0));
    if (Date.now() - last < 60000) { msg.textContent = "Please wait a minute between posts."; return; }
    const lower = body.toLowerCase();
    if (BAD_WORDS.some((w) => lower.includes(w))) { msg.textContent = "Please remove rude words and try again."; return; }

    try {
      await addDoc(collection(db, "posts"), { text: body, approved: false, reports: 0, createdAt: serverTimestamp() });
      store.set("lastPost", Date.now());
      text.value = "";
      $("post-count").textContent = "0 / 300";
      msg.textContent = "Thanks! Your post will appear after it is approved.";
      burst(innerWidth / 2, innerHeight / 2, ["🩸", "👁️", "🕯️"], 14);
    } catch (err) {
      console.error(err);
      msg.textContent = "Could not post. Try again later.";
    }
  });

  if (ready) {
    onSnapshot(query(collection(db, "posts"), where("approved", "==", true)), (snap) => {
      approvedPosts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderWall();
    });
  } else {
    $("post-list").append(el("p", { class: "muted", text: "Posts will show here once Firebase is connected." }));
  }
}

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

function postTime(p) {
  const s = p.createdAt?.seconds;
  return s ? new Date(s * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "just now";
}

function renderWall() {
  if (!ready) return;
  const staff = !!currentUser;
  const reported = reportedSet();

  // Students hide posts that got 3+ reports. Staff still see them with the count.
  const visible = approvedPosts
    .filter((p) => staff || (p.reports || 0) < 3)
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  const wc = $("wp-count");
  if (wc) wc.textContent = String(visible.length);
  const list = $("post-list");
  list.replaceChildren();
  if (!visible.length) list.append(el("p", { class: "muted", text: "No posts yet. Be the first." }));
  visible.forEach((p) => {
    const actions = el("div", { class: "actions" });
    actions.append(el("button", {
      class: "ghost",
      text: reported.has(p.id) ? "Reported" : "Report",
      disabled: reported.has(p.id) ? "" : null,
      onclick: () => reportPost(p.id)
    }));
    if (staff) actions.append(el("button", { class: "danger", text: `Delete (${p.reports || 0} reports)`, onclick: () => removePost(p.id) }));
    list.append(el("div", { class: `card post c${noteColor(p.id)}` },
      el("p", { text: p.text }),
      el("p", { class: "muted", text: postTime(p) }),
      actions
    ));
  });

  const box = $("pending-box");
  box.hidden = !staff;
  const pl = $("pending-list");
  pl.replaceChildren();
  if (staff) {
    if (!pendingPosts.length) pl.append(el("p", { class: "muted", text: "Nothing waiting." }));
    pendingPosts
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      .forEach((p) => {
        pl.append(el("div", { class: "card" },
          el("p", { text: p.text }),
          el("div", { class: "actions" },
            el("button", { text: "Approve", onclick: () => approvePost(p.id) }),
            el("button", { class: "danger", text: "Delete", onclick: () => removePost(p.id) })
          )
        ));
      });
  }
}

async function reportPost(id) {
  try {
    if (!me) throw new Error("not signed in");
    const batch = writeBatch(db);
    batch.set(doc(db, "posts", id, "reports", me.uid), { createdAt: serverTimestamp() });
    batch.update(doc(db, "posts", id), { reports: increment(1) });
    await batch.commit();
    const set = reportedSet(); set.add(id);
    store.set(reportedKey, JSON.stringify([...set]));
    renderWall();
  } catch (e) { console.error(e); alert("Could not report."); }
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
const reportedGigs = () => new Set(JSON.parse(store.get(reportedGigsKey, "[]")));
const appliedKey = (id) => `applied_${id}`;
const newestFirst = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);

function initGigs() {
  const filterSel = $("gig-cat-filter");
  filterSel.append(el("option", { value: "all", text: "All categories" }));
  GIG_CATS.forEach((c) => {
    filterSel.append(el("option", { value: c, text: c }));
    $("gig-cat").append(el("option", { value: c, text: c }));
  });
  filterSel.addEventListener("change", () => { gigFilter.cat = filterSel.value; renderGigs(); });

  document.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      gigFilter.kind = b.dataset.kind;
      document.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderGigs();
    }));

  const details = $("gig-details");
  details.addEventListener("input", () => { $("gig-count").textContent = `${details.value.length} / 300`; });
  $("gig-name").value = store.get("gigName", "");

  $("gig-form").addEventListener("submit", submitGig);
  $("gig-cta-post").addEventListener("click", () => { const d = $("gig-compose"); d.open = true; d.scrollIntoView({ behavior: "smooth", block: "center" }); });
  $("gig-cta-browse").addEventListener("click", () => $("gig-board").scrollIntoView({ behavior: "smooth", block: "start" }));
  renderArc();
  $("apply-form").addEventListener("submit", submitApplication);
  $("apply-cancel").addEventListener("click", () => $("apply-dialog").close());

  if (ready) {
    onSnapshot(query(collection(db, "gigs"), where("approved", "==", true)), (snap) => {
      gigsApproved = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderGigs();
    });
  } else {
    $("gig-list").append(el("p", { class: "muted", text: "The board will show here once Firebase is connected." }));
  }
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
  if (!me) { msg.textContent = anonFailed ? "Posting is unavailable right now." : "Still connecting. Try again in a few seconds."; return; }

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
  const n = d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return `https://wa.me/${n.length === 10 ? "91" + n : n}`;
}

const ARC_TINTS = ["#e4e4e0", "#d9f99d", "#e9d5ff", "#fed7aa", "#bfdbfe", "#fbcfe8", "#bbf7d0", "#fde68a", "#cbd5e1"];

const CHIP_POS = { "Design": [30, 14], "Photo & video": [62, 8], "Errands & help": [13, 32], "Coding & tech": [36, 38],
  "Writing & editing": [74, 28], "Music & events": [63, 52], "Tutoring": [22, 56], "Other": [87, 46] };

// Category chips around the globe (they filter the board) plus the live-count card.
function renderArc() {
  const box = $("gig-arc");
  if (!box) return;
  const staff = !!currentUser;
  const live = gigsApproved.filter((g) => (staff || (g.reports || 0) < 3) && g.status !== "closed");
  box.replaceChildren();
  GIG_CATS.forEach((c, i) => {
    const on = gigFilter.cat === c;
    const n = live.filter((g) => g.category === c).length;
    const [x, y] = CHIP_POS[c] || [50, 50];
    box.append(el("button", {
      type: "button", class: "chip-g" + (on ? " on" : ""), style: `--x:${x};--y:${y};--c:${ARC_TINTS[i + 1]}`, "aria-pressed": String(on),
      onclick: () => { gigFilter.cat = on ? "all" : c; $("gig-cat-filter").value = gigFilter.cat; renderGigs(); }
    }, el("i"), c, el("em", { text: n })));
  });
  const wanted = live.filter((g) => g.kind === "wanted").length;
  $("gig-stat").textContent = `${live.length} live`;
  $("gig-stat-sub").textContent = live.length ? `${wanted} wanted, ${live.length - wanted} offering` : "Be the first to post.";
  const av = $("gig-avatars");
  av.replaceChildren();
  live.slice(0, 4).forEach((g, i) => av.append(el("span", { style: `--c:${ARC_TINTS[1 + ((g.title.length + i) % 8)]}`, text: (g.name || "S").charAt(0).toUpperCase() })));
  if (live.length > 4) av.append(el("span", { class: "more", text: `+${live.length - 4}` }));
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
  if (!ready) return;
  renderArc();
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
    if (!me) throw new Error("not signed in");
    const batch = writeBatch(db);
    batch.set(doc(db, "gigs", id, "reports", me.uid), { createdAt: serverTimestamp() });
    batch.update(doc(db, "gigs", id), { reports: increment(1) });
    await batch.commit();
    const set = reportedGigs(); set.add(id);
    store.set(reportedGigsKey, JSON.stringify([...set]));
    renderGigs();
  } catch (e) { console.error(e); alert("Could not report."); }
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
      signInAnonymously(auth).catch((err) => { anonFailed = true; console.warn("Anonymous sign-in failed:", err.code); });
    }
    me = u;
    currentUser = u && !u.isAnonymous ? u : null; // only email logins count as staff
    renderAuth();
    renderClasses();
    subscribePending();
    subscribeGigs();
  });
} else {
  $("login-form").hidden = true;
}

/* ---------- quote of the day (Classes tab) ---------- */
const QUOTES = [
  ["Education is the most powerful weapon which you can use to change the world.", "Nelson Mandela"],
  ["Arise, awake, and stop not till the goal is reached.", "Swami Vivekananda"],
  ["Dream, dream, dream. Dreams transform into thoughts, and thoughts result in action.", "A. P. J. Abdul Kalam"],
  ["The beautiful thing about learning is that no one can take it away from you.", "B. B. King"],
  ["An investment in knowledge pays the best interest.", "Benjamin Franklin"],
  ["It does not matter how slowly you go as long as you do not stop.", "Confucius"],
  ["Excellence is not an act, but a habit.", "Will Durant"],
  ["Knowledge is power.", "Francis Bacon"],
  ["The more that you read, the more things you will know.", "Dr. Seuss"],
  ["Learning never exhausts the mind.", "Leonardo da Vinci"]
];
function renderQuote() {
  const p = istParts();
  const day = Math.floor((Date.UTC(+p.year, +p.month - 1, +p.day) - Date.UTC(+p.year, 0, 0)) / 864e5);
  const [text, by] = QUOTES[day % QUOTES.length];
  $("quote-text").textContent = text;
  $("quote-by").textContent = by;
}

/* ---------- start ---------- */
initFood().catch(showLoadError);
initClasses().catch(showLoadError);
initWall();
initGigs();
initNotices();
renderQuote();

/* ---------- interactive hero ---------- */
const hero = $("hero");
const lines = { food: "good food, on time.", classes: "The day worth\nshowing up for.", wall: "the walls are listening.", gigs: "Hire top student talent\nwithout leaving campus.", about: "made by students." };
document.querySelectorAll(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    const h = $("h1-line");
    h.textContent = lines[b.dataset.tab];
    h.classList.remove("pop"); void h.offsetWidth; h.classList.add("pop");
  }));

// Deep links: /#classes, /#wall, /#gigs open that tab.
const openFromHash = (scroll) => {
  const t = location.hash.slice(1);
  if (!lines[t]) return;
  document.querySelector(`.tab[data-tab="${t}"]`)?.click();
  // Footer links like #gigs sit far below the tabs, so bring the tabs into view.
  if (scroll) document.querySelector("nav").scrollIntoView({ behavior: "smooth", block: "start" });
};
openFromHash(false);
addEventListener("hashchange", () => openFromHash(true));

// Time-of-day greeting chip.
(() => {
  const h = Math.floor(nowMin() / 60);
  const hi = h < 5 ? "late night? 🦉" : h < 12 ? "good morning ☀️" : h < 17 ? "good afternoon 🌤️" : h < 21 ? "good evening 🌆" : "night owl 🌙";
  $("greet").textContent = `${hi} · ${todayName()}`;
})();

// Blobs drift and the headline's 3D shadow swings away from your finger or mouse.
if (hero && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  window.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    hero.style.setProperty("--px", (px - 0.5).toFixed(3));
    hero.style.setProperty("--py", (py - 0.5).toFixed(3));
    hero.style.setProperty("--sx", ((0.5 - px) * 6).toFixed(2));
    hero.style.setProperty("--sy", (3 + (0.5 - py) * 4).toFixed(2));
  });
}

/* ---------- draggable stickers ---------- */
document.querySelectorAll(".sticker").forEach((s) => {
  let sx = 0, sy = 0, ox = 0, oy = 0, moved = false;
  s.addEventListener("pointerdown", (e) => {
    s.setPointerCapture(e.pointerId);
    sx = e.clientX; sy = e.clientY; moved = false;
    s.dataset.dragging = "1";
  });
  s.addEventListener("pointermove", (e) => {
    if (!s.dataset.dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    s.style.transform = `translate(${ox + dx}px, ${oy + dy}px)`;
  });
  const end = (e) => {
    if (!s.dataset.dragging) return;
    delete s.dataset.dragging;
    ox += e.clientX - sx; oy += e.clientY - sy;
    if (!moved) {
      s.classList.remove("spin"); void s.offsetWidth; s.classList.add("spin");
      burst(e.clientX, e.clientY, ["✨", "⭐", "💫"], 10);
    }
  };
  s.addEventListener("pointerup", end);
  s.addEventListener("pointercancel", end);
});

/* ---------- emoji bursts (clicks, ratings, posting) ---------- */

function burst(x, y, emojis, n = 10) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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

// Each wall post gets a stable sticky-note colour from its id.
function noteColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 4;
}

/* ---------- wall poster: jump buttons + eyes that follow the pointer ---------- */
(() => {
  const go = (id) => {
    const t = $(id);
    if (!t || t.hidden) return;
    t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };
  $("wp-whisper")?.addEventListener("click", () => { go("post-form"); setTimeout(() => $("post-text")?.focus({ preventScroll: true }), 350); });
  $("wp-read")?.addEventListener("click", () => go("post-list"));
  $("wp-down")?.addEventListener("click", () => go("post-form"));
  // Found-footage timecode on the wall poster.
  const tc = $("wp-tc");
  if (tc) { const t0 = Date.now(); const pad = (n) => String(n).padStart(2, "0");
    setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); tc.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }, 1000); }
  document.querySelectorAll(".wp-dot").forEach((d) => d.addEventListener("click", () => {
    document.querySelectorAll(".wp-dot").forEach((x) => x.classList.toggle("on", x === d));
    go(d.dataset.go);
  }));

  const poster = document.querySelector(".wposter");
  if (poster) {
    // A torch beam: the poster stays dark except around the pointer.
    poster.addEventListener("pointermove", (e) => {
      const r = poster.getBoundingClientRect();
      poster.style.setProperty("--mx", `${e.clientX - r.left}px`);
      poster.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
    poster.addEventListener("pointerleave", () => { poster.style.removeProperty("--mx"); poster.style.removeProperty("--my"); });
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const pupils = document.querySelectorAll(".wp-clown .pupil");
  document.addEventListener("pointermove", (e) => {
    if (document.body.dataset.theme !== "wall") return;
    pupils.forEach((p) => {
      const eye = p.parentNode.getBoundingClientRect();
      const dx = e.clientX - (eye.left + eye.width / 2), dy = e.clientY - (eye.top + eye.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 220);
      p.style.transform = `translate(${(dx / d) * 11 * k}px, ${(dy / d) * 6 * k}px)`; // user units, kept inside the eye by the clip
    });
  });
})();

/* ---------- gigs globe: a slowly turning network sphere ---------- */
(() => {
  const cv = $("gig-globe");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const N = 170, pts = [], links = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
    if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]) < 0.34) links.push([i, j]);
  }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1, t = 0;

  const draw = () => {
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw) return;
    const d = Math.min(devicePixelRatio || 1, 2);
    if (cw !== w || ch !== h || d !== dpr) { w = cw; h = ch; dpr = d; cv.width = w * d; cv.height = h * d; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.56, R = Math.min(w * 0.36, h * 0.38);
    const g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.3);
    g.addColorStop(0, "rgba(255,196,130,.6)"); g.addColorStop(0.6, "rgba(255,120,40,.28)"); g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const ca = Math.cos(t), sa = Math.sin(t), ct = Math.cos(0.35), st = Math.sin(0.35);
    const P = pts.map(([x, y, z]) => {
      const x1 = x * ca + z * sa, z1 = -x * sa + z * ca;
      return [cx + x1 * R, cy + (y * ct - z1 * st) * R, y * st + z1 * ct];
    });
    ctx.lineWidth = 0.7;
    for (const [i, j] of links) {
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.32 * ((P[i][2] + P[j][2]) / 2 + 1) / 2})`;
      ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[j][0], P[j][1]); ctx.stroke();
    }
    for (const p of P) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * (p[2] + 1) / 2})`;
      ctx.beginPath(); ctx.arc(p[0], p[1], 1 + 1.4 * (p[2] + 1) / 2, 0, 6.2832); ctx.fill();
    }
    if (matchMedia("(min-width:760px)").matches) {
      ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1.2;
      for (const [x, y] of Object.values(CHIP_POS)) {
        const px = x / 100 * w, py = y / 100 * h, tx = cx + (px - cx) * 0.45, ty = cy + (py - cy) * 0.45;
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.quadraticCurveTo((px + tx) / 2 + (py - cy) * 0.25, (py + ty) / 2 - (px - cx) * 0.25, tx, ty);
        ctx.stroke();
      }
    }
  };
  const frame = () => {
    if (document.body.dataset.theme === "gigs") { draw(); t += 0.004; }
    requestAnimationFrame(frame);
  };
  if (reduce) {
    document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTimeout(draw, 60)));
    addEventListener("resize", draw);
  } else requestAnimationFrame(frame);
})();

/* ---------- installable app (PWA) ---------- */
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(console.warn));
