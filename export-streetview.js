const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ============================================
// 🧑‍🎓 STUDENT TWEAKS (EDIT THIS BLOCK)
// ============================================

const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDf2b_bwfWvNMgMr2XZdTfbcXQHxWqux8A';
const KML_INPUT_CANDIDATES = ['points.kml'];

const OUTPUT_DIR = path.join(__dirname, 'output', 'streetview');
const OUTPUT_VIDEO = path.join(__dirname, 'video', 'streetview.mp4');

const IMAGE_SIZE = '640x300';
const FOV = 90;
const PITCH = 0;
const HEADING_OFFSET = 0;

const MIN_DISTANCE = 5;
const MAX_FRAMES = 200;
const DELAY_MS = 100;

// ============================================
// 🔒 WORKSHOP LOGIC (DON'T EDIT BELOW)
// ============================================

// ============================================
// 🔧 HELPER FUNCTIONS
// ============================================

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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

function downloadImage(url, outputPath) {
    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed: ${response.statusCode}`));
                return;
            }
            const fileStream = fs.createWriteStream(outputPath);
            response.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                resolve();
            });
            fileStream.on('error', reject);
        }).on('error', reject);
    });
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

function resolveKmlFile() {
    for (const fileName of KML_INPUT_CANDIDATES) {
        const fullPath = path.join(__dirname, fileName);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
    }

    return null;
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

// ============================================
// 🎥 MAIN EXECUTION
// ============================================

async function main() {
    const checkOnly = hasFlag('--check');
    const noVideo = hasFlag('--no-video');
    const limitArg = getArgValue('--limit');
    const maxFrames = limitArg ? Number(limitArg) : MAX_FRAMES;
    const kmlFile = resolveKmlFile();

    if (!Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 2000) {
        throw new Error(`Invalid --limit value: ${limitArg}. Use integer between 1 and 2000.`);
    }

    console.log('\n📷 STATIC CAMERA (KML) - Forward Facing View\n');
    console.log('Configuration:');
    console.log(`  KML file: ${kmlFile || '(not found)'}`);
    console.log(`  FOV: ${FOV}°`);
    console.log(`  Pitch: ${PITCH}°`);
    console.log(`  Heading: Route direction + ${HEADING_OFFSET}°`);
    console.log(`  Frames: ${maxFrames}`);
    console.log(`  Distance: ${MIN_DISTANCE}m between frames\n`);

    if (!kmlFile) {
        throw new Error('KML file not found: points.kml');
    }

    const kmlContent = fs.readFileSync(kmlFile, 'utf-8');
    const allPoints = parseKmlCoordinates(kmlContent);

    if (allPoints.length < 2) {
        throw new Error('KML needs at least 2 valid coordinates in <coordinates> tags.');
    }

    // Filter by distance
    const locations = [allPoints[0]];
    let lastPoint = allPoints[0];

    for (let i = 1; i < allPoints.length && locations.length < maxFrames; i++) {
        const current = allPoints[i];
        const distance = getDistance(lastPoint[1], lastPoint[0], current[1], current[0]);

        if (distance >= MIN_DISTANCE) {
            locations.push(current);
            lastPoint = current;
        }
    }

    console.log(`Total KML points: ${allPoints.length}`);
    console.log(`Filtered points: ${locations.length}\n`);

    if (checkOnly) {
        console.log('✅ KML check passed. Use without --check to download frames.');
        process.exit(0);
    }

    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    clearNumberedFrames(OUTPUT_DIR, 'jpg');

    for (let i = 0; i < locations.length; i++) {
        const [lon, lat] = locations[i];

        let heading = HEADING_OFFSET;
        if (i < locations.length - 1) {
            const [nextLon, nextLat] = locations[i + 1];
            heading = calculateBearing(lat, lon, nextLat, nextLon) + HEADING_OFFSET;
        }

        const url = `https://maps.googleapis.com/maps/api/streetview?` +
            `size=${IMAGE_SIZE}` +
            `&location=${lat},${lon}` +
            `&fov=${FOV}` +
            `&pitch=${PITCH}` +
            `&heading=${heading}` +
            `&key=${API_KEY}`;

        const outputPath = path.join(OUTPUT_DIR, `${String(i + 1).padStart(5, '0')}.jpg`);

        try {
            await downloadImage(url, outputPath);
            console.log(`✓ Frame ${i + 1}/${locations.length} - FOV:${FOV}° pitch:${PITCH}° heading:${Math.round(heading)}°`);
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        } catch (err) {
            console.error(`✗ Frame ${i + 1} failed:`, err.message);
        }
    }

    console.log(`\n✅ Done! Saved ${locations.length} frames to ${OUTPUT_DIR}`);

    if (noVideo) {
        console.log('\nVideo assembly skipped (--no-video).');
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
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
});
