"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAirwayFile = parseAirwayFile;
exports.buildAirwaysDb = buildAirwaysDb;
exports.buildAirwaysCommand = buildAirwaysCommand;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ora_1 = __importDefault(require("ora"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const SCHEMA_SQL = `
DROP TABLE IF EXISTS direct_segments;
DROP TABLE IF EXISTS airways;
DROP TABLE IF EXISTS waypoints;
DROP VIEW IF EXISTS traversable_paths;
CREATE TABLE waypoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    UNIQUE(identifier, latitude, longitude)
);
CREATE TABLE airways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    level_type TEXT NOT NULL
);
CREATE TABLE direct_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    airway_id INTEGER NOT NULL,
    from_waypoint_id INTEGER NOT NULL,
    to_waypoint_id INTEGER NOT NULL,
    minimum_level INTEGER NOT NULL,
    can_traverse BOOLEAN NOT NULL,
    from_identifier TEXT NOT NULL,
    to_identifier TEXT NOT NULL,
    airway_name TEXT NOT NULL,
    FOREIGN KEY (airway_id) REFERENCES airways(id),
    FOREIGN KEY (from_waypoint_id) REFERENCES waypoints(id),
    FOREIGN KEY (to_waypoint_id) REFERENCES waypoints(id)
);
CREATE INDEX idx_waypoints_identifier ON waypoints(identifier);
CREATE INDEX idx_airways_name ON airways(name);
CREATE INDEX idx_segments_traversal ON direct_segments(airway_name, from_identifier, to_identifier);
CREATE INDEX idx_segments_airway ON direct_segments(airway_id);
CREATE INDEX idx_segments_from ON direct_segments(from_identifier, can_traverse);
CREATE INDEX idx_segments_to ON direct_segments(to_identifier, can_traverse);
CREATE VIEW traversable_paths AS
WITH RECURSIVE path AS (
    SELECT
        from_waypoint_id, to_waypoint_id, airway_id,
        from_identifier, to_identifier, minimum_level,
        minimum_level as max_level, 1 as depth
    FROM direct_segments WHERE can_traverse = 1
    UNION ALL
    SELECT
        p.from_waypoint_id, s.to_waypoint_id, p.airway_id,
        p.from_identifier, s.to_identifier, s.minimum_level,
        MAX(p.max_level, s.minimum_level), p.depth + 1
    FROM path p
    JOIN direct_segments s ON s.from_identifier = p.to_identifier
                         AND s.airway_id = p.airway_id
                         AND s.can_traverse = 1
    WHERE p.depth < 50
)
SELECT * FROM path;
`;
function normalizeLevel(s) {
    const c = s.charCodeAt(0);
    if (c === 66)
        return "B";
    if (c === 72)
        return "H";
    if (c === 76)
        return "L";
    return "U";
}
function parseFloatOrNaN(s) {
    if (!s)
        return NaN;
    return Number(s);
}
function parseIsec(buf, onProgress) {
    const map = new Map();
    let count = 0;
    let lineStart = 0;
    const len = buf.length;
    const text = buf.toString("utf8");
    for (let i = 0; i <= text.length; i++) {
        const c = i === text.length ? 10 : text.charCodeAt(i);
        if (c !== 10)
            continue;
        let lineEnd = i;
        if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13)
            lineEnd--;
        if (lineEnd > lineStart && text.charCodeAt(lineStart) !== 59) {
            const t1 = text.indexOf("\t", lineStart);
            if (t1 > -1 && t1 < lineEnd) {
                const t2 = text.indexOf("\t", t1 + 1);
                if (t2 > -1 && t2 < lineEnd) {
                    const t3Raw = text.indexOf("\t", t2 + 1);
                    const t3 = t3Raw === -1 || t3Raw > lineEnd ? lineEnd : t3Raw;
                    const ident = text.slice(lineStart, t1);
                    const lat = Number(text.slice(t1 + 1, t2));
                    const lon = Number(text.slice(t2 + 1, t3));
                    if (ident && Number.isFinite(lat) && Number.isFinite(lon)) {
                        const key = ident + "|" + lat + "|" + lon;
                        if (!map.has(key))
                            map.set(key, { ident, lat, lon });
                        count++;
                        if ((count & 16383) === 0)
                            onProgress(count);
                    }
                }
            }
        }
        lineStart = i + 1;
    }
    void len;
    onProgress(count);
    return map;
}
function findOrCreateSubnet(list, level, fromIdent, toIdent) {
    for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.level !== level)
            continue;
        if (s.fixToIdx.has(fromIdent) || s.fixToIdx.has(toIdent))
            return s;
    }
    const fresh = {
        level,
        fixToIdx: new Map(),
        fixes: [],
        segPairToIdx: new Map(),
        segments: [],
    };
    list.push(fresh);
    return fresh;
}
function addFixToSubnet(s, ident, lat, lon) {
    const existing = s.fixToIdx.get(ident);
    if (existing !== undefined)
        return existing;
    const idx = s.fixes.length;
    s.fixes.push({ ident, lat, lon });
    s.fixToIdx.set(ident, idx);
    return idx;
}
function addSegment(s, fromIdx, toIdx, minLevel, canTraverse) {
    if (fromIdx === toIdx)
        return;
    const key = fromIdx * 0x100000 + toIdx;
    const existing = s.segPairToIdx.get(key);
    if (existing !== undefined) {
        const seg = s.segments[existing];
        seg.canTraverse = canTraverse;
        seg.minLevel = minLevel;
        return;
    }
    s.segPairToIdx.set(key, s.segments.length);
    s.segments.push({ fromIdx, toIdx, minLevel, canTraverse });
}
function parseAirwayFile(text, onProgress) {
    const airwaysByName = new Map();
    let lineCount = 0;
    let lineStart = 0;
    const totalLen = text.length;
    for (let i = 0; i <= totalLen; i++) {
        const c = i === totalLen ? 10 : text.charCodeAt(i);
        if (c !== 10)
            continue;
        let lineEnd = i;
        if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13)
            lineEnd--;
        const firstChar = lineStart < lineEnd ? text.charCodeAt(lineStart) : 0;
        if (lineEnd <= lineStart || firstChar === 59) {
            lineStart = i + 1;
            continue;
        }
        const fields = [];
        let fStart = lineStart;
        for (let j = lineStart; j <= lineEnd; j++) {
            if (j === lineEnd || text.charCodeAt(j) === 9) {
                fields.push(text.slice(fStart, j));
                fStart = j + 1;
            }
        }
        if (fields.length < 11) {
            lineStart = i + 1;
            continue;
        }
        const mainId = fields[0];
        const mainLat = parseFloatOrNaN(fields[1]);
        const mainLon = parseFloatOrNaN(fields[2]);
        const airwayName = fields[4];
        const level = normalizeLevel(fields[5]);
        if (!mainId || !airwayName || !Number.isFinite(mainLat) || !Number.isFinite(mainLon)) {
            lineStart = i + 1;
            continue;
        }
        let list = airwaysByName.get(airwayName);
        if (!list) {
            list = [];
            airwaysByName.set(airwayName, list);
        }
        for (let n = 0; n < 2; n++) {
            const base = n === 0 ? 6 : 11;
            if (fields.length < base + 5)
                break;
            const nIdent = fields[base];
            if (!nIdent || nIdent === "N")
                continue;
            const nLat = parseFloatOrNaN(fields[base + 1]);
            const nLon = parseFloatOrNaN(fields[base + 2]);
            if (!Number.isFinite(nLat) || !Number.isFinite(nLon))
                continue;
            const minLevelStr = fields[base + 3];
            const minLevel = minLevelStr && minLevelStr !== "NESTB" ? Number(minLevelStr) || 0 : 0;
            const canTraverse = fields[base + 4] === "Y";
            const subnet = findOrCreateSubnet(list, level, mainId, nIdent);
            const fromIdx = addFixToSubnet(subnet, mainId, mainLat, mainLon);
            const toIdx = addFixToSubnet(subnet, nIdent, nLat, nLon);
            addSegment(subnet, fromIdx, toIdx, minLevel, canTraverse);
        }
        lineCount++;
        if (onProgress && (lineCount & 8191) === 0)
            onProgress(lineCount);
        lineStart = i + 1;
    }
    if (onProgress)
        onProgress(lineCount);
    return { airwaysByName, lineCount };
}
function buildAirwaysDb(opts) {
    const { airwayPath, isecPath, outputPath, silent } = opts;
    if (!fs_1.default.existsSync(airwayPath))
        throw new Error(`airway.txt not found: ${airwayPath}`);
    if (!fs_1.default.existsSync(isecPath))
        throw new Error(`isec.txt not found: ${isecPath}`);
    const startSpinner = (text) => {
        if (silent)
            return null;
        return (0, ora_1.default)(text).start();
    };
    const setText = (s, t) => {
        if (s)
            s.text = t;
    };
    const succeed = (s, t) => {
        if (s)
            s.succeed(t);
    };
    const isecSpin = startSpinner("Reading isec.txt");
    const isecBuf = fs_1.default.readFileSync(isecPath);
    setText(isecSpin, `Parsing isec.txt (${(isecBuf.length / 1048576).toFixed(1)} MB)`);
    const isecMap = parseIsec(isecBuf, (n) => setText(isecSpin, `Parsing isec.txt — ${n.toLocaleString()} waypoints`));
    succeed(isecSpin, `Parsed ${isecMap.size.toLocaleString()} ISEC waypoints`);
    const airwaySpin = startSpinner("Reading airway.txt");
    const airwayText = fs_1.default.readFileSync(airwayPath, "utf8");
    setText(airwaySpin, `Parsing airway.txt (${(airwayText.length / 1048576).toFixed(1)} MB)`);
    const { airwaysByName, lineCount } = parseAirwayFile(airwayText, (n) => setText(airwaySpin, `Parsing airway.txt — ${n.toLocaleString()} lines`));
    let subnetCount = 0;
    let segmentCount = 0;
    for (const list of airwaysByName.values()) {
        subnetCount += list.length;
        for (const s of list)
            segmentCount += s.segments.length;
    }
    succeed(airwaySpin, `Parsed ${lineCount.toLocaleString()} airway lines → ${subnetCount.toLocaleString()} airways, ${segmentCount.toLocaleString()} segments`);
    if (fs_1.default.existsSync(outputPath))
        fs_1.default.unlinkSync(outputPath);
    const dbSpin = startSpinner(`Writing ${path_1.default.basename(outputPath)}`);
    const db = new better_sqlite3_1.default(outputPath);
    db.pragma("journal_mode = OFF");
    db.pragma("synchronous = OFF");
    db.pragma("temp_store = MEMORY");
    db.pragma("cache_size = -65536");
    db.exec(SCHEMA_SQL);
    const insertWaypoint = db.prepare("INSERT OR IGNORE INTO waypoints (identifier, latitude, longitude) VALUES (?, ?, ?)");
    const selectWaypoint = db.prepare("SELECT id FROM waypoints WHERE identifier = ? AND latitude = ? AND longitude = ?");
    const insertAirway = db.prepare("INSERT INTO airways (name, level_type) VALUES (?, ?)");
    const insertSegment = db.prepare("INSERT INTO direct_segments (airway_id, from_waypoint_id, to_waypoint_id, minimum_level, can_traverse, from_identifier, to_identifier, airway_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const waypointIdCache = new Map();
    const getOrInsertWaypoint = (ident, lat, lon) => {
        const key = ident + "|" + lat + "|" + lon;
        const cached = waypointIdCache.get(key);
        if (cached !== undefined)
            return cached;
        const info = insertWaypoint.run(ident, lat, lon);
        let id;
        if (info.changes > 0) {
            id = Number(info.lastInsertRowid);
        }
        else {
            const row = selectWaypoint.get(ident, lat, lon);
            if (!row)
                throw new Error(`Failed to resolve waypoint id for ${ident}`);
            id = row.id;
        }
        waypointIdCache.set(key, id);
        return id;
    };
    let waypointsWritten = 0;
    let airwaysWritten = 0;
    let segmentsWritten = 0;
    const tx = db.transaction(() => {
        for (const wp of isecMap.values()) {
            const info = insertWaypoint.run(wp.ident, wp.lat, wp.lon);
            if (info.changes > 0) {
                waypointIdCache.set(wp.ident + "|" + wp.lat + "|" + wp.lon, Number(info.lastInsertRowid));
                waypointsWritten++;
            }
            if ((waypointsWritten & 16383) === 0 && waypointsWritten > 0) {
                setText(dbSpin, `Writing waypoints — ${waypointsWritten.toLocaleString()}`);
            }
        }
        for (const [name, list] of airwaysByName) {
            for (const subnet of list) {
                const aInfo = insertAirway.run(name, subnet.level);
                const airwayId = Number(aInfo.lastInsertRowid);
                airwaysWritten++;
                const fixIds = new Array(subnet.fixes.length);
                for (let i = 0; i < subnet.fixes.length; i++) {
                    const f = subnet.fixes[i];
                    fixIds[i] = getOrInsertWaypoint(f.ident, f.lat, f.lon);
                }
                for (const seg of subnet.segments) {
                    const fromFix = subnet.fixes[seg.fromIdx];
                    const toFix = subnet.fixes[seg.toIdx];
                    insertSegment.run(airwayId, fixIds[seg.fromIdx], fixIds[seg.toIdx], seg.minLevel, seg.canTraverse ? 1 : 0, fromFix.ident, toFix.ident, name);
                    segmentsWritten++;
                }
                if ((airwaysWritten & 1023) === 0) {
                    setText(dbSpin, `Writing airways — ${airwaysWritten.toLocaleString()}/${subnetCount.toLocaleString()}, segments ${segmentsWritten.toLocaleString()}`);
                }
            }
        }
    });
    tx();
    setText(dbSpin, "Running ANALYZE");
    db.exec("ANALYZE");
    db.close();
    succeed(dbSpin, `Wrote ${outputPath} — ${airwaysWritten.toLocaleString()} airways, ${segmentsWritten.toLocaleString()} segments`);
    return { waypoints: waypointsWritten, airways: airwaysWritten, segments: segmentsWritten };
}
async function buildAirwaysCommand(navDataPath, outputPath) {
    const stat = fs_1.default.existsSync(navDataPath) ? fs_1.default.statSync(navDataPath) : null;
    let airwayPath;
    let isecPath;
    if (stat && stat.isDirectory()) {
        airwayPath = path_1.default.join(navDataPath, "airway.txt");
        isecPath = path_1.default.join(navDataPath, "isec.txt");
    }
    else {
        throw new Error(`navDataPath must be a directory containing airway.txt and isec.txt: ${navDataPath}`);
    }
    // airways.db is Navigraph-derived and server-only (server-link addendum D44/A§11) — default lands next to the
    // NavData source, never inside a package, so it can't be swept up by `distribute`.
    const out = outputPath || path_1.default.join(navDataPath, "server-artifacts", "airways.db");
    fs_1.default.mkdirSync(path_1.default.dirname(out), { recursive: true });
    const t0 = Date.now();
    const result = buildAirwaysDb({ airwayPath, isecPath, outputPath: out });
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`Done in ${elapsed}s — ${result.waypoints.toLocaleString()} new waypoints, ${result.airways.toLocaleString()} airways, ${result.segments.toLocaleString()} segments`);
}
//# sourceMappingURL=build-airways.js.map