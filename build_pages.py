#!/usr/bin/env python3
"""
Builds every page of Og Sabha.

  python3 build_pages.py

Writes (next to this script):
  index.html (Food, the home page), classes.html, wall.html, gigs.html, about.html,
  mess-menu.html, timetable.html, bus.html, bus-timings.html, robots.txt, sitemap.xml, .build-state.json

Reads:
  menu.json, timetable.json and bus.json from data/ first, then from the main folder
  _src/classes.html, bus.html, wall.html, gigs.html, about.html (the page bodies; edit these, not the output)

Run it again after every menu or timetable change, and after editing style.css, app.js or anything in _src/.
Then commit the files it writes. The Food page is generated from menu.json (clock, meal tiles and the menu data
are written into the HTML so the page paints before any JavaScript runs).
"""
import datetime
import hashlib
import html
import json
import math
import pathlib
import re

SITE = "https://ogsabha.github.io"          # no trailing slash. Change this if your domain changes.
MENU_VALIDITY = "Menu valid from 26 October 2026 to December 2026. It may change with the supply of raw materials."
ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "_src"
STATE_FILE = ROOT / ".build-state.json"
TODAY = datetime.date.today().isoformat()
WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MEAL_EMOJI = {"Breakfast": "🍳", "Lunch": "🍛", "Snacks": "🍟", "Dinner": "🌙"}
esc = html.escape


# ---------------------------------------------------------------- helpers
def load(name):
    for p in (ROOT / "data" / name, ROOT / name):
        if p.exists():
            return json.loads(p.read_text(encoding="utf-8"))
    raise SystemExit(f"Could not find {name} in data/ or the main folder")


def t12(hhmm):
    h, m = map(int, hhmm.split(":"))
    return f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"


def rng(a, b):
    return f"{t12(a)} to {t12(b)}"


def asset_version(name):
    p = ROOT / name
    return hashlib.md5(p.read_bytes()).hexdigest()[:8] if p.exists() else "0"


CSS_V, JS_V = asset_version("style.css"), asset_version("app.js")

try:
    STATE = json.loads(STATE_FILE.read_text(encoding="utf-8"))
except Exception:
    STATE = {}
NEW_STATE = {}


def finish(path, text):
    """Fills in the version stamps. The 'last modified' date only moves when the page content really changed."""
    digest = hashlib.md5(text.encode("utf-8")).hexdigest()
    old = STATE.get(path, {})
    entry = old if old.get("hash") == digest else {"hash": digest, "date": TODAY}
    NEW_STATE[path] = entry
    return text.replace("@@MOD@@", entry["date"]).replace("@@CSS@@", CSS_V).replace("@@JS@@", JS_V)


def ld_script(obj):
    body = json.dumps(obj, indent=2, ensure_ascii=False).replace("</", "<\\/")
    return f'<script type="application/ld+json">{body}</script>'


# ---------------------------------------------------------------- fonts: each page loads only what it uses
FONT_QS = {
    "food": "family=Poppins:wght@400;500;600;700",
    "classes": "family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Playfair+Display:ital,wght@1,600&family=Caveat:wght@500&family=Poppins:wght@400;500;600",
    "bus": "family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Malayalam:wght@700",
    "wall": "family=Montserrat:wght@500;600;700&family=Special+Elite&family=Caveat:wght@500",
    "gigs": "family=Inter:wght@400;500;600",
    "about": "family=Montserrat:wght@400;500;600;700&family=Instrument+Serif",
}


def font_links(key):
    href = f"https://fonts.googleapis.com/css2?{FONT_QS[key]}&display=swap"
    return (
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        f'  <link rel="preload" as="style" onload="this.onload=null;this.rel=\'stylesheet\'" href="{href}">\n'
        f'  <noscript><link rel="stylesheet" href="{href}"></noscript>'
    )


