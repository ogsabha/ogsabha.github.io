#!/usr/bin/env python3
"""
Builds the crawlable pages for Og Sabha from the JSON data.

  python3 build_pages.py

Writes (next to this script): mess-menu.html, timetable.html, robots.txt, sitemap.xml
Reads menu.json and timetable.json from data/ first, then from the main folder.
Run it again after every menu or timetable change, then commit the files it writes.
"""
import datetime
import html
import json
import pathlib

SITE = "https://ogsabha.github.io"          # no trailing slash. Change this if your domain changes.
MENU_VALIDITY = "Menu valid from 26 October 2026 to December 2026. It may change with the supply of raw materials."
ROOT = pathlib.Path(__file__).resolve().parent
TODAY = datetime.date.today().isoformat()
WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
esc = html.escape


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


def page(*, path, title, desc, h1, lead, body, crumb):
    url = f"{SITE}/{path}"
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage", "@id": url + "#page", "url": url, "name": title, "description": desc,
                "inLanguage": "en-IN", "dateModified": TODAY,
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
    fonts = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Instrument+Serif:ital@0;1&family=Playfair+Display:ital,wght@0,600;0,800;1,600&family=Poppins:wght@400;500;600;700&display=swap"
    return f"""<!DOCTYPE html>
<html lang="en-IN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="{url}">
  <meta name="theme-color" content="#FFF0C2">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Og Sabha">
  <meta property="og:locale" content="en_IN">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <script type="application/ld+json">{json.dumps(ld, indent=2, ensure_ascii=False)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="{fonts}">
  <link rel="stylesheet" href="style.css">
  <style>
    .page-head{{width:min(720px,calc(100% - 32px));margin:32px auto 8px}}
    .page-head .back{{font-weight:600}}
    .page-head h1{{font-size:clamp(2rem,8vw,3.2rem);margin:14px 0 10px;line-height:1.05}}
    .lead{{color:var(--muted);font-weight:500;margin:0}}
    th{{text-align:left;font-size:.8rem;font-weight:600;padding:0 14px;color:var(--muted)}}
    main h2{{margin-top:28px}} main h3{{margin:22px 0 6px;font-size:1.1rem}}
  </style>
</head>
<body data-theme="food">
  <header class="page-head">
    <a class="back" href="/">&larr; Og Sabha, DCSMAT Vagamon student hub</a>
    <h1>{esc(h1)}</h1>
    <p class="lead">{lead}</p>
  </header>
  <main>
{body}
  </main>
  <footer>
    <p class="muted"><a href="/">Home</a> &middot; <a href="mess-menu.html">Mess menu</a> &middot; <a href="timetable.html">Class timetable</a></p>
    <p class="muted">Made by UG 2026 students of DCSMAT, Vagamon. Not an official college site. Always confirm with the college.</p>
  </footer>
</body>
</html>
"""


def build_menu(menu):
    meals = menu["meals"]
    parts = ['    <h2>Meal timings</h2>\n    <table>\n      <tr><th>Meal</th><th>Time (approx.)</th></tr>']
    for m in meals:
        parts.append(f'      <tr><td class="muted">{esc(m["name"])}</td><td>{esc(rng(m["start"], m["end"]))}</td></tr>')
    parts.append("    </table>")
    for day in WEEK:
        d = menu["days"].get(day)
        if not d:
            continue
        parts.append(f'    <section id="{day.lower()}">\n    <h2>{day} mess menu</h2>\n    <table>\n      <tr><th>Meal</th><th>Menu</th></tr>')
        for m in meals:
            parts.append(f'      <tr><td class="muted">{esc(m["name"])}</td><td>{esc(d.get(m["name"], "-"))}</td></tr>')
        parts.append("    </table>\n    </section>")
    body = "\n".join(parts)
    return page(
        path="mess-menu.html",
        title="DCSMAT Vagamon Mess Menu: Weekly Breakfast, Lunch, Snacks & Dinner",
        desc="Full weekly mess menu for DCSMAT, Vagamon: breakfast, lunch, snacks and dinner for every day, with meal timings and veg options. Made by students.",
        h1="DCSMAT Vagamon Mess Menu",
        lead=esc(MENU_VALIDITY),
        body=body, crumb="Mess menu",
    )


def build_timetable(tt):
    periods = {p["no"]: p for p in tt["periods"]}
    parts = ['    <h2>Period timings</h2>\n    <table>\n      <tr><th>Period</th><th>Time</th></tr>']
    for p in tt["periods"]:
        parts.append(f'      <tr><td class="muted">Period {p["no"]}</td><td>{esc(rng(p["start"], p["end"]))}</td></tr>')
    parts.append("    </table>")
    names = list(tt["classes"])
    parts.append("    <p class=\"muted\">Jump to: " + " &middot; ".join(
        f'<a href="#{esc(n.lower().replace(" ", "-"))}">{esc(n)}</a>' for n in names) + "</p>")
    for name, days in tt["classes"].items():
        cid = name.lower().replace(" ", "-")
        parts.append(f'    <section id="{esc(cid)}">\n    <h2>{esc(name)} class timetable</h2>')
        for day in WEEK:
            slots = days.get(day) or []
            if not slots:
                continue
            parts.append(f'    <h3>{day}</h3>\n    <table>\n      <tr><th>Period</th><th>Time</th><th>Subject</th><th>Teacher</th></tr>')
            for s in sorted(slots, key=lambda x: x["period"]):
                p = periods[s["period"]]
                parts.append(
                    f'      <tr><td class="muted">{s["period"]}</td><td class="muted">{esc(t12(p["start"]))}</td>'
                    f'<td><strong>{esc(s["subject"])}</strong></td><td>{esc(s["teacher"])}</td></tr>')
            parts.append("    </table>")
        parts.append("    </section>")
    body = "\n".join(parts)
    label = " and ".join(names)
    return page(
        path="timetable.html",
        title=f"{label} Timetable | DCSMAT Vagamon Class Schedule",
        desc=f"Weekly class timetable for {label} at DCSMAT, Vagamon: subjects, teachers and period timings for every day. Made by students.",
        h1="DCSMAT Vagamon Class Timetable",
        lead=f"Weekly timetable for {esc(label)}: subjects, teachers and period timings. Open the home page to see the live current class.",
        body=body, crumb="Class timetable",
    )


def main():
    menu, tt = load("menu.json"), load("timetable.json")
    out = {
        "mess-menu.html": build_menu(menu),
        "timetable.html": build_timetable(tt),
        "robots.txt": f"User-agent: *\nAllow: /\n\nSitemap: {SITE}/sitemap.xml\n",
    }
    index = ROOT / "index.html"
    index_mod = datetime.date.fromtimestamp(index.stat().st_mtime).isoformat() if index.exists() else TODAY
    urls = [("/", index_mod), ("/mess-menu.html", TODAY), ("/timetable.html", TODAY)]
    out["sitemap.xml"] = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                          + "".join(f"  <url><loc>{SITE}{u}</loc><lastmod>{m}</lastmod></url>\n" for u, m in urls)
                          + "</urlset>\n")
    for name, text in out.items():
        (ROOT / name).write_text(text, encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
