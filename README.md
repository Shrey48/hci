# Harmonia

**Learn, create and explore music in one browser tab.**

Harmonia is a single-page music learning web app built as a final project for a Human-Computer Interaction course. You can play five virtual instruments with the mouse or the computer keyboard, compose short tracks from a text prompt, walk through 9,000 years of music history while hearing each era, turn 3D instrument models around to learn their parts, track your practice on a dashboard, and find or list local concerts.

All of the sound is synthesised in the browser with the Web Audio API, so the app needs no audio sample files. The server is a small Express + SQLite backend. It handles accounts, saves your progress and serves a procedural music generator.

---

## What the app does

The whole interface is one file, `public/index.html`. Its seven "pages" are `<div>` sections that `showPage()` switches between, so moving around never reloads the page.

| Page | What you can do |
|---|---|
| **Home** | Landing hero and feature cards that link to each section. |
| **Training** | Play a virtual **piano, guitar, drums, violin or flute**. Each piano key is labelled with the computer key that plays it. Includes a *C Major Scale Challenge* (+20 XP) with a progress bar, a "Play Beat" backing track, a progress panel and per-instrument lessons. |
| **AI Generator** | Describe a track in words, or tap a quick-prompt tag (Jazz, Lo-fi, Cinematic, EDM, Folk). Then pick mood, genre, tempo (60–180 BPM) and key. You can also turn on vocals, choose a female or male voice and a vocal style, and give the song a name. Generated tracks are kept in a history list. Tracks with real MusicGen audio can also be downloaded. |
| **3D Anatomy** | Three.js models of guitar, piano, drums, violin and flute. Orbit, zoom and pan them. Click a part or a glowing hotspot to read about it. Includes *Exploded View*, *Reset Camera* and *Show All Labels* buttons. |
| **Music History** | Three tabs. **Timeline** has nine eras from Ancient Music (~3000 BCE) to the Digital Era, and each one plays a synthesised sound. **World Music** plays regional scales. **Theory** has a clickable C-major scale, common chords, intervals and a step rhythm sequencer. |
| **Dashboard** | Total XP, lessons done, AI tracks made, a day streak, a weekly practice-sessions chart, a 30-day activity calendar, per-instrument progress, recent activity and achievements. |
| **Concerts** | Search shows by city, list your own show, and book a ticket. Each booking gets a ticket code (`TK-XXXXXXXX`), and your bookings appear under *My Tickets*. |

### How track generation works

`POST /api/music/generate` does two things:

1. It sends the prompt to Hugging Face's hosted `facebook/musicgen-small` model, with a 30 s timeout. The request carries **no access token**. If the call succeeds, the returned audio is sent to the browser as base64 and the track is badged as AI-generated.
2. It always builds a **procedural note sequence** as well. The melody is 16–32 notes that step through the chosen key's scale. The mood sets the rest probability, how often long notes appear and the step size: *Energetic* moves in bigger, busier steps, while *Melancholic* has more rests and longer notes. The genre picks the oscillator waveform: sawtooth for Rock, square for Electronic, triangle for Jazz/Folk, sine otherwise. A bass line on the root, third or fifth is added underneath. The browser plays this sequence whenever there is no real audio.

When vocals are on, the server writes **lyrics from templates**. It removes stop-words from your prompt and matches what is left against eight themes (love, night, rain, summer, dream, dance, sad, party). It mixes those theme lines with lines for the chosen mood and builds a chorus around the first keyword. The output has verse, chorus, bridge and outro sections. The browser then reads the lyrics aloud with the Web Speech API (`speechSynthesis`) in the chosen voice.

So most of the "AI" here is rule-based generation. Only the optional MusicGen call uses a learned model.

---

## The HCI angle

These are the interaction and usability decisions visible in the code:

- **Several ways to do the same thing.** A page can be reached from the nav bar, the home feature cards, the footer links or the search overlay. The search opens with **Ctrl/Cmd + K** and closes with **Esc**. It also has **voice search**: speak a page or feature name using the Web Speech API's `SpeechRecognition`.
- **Immediate feedback.** Every key, string, pad and theory element plays a sound when you press it. The piano writes feedback into an `aria-live="polite"` region. Toast notifications confirm actions such as generating a track or booking a ticket. The scale challenge shows its progress step by step.
- **Learning by ear, not by reading.** Training says "your ears learn as you play". Each history era and world-music region can be *heard*, not only read about.
- **Low barrier to entry.** **Continue as Guest** starts a local demo profile without an account. **Sign in with Google** is wired in. The vocalist options stay hidden until you tick "Generate Song with Vocals". The song name is optional and filled in automatically when left empty.
- **Motivation through game elements.** XP, levels, a day streak, achievements and an activity calendar, all shown on the dashboard.
- **Accessibility work.** The nav uses `role="navigation"`, `role="menubar"` and `role="menuitem"`, and icon-only buttons have `aria-label`s. Feature cards are focusable (`tabindex="0"`, `role="button"`). Form fields have the right `autocomplete` hints. Modals close with **Esc**.
- **User control over the environment.** There is a light/dark theme toggle (remembered in `localStorage`) and an optional ambient music toggle. Breakpoints at 900 px and 600 px give a responsive layout.