# ---------------------------------------------------------------- shared <head>
def head(*, url, title, desc, theme_color, fonts, ld, og_title=None, og_desc=None, verify="", extra=""):
    og_title = og_title or title
    og_desc = og_desc or desc
    return f"""<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">{verify}
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta name="theme-color" content="{theme_color}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Og Sabha">
  <meta property="og:locale" content="en_IN">
  <meta property="og:title" content="{esc(og_title)}">
  <meta property="og:description" content="{esc(og_desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Og Sabha, the DCSMAT Vagamon student hub">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{esc(og_title)}">
  <meta name="twitter:description" content="{esc(og_desc)}">
  <meta name="twitter:image" content="{SITE}/og-image.png">
  <meta name="apple-mobile-web-app-title" content="Og Sabha">
  <meta name="application-name" content="Og Sabha">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icons/favicon.ico" sizes="48x48">
  <link rel="icon" href="icons/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  {ld_script(ld)}
  {font_links(fonts)}
  <link rel="stylesheet" href="style.css?v=@@CSS@@">
{extra}</head>"""


def page_ld(url, title, desc, crumb):
    return {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage", "@id": url + "#page", "url": url, "name": title, "description": desc,
                "inLanguage": "en-IN", "dateModified": "@@MOD@@",
                "isPartOf": {"@id": SITE + "/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "Og Sabha", "item": SITE + "/"},
                    {"@type": "ListItem", "position": 2, "name": crumb, "item": url},
                ],
            },
        ],
    }


HOME_LD = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "WebSite", "@id": SITE + "/#website", "url": SITE + "/", "name": "Og Sabha",
            "alternateName": ["og sabha", "OgSabha", "ogsabha", "Og Sabha DCSMAT", "Og Sabha DCSMAT Vagamon", "DCSMAT Hub"],
            "description": "Student hub for DCSMAT, Vagamon: mess menu, class timetable, anonymous wall and skill board.",
            "inLanguage": "en-IN", "publisher": {"@id": SITE + "/#team"},
        },
        {
            "@type": "WebApplication", "@id": SITE + "/#app", "name": "Og Sabha", "alternateName": ["og sabha", "OgSabha"],
            "url": SITE + "/", "image": SITE + "/icons/icon-512.png", "applicationCategory": "EducationalApplication",
            "operatingSystem": "Any (web browser, installable PWA)", "inLanguage": "en-IN", "isAccessibleForFree": True,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "INR"},
            "audience": {"@type": "EducationalAudience", "educationalRole": "student"},
        },
        {
            "@type": "Organization", "@id": SITE + "/#team", "name": "Og Sabha (UG 2026 students, DCSMAT Vagamon)",
            "alternateName": "Og Sabha", "url": SITE + "/", "logo": SITE + "/icons/icon-512.png",
        },
        {
            "@type": "CollegeOrUniversity", "name": "DCSMAT",
            "address": {"@type": "PostalAddress", "addressLocality": "Vagamon", "addressRegion": "Kerala", "addressCountry": "IN"},
        },
    ],
}


