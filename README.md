# 🎓 UniMatch — swipe your way to the right college

A Tinder-style web app for choosing a U.S. university. **Set your filters, then
swipe through matching schools** one card at a time — save the ones you like,
pass on the rest, and build a shortlist you can revisit and share.

Every degree-granting college in the U.S. is included, so you won't miss one.

## What it does

1. **Filter** — pick what matters: region/state, degree focus (4-year, 2-year,
   grad), public vs. private, size, campus setting, selectivity, max net price,
   fields of study, and community/mission (HBCU, Hispanic-serving, women's or
   men's colleges, tribal, religious).
2. **Swipe** — each school shows a quick summary and key stats. Tap **ℹ** or
   *Read more* for the full picture, then **✕ Pass** or **♥ Save**
   (swipe, click, or use ← / → arrow keys). **Undo** if you change your mind.
3. **My List** — your saved schools, with links to each official site. Copy the
   whole shortlist to your clipboard, or jump back into swiping.

Your filters, saved schools, and passed schools are remembered in your browser
(localStorage) — close the tab and pick up where you left off.

## Run it

It's a static site — no build step, no dependencies. Serve the folder over HTTP
(the app fetches `data/colleges.json`, which browsers block from `file://`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static host (GitHub Pages, Netlify, etc.) works too.

## The data

Coverage comes from the U.S. Department of Education's
[**College Scorecard**](https://collegescorecard.ed.gov/data) (public domain) —
the authoritative, comprehensive record of Title IV institutions. The app
includes every **currently-operating, degree-granting** institution
(associate, bachelor's, or graduate); certificate-only trade schools and closed
institutions are left out to keep the deck about actual colleges.

Fields per school: location, control (public/private/for-profit), degree level,
undergraduate size, campus setting, average SAT, average net price, on-time
graduation rate, median earnings 10 years out, most-popular fields of study, and
mission flags.

### Rebuilding the dataset

`data/colleges.json` is generated from the raw Scorecard file by a small script:

```bash
# scripts/scorecard-raw.csv is the "Most-Recent-Cohorts-Scorecard-Elements"
# file from collegescorecard.ed.gov/data
python3 scripts/build_data.py
```

To refresh with a newer Scorecard release, drop the new CSV in at
`scripts/scorecard-raw.csv` and re-run the script.

## Project layout

```
index.html            app shell + three views (Filters, Swipe, My List)
styles.css            all styling
app.js                filtering, swipe deck, saved-list logic (vanilla JS)
data/colleges.json    generated dataset (~3,500 colleges)
scripts/build_data.py CSV → JSON transform
scripts/scorecard-raw.csv  source data (College Scorecard, public domain)
```
