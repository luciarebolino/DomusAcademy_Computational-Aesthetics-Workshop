#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

// ============================================
// 🧑‍🎓 STUDENT TWEAKS (EDIT THIS BLOCK)
// ============================================

const API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyDf2b_bwfWvNMgMr2XZdTfbcXQHxWqux8A';

const BBOX_COORDS = '12.4795,41.8986,12.5036,41.9124'; // Required format: "west,south,east,north" (example: "9.181279,45.467299,9.193945,45.475856")
const BBOX = parseBBoxCoords(BBOX_COORDS);

const PLACE_TYPES = ['restaurant'];

const OUTPUT_ROOT = path.join(__dirname, 'output', 'places_storefront_satellite');
const STOREFRONT_DIR = path.join(OUTPUT_ROOT, 'storefront');
const SATELLITE_DIR = path.join(OUTPUT_ROOT, 'satellite');

const GRID_COLS = 5;
const GRID_ROWS = 4;
const MAX_PLACES = 200;

const STOREFRONT_SIZE = '1024x1024';
const STOREFRONT_FOV = 72;
const STOREFRONT_PITCH = -3;
const STOREFRONT_HEADING_OFFSET = 0;

const SATELLITE_SIZE = '1024x1024';
const SATELLITE_ZOOM = 20;
const SATELLITE_MAPTYPE = 'satellite';

const REQUEST_DELAY_MS = 120;

// ============================================
// 🔒 WORKSHOP LOGIC (DON'T EDIT BELOW)
// ============================================

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

function parseBBoxCoords(raw) {
    const parts = raw.split(',').map((v) => Number(v.trim()));
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
        throw new Error('Invalid BBOX_COORDS. Expected format: "west,south,east,north".');
    }

    const [west, south, east, north] = parts;
    return { north, south, east, west };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
    for (const name of fs.readdirSync(dirPath)) {
        const full = path.join(dirPath, name);
        if (fs.statSync(full).isFile()) {
            fs.unlinkSync(full);
        }
    }
}

function toRadians(value) {
    return value * Math.PI / 180;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = toRadians(lon2 - lon1);
    const phi1 = toRadians(lat1);
    const phi2 = toRadians(lat2);

    const y = Math.sin(dLon) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);

    const bearing = Math.atan2(y, x) * 180 / Math.PI;
    return (bearing + 360) % 360;
}

function sanitizeFileName(name) {
    return name
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9\-_ ]+/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 70) || 'place';
}

function isInsideBBox(lat, lng, bbox) {
    return lat <= bbox.north && lat >= bbox.south && lng <= bbox.east && lng >= bbox.west;
}

function buildSearchGrid(bbox, cols, rows) {
    const points = [];
    for (let r = 0; r < rows; r++) {
        const tLat = rows === 1 ? 0.5 : r / (rows - 1);
        const lat = bbox.north - tLat * (bbox.north - bbox.south);

        for (let c = 0; c < cols; c++) {
            const tLng = cols === 1 ? 0.5 : c / (cols - 1);
            const lng = bbox.west + tLng * (bbox.east - bbox.west);
            points.push({ lat, lng });
        }
    }
    return points;
}

function estimateRadiusMeters(bbox, cols, rows) {
    const latStep = (bbox.north - bbox.south) / Math.max(1, rows - 1);
    const lngStep = (bbox.east - bbox.west) / Math.max(1, cols - 1);
    const centerLat = (bbox.north + bbox.south) / 2;
    const metersLat = haversineMeters(centerLat - latStep / 2, bbox.west, centerLat + latStep / 2, bbox.west);
    const metersLng = haversineMeters(centerLat, bbox.west - lngStep / 2, centerLat, bbox.west + lngStep / 2);
    const diagonalHalf = Math.sqrt(metersLat * metersLat + metersLng * metersLng) / 2;
    return Math.max(120, Math.min(50000, Math.round(diagonalHalf * 1.2)));
}

function httpGetBuffer(url) {
    return new Promise((resolve, reject) => {
        https
            .get(url, (response) => {
                if (response.statusCode !== 200) {
                    const status = response.statusCode;
                    response.resume();
                    reject(new Error(`HTTP ${status}`));
                    return;
                }

                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            })
            .on('error', reject);
    });
}

async function httpGetJson(url) {
    const buffer = await httpGetBuffer(url);
    try {
        return JSON.parse(buffer.toString('utf8'));
    } catch (error) {
        throw new Error(`Invalid JSON response: ${error.message}`);
    }
}