# ---------------------------------------------------------------- the five app pages
PAGES = [
    dict(
        key="food", file="index.html", href="./", url=SITE + "/", nav="Food", crumb="Food", theme="#FFFFFF",
        title="Og Sabha | DCSMAT Vagamon Student Hub: Mess Menu & Timetable",
        desc="Og Sabha (og sabha) is the student hub for DCSMAT, Vagamon: today's mess menu, live class timetable for BBA and BCA, an anonymous wall and a skill board. Made by students.",
        og_title="Og Sabha | DCSMAT Vagamon Student Hub",
        og_desc="Mess menu, live classes, an anonymous wall and a skill board. Made by UG 2026 students at DCSMAT, Vagamon.",
        h1="Og Sabha: DCSMAT Vagamon student hub", vis=None,
        sub="Mess menu, live classes, an anonymous wall and a skill board. Made by UG 2026 students, Vagamon.",
    ),
    dict(
        key="classes", file="classes.html", href="classes.html", url=SITE + "/classes.html", nav="Classes", crumb="Classes", theme="#C8D8BC",
        title="Og Sabha | DCSMAT Vagamon Live Class Timetable (BBA & BCA)",
        desc="Live class timetable for BBA 2026 and BCA 2026 at DCSMAT, Vagamon: the current period, today's teachers, class notices and live teacher present or absent status. Made by students.",
        h1="DCSMAT Vagamon live class timetable for BBA and BCA", vis="your day,\nat a glance.",
        sub="Stay on top of your day: who is teaching, and when.",
    ),
    dict(
        key="bus", file="bus.html", href="bus.html", url=SITE + "/bus.html", nav="Bus", crumb="Bus", theme="#e9e9ea",
        title="Og Sabha | KSRTC Bus Timings at DCSMAT Vagamon",
        desc="KSRTC bus timings at DC College, Vagamon: the next bus to Vagamon and to Moolamattom, plus the full list for the day. Made by students.",
        h1="DCSMAT Vagamon KSRTC bus timings", vis=None,
        sub="The next KSRTC bus from DC College, towards Vagamon and Moolamattom.",
    ),
    dict(
        key="wall", file="wall.html", href="wall.html", url=SITE + "/wall.html", nav="Wall", crumb="Wall", theme="#0a0f14",
        title="Og Sabha | Anonymous Wall for DCSMAT Vagamon Students",
        desc="The Og Sabha wall: an anonymous, moderated space for DCSMAT, Vagamon students to say what they can't say out loud. A person reads every post before it goes up.",
        h1="Og Sabha anonymous wall for DCSMAT Vagamon students", vis=None,
        sub="Say what you can't say out loud. Anonymous, always kind.",
    ),
    dict(
        key="gigs", file="gigs.html", href="gigs.html", url=SITE + "/gigs.html", nav="Gigs", crumb="Gigs", theme="#4A1604",
        title="Og Sabha | Gigs and Skill Board for DCSMAT Vagamon Students",
        desc="Og Sabha's skill board for DCSMAT, Vagamon: post a gig or offer your skill, from design and coding to tutoring and photography, and get private replies from classmates.",
        h1="Og Sabha gigs and skill board for DCSMAT Vagamon students", vis="turn skills into\npocket money.",
        sub="Need a hand? Got a skill? Post it, get hired, earn a little.",
    ),
    dict(
        key="about", file="about.html", href="about.html", url=SITE + "/about.html", nav="About", crumb="About", theme="#000000",
        title="About Og Sabha | DCSMAT Vagamon Student Hub",
        desc="About Og Sabha, the free student hub for DCSMAT, Vagamon, built by the UG 2026 batch: our story, what you can do here and how to contact the team.",
        h1="About Og Sabha, the DCSMAT Vagamon student hub", vis=None,
        sub="The story behind Og Sabha, and how to reach us.",
    ),
]


def parts(name):
    text = (SRC / f"{name}.html").read_text(encoding="utf-8")
    out = {"TOP": "", "MAIN": "", "AFTER": ""}
    cur = "MAIN"
    for chunk in re.split(r"(<!--(?:TOP|MAIN|AFTER)-->)", text):
        m = re.fullmatch(r"<!--(TOP|MAIN|AFTER)-->", chunk)
        if m:
            cur = m.group(1)
        else:
            out[cur] += chunk
    return out


def clock_svg():
    """The watch face, written as static SVG so it shows before JavaScript runs."""
    big, small = [], []
    for i in range(60):
        a = math.radians(i * 6)
        is_big = i % 5 == 0
        r1, r2 = (41.5 if is_big else 44.5), 47.5
        seg = (f"M{50 + r1 * math.sin(a):.2f} {50 - r1 * math.cos(a):.2f}"
               f"L{50 + r2 * math.sin(a):.2f} {50 - r2 * math.cos(a):.2f}")
        (big if is_big else small).append(seg)
    nums = "".join(
        f'<text class="n" x="{50 + 34 * math.sin(math.radians(h * 30)):.2f}" '
        f'y="{50 - 34 * math.cos(math.radians(h * 30)):.2f}">{h}</text>' for h in range(1, 13))
    return ('<svg viewBox="0 0 100 100" class="bw" aria-hidden="true">'
            f'<path class="ts" fill="none" d="{"".join(small)}"/><path class="tb" fill="none" d="{"".join(big)}"/>'
            + nums +
            '<line class="bh" x1="50" y1="54" x2="50" y2="31"/><line class="bm" x1="50" y1="56" x2="50" y2="19"/>'
            '<line class="bs" x1="50" y1="60" x2="50" y2="14"/><circle class="bd" cx="50" cy="50" r="2.4"/></svg>')


