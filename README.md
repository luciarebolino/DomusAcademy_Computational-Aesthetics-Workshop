# KML Export Suite (Student Setup)

This guide assumes you have **never coded before** and this is your **first time using VS Code**.

---

## 0) Install everything first (step by step)

### Option A — macOS

1. Install **Homebrew**
	- Open Terminal app and run:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

2. Install **Visual Studio Code**
	- Go to: https://code.visualstudio.com/
	- Download VS Code for macOS
	- Drag VS Code into Applications

3. Install **Node.js**
	- In Terminal, run:

```bash
brew install node
```

4. Install **FFmpeg**

```bash
brew install ffmpeg
```

### Option B — Windows

1. Install **Visual Studio Code**
	- Go to: https://code.visualstudio.com/
	- Download VS Code for Windows and install

2. Install **Node.js LTS** (easiest: PowerShell + winget)
	- Open **PowerShell as Administrator** and run:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

3. Install **FFmpeg** (same method)
	- In the same PowerShell window, run:

```powershell
winget install --id Gyan.FFmpeg -e
```

	- If `winget` is unavailable:
	  - Install Node LTS from https://nodejs.org/
	  - Install FFmpeg from https://ffmpeg.org/download.html and add it to PATH

### Verify install (both macOS and Windows)

Open Terminal (or PowerShell) and run:

```bash
node -v
npm -v
ffmpeg -version
```

If all 3 commands print a version, setup is OK.

---

## 1) Google API setup (required)

In Google Cloud Console:

1. Create or select a project
2. Enable billing on the project
3. Enable these APIs:
	- **Street View Static API**
	- **Maps Static API**
	- **Places API**
	- **Maps JavaScript API** (needed for oblique script)
4. Create an API key
5. Paste the key into the scripts (in the `🧑‍🎓 STUDENT TWEAKS` block), or set environment variable `GOOGLE_API_KEY`

---

## 2) Open project in VS Code

1. Open VS Code
2. File → Open Folder...
3. Select folder: `DomusAcademy_Computational-Aesthetics-Workshop`
4. In VS Code, open Terminal (Terminal → New Terminal)

---

## 3) FIRST COMMAND TO RUN (always)

From the project root terminal, run:

```bash
npm install
```

Do this once on each computer before running scripts.

---

## 4) Files students can edit

Only edit values in blocks labeled:

- `🧑‍🎓 STUDENT TWEAKS (EDIT THIS BLOCK)`

Main input route file:

- `points.kml`

---

## 5) What each script does

1. `export-streetview.js` → route-based Street View frames + video
2. `export-satellite.js` → route-based satellite frames + video
3. `export-oblique-3d.js` → route-based oblique 3D frames + video
4. `export-places-storefront-satellite.js` → for each place type in bbox: storefront image + satellite image

---

## 6) Beginner run commands

### A) Street View

```bash
npm run street:check
npm run street
```

### B) Satellite route

```bash
npm run satellite:check
npm run satellite
```

### C) Oblique 3D route

```bash
npm run oblique:check
npm run oblique
```

Rougher/mesh style version:

```bash
npm run oblique:rough:check
npm run oblique:rough
```

### D) Places storefront + satellite

Edit in `export-places-storefront-satellite.js`:

- `BBOX_COORDS` with format: `west,south,east,north`
- `PLACE_TYPES`, example: `['restaurant']` or `['restaurant', 'cafe']`

Then run:

```bash
npm run places:check
npm run places
```

---

## 7) Where outputs are saved

- Street frames: `output/streetview/`
- Satellite frames: `output/satellite/`
- Oblique frames: `output/oblique_3d/`
- Places storefront images: `output/places_storefront_satellite/storefront/`
- Places satellite images: `output/places_storefront_satellite/satellite/`
- Places metadata: `output/places_storefront_satellite/manifest.json`
- Videos: `video/`

---

## 8) Common problems

1. `command not found: node` → Node.js not installed
2. `command not found: ffmpeg` → FFmpeg not installed
3. API errors (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`) → check billing, enabled APIs, API key restrictions
4. Empty output for places → bbox too small/wrong, or place type has no matches in that area

---

## 9) Classroom reset (optional)

If you want a clean run, delete old output folders before running again.
