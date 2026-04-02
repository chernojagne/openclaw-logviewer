const express = require("express");
const fs = require("node:fs/promises");
const path = require("node:path");

const app = express();
const PORT = Number(process.env.PORT || 3780);
const HOST = process.env.HOST || "0.0.0.0";

const state = {
    mode: "auto",
    selectedPath: "",
    currentPath: "",
    uploadedContent: "",
    loadedAt: null,
    entries: []
};

app.use(express.json({ limit: "100mb" }));
app.use(express.static(path.join(__dirname, "../public")));

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function normalizeLevel(levelName) {
    if (!levelName) {
        return "UNKNOWN";
    }

    return String(levelName).toUpperCase();
}

function extractMessageParts(parsedLine) {
    const messageKeys = Object.keys(parsedLine)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b));

    return messageKeys.map((key) => parsedLine[key]);
}

function stringifyMessagePart(part) {
    if (part === null || part === undefined) {
        return "";
    }

    if (typeof part === "string") {
        return part;
    }

    return JSON.stringify(part);
}

function deriveSubsystem(nameValue) {
    if (!nameValue) {
        return "(none)";
    }

    if (typeof nameValue === "string" && nameValue.startsWith("{")) {
        const parsed = tryParseJson(nameValue);
        if (parsed && typeof parsed.subsystem === "string") {
            return parsed.subsystem;
        }
    }

    return String(nameValue);
}

function parseLine(lineText, lineNumber) {
    const parsed = tryParseJson(lineText);
    if (!parsed || typeof parsed !== "object") {
        return {
            id: lineNumber,
            lineNumber,
            parseError: true,
            raw: lineText,
            level: "UNKNOWN",
            logger: "unparsed",
            subsystem: "unparsed",
            timestamp: null,
            timestampMs: 0,
            message: lineText,
            messageParts: [lineText],
            meta: null
        };
    }

    const meta = parsed._meta || {};
    const messageParts = extractMessageParts(parsed);
    const message = messageParts.map(stringifyMessagePart).join(" ").trim();
    const timestamp = typeof parsed.time === "string" ? parsed.time : null;
    const timestampMs = timestamp ? Date.parse(timestamp) || 0 : 0;

    return {
        id: lineNumber,
        lineNumber,
        parseError: false,
        raw: lineText,
        level: normalizeLevel(meta.logLevelName),
        logger: String(meta.name || "unknown"),
        subsystem: deriveSubsystem(meta.name),
        runtime: meta.runtime || "",
        timestamp,
        timestampMs,
        message,
        messageParts,
        meta
    };
}

async function loadFromPath(filePath) {
    const text = await fs.readFile(filePath, "utf8");
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    const parsed = lines.map((line, index) => parseLine(line, index + 1));

    state.currentPath = filePath;
    state.loadedAt = new Date().toISOString();
    state.entries = parsed;

    return parsed;
}

async function loadFromContent(content, sourceLabel) {
    const text = String(content || "");
    const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
    const parsed = lines.map((line, index) => parseLine(line, index + 1));

    state.currentPath = String(sourceLabel || "uploaded-file");
    state.loadedAt = new Date().toISOString();
    state.entries = parsed;
    state.mode = "uploaded";
    state.selectedPath = "";
    state.uploadedContent = text;

    return parsed;
}

async function resolvePathToLoad(incomingPath) {
    if (incomingPath) {
        state.mode = "custom";
        state.selectedPath = incomingPath;
        return incomingPath;
    }

    if (state.mode === "custom" && state.selectedPath) {
        return state.selectedPath;
    }

    throw new Error("No log file loaded. Use the file picker to choose a log file.");
}

async function reloadCurrentSource(requestedPath) {
    const trimmedPath = requestedPath ? String(requestedPath).trim() : "";

    if (trimmedPath) {
        const pathToLoad = await resolvePathToLoad(trimmedPath);
        state.uploadedContent = "";
        return loadFromPath(pathToLoad);
    }

    if (state.mode === "uploaded" && state.uploadedContent) {
        return loadFromContent(state.uploadedContent, state.currentPath || "uploaded-file");
    }

    const pathToLoad = await resolvePathToLoad("");
    state.uploadedContent = "";
    return loadFromPath(pathToLoad);
}

function textIncludes(haystack, needle) {
    return String(haystack || "").toLowerCase().includes(String(needle || "").toLowerCase());
}