def food_panel(menu):
    meals = menu["meals"]
    chips = "".join(f'<button type="button" class="dchip" data-day="{d}" aria-label="{d}">{d[:3]}</button>' for d in WEEK)
    rail = "".join(f'<button type="button" class="rail-btn" data-meal="{esc(m["name"])}">{esc(m["name"].lower())}</button>' for m in meals)
    tiles = "".join(
        f'<button type="button" class="tile" data-meal="{esc(m["name"])}">'
        f'<span class="plate-art"><span class="plate-name">{MEAL_EMOJI.get(m["name"], "🍽️")}</span></span>'
        f'<span class="tile-time">{t12(m["start"])}</span><span class="tile-name">{esc(m["name"])}</span>'
        f'<span class="tile-sub"></span><span class="tile-more"></span>'
        f'<span class="tile-foot"><span></span><span aria-hidden="true">view →</span></span></button>' for m in meals)
    dots = "".join(f'<button type="button" data-meal="{esc(m["name"])}" aria-label="{esc(m["name"])}"></button>' for m in meals)
    return f"""<section id="food" class="panel active">
      <div id="day-nav" class="daynav" role="group" aria-label="Day of the week">{chips}</div>
      <div id="food-feature" class="feature" aria-live="polite">
        <div class="stage">
          <div class="slab"></div>
          <div class="plate-art big" id="food-plate" role="button" tabindex="0" aria-label="Tap the clock">
            <div class="bwrap">{clock_svg()}</div><span class="plate-name"></span>
          </div>
          <div class="rail" role="group" aria-label="Meal">{rail}</div>
        </div>
        <div class="copy">
          <span class="badge"></span>
          <h2></h2>
          <p class="when"><span class="when-main"></span><small></small></p>
          <p class="desc"></p>
          <div class="rate"><p class="muted"></p><div class="stars"></div></div>
          <a class="darkbtn" href="mess-menu.html">Full weekly menu</a>
        </div>
      </div>
      <div id="food-list">{tiles}</div>
      <div id="food-dots" class="dots">{dots}</div>
    </section>"""


