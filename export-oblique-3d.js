#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// TWEAKS (EDIT THIS BLOCK)
// ============================================

const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDf2b_bwfWvNMgMr2XZdTfbcXQHxWqux8A';
const MAP_ID = process.env.GOOGLE_MAP_ID || '';

const KML_INPUT_CANDIDATES = ['points.kml'];
const OUTPUT_DIR = path.join(__dirname, 'output', 'oblique_3d');
const OUTPUT_VIDEO_DIR = path.join(__dirname, 'video');

const WIDTH = 1280;
const HEIGHT = 720;
const DEFAULT_ZOOM = 20.5;
const DEFAULT_TILT = 67.5;
const HEADING_OFFSET = 0;
const MIN_DISTANCE = 10;
const MAX_FRAMES = 180;
const DEFAULT_RENDER_WAIT_MS = 450;

const MESH_ACCURACY_PERCENT = 100; // 100 = original (no mesh warp), 0 = very rough
const LOW_MESH_SEED = 1337;

// ============================================
// WORKSHOP LOGIC (DON'T EDIT BELOW)
// ============================================

function assembleVideoFromFrames({ outputDir, pattern, outputVideo, fps = 30 }) {
    fs.mkdirSync(path.dirname(outputVideo), { recursive: true });
    const command = `ffmpeg -framerate ${fps} -i "${path.join(outputDir, pattern)}" -c:v libx264 -pix_fmt yuv420p -y "${outputVideo}"`;
    execSync(command, { stdio: 'inherit' });
}

function clearNumberedFrames(outputDir, ext) {
    if (!fs.existsSync(outputDir)) {
        return;
    }

    const regex = new RegExp(`^\\d{5}\\.${ext}$`, 'i');
    for (const name of fs.readdirSync(outputDir)) {
        if (regex.test(name)) {
            fs.unlinkSync(path.join(outputDir, name));
        }
    }
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function getArgValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index === -1 || index === process.argv.length - 1) {
        return null;
    }
    return process.argv[index + 1];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getMeshParamsFromAccuracy(accuracyPercent) {
    const a = clamp(accuracyPercent, 0, 100);
    const rough = (100 - a) / 100;

    return {
        cols: Math.round(12 + a * 0.68),
        rows: Math.round(8 + a * 0.37),
        warpPx: Math.round(rough * 34)
    };
}

function resolveKmlFile() {
    for (const name of KML_INPUT_CANDIDATES) {
        const full = path.join(__dirname, name);
        if (fs.existsSync(full)) {
            return full;
        }
    }
    return null;
}

function parseKmlCoordinates(kmlContent) {
    const coordinatesBlocks = [...kmlContent.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    const points = [];

    for (const block of coordinatesBlocks) {
        const raw = block[1].trim();
        if (!raw) continue;

        const entries = raw.split(/\s+/);
        for (const entry of entries) {
            const [lonStr, latStr] = entry.split(',');
            const lon = Number(lonStr);
            const lat = Number(latStr);
            if (Number.isFinite(lon) && Number.isFinite(lat)) {
                points.push([lon, lat]);
            }
        }
    }

    return points;
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

function sampleRoute(points, maxFrames) {
    const sampled = [points[0]];
    let last = points[0];

    for (let i = 1; i < points.length && sampled.length < maxFrames; i++) {
        const current = points[i];
        const dist = getDistance(last[1], last[0], current[1], current[0]);
        if (dist >= MIN_DISTANCE) {
            sampled.push(current);
            last = current;
        }
    }

    return sampled;
}

function buildFrames(routePoints) {
    const frames = [];
    for (let i = 0; i < routePoints.length; i++) {
        const [lon, lat] = routePoints[i];
        let heading = HEADING_OFFSET;

        if (i < routePoints.length - 1) {
            const [nextLon, nextLat] = routePoints[i + 1];
            heading = calculateBearing(lat, lon, nextLat, nextLon) + HEADING_OFFSET;
        }

        frames.push({ lat, lon, heading });
    }
    return frames;
}

function makeViewerHtml({ apiKey, mapId, frames, zoom, tilt }) {
    const framesJson = JSON.stringify(frames);
    const mapIdLine = mapId ? `mapId: '${mapId}',` : '';

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const FRAMES = ${framesJson};
    let map;

    function initMap() {
      const first = FRAMES[0];
      map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: first.lat, lng: first.lon },
        zoom: ${zoom},
        tilt: ${tilt},
        heading: first.heading,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        gestureHandling: 'none',
        keyboardShortcuts: false,
        clickableIcons: false,
        isFractionalZoomEnabled: true,
        ${mapIdLine}
      });

      map.setTilt(${tilt});
      window.__captureReady = true;
    }

    window.__setFrame = (index) => {
      const frame = FRAMES[index];
      if (!frame || !map) return false;
      map.moveCamera({
        center: { lat: frame.lat, lng: frame.lon },
        heading: frame.heading,
        tilt: ${tilt},
        zoom: ${zoom}
      });
      return true;
    };
  </script>
  <script async defer src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&callback=initMap"></script>