function buildSummary(entries) {
    const levels = {};
    const subsystems = {};
    const loggers = {};
    const timeBuckets = {};
    let parseErrors = 0;

    for (const entry of entries) {
        levels[entry.level] = (levels[entry.level] || 0) + 1;
        subsystems[entry.subsystem] = (subsystems[entry.subsystem] || 0) + 1;
        loggers[entry.logger] = (loggers[entry.logger] || 0) + 1;

        if (entry.timestampMs) {
            const bucketDate = new Date(entry.timestampMs);
            bucketDate.setUTCMinutes(0, 0, 0);
            const bucket = bucketDate.toISOString();
            if (!timeBuckets[bucket]) {
                timeBuckets[bucket] = {
                    count: 0,
                    debug: 0,
                    info: 0,
                    warn: 0,
                    error: 0,
                    parse: 0
                };
            }

            timeBuckets[bucket].count += 1;
            if (entry.parseError) {
                timeBuckets[bucket].parse += 1;
            } else if (entry.level === "DEBUG") {
                timeBuckets[bucket].debug += 1;
            } else if (entry.level === "INFO") {
                timeBuckets[bucket].info += 1;
            } else if (entry.level === "WARN") {
                timeBuckets[bucket].warn += 1;
            } else if (entry.level === "ERROR") {
                timeBuckets[bucket].error += 1;
            } else {
                // Keep stack totals consistent with overall bucket totals.
                timeBuckets[bucket].parse += 1;
            }
        }

        if (entry.parseError) {
            parseErrors += 1;
        }
    }

    const topSubsystems = Object.entries(subsystems)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));

    const topLoggers = Object.entries(loggers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, count }));

    const messagesByHour = Object.entries(timeBuckets)
        .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
        .map(([bucket, counts]) => ({
            bucket,
            count: counts.count,
            debug: counts.debug,
            info: counts.info,
            warn: counts.warn,
            error: counts.error,
            parse: counts.parse
        }));

    return {
        total: entries.length,
        parseErrors,
        levels,
        topSubsystems,
        topLoggers,
        messagesByHour
    };
}

function buildLast24HourBuckets(messagesByHour, anchorIso) {
    if (!anchorIso) {
        return [];
    }

    const anchor = new Date(anchorIso);
    if (Number.isNaN(anchor.getTime())) {
        return [];
    }

    const anchorHour = new Date(anchor);
    anchorHour.setUTCMinutes(0, 0, 0);

    const bucketMap = new Map(messagesByHour.map((x) => [x.bucket, x]));
    const result = [];

    for (let h = 23; h >= 0; h -= 1) {
        const slot = new Date(anchorHour);
        slot.setUTCHours(slot.getUTCHours() - h, 0, 0, 0);
        const iso = slot.toISOString();
        const found = bucketMap.get(iso);
        const month = String(slot.getUTCMonth() + 1).padStart(2, "0");
        const day = String(slot.getUTCDate()).padStart(2, "0");
        const hour = String(slot.getUTCHours()).padStart(2, "0");

        result.push({
            bucket: iso,
            hourLabel: `${month}-${day} ${hour}:00`,
            count: found ? found.count : 0,
            debug: found ? found.debug : 0,
            info: found ? found.info : 0,
            warn: found ? found.warn : 0,
            error: found ? found.error : 0,
            parse: found ? found.parse : 0
        });
    }

    return result;
}

function filterEntries(entries, query) {
    const q = query.q ? String(query.q).trim() : "";
    const levelFilters = Array.isArray(query.level)
        ? query.level.map((x) => String(x).toUpperCase()).filter(Boolean)
        : query.level
            ? [String(query.level).toUpperCase()]
            : [];
    const subsystemFilters = Array.isArray(query.subsystem)
        ? query.subsystem.map((x) => String(x).trim()).filter(Boolean)
        : query.subsystem
            ? [String(query.subsystem).trim()]
            : [];
    const logger = query.logger ? String(query.logger).trim() : "";
    const from = query.from ? Date.parse(String(query.from)) : NaN;
    const to = query.to ? Date.parse(String(query.to)) : NaN;

    return entries.filter((entry) => {
        if (levelFilters.length > 0 && !levelFilters.includes(entry.level)) {
            return false;
        }

        if (subsystemFilters.length > 0) {
            const anyMatch = subsystemFilters.some((sub) => textIncludes(entry.subsystem, sub));
            if (!anyMatch) {
                return false;
            }
        }

        if (logger && !textIncludes(entry.logger, logger)) {
            return false;
        }

        if (!Number.isNaN(from) && entry.timestampMs && entry.timestampMs < from) {
            return false;
        }

        if (!Number.isNaN(to) && entry.timestampMs && entry.timestampMs > to) {
            return false;
        }

        if (!q) {
            return true;
        }

        return (
            textIncludes(entry.message, q) ||
            textIncludes(entry.subsystem, q) ||
            textIncludes(entry.logger, q) ||
            textIncludes(entry.raw, q)
        );
    });
}

