#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// 🧑‍🎓 STUDENT TWEAKS (EDIT THIS BLOCK)
// ============================================

const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDf2b_bwfWvNMgMr2XZdTfbcXQHxWqux8A';
const KML_INPUT_CANDIDATES = ['points.kml'];
const OUTPUT_DIR = path.join(__dirname, 'output', 'satellite');
const OUTPUT_VIDEO = path.join(__dirname, 'video', 'satellite.mp4');

const IMAGE_WIDTH = 640;
const IMAGE_HEIGHT = 300;
const SCALE = 2;
const MAP_TYPE = 'satellite';
const FORMAT = 'jpg';
const ZOOM = 19;

const MIN_DISTANCE = 8;
const MAX_FRAMES = 200;
const DELAY_MS = 120;

// ============================================
// 🔒 WORKSHOP LOGIC (DON'T EDIT BELOW)
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
    const idx = process.argv.indexOf(flag);
    if (idx === -1 || idx === process.argv.length - 1) {
        return null;
    }
    return process.argv[idx + 1];
}

function resolveKmlFile() {
    for (const fileName of KML_INPUT_CANDIDATES) {
        const fullPath = path.join(__dirname, fileName);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }
    return null;
}

function parseKmlCoordinates(kmlContent) {
    const coordinatesBlocks = [...kmlContent.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    const points = [];

    for (const block of coordinatesBlocks) {
        const raw = block[1].trim();
        if (!raw) {
            continue;
        }

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
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

function downloadImage(url, outputPath) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed: HTTP ${response.statusCode}`));
                return;
            }

            const stream = fs.createWriteStream(outputPath);
            response.pipe(stream);
            stream.on('finish', () => {
                stream.close();
                resolve();
            });
            stream.on('error', reject);
        }).on('error', reject);
    });
}

async function main() {
    const checkOnly = hasFlag('--check');
    const noVideo = hasFlag('--no-video');

    const zoomArg = getArgValue('--zoom');
    const limitArg = getArgValue('--limit');
    const mapTypeArg = getArgValue('--maptype');

    const zoom = zoomArg ? Number(zoomArg) : ZOOM;
    const maxFrames = limitArg ? Number(limitArg) : MAX_FRAMES;
    const mapType = mapTypeArg || MAP_TYPE;

    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 21) {
        throw new Error(`Invalid --zoom value: ${zoomArg}. Use integer between 0 and 21.`);
    }

    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 2000) {
        throw new Error(`Invalid --limit value: ${limitArg}. Use integer between 1 and 2000.`);
    }

    if (!['satellite', 'hybrid', 'roadmap', 'terrain'].includes(mapType)) {
        throw new Error(`Invalid --maptype value: ${mapType}. Use satellite|hybrid|roadmap|terrain.`);
    }

    const kmlFile = resolveKmlFile();
    if (!kmlFile) {
        throw new Error('KML file not found: points.kml');
    }

    const kml = fs.readFileSync(kmlFile, 'utf-8');
    const allPoints = parseKmlCoordinates(kml);
    if (allPoints.length < 2) {
        throw new Error('KML needs at least 2 valid coordinates in <coordinates> tags.');
    }

    const route = sampleRoute(allPoints, maxFrames);

    console.log('\n🛰️ Satellite Path Frames (Textured API)\n');
    console.log(`KML: ${kmlFile}`);
    console.log(`Raw points: ${allPoints.length}`);
    console.log(`Sampled points: ${route.length}`);
    console.log(`Zoom: ${zoom}, maptype: ${mapType}\n`);

    if (checkOnly) {
        console.log('✅ Check passed. Run without --check to download frames.');
        process.exit(0);
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    clearNumberedFrames(OUTPUT_DIR, 'jpg');

    for (let i = 0; i < route.length; i++) {
        const [lon, lat] = route[i];

        const params = new URLSearchParams({
            center: `${lat},${lon}`,
            zoom: String(zoom),
            size: `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
            scale: String(SCALE),
            maptype: mapType,
            format: FORMAT,
            key: API_KEY
        });

        const url = `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
        const out = path.join(OUTPUT_DIR, `${String(i + 1).padStart(5, '0')}.jpg`);

        try {
            await downloadImage(url, out);
            console.log(`✓ Frame ${i + 1}/${route.length}`);
            await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        } catch (err) {
            console.error(`✗ Frame ${i + 1} failed: ${err.message}`);
        }
    }

    console.log(`\n✅ Done. Frames in: ${OUTPUT_DIR}`);

    if (noVideo) {
        console.log('Video assembly skipped (--no-video).');
        console.log('Create video manually:');
        console.log(`ffmpeg -framerate 30 -i "${path.join(OUTPUT_DIR, '%05d.jpg')}" -c:v libx264 -pix_fmt yuv420p -y "${OUTPUT_VIDEO}"`);
        return;
    }

    try {
        console.log('\n🎬 Assembling video...');
        assembleVideoFromFrames({
            outputDir: OUTPUT_DIR,
            pattern: '%05d.jpg',
            outputVideo: OUTPUT_VIDEO,
            fps: 30
        });
        console.log(`✅ Video created: ${OUTPUT_VIDEO}`);
    } catch (error) {
        console.error(`⚠️ Could not assemble video automatically: ${error.message}`);
        console.log('You can still run manually:');
        console.log(`ffmpeg -framerate 30 -i "${path.join(OUTPUT_DIR, '%05d.jpg')}" -c:v libx264 -pix_fmt yuv420p -y "${OUTPUT_VIDEO}"`);
    }
}

main().catch((err) => {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
});
