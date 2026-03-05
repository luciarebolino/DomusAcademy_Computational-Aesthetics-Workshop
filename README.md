# Computational Aesthetics 

A hands-on toolkit to collect and render visual data scraping data from Google Maps.

<img width="1052" height="526" alt="Screenshot 2026-03-05 at 8 38 38 PM" src="https://github.com/user-attachments/assets/e1570fb2-2b72-45a5-872e-5cdfff43e204" />



## References

- [Laura Kurgan](https://c4sr.columbia.edu/projects/plain-sight)
- [CSR - Conflict Urbanism](https://centerforspatialresearch.github.io/conflict_urbanism_sp2023/2023/04/28/Those-Who-Live-and-Travel-in-the-Dark.html)
- [Robert Pietrusko](https://www.warning-office.org/wo-test-sites)
- [Sam Lavigne](https://lav.io/projects/street-views/)
- [James Bridle](https://jamesbridle.com/works/every-cctv-camera-cc)
- [Clement Valla](https://clementvalla.com/work/postcards-from-google-earth/)
- [Dan Miller](https://dl.acm.org/doi/10.1145/3715668.3736392#:~:text=As%20we%20Witness%20the%20unraveling,stored%20the%20files%20%5B9%5D.)
- [Mario Santamaria](https://www.mariosantamaria.net/Emerald-black-latency/)
- [Simon Weckert](https://www.simonweckert.com/googlemapshacks.html)
- [Jenny Odell](https://www.jennyodell.com/satellite-landscapes.html)
- [Josh Begley](https://joshbegley.com/)
- [WTTDOTM](https://trafficcamphotobooth.com/animenyc.html)
- [Tatu Gustaffsson](https://stanisland.com/2024/10/08/tatu-gustaffsson-cctv-project-finland/)


---

## HOW TO GET DATA
We will use Google APIs to collect visual and spatial data.

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
5. Paste the key into the scripts (in the `TWEAKS` block), or set environment variable `GOOGLE_API_KEY`

---

- **Google My Maps** https://www.google.com/maps/d/
Trace a route for a car, export it as a KML file, drag and drop it into this folder, and name it `points.kml` (important).
- **Google Places** https://developers.google.com/maps/documentation/places/web-service/legacy/supported_types
Select the place type(s) you want to investigate and scrape from this list.

## 0) Install all libraries (step by step)

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

If all 3 commands print a version, setup is complete.



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

Run this once on each computer before launching the scripts.

---

## 4) Files students can edit

Only edit values in blocks labeled:

- `TWEAKS (EDIT THIS BLOCK)`

Main route input file:

- `points.kml`

---

## 5) What each script does

1. `export-streetview.js` → route-based Street View frames + video
2. `export-satellite.js` → route-based satellite frames + video
3. `export-oblique-3d.js` → route-based oblique 3D frames + video
4. `export-places-storefront-satellite.js` → for each place type in bbox: storefront image + satellite image

---

## 6) Run commands

### A) Street 

```bash
npm run street:check
npm run street
```

### B) Satellite 

```bash
npm run satellite:check
npm run satellite
```

### C) 3D 

```bash
npm run oblique:check
npm run oblique
```

Rougher/mesh style version:

```bash
npm run oblique:rough:check
npm run oblique:rough
```

### D) Storefront + Satellite

Edit in `export-places-storefront-satellite.js`:

- `BBOX_COORDS` with format: `west,south,east,north` (get the bbox in CSV format here: https://boundingbox.klokantech.com/)
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
- 3D frames: `output/oblique_3d/`
- Places storefront images: `output/places_storefront_satellite/storefront/`
- Places satellite images: `output/places_storefront_satellite/satellite/`
- Places metadata: `output/places_storefront_satellite/manifest.json`
- Videos: `video/`

---

## 8) Common problems

1. `command not found: node` → Node.js not installed
2. `command not found: ffmpeg` → FFmpeg not installed
3. Empty output for places → bbox is too small/incorrect, or the selected place type has no matches in that area

---