async function downloadToFile(url, filePath) {
    const buffer = await httpGetBuffer(url);
    fs.writeFileSync(filePath, buffer);
}

async function nearbySearch({ lat, lng, radius, type, pageToken }) {
    const params = new URLSearchParams({
        location: `${lat},${lng}`,
        radius: String(radius),
        key: API_KEY
    });

    if (type) params.set('type', type);
    if (pageToken) params.set('pagetoken', pageToken);

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    return httpGetJson(url);
}

async function findPlacesInBBox({ bbox, placeTypes, maxPlaces, cols, rows }) {
    const grid = buildSearchGrid(bbox, cols, rows);
    const radius = estimateRadiusMeters(bbox, cols, rows);

    console.log(`Grid points: ${grid.length} (${cols}x${rows})`);
    console.log(`Search radius per point: ${radius}m`);

    const unique = new Map();

    for (const type of placeTypes) {
        console.log(`\n🔎 Scanning type: ${type}`);

        for (let i = 0; i < grid.length; i++) {
            const g = grid[i];
            let pageToken = null;
            let page = 1;

            do {
                const data = await nearbySearch({
                    lat: g.lat,
                    lng: g.lng,
                    radius,
                    type,
                    pageToken
                });

                if (!['OK', 'ZERO_RESULTS'].includes(data.status)) {
                    throw new Error(`Nearby search failed (${type}, grid ${i + 1}): ${data.status}`);
                }

                if (Array.isArray(data.results)) {
                    for (const result of data.results) {
                        const loc = result.geometry && result.geometry.location;
                        if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
                        if (!isInsideBBox(loc.lat, loc.lng, bbox)) continue;

                        if (!unique.has(result.place_id)) {
                            unique.set(result.place_id, {
                                placeId: result.place_id,
                                name: result.name || 'Unnamed',
                                lat: loc.lat,
                                lng: loc.lng,
                                types: result.types || [],
                                rating: result.rating ?? null,
                                userRatingsTotal: result.user_ratings_total ?? null,
                                vicinity: result.vicinity || '',
                                sourceType: type
                            });
                        }

                        if (unique.size >= maxPlaces) {
                            return [...unique.values()];
                        }
                    }
                }

                pageToken = data.next_page_token || null;
                if (pageToken) {
                    await sleep(2200);
                    page += 1;
                }
            } while (pageToken);

            if ((i + 1) % 4 === 0 || i === grid.length - 1) {
                console.log(`  ✓ ${type}: grid ${i + 1}/${grid.length} | unique places: ${unique.size}`);
            }

            await sleep(REQUEST_DELAY_MS);
        }
    }

    return [...unique.values()];
}

