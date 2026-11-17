# Og Sabha (DCSMAT Hub)

A loud, sticker-style student hub for **DCSMAT, Vagamon**. Made by UG 2026 students of DCSMAT, Vagamon. Not an official college site.

It brings four everyday things into one installable web app:

| Tab | What it does |
| --- | --- |
| 🍛 **Food** | Weekly mess menu, a "serving now" highlight, and live star ratings for each meal |
| 📚 **Classes** | Timetable for your class, the current period with a progress bar, and live "teacher present / absent" status |
| 💬 **Wall** | Anonymous posts with moderation, reporting and an approval queue |
| 🛠️ **Gigs** | A skill board where students post "wanted" jobs or "offering" skills and get private replies |

## Features

- **Live "right now" strip** showing the current meal and current class
- **Anonymous ratings**: one rating per device, per meal, per day
- **Class rep attendance**: staff can mark a teacher present, absent or clear the status
- **Moderated wall**: posts wait for approval, 3 or more reports hide a post, a rude-word filter and a 60 second cooldown apply
- **Private gig replies**: contact details are never shown on the post, only the poster (and staff) can read replies
- **WhatsApp shortcut** for replies that contain a phone number
- **Four moods**: the whole theme changes per tab (butter yellow, lilac, midnight, mint)
- **Playful touches**: draggable stickers, emoji bursts, pointer-following blobs, time-of-day greeting
- **Installable PWA** with a web manifest and service worker
- Respects `prefers-reduced-motion`

## Tech stack

- Plain HTML, CSS and JavaScript (ES modules), with no build step
- [Firebase](https://firebase.google.com/) Firestore for data
- Firebase Authentication: email/password for staff, silent anonymous sign-in for visitors
- Google Fonts: Bebas Neue, Playfair Display, Poppins, Inter and a few more

## Project structure

```
.
├── index.html            # Main app (tabs filled by JavaScript)
├── classes.html          # Crawlable page: classes
├── about.html            # Crawlable page: about
├── gigs.html             # Crawlable page: gigs
├── wall.html             # Crawlable page: wall
├── mess-menu.html        # Static, crawlable menu page (generated)
├── timetable.html        # Static, crawlable timetable page (generated)
├── style.css             # All styling and the four themes
├── app.js                # App logic and Firebase code
├── sw.js                 # Service worker (PWA)
├── manifest.webmanifest  # PWA manifest
├── firestore.rules       # Firestore security rules
├── build_pages.py        # Regenerates the menu and timetable pages, robots.txt and sitemap.xml
├── robots.txt            # Crawler rules + sitemap link
├── sitemap.xml           # Pages for search engines (generated)
├── og-image.png          # Link-preview image (1200x630)
├── icons/                # favicon.ico, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png
├── members/              # Team photos
└── data/
    ├── menu.json         # Mess menu and meal timings
    └── timetable.json    # Periods and class timetables
```

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

### SEO pages
After editing `data/menu.json` or `data/timetable.json`, run `python3 build_pages.py` to refresh `mess-menu.html`, `timetable.html` and `sitemap.xml`.
The site URL is set once at the top of `build_pages.py` (and in the `<head>` of `index.html`). Change it if your domain is not `ogsabha.github.io`.

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

- Search engines cannot see the live tabs (they are filled by JavaScript), so the crawlable pages are `index.html`, `mess-menu.html` and `timetable.html`. Keep their text accurate and re-run `build_pages.py` after every menu or timetable change.
- Tabs can be opened directly with `/#classes`, `/#wall` and `/#gigs`.
- Submit `sitemap.xml` in Google Search Console and check the pages with the URL Inspection tool.

## License

Add a license of your choice (for example MIT) before publishing.
