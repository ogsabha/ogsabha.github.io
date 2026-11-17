# Og Sabha (DCSMAT Hub)

A loud, sticker-style student hub for **DCSMAT, Vagamon**. Made by UG 2026 students of DCSMAT, Vagamon. Not an official college site.

It brings four everyday things into one installable web app. Every section is its own page with its own URL, so Google can index each one:

| Page | URL | What it does |
| --- | --- | --- |
| 🍛 **Food** | `/` (home) | Weekly mess menu, a "serving now" highlight, and live star ratings for each meal |
| 📚 **Classes** | `/classes.html` | Timetable for your class, the current period with a progress bar, and live "teacher present / absent" status |
| 💬 **Wall** | `/wall.html` | Anonymous posts with moderation, reporting and an approval queue |
| 🛠️ **Gigs** | `/gigs.html` | A skill board where students post "wanted" jobs or "offering" skills and get private replies |

## Features

- **Live "right now" strip** showing the current meal and current class
- **Anonymous ratings**: one rating per device, per meal, per day
- **Class rep attendance**: staff can mark a teacher present, absent or clear the status
- **Moderated wall**: posts wait for approval, 3 or more reports hide a post, a rude-word filter and a 60 second cooldown apply
- **Private gig replies**: contact details are never shown on the post, only the poster (and staff) can read replies
- **WhatsApp shortcut** for replies that contain a phone number
- **Four moods**: each page has its own theme (butter yellow, lilac, midnight, mint)
- **Playful touches**: draggable stickers, emoji bursts, pointer-following blobs, time-of-day greeting
- **Installable PWA** with a web manifest and service worker
- Respects `prefers-reduced-motion`

## Tech stack

- Plain HTML, CSS and JavaScript. One small Python script (`build_pages.py`) writes the HTML pages; there is no bundler
- [Firebase](https://firebase.google.com/) Firestore for data
- Firebase Authentication: email/password for staff, silent anonymous sign-in for visitors
- Google Fonts, loaded per page: only the fonts that page uses

## Project structure

```
.
├── index.html            # Food page, the home page (generated)
├── classes.html          # Classes page (generated)
├── wall.html             # Wall page (generated)
├── gigs.html             # Gigs page (generated)
├── about.html            # About page (generated)
├── mess-menu.html        # Plain weekly menu page (generated)
├── timetable.html        # Plain weekly timetable page (generated)
├── _src/                 # Page bodies. EDIT THESE (classes, wall, gigs, about). Food is built from menu.json
├── build_pages.py        # Writes all the pages above, robots.txt and sitemap.xml
├── style.css             # All styling and the themes
├── app.js                # App logic and Firebase code (each page runs only its own part)
├── sw.js                 # Service worker (PWA)
├── manifest.webmanifest  # PWA manifest
├── firestore.rules       # Firestore security rules
├── data/
│   ├── menu.json         # Mess menu and meal timings
│   └── timetable.json    # Periods and class timetables
├── robots.txt            # Crawler rules + sitemap link (generated)
├── sitemap.xml           # Pages for search engines (generated)
├── .build-state.json     # Remembers when each page last really changed (generated)
├── icons/                # favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png, icon-512-maskable.png
└── og-image.png          # Link-preview image (1200x630)
```

**The HTML files in the main folder are generated. Do not edit them by hand.** Change `_src/`, `menu.json`, `timetable.json`, `style.css` or `app.js`, then run `python3 build_pages.py` and commit everything it writes.

`app.js` looks for the JSON files in `data/` first, then in the main folder, so either layout works.

## Setup

1. **Create a Firebase project** and add a Web app.
2. Paste your config into the `firebaseConfig` object in `app.js`.
3. **Enable Firestore** and publish the rules from `firestore.rules`.
4. **Enable Authentication**:
   - *Email/Password*: create accounts for staff and class reps.
   - *Anonymous*: required for the Gigs tab.
5. In `firestore.rules`, put the staff email addresses in the `isStaff()` list. Then, in Authentication > Settings > User actions, turn **off** "Enable create (sign-up)" so nobody can register a staff email themselves.
6. Host the files anywhere static (Firebase Hosting, GitHub Pages, Netlify, Cloudflare Pages).

To test locally, serve the folder over HTTP (modules and the service worker will not work from `file://`):

```bash
npx serve .
# or
python3 -m http.server 8000
```

## Editing content

### Mess menu: `data/menu.json`
- `meals` holds the name, `start` and `end` time (24-hour) of each meal. Edit these to the real mess timings.
- `days` holds the menu per weekday and meal.

### Timetable: `data/timetable.json`
- `periods` defines period numbers and their start and end times.
- `classes` maps a class name (for example `BCA 2026`) to each weekday and a list of `{ period, subject, teacher }`.
- To add a class, copy an existing block and rename it. It appears in the class dropdown automatically.

### Pages and the build step
After editing `data/menu.json`, `data/timetable.json`, anything in `_src/`, `style.css` or `app.js`, run:

```bash
python3 build_pages.py
```

It rewrites every page, `sitemap.xml` and `robots.txt`. It also:
- writes the menu and timetable data into the pages, so they load without an extra request
- adds a version to `style.css?v=...` and `app.js?v=...`, so browsers and the service worker cache them safely and fetch the new file as soon as it changes
- only moves a page's "last modified" date when its content really changed

The site URL is set once at the top of `build_pages.py`. Change it if your domain is not `ogsabha.github.io`.
Page titles, descriptions and headings for each page live in the `PAGES` list in `build_pages.py`.

### Moderation words
Add words to the `BAD_WORDS` array in `app.js` (lowercase).

## How moderation works

- New wall posts and gigs are created with `approved: false` and stay hidden until staff approve them.
- Every signed-in visitor (including anonymous ones) can add one report per post or gig; the rules enforce this with a `reports/{uid}` document.
- Anyone can add one report to a post. At 3 reports it is hidden from students, but staff still see it.
- Replies to gigs are stored in a sub-collection that only the gig owner and staff can read.
- The Firestore rules enforce field names, length limits and who can edit what, so these checks are not only in the browser.

## Notes

- The Firebase web config is not a secret, but your **security rules are what protect the data**. Review `firestore.rules` before going live.
- Anonymous visitors get a hidden Firebase login so the board knows who posted what. No personal details are collected for this.
- The menu and timetable are maintained by hand and may be out of date. Always confirm with the college.

## Contributing

Pull requests and ideas are welcome, especially:
- New timetables for other classes
- Menu updates
- Accessibility and performance improvements

## SEO notes

- Every section is a real page with its own title, description, canonical link and structured data, linked from the navigation bar and the footer. Old links such as `/#wall` still work and redirect to `/wall.html`.
- Live content (today's rating, wall posts, gigs) is filled in by JavaScript, so keep the headings and intro text on each page accurate.
- Submit `sitemap.xml` in Google Search Console, then use URL Inspection > Request indexing for each of the five pages.

## Performance notes (Food page)

- The watch face, day chips and meal buttons are written into the HTML, so the page paints before JavaScript runs.
- Firebase (the heaviest download) loads after the page is shown. The Food page works without it; it only adds live ratings.
- The clock stops while the tab is hidden or the watch is scrolled off screen.
- Each page loads only the fonts it uses.

## License

Add a license of your choice (for example MIT) before publishing.