function buildStorefrontUrl({ lat, lng }) {
    const params = new URLSearchParams({
        size: STOREFRONT_SIZE,
        location: `${lat},${lng}`,
        fov: String(STOREFRONT_FOV),
        pitch: String(STOREFRONT_PITCH),
        source: 'outdoor',
        return_error_code: 'true',
        key: API_KEY
    });
    return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

async function getStreetViewMetadata({ lat, lng }) {
    const params = new URLSearchParams({
        location: `${lat},${lng}`,
        source: 'outdoor',
        key: API_KEY
    });

    const url = `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`;
    const data = await httpGetJson(url);
    if (data.status !== 'OK' || !data.location) {
        return null;
    }

    return data.location;
}

async function buildStorefrontUrlForPlace(place) {
    const meta = await getStreetViewMetadata(place);

    let heading = null;
    if (meta && Number.isFinite(meta.lat) && Number.isFinite(meta.lng)) {
        heading = (calculateBearing(meta.lat, meta.lng, place.lat, place.lng) + STOREFRONT_HEADING_OFFSET + 360) % 360;
    }

    const params = new URLSearchParams({
        size: STOREFRONT_SIZE,
        location: `${place.lat},${place.lng}`,
        fov: String(STOREFRONT_FOV),
        pitch: String(STOREFRONT_PITCH),
        source: 'outdoor',
        return_error_code: 'true',
        key: API_KEY
    });

    if (heading !== null) {
        params.set('heading', heading.toFixed(1));
    }

    return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
}

function buildSatelliteUrl({ lat, lng }) {
    const params = new URLSearchParams({
        center: `${lat},${lng}`,
        zoom: String(SATELLITE_ZOOM),
        size: SATELLITE_SIZE,
        maptype: SATELLITE_MAPTYPE,
        key: API_KEY
    });
    return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

async function exportPlaceImages(places) {
    const manifest = [];

    for (let i = 0; i < places.length; i++) {
        const p = places[i];
        const rank = String(i + 1).padStart(4, '0');
        const base = `${rank}_${sanitizeFileName(p.name)}_${p.placeId.slice(0, 8)}`;

        const storefrontPath = path.join(STOREFRONT_DIR, `${base}.jpg`);
        const satellitePath = path.join(SATELLITE_DIR, `${base}.jpg`);

        let storefrontOk = false;
        let satelliteOk = false;
        let storefrontError = null;
        let satelliteError = null;

        try {
            const storefrontUrl = await buildStorefrontUrlForPlace(p);
            await downloadToFile(storefrontUrl, storefrontPath);
            storefrontOk = true;
        } catch (error) {
            storefrontError = error.message;
        }

        try {
            await downloadToFile(buildSatelliteUrl(p), satellitePath);
            satelliteOk = true;
        } catch (error) {
            satelliteError = error.message;
        }

        manifest.push({
            ...p,
            storefrontFile: storefrontOk ? path.relative(OUTPUT_ROOT, storefrontPath) : null,
            satelliteFile: satelliteOk ? path.relative(OUTPUT_ROOT, satellitePath) : null,
            storefrontError,
            satelliteError
        });

        console.log(`✓ ${i + 1}/${places.length} ${p.name} | storefront: ${storefrontOk ? 'ok' : 'fail'} | satellite: ${satelliteOk ? 'ok' : 'fail'}`);
        await sleep(REQUEST_DELAY_MS);
    }

    return manifest;
}

function validateConfig() {
    if (!API_KEY || typeof API_KEY !== 'string') {
        throw new Error('Missing GOOGLE_API_KEY.');
    }

    const bboxOk =
        Number.isFinite(BBOX.north) && Number.isFinite(BBOX.south) &&
        Number.isFinite(BBOX.east) && Number.isFinite(BBOX.west) &&
        BBOX.north > BBOX.south && BBOX.east > BBOX.west;

    if (!bboxOk) {
        throw new Error('Invalid BBOX. Ensure north > south and east > west.');
    }

    if (!Array.isArray(PLACE_TYPES) || PLACE_TYPES.length === 0) {
        throw new Error('PLACE_TYPES must include at least one Google place type.');
    }
}

async function main() {
    const checkOnly = hasFlag('--check');
    const limitArg = getArgValue('--limit');
    const maxPlaces = limitArg ? Number(limitArg) : MAX_PLACES;

    if (!Number.isInteger(maxPlaces) || maxPlaces < 1 || maxPlaces > 2000) {
        throw new Error(`Invalid --limit value: ${limitArg}. Use integer between 1 and 2000.`);
    }

    validateConfig();

    console.log('\n🏬 Places Storefront + Satellite Export\n');
    console.log(`Types: ${PLACE_TYPES.join(', ')}`);
    console.log(`BBox: N ${BBOX.north}, S ${BBOX.south}, E ${BBOX.east}, W ${BBOX.west}`);
    console.log(`Max places: ${maxPlaces}`);

    if (checkOnly) {
        console.log('✅ Check passed. Run without --check to export images.');
        process.exit(0);
    }

    clearDirectory(STOREFRONT_DIR);
    clearDirectory(SATELLITE_DIR);

    const places = await findPlacesInBBox({
        bbox: BBOX,
        placeTypes: PLACE_TYPES,
        maxPlaces,
        cols: GRID_COLS,
        rows: GRID_ROWS
    });

    if (places.length === 0) {
        console.log('\n⚠️ No places found in this bbox for selected types.');
        process.exit(0);
    }

    console.log(`\n📍 Found ${places.length} unique places inside bbox.`);

    const manifest = await exportPlaceImages(places);
    const okStorefront = manifest.filter((m) => m.storefrontFile).length;
    const okSatellite = manifest.filter((m) => m.satelliteFile).length;

    const manifestPath = path.join(OUTPUT_ROOT, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        bbox: BBOX,
        placeTypes: PLACE_TYPES,
        maxPlaces,
        totals: {
            places: manifest.length,
            storefrontOk: okStorefront,
            satelliteOk: okSatellite
        },
        items: manifest
    }, null, 2));

    console.log('\n✅ Export complete');
    console.log(`Storefront images: ${okStorefront}/${manifest.length}`);
    console.log(`Satellite images: ${okSatellite}/${manifest.length}`);
    console.log(`Manifest: ${manifestPath}\n`);
}

main().catch((err) => {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
});