def inline_data(**data):
    out = ""
    for name, obj in data.items():
        clean = {k: v for k, v in obj.items() if not k.startswith("_")}
        blob = json.dumps(clean, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
        out += f'  <script type="application/json" id="data-{name}">{blob}</script>\n'
    return out


SITE_LINKS = " &middot; ".join(f'<a href="{p["href"]}">{p["nav"]}</a>' for p in PAGES) + \
    ' &middot; <a href="mess-menu.html">Mess menu</a> &middot; <a href="timetable.html">Class timetable</a> &middot; <a href="bus-timings.html">Bus timings</a>'

ABOUT_BLOCK = """    <section class="about" aria-labelledby="about-h">
      <h2 id="about-h">About Og Sabha, the DCSMAT Vagamon student hub</h2>
      <p class="muted">Og Sabha is a free, student-made website for DCSMAT, Vagamon, built by the UG 2026 batch.
        See what is being served in the mess right now, read the full
        <a href="mess-menu.html">weekly DCSMAT mess menu</a>, find the
        <a href="classes.html">live BBA 2026 or BCA 2026 class timetable</a> with teachers and period timings
        (or the <a href="timetable.html">printable weekly timetable</a>),
        check the next <a href="bus.html">KSRTC bus from the college</a>,
        share thoughts on the <a href="wall.html">anonymous wall</a>, or hire a classmate on the <a href="gigs.html">gigs board</a>.</p>
    </section>
"""


def app_page(spec, menu, tt, bus):
    key = spec["key"]
    if key == "food":
        top, main, after = "", food_panel(menu), ""
        data = inline_data(menu=menu)
    else:
        p = parts(key)
        top, main, after = p["TOP"], p["MAIN"], p["AFTER"]
        data = inline_data(menu=menu, timetable=tt) if key == "classes" else inline_data(bus=bus) if key == "bus" else ""

    def tab(p):
        here = p["key"] == key
        cls = "tab active" if here else "tab"
        cur = ' aria-current="page"' if here else ""
        return f'<a class="{cls}" href="{p["href"]}"{cur}>{p["nav"]}</a>'

    nav = "".join(tab(p) for p in PAGES)

    if spec["vis"]:
        h1 = f'<span aria-hidden="true">{esc(spec["vis"])}</span><span class="sr-only"> {esc(spec["h1"])}</span>'
    else:
        h1 = esc(spec["h1"])

    extra = '  <script type="module" src="app.js?v=@@JS@@"></script>\n'
    verify = ""
    if key == "food":
        # old links like /#wall now open the real page
        extra = ('  <script>(function(){var h=location.hash.slice(1);if(/^(classes|wall|gigs|about)$/.test(h))location.replace(h+".html")})();</script>\n'
                 + extra)
        verify = '\n  <meta name="google-site-verification" content="gWRmwSl6wigGY8gN4rM9We63xPeJ07Jaqomf1dwj_xg" />'
        ld = {"@context": "https://schema.org", "@graph": HOME_LD["@graph"] + page_ld(spec["url"], spec["title"], spec["desc"], spec["crumb"])["@graph"][:1]}
    else:
        ld = page_ld(spec["url"], spec["title"], spec["desc"], spec["crumb"])

    head_html = head(url=spec["url"], title=spec["title"], desc=spec["desc"], theme_color=spec["theme"], fonts=key,
                     ld=ld, og_title=spec.get("og_title"), og_desc=spec.get("og_desc"), verify=verify, extra=extra)
    now = '  <div id="now-strip" class="now" aria-live="polite"></div>\n' if key == "classes" else ""
    about = ABOUT_BLOCK if key == "food" else ""
    top = (top.strip() + "\n") if top.strip() else ""
    after = ("  " + after.strip() + "\n") if after.strip() else ""

    return f"""<!DOCTYPE html>
<html lang="en-IN">
{head_html}
<body data-theme="{key}" data-page="{key}">
  {top}  <div class="topbar">
    <a class="brand" href="./">Og Sabha</a>
    <span class="chip" id="greet">hey</span>
  </div>

  <nav aria-label="Sections">
    {nav}
  </nav>

  <header class="hero" id="hero">
    <div class="hero-text">
      <h1 id="h1-line">{h1}</h1>
      <p class="sub">{esc(spec["sub"])}</p>
    </div>
  </header>

{now}  <p id="setup-note" class="note" hidden></p>

  <noscript>
    <p class="note">Og Sabha needs JavaScript for live features. You can still read the
      <a href="mess-menu.html">weekly DCSMAT mess menu</a> and the <a href="timetable.html">BBA and BCA class timetable</a> and <a href="bus-timings.html">KSRTC bus timings</a>.</p>
  </noscript>

  <main>
    {main.strip()}
  </main>

  <footer>
    <details id="staff-login">
      <summary>Staff login</summary>
      <form id="login-form">
        <input id="login-email" type="email" placeholder="Email" autocomplete="username" required>
        <input id="login-pass" type="password" placeholder="Password" autocomplete="current-password" required>
        <button type="submit">Log in</button>
      </form>
      <div id="auth-status" class="muted"></div>
    </details>
{about}    <p class="muted">{SITE_LINKS}</p>
    <p class="muted">Made by Rianadalha &amp; UG 2026 students of DCSMAT, Vagamon. Not an official college site.</p>
  </footer>
{after}{data}</body>
</html>
"""


# ---------------------------------------------------------------- the two plain, crawlable data pages
STATIC_CSS = """  <style>
    .page-head{width:min(720px,calc(100% - 32px));margin:32px auto 8px}
    .page-head .back{font-weight:600}
    .page-head h1{font-size:clamp(2rem,8vw,3.2rem);margin:14px 0 10px;line-height:1.05}
    .lead{color:var(--muted);font-weight:500;margin:0}
    th{text-align:left;font-size:.8rem;font-weight:600;padding:0 14px;color:var(--muted)}
    main h2{margin-top:28px} main h3{margin:22px 0 6px;font-size:1.1rem}
  </style>
"""


def static_page(*, path, title, desc, h1, lead, body, crumb):
    url = f"{SITE}/{path}"
    head_html = head(url=url, title=title, desc=desc, theme_color="#FFFFFF", fonts="food",
                     ld=page_ld(url, title, desc, crumb), extra=STATIC_CSS)
    return f"""<!DOCTYPE html>
<html lang="en-IN">
{head_html}
<body data-theme="food">
  <header class="page-head">
    <a class="back" href="./">&larr; Og Sabha, DCSMAT Vagamon student hub</a>
    <h1>{esc(h1)}</h1>
    <p class="lead">{lead}</p>
  </header>
  <main>
{body}
  </main>
  <footer>
    <p class="muted">{SITE_LINKS}</p>
    <p class="muted">Made by UG 2026 students of DCSMAT, Vagamon. Not an official college site. Always confirm with the college.</p>
  </footer>
</body>
</html>
"""


def build_menu(menu):
    meals = menu["meals"]
    parts_ = ['    <h2>Meal timings</h2>\n    <table>\n      <tr><th>Meal</th><th>Time (approx.)</th></tr>']
    for m in meals:
        parts_.append(f'      <tr><td class="muted">{esc(m["name"])}</td><td>{esc(rng(m["start"], m["end"]))}</td></tr>')
    parts_.append("    </table>")
    for day in WEEK:
        d = menu["days"].get(day)
        if not d:
            continue
        parts_.append(f'    <section id="{day.lower()}">\n    <h2>{day} mess menu</h2>\n    <table>\n      <tr><th>Meal</th><th>Menu</th></tr>')
        for m in meals:
            parts_.append(f'      <tr><td class="muted">{esc(m["name"])}</td><td>{esc(d.get(m["name"], "-"))}</td></tr>')
        parts_.append("    </table>\n    </section>")
    return static_page(
        path="mess-menu.html",
        title="Og Sabha | DCSMAT Vagamon Weekly Mess Menu",
        desc="Og Sabha's full weekly mess menu for DCSMAT, Vagamon: breakfast, lunch, snacks and dinner for every day, with meal timings and veg options. Made by students.",
        h1="DCSMAT Vagamon Mess Menu",
        lead=esc(MENU_VALIDITY),
        body="\n".join(parts_), crumb="Mess menu",
    )


def build_timetable(tt):
    periods = {p["no"]: p for p in tt["periods"]}
    parts_ = ['    <h2>Period timings</h2>\n    <table>\n      <tr><th>Period</th><th>Time</th></tr>']
    for p in tt["periods"]:
        parts_.append(f'      <tr><td class="muted">Period {p["no"]}</td><td>{esc(rng(p["start"], p["end"]))}</td></tr>')
    parts_.append("    </table>")
    names = list(tt["classes"])
    parts_.append('    <p class="muted">Jump to: ' + " &middot; ".join(
        f'<a href="#{esc(n.lower().replace(" ", "-"))}">{esc(n)}</a>' for n in names) + "</p>")
    for name, days in tt["classes"].items():
        cid = name.lower().replace(" ", "-")
        parts_.append(f'    <section id="{esc(cid)}">\n    <h2>{esc(name)} class timetable</h2>')
        for day in WEEK:
            slots = days.get(day) or []
            if not slots:
                continue
            parts_.append(f'    <h3>{day}</h3>\n    <table>\n      <tr><th>Period</th><th>Time</th><th>Subject</th><th>Teacher</th></tr>')
            for s in sorted(slots, key=lambda x: x["period"]):
                p = periods[s["period"]]
                parts_.append(
                    f'      <tr><td class="muted">{s["period"]}</td><td class="muted">{esc(rng(p["start"], p["end"]))}</td>'
                    f'<td><strong>{esc(s["subject"])}</strong></td><td>{esc(s["teacher"])}</td></tr>')
            parts_.append("    </table>")
        parts_.append("    </section>")
    label = " and ".join(names)
    return static_page(
        path="timetable.html",
        title=f"Og Sabha | {label} Timetable, DCSMAT Vagamon",
        desc=f"Og Sabha's weekly class timetable for {label} at DCSMAT, Vagamon: subjects, teachers and period timings for every day. Made by students.",
        h1="DCSMAT Vagamon Class Timetable",
        lead=f'Weekly timetable for {esc(label)}: subjects, teachers and period timings. Open the <a href="classes.html">live Classes page</a> to see the current class.',
        body="\n".join(parts_), crumb="Class timetable",
    )


def build_bus(bus):
    parts_ = []
    for direction, trips in bus["directions"].items():
        did = direction.lower().replace(" ", "-")
        parts_.append(f'    <section id="{esc(did)}">\n    <h2>KSRTC buses {esc(direction[:1].lower() + direction[1:])}</h2>\n    <table>\n      <tr><th>Time</th><th>Bus</th><th>Via</th></tr>')
        for t in sorted(trips, key=lambda x: x["time"]):
            note = " (to be confirmed)" if t.get("check") else ""
            parts_.append(f'      <tr><td class="muted">{esc(t12(t["time"]))}</td><td><strong>{esc(t["route"])}</strong>{note}</td><td>{esc(t.get("via", "-"))}</td></tr>')
        parts_.append("    </table>\n    </section>")
    return static_page(
        path="bus-timings.html",
        title="Og Sabha | DCSMAT Vagamon KSRTC Bus Timings (Vagamon & Moolamattom)",
        desc="KSRTC bus timings at DC College, Vagamon: every bus to Vagamon and to Moolamattom with routes and stops. Copied from the college notice, made by students.",
        h1="DCSMAT Vagamon KSRTC Bus Timings",
        lead='Buses at the DC College stop, copied from the notice on campus. Timings can change, so confirm with KSRTC. Open the <a href="bus.html">live Bus page</a> to see the next bus.',
        body="\n".join(parts_), crumb="Bus timings",
    )


def main():
    menu, tt, bus = load("menu.json"), load("timetable.json"), load("bus.json")
    out = {spec["file"]: app_page(spec, menu, tt, bus) for spec in PAGES}
    out["mess-menu.html"] = build_menu(menu)
    out["timetable.html"] = build_timetable(tt)
    out["bus-timings.html"] = build_bus(bus)

    final = {name: finish(name, text) for name, text in out.items()}
    final["robots.txt"] = f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n"

    order = [(("/" if s["file"] == "index.html" else "/" + s["file"]), s["file"]) for s in PAGES]
    order += [("/mess-menu.html", "mess-menu.html"), ("/timetable.html", "timetable.html"), ("/bus-timings.html", "bus-timings.html")]
    final["sitemap.xml"] = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                            + "".join(f"  <url><loc>{SITE}{u}</loc><lastmod>{NEW_STATE[f]['date']}</lastmod></url>\n" for u, f in order)
                            + "</urlset>\n")
    for name, text in final.items():
        (ROOT / name).write_text(text, encoding="utf-8")
        print("wrote", name)
    STATE_FILE.write_text(json.dumps(NEW_STATE, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