</body>
</html>`;
}

function makeMeshFilterHtml({ width, height }) {
        return `<!doctype html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:#000">
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

function seededNoise(i, j, seed) {
    const x = Math.sin((i * 127.1 + j * 311.7 + seed * 13.37)) * 43758.5453123;
    return x - Math.floor(x);
}

function affineFromTriangles(s0, s1, s2, d0, d1, d2) {
    const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
    if (Math.abs(den) < 1e-8) return null;

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den;
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den;
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / den;

    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den;
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den;
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / den;

    return { a, b, c, d, e, f };
}

function drawTriangle(img, s0, s1, s2, d0, d1, d2) {
    const m = affineFromTriangles(s0, s1, s2, d0, d1, d2);
    if (!m) return;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();

    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
}

async function loadImageFromBase64(base64) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = 'data:image/png;base64,' + base64;
    });
}

window.__stylize = async (base64Png, cols, rows, warpPx, seed) => {
    const img = await loadImageFromBase64(base64Png);

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const dx = img.width / cols;
    const dy = img.height / rows;

    const src = [];
    const dst = [];
    for (let r = 0; r <= rows; r++) {
        const srcRow = [];
        const dstRow = [];
        for (let c = 0; c <= cols; c++) {
            const x = c * dx;
            const y = r * dy;
            srcRow.push({ x, y });

            const border = r === 0 || r === rows || c === 0 || c === cols;
            if (border) {
                dstRow.push({ x, y });
            } else {
                const nx = (seededNoise(c, r, seed) - 0.5) * 2;
                const ny = (seededNoise(c + 91, r + 47, seed) - 0.5) * 2;
                dstRow.push({ x: x + nx * warpPx, y: y + ny * warpPx });
            }
        }
        src.push(srcRow);
        dst.push(dstRow);
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const s00 = src[r][c];
            const s10 = src[r][c + 1];
            const s01 = src[r + 1][c];
            const s11 = src[r + 1][c + 1];

            const d00 = dst[r][c];
            const d10 = dst[r][c + 1];
            const d01 = dst[r + 1][c];
            const d11 = dst[r + 1][c + 1];

            drawTriangle(img, s00, s10, s11, d00, d10, d11);
            drawTriangle(img, s00, s11, s01, d00, d11, d01);
        }
    }

    const out = canvas.toDataURL('image/png');
    return out.slice('data:image/png;base64,'.length);
};
</script>
</body>
</html>`;
}

async function main() {
    const checkOnly = hasFlag('--check');
    const limitArg = getArgValue('--limit');
    const zoomArg = getArgValue('--zoom');
    const tiltArg = getArgValue('--tilt');
    const waitArg = getArgValue('--wait');
    const accuracyArg = getArgValue('--accuracy');
    const roughnessArg = getArgValue('--roughness');
    const legacyStyleArg = getArgValue('--style');
    const maxFrames = limitArg ? Number(limitArg) : MAX_FRAMES;
    const zoom = zoomArg ? Number(zoomArg) : DEFAULT_ZOOM;
    const tilt = tiltArg ? Number(tiltArg) : DEFAULT_TILT;
    const renderWaitMs = waitArg ? Number(waitArg) : DEFAULT_RENDER_WAIT_MS;
    let accuracyPercent = MESH_ACCURACY_PERCENT;

    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 1500) {
        throw new Error(`Invalid --limit value: ${limitArg}. Use integer between 1 and 1500.`);
    }

    if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) {
        throw new Error(`Invalid --zoom value: ${zoomArg}. Use number between 0 and 22.`);
    }

    if (!Number.isFinite(tilt) || tilt < 0 || tilt > 67.5) {
        throw new Error(`Invalid --tilt value: ${tiltArg}. Use number between 0 and 67.5.`);
    }

    if (!Number.isFinite(renderWaitMs) || renderWaitMs < 50 || renderWaitMs > 5000) {
        throw new Error(`Invalid --wait value: ${waitArg}. Use milliseconds between 50 and 5000.`);
    }

    if (legacyStyleArg) {
        const legacy = legacyStyleArg.toLowerCase();
        if (legacy === 'high') {
            accuracyPercent = 100;
        } else if (legacy === 'low') {
            accuracyPercent = 35;
        } else {
            throw new Error(`Invalid --style value: ${legacyStyleArg}. Use 'high' or 'low', or prefer --accuracy 0..100.`);
        }
    }

    if (accuracyArg) {
        accuracyPercent = Number(accuracyArg);
    }

    if (roughnessArg) {
        const roughness = Number(roughnessArg);
        if (!Number.isFinite(roughness) || roughness < 0 || roughness > 10) {
            throw new Error(`Invalid --roughness value: ${roughnessArg}. Use number between 0 and 10.`);
        }
        accuracyPercent = 100 - roughness * 10;
    }

    if (!Number.isFinite(accuracyPercent) || accuracyPercent < 0 || accuracyPercent > 100) {
        throw new Error(`Invalid --accuracy value: ${accuracyArg}. Use number between 0 and 100.`);
    }

    const meshParams = getMeshParamsFromAccuracy(accuracyPercent);
    const useMeshFilter = meshParams.warpPx > 0;
    const accuracyLabel = String(Math.round(accuracyPercent));
    const outputVideo = path.join(OUTPUT_VIDEO_DIR, `oblique-3d-${accuracyLabel}.mp4`);

    const kmlFile = resolveKmlFile();
    if (!kmlFile) {
        throw new Error('KML file not found: points.kml');
    }

    const kmlContent = fs.readFileSync(kmlFile, 'utf-8');
    const allPoints = parseKmlCoordinates(kmlContent);
    if (allPoints.length < 2) {
        throw new Error('KML needs at least 2 valid coordinates in <coordinates> tags.');
    }

    const sampledRoute = sampleRoute(allPoints, maxFrames);
    const frames = buildFrames(sampledRoute);

    console.log('\n🌍 Oblique 3D Google-style Capture\n');
    console.log(`KML: ${kmlFile}`);
    console.log(`Raw points: ${allPoints.length}`);
    console.log(`Sampled frames: ${frames.length}`);
    console.log(`Zoom: ${zoom}, Tilt: ${tilt}`);
    console.log(`Accuracy: ${accuracyPercent.toFixed(1)}%`);
    console.log(`Mesh filter: ${useMeshFilter ? `ON (${meshParams.cols}x${meshParams.rows}, warp ${meshParams.warpPx}px)` : 'OFF (original look)'}`);
    if (!MAP_ID) {
        console.log('Map ID: not set (some locations may show less 3D detail)');
    }
    console.log('');

    if (checkOnly) {
        console.log('✅ Check passed. Run without --check to capture frames.');
        process.exit(0);
    }

    let puppeteer;
    try {
        puppeteer = require('puppeteer');
    } catch (error) {
        throw new Error('Missing dependency: puppeteer. Install with: npm install puppeteer');
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    clearNumberedFrames(OUTPUT_DIR, 'png');

    const tempHtml = path.join(os.tmpdir(), `oblique-capture-${Date.now()}.html`);
    const tempMeshHtml = path.join(os.tmpdir(), `oblique-style-${Date.now()}.html`);
    fs.writeFileSync(tempHtml, makeViewerHtml({
        apiKey: API_KEY,
        mapId: MAP_ID,
        frames,
        zoom,
        tilt
    }));
    if (useMeshFilter) {
        fs.writeFileSync(tempMeshHtml, makeMeshFilterHtml({ width: WIDTH, height: HEIGHT }));
    }

    const browser = await puppeteer.launch({
        headless: true,
        defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 }
    });

    try {
        const page = await browser.newPage();
        await page.goto(`file://${tempHtml}`, { waitUntil: 'networkidle2', timeout: 120000 });
        await page.waitForFunction(() => window.__captureReady === true, { timeout: 120000 });

        let meshPage = null;
        if (useMeshFilter) {
            meshPage = await browser.newPage();
            await meshPage.goto(`file://${tempMeshHtml}`, { waitUntil: 'load', timeout: 120000 });
        }

        for (let i = 0; i < frames.length; i++) {
            await page.evaluate((index) => window.__setFrame(index), i);
            await new Promise((resolve) => setTimeout(resolve, renderWaitMs));

            const fileName = path.join(OUTPUT_DIR, `${String(i + 1).padStart(5, '0')}.png`);
            if (useMeshFilter) {
                const rawBuffer = await page.screenshot({ type: 'png' });
                const stylizedBase64 = await meshPage.evaluate(
                    async (base64Png, cols, rows, warpPx, seed) => {
                        return await window.__stylize(base64Png, cols, rows, warpPx, seed);
                    },
                    rawBuffer.toString('base64'),
                    meshParams.cols,
                    meshParams.rows,
                    meshParams.warpPx,
                    LOW_MESH_SEED + i
                );
                fs.writeFileSync(fileName, Buffer.from(stylizedBase64, 'base64'));
            } else {
                await page.screenshot({ path: fileName, type: 'png' });
            }
            console.log(`✓ Frame ${i + 1}/${frames.length}`);
        }

        console.log(`\n✅ Done. Frames in: ${OUTPUT_DIR}`);

        console.log('\n🎬 Assembling video...');
        assembleVideoFromFrames({
            outputDir: OUTPUT_DIR,
            pattern: '%05d.png',
            outputVideo,
            fps: 30
        });
        console.log(`✅ Video created: ${outputVideo}`);
    } finally {
        await browser.close();
        if (fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
        if (fs.existsSync(tempMeshHtml)) fs.unlinkSync(tempMeshHtml);
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
});