function sanitizeLimit(value, fallback) {
    const n = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(n) || n < 1) {
        return fallback;
    }
    return Math.min(n, 2000);
}

function sanitizeOffset(value) {
    const n = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(n) || n < 0) {
        return 0;
    }
    return n;
}

app.get("/api/config", (req, res) => {
    res.json({
        mode: state.mode,
        selectedPath: state.selectedPath,
        currentPath: state.currentPath,
        loadedAt: state.loadedAt,
        totalEntries: state.entries.length
    });
});

app.post("/api/logs/reload", async (req, res) => {
    try {
        const requestedPath = req.body && typeof req.body.path === "string" ? req.body.path.trim() : "";
        await reloadCurrentSource(requestedPath);

        res.json({
            ok: true,
            mode: state.mode,
            selectedPath: state.selectedPath,
            currentPath: state.currentPath,
            loadedAt: state.loadedAt,
            totalEntries: state.entries.length
        });
    } catch (error) {
        res.status(400).json({
            ok: false,
            error: String(error.message || error)
        });
    }
});

app.post("/api/logs/load-content", async (req, res) => {
    try {
        const content = req.body && typeof req.body.content === "string" ? req.body.content : "";
        const sourceLabel = req.body && typeof req.body.sourceLabel === "string"
            ? req.body.sourceLabel.trim()
            : "uploaded-file";

        if (!content.trim()) {
            throw new Error("Selected file is empty.");
        }

        await loadFromContent(content, sourceLabel || "uploaded-file");

        res.json({
            ok: true,
            mode: state.mode,
            selectedPath: state.selectedPath,
            currentPath: state.currentPath,
            loadedAt: state.loadedAt,
            totalEntries: state.entries.length
        });
    } catch (error) {
        res.status(400).json({
            ok: false,
            error: String(error.message || error)
        });
    }
});

app.get("/api/logs", (req, res) => {
    const filtered = filterEntries(state.entries, req.query);
    const summary = buildSummary(filtered);
    const queryWithoutSubsystem = { ...req.query };
    delete queryWithoutSubsystem.subsystem;
    const filteredForSubsystemList = filterEntries(state.entries, queryWithoutSubsystem);
    const subsystemSummary = buildSummary(filteredForSubsystemList);
    summary.topSubsystemsAll = subsystemSummary.topSubsystems;

    const latestFilteredTimestamp = filtered.reduce((maxTs, entry) => {
        if (!entry.timestampMs) {
            return maxTs;
        }
        return entry.timestampMs > maxTs ? entry.timestampMs : maxTs;
    }, 0);
    summary.chartDayAnchor = latestFilteredTimestamp ? new Date(latestFilteredTimestamp).toISOString() : null;
    summary.messagesByHourLast24 = buildLast24HourBuckets(summary.messagesByHour, summary.chartDayAnchor);

    const sort = String(req.query.sort || "desc").toLowerCase();
    const ordered = sort === "asc" ? [...filtered] : [...filtered].reverse();
    const limit = sanitizeLimit(req.query.limit, 300);
    const offset = sanitizeOffset(req.query.offset);
    const page = ordered.slice(offset, offset + limit);

    res.json({
        currentPath: state.currentPath,
        loadedAt: state.loadedAt,
        totalAll: state.entries.length,
        totalFiltered: filtered.length,
        offset,
        limit,
        summary,
        entries: page
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        currentPath: state.currentPath,
        loadedAt: state.loadedAt,
        entries: state.entries.length
    });
});

async function bootstrap() {
    app.listen(PORT, HOST, () => {
        console.log(`OpenClaw Log Viewer listening at http://${HOST}:${PORT}`);
    });
}

bootstrap();