---

## Tech stack

| Layer | Used |
|---|---|
| Frontend | One `public/index.html` with HTML, CSS and vanilla JavaScript (about 6,200 lines) |
| Audio | Web Audio API (oscillators, gain, LFO), Web Speech API (synthesis + recognition) |
| Graphics / motion | Three.js r128 + OrbitControls, GSAP 3.12.5 + ScrollTrigger, Lenis smooth scroll (all loaded from CDNs) |
| Auth (client) | Google Identity Services (`accounts.google.com/gsi/client`) |
| Backend | Node.js, Express 5 |
| Auth (server) | bcrypt password hashing, JSON Web Tokens (7-day expiry), `google-auth-library` ID-token verification |
| Database | SQLite via `sqlite3` |

---

## Data model

`server.js` creates all three tables at startup (`CREATE TABLE IF NOT EXISTS`). It also seeds 10 sample concerts in Indian cities whenever the `concerts` table is empty.

| Table | Columns | Notes |
|---|---|---|
| `users` | `id`, `email` (unique), `password` (bcrypt hash), `name`, `data`, `google_id` | `data` is a JSON blob holding the user's whole profile: XP, level, streak, activities, achievements, generated tracks, instrument progress. |
| `concerts` | `id`, `city`, `title`, `date`, `venue`, `price`, `user_id` | `user_id = 0` marks the seeded sample shows. |
| `tickets` | `id`, `concert_id`, `user_id`, `qr_code` | One row per booking. |

### API

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | – | Create an account, return a JWT |
| POST | `/api/auth/login` | – | Email + password login |
| POST | `/api/auth/google` | – | Verify a Google ID token, log in or create the user |
| GET / PUT | `/api/user` | JWT | Read / save the profile JSON |
| POST | `/api/music/generate` | – | Generate a track (see above) |
| GET | `/api/concerts?city=` | – | List or search concerts |
| POST | `/api/concerts` | JWT | List a new show |
| POST | `/api/concerts/book` | JWT | Book a ticket |
| GET | `/api/users/tickets` | JWT | My tickets |

Any other non-`/api` path returns `public/index.html`. Only `public/` is served as static files, so `server.js` and `database.sqlite` are never reachable by URL.

---

## Getting started

Requirements: **Node.js 18 or newer** (Express 5 requires it). npm installs the native modules (`bcrypt`, `sqlite3`) for your platform.

```bash
git clone https://github.com/Shrey48/hci.git
cd hci
npm install
export JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")"
npm start
```

Then open **http://localhost:3000**.

### Configuration

The server reads these settings from environment variables. `.env.example` lists them. The app does not load `.env` files on its own, so export the variables in your shell or set them in your process manager.

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | random value generated at each start | Signs login tokens. Without it, the server prints a warning, and every login becomes invalid when the server restarts. Set it to a long random string for anything beyond a quick local try. |
| `GOOGLE_CLIENT_ID` | placeholder | Enables "Sign in with Google" (see below). |
| `PORT` | `3000` | Port to listen on. |

The SQLite file `database.sqlite` is created next to `server.js` on first start. The tables are created and 10 sample concerts are added at that point. The file is git-ignored, because it fills up with real accounts once people sign up.

### Optional: Google sign-in

Create an OAuth 2.0 Web client ID in Google Cloud Console, then:

- set `GOOGLE_CLIENT_ID=<your id>` before `npm start`, and
- replace the `'YOUR_GOOGLE_CLIENT_ID'` placeholder in `public/index.html` (the `google.accounts.id.initialize` call) with the same ID.

Email/password login and guest mode work without this.

---

## Project layout

```
hci/
├── public/
│   └── index.html      # the entire frontend: markup, styles, scripts, 7 pages
├── server.js           # Express API, SQLite setup + seed, music & lyrics generator
├── package.json        # dependencies and the `npm start` script
├── package-lock.json   # exact dependency versions
├── .env.example        # environment variables the server reads
└── .gitignore          # node_modules/, *.sqlite, .env, .DS_Store
```

---

## Notes and known limitations

- **MusicGen is best-effort.** The Hugging Face request sends no token. If it is rejected or times out, the server logs that and falls back to the procedural synthesiser, and the app still works.
- **Lyrics are spoken, not sung.** Vocals use the browser's text-to-speech voices.
- **Ticket codes are random strings.** They are not real QR codes and are not validated.
- **Guest progress is not saved to the server.** A guest profile lives only in the page.
- Built as a course project. No automated tests (`npm test` is the npm placeholder).
