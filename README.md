# Food.io

Look up any ingredient and get the full story — a photo, traditional regional dishes, how to cook it correctly, how to spot fakes and buy the real thing, how to grow it, and how to store or preserve it with realistic shelf lives. Powered by AI with live web search, so there's no database to maintain.

There are two apps in this repo, both talking to the same FastAPI backend:

| App | Where | What |
|---|---|---|
| **Web app** | `static/` served by `main.py` | Full 7-tab ingredient explorer + meal planner |
| **Mobile app** | `mobile/` | Expo / React Native version (iOS + Android), same features |

---

## 1. Run the web app (easiest way to test)

**You need:** Python 3.10+, and an OpenAI API key ([get one here](https://platform.openai.com/api-keys)).

```bash
# one-time setup
cp .env.example .env        # then paste your OpenAI key into .env

# start it
./run.sh                    # Mac / Linux
run.bat                     # Windows (or just double-click it)
```

Open **http://localhost:8000** — search an ingredient (try *saffron*, it has great fraud data) and click through the tabs:

**Overview** (photo, history, nutrition) · **Cook It Right** · **Real or Fake** · **Where to Find** · **Grow It** · **Preserve & Store** · **Recipes Through Time** — plus the **Meal Planner** below.

> Each tab is a separate AI call with web search, so results take 10–30 seconds to stream in. They load in parallel.

## 2. Run the mobile app

**You need:** Node 18+, and the backend from step 1 already running.

```bash
cd mobile
npm install
npx expo start
```

Then:
- Press **i** for the iOS Simulator, or **a** for the Android emulator — the app finds the backend automatically.
- **Physical phone:** install *Expo Go* from your app store, scan the QR code, and set `API_BASE_URL` in `mobile/src/api.js` to `http://<your-computer's-LAN-IP>:8000` first.

### Run in Android Studio

The native Android project lives at `mobile/android/` (generated with Expo prebuild).

**One-time setup**
1. Install [Android Studio](https://developer.android.com/studio). During setup let it install the **Android SDK** and an **emulator image**.
2. Create a virtual device: **Tools → Device Manager → Create Device** — any recent Pixel with the newest system image is fine.
3. Make sure you've run `npm install` inside `mobile/` at least once.

**Each time you run the app**
1. Start the backend: `./run.sh` (or `run.bat`) from the repo root.
2. Start the JavaScript bundler — in a terminal:
   ```bash
   cd mobile
   npx expo start
   ```
   Leave this running; the app loads its code from it in debug builds.
3. Open Android Studio → **Open** → select the **`mobile/android`** folder (not the repo root). Wait for the Gradle sync to finish (first time takes several minutes).
4. Pick your virtual device in the toolbar and press the green **Run ▶** button.

The emulator reaches your local backend automatically (the app uses `10.0.2.2:8000` on Android, which is the emulator's alias for your computer's `localhost`).

**Shortcut without opening the IDE:** `cd mobile && npx expo run:android` builds and launches the same native project from the command line, as long as Android Studio's SDK and an emulator are installed.

## 3. Quick health check

With the backend running:

```bash
curl http://localhost:8000/health
# → {"status":"ok"}

curl -X POST http://localhost:8000/ingredient/preservation \
  -H 'Content-Type: application/json' \
  -d '{"ingredient": "basil", "language": "English"}'
```

---

## Giving feedback / requesting changes

While testing, note anything you want changed — wording, layout, missing info, new features — and tell Claude in the session, for example:

> "On the Grow tab, add companion-planting suggestions"
> "The fraud risk banner should also show a confidence score"
> "Make the meal planner support dietary restrictions"

Screenshots help for visual issues. Every change gets committed to this repo so nothing is lost.

## Project layout

```
main.py              FastAPI backend — all AI endpoints live here
requirements.txt     Python dependencies
run.sh / run.bat     One-command starters (Mac/Linux · Windows)
.env.example         Template for your API key
static/              Web frontend (vanilla JS, no build step)
mobile/              Expo / React Native app
MOBILE_HANDOFF.md    Full technical inventory of the mobile app
```

## API endpoints

All `POST` with JSON body `{"ingredient": "...", "language": "English"}` unless noted:

| Endpoint | Returns |
|---|---|
| `/ingredient/info` | Description, origin, history, nutrition, season, fun fact |
| `/ingredient/image` | Wikipedia photo URL |
| `/ingredient/cooking` | Prep, cooking methods with time/temp, mistakes, pairings |
| `/ingredient/authenticity` | Fraud risk, common fakes, how to spot them, certifications |
| `/ingredient/markets` | Local sourcing (also accepts `"location"`) |
| `/ingredient/cultivation` | How to grow: climate, soil, steps, harvest, pests |
| `/ingredient/preservation` | Shelf life, storage, preservation methods, spoilage signs |
| `/ingredient/recipes` | Historical + modern recipes |
| `/meals` | Meal suggestions from `{"ingredients": [...], "meal_type": "dinner", "language": "English"}` |
