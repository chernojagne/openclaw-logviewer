const PAGE_SIZE = 100;

const state = {
    entries: [],
    selectedId: null,
    showSourceLine: false,
    selectedSubsystems: [],
    selectedLevels: [],
    page: 0,
    totalFiltered: 0,
    lastQuery: {
        q: "",
        subsystem: "",
        logger: ""
    }
};

const refs = {
    refreshBtn: document.getElementById("refreshBtn"),
    loadPathBtn: document.getElementById("loadPathBtn"),
    fileInput: document.getElementById("fileInput"),
    sourceMeta: document.getElementById("sourceMeta"),
    searchInput: document.getElementById("searchInput"),
    clearSearchBtn: document.getElementById("clearSearchBtn"),
    levelPills: document.getElementById("levelPills"),
    statsCards: document.getElementById("statsCards"),
    timeChartCanvas: document.getElementById("timeChartCanvas"),
    topSubsystems: document.getElementById("topSubsystems"),
    resultCount: document.getElementById("resultCount"),
    pagingBar: document.getElementById("pagingBar"),
    entryList: document.getElementById("entryList"),
    detailPane: document.getElementById("detailPane")
};

let timeChartInstance = null;

function esc(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text) {
    const query = String(state.lastQuery.q || "").trim();
    const source = String(text || "");

    if (!query) {
        return esc(source);
    }

    const re = new RegExp(escapeRegExp(query), "ig");
    let result = "";
    let last = 0;

    source.replace(re, (match, offset) => {
        result += esc(source.slice(last, offset));
        result += `<mark class="hl">${esc(match)}</mark>`;
        last = offset + match.length;
        return match;
    });

    result += esc(source.slice(last));
    return result;
}

function levelBadge(level) {
    return `<span class="badge lvl-${esc(level)}">${esc(level)}</span>`;
}

function parseJsonSafe(value) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
}

function normalizeSubsystemLabel(subsystem) {
    return String(subsystem || "").trim().toLowerCase();
}

function subsystemIcon(subsystem) {
    const name = normalizeSubsystemLabel(subsystem);

    if (name.includes("gateway/ws")) return "🔌";
    if (name.includes("gateway/heartbeat")) return "💓";
    if (name.includes("gateway/health-monitor")) return "🩺";
    if (name.includes("gateway/hooks")) return "🪝";
    if (name.includes("gateway/channels/telegram")) return "✈️";
    if (name.includes("gateway/canvas")) return "🖼️";
    if (name.includes("bonjour")) return "📡";
    if (name.includes("cron")) return "⏱️";
    if (name.includes("browser/server")) return "🌐";
    if (name.includes("gateway")) return "🚪";
    if (name.includes("openclaw")) return "🦞";
    return "📄";
}

function subsystemTone(subsystem) {
    const name = normalizeSubsystemLabel(subsystem);

    if (name.includes("gateway/ws")) return "ws";
    if (name.includes("gateway/heartbeat")) return "heartbeat";
    if (name.includes("gateway/health-monitor")) return "health";
    if (name.includes("gateway/hooks")) return "hooks";
    if (name.includes("gateway/channels/telegram")) return "telegram";
    if (name.includes("gateway/canvas")) return "canvas";
    if (name.includes("bonjour")) return "bonjour";
    if (name.includes("cron")) return "cron";
    if (name.includes("browser/server")) return "browser";
    if (name.includes("gateway")) return "gateway";
    if (name.includes("openclaw")) return "openclaw";
    return "default";
}

function subsystemChip(subsystem) {
    return `<span class="subsystem-chip tone-${subsystemTone(subsystem)}"><span class="subsystem-icon">${subsystemIcon(subsystem)}</span>${esc(subsystem || "(none)")}</span>`;
}

function splitMessageParts(entry) {
    const parts = Array.isArray(entry.messageParts) ? entry.messageParts : [entry.message];
    return parts
        .map((part, index) => {
            const structured = typeof part === "object" ? part : parseJsonSafe(String(part || ""));
            return {
                index,
                text: typeof part === "string" ? part : JSON.stringify(part),
                structured
            };
        })
        .filter((x) => x.text !== undefined);
}

function chooseHeadline(parts, fallback) {
    for (const part of parts) {
        if (!part.text) {
            continue;
        }

        if (part.structured && part.structured.subsystem) {
            continue;
        }

        const trimmed = part.text.trim();
        if (trimmed) {
            return trimmed;
        }
    }

    return fallback || "(empty)";
}

function renderObjectTree(value) {
    if (value === null) {
        return `<span class="val-null">null</span>`;
    }

    if (value === undefined) {
        return `<span class="val-null">undefined</span>`;
    }

    if (typeof value === "string") {
        return `<span class="val-string">${highlightText(value)}</span>`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return `<span class="val-scalar">${esc(value)}</span>`;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return `<span class="val-null">[]</span>`;
        }

        return `
      <div class="tree-block">
        ${value
                .map(
                    (item, i) => `
            <div class="tree-row">
              <div class="tree-key">[${i}]</div>
              <div class="tree-val">${renderObjectTree(item)}</div>
            </div>
          `
                )
                .join("")}
      </div>
    `;
    }

    const keys = Object.keys(value);
    if (keys.length === 0) {
        return `<span class="val-null">{}</span>`;
    }

    return `
    <div class="tree-block">
      ${keys
            .map(
                (key) => `
          <div class="tree-row">
            <div class="tree-key">${esc(key)}</div>
            <div class="tree-val">${renderObjectTree(value[key])}</div>
          </div>
        `
            )
            .join("")}
    </div>
  `;
}

function formatDate(iso) {
    if (!iso) {
        return "n/a";
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return iso;
    }
    return d.toLocaleString();
}

function formatHourBucket(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return iso;
    }

    return d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatAxisHourLocal(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
        return iso;
    }

    return d.toLocaleString([], {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function renderTimeChart(summary) {
    const buckets = Array.isArray(summary.messagesByHourLast24)
        ? summary.messagesByHourLast24
        : Array.isArray(summary.messagesByHourFullDay)
            ? summary.messagesByHourFullDay
            : Array.isArray(summary.messagesByHour)
                ? summary.messagesByHour
                : [];

    if (timeChartInstance) {
        timeChartInstance.destroy();
        timeChartInstance = null;
    }

    if (buckets.length === 0 || typeof Chart === "undefined") {
        return;
    }

    const labels = buckets.map((b) => formatAxisHourLocal(b.bucket));
    const datasets = [
        { label: "Debug", data: buckets.map((b) => b.debug || 0), backgroundColor: "#5a9dff" },
        { label: "Info", data: buckets.map((b) => b.info || 0), backgroundColor: "#20c8a5" },
        { label: "Warn", data: buckets.map((b) => b.warn || 0), backgroundColor: "#ffbf3f" },
        { label: "Error", data: buckets.map((b) => b.error || 0), backgroundColor: "#ff667a" },
        { label: "Parse", data: buckets.map((b) => b.parse || 0), backgroundColor: "#9ea8b8" }
    ];

    timeChartInstance = new Chart(refs.timeChartCanvas, {
        type: "bar",
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "bottom",
                    labels: { boxWidth: 12, padding: 10, font: { size: 11 } }
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                    callbacks: {
                        title: (items) => items[0]?.label || "",
                        afterTitle: (items) => {
                            const total = items.reduce((s, i) => s + (i.raw || 0), 0);
                            return `Total: ${total}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        maxRotation: 45,
                        minRotation: 20,
                        autoSkip: true,
                        maxTicksLimit: 8,
                        font: { size: 10 }
                    },
                    grid: { display: false }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: { font: { size: 10 }, precision: 0 },
                    grid: { color: "rgba(130,146,128,0.15)" }
                }
            }
        }
    });
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {})
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Request failed");
    }
    return data;
}

async function loadConfig() {
    const response = await fetch("/api/config");
    return response.json();
}

function renderStats(summary) {
    const levels = summary.levels || {};
    refs.statsCards.innerHTML = [
        { label: "Total", value: summary.total || 0, cls: "card-total" },
        { label: "Errors", value: levels.ERROR || 0, cls: "card-error" },
        { label: "Warnings", value: levels.WARN || 0, cls: "card-warn" },
        { label: "Info", value: levels.INFO || 0, cls: "card-info" },
        { label: "Debug", value: levels.DEBUG || 0, cls: "card-debug" },
        { label: "Parse Errors", value: summary.parseErrors || 0, cls: "card-parse" }
    ]
        .map(
            (item) =>
                `<div class="card ${item.cls}"><div>${esc(item.label)}</div><div class="value">${esc(item.value)}</div></div>`
        )
        .join("");

    const topSubsystems = summary.topSubsystemsAll || summary.topSubsystems || [];
    const selectedSet = new Set(state.selectedSubsystems);

    refs.topSubsystems.innerHTML = topSubsystems
        .map((x) => {
            const name = x.name || "";
            const checked = selectedSet.has(name) ? "checked" : "";
            return `
                <li class="top-subsystem-item ${checked ? "selected" : ""}">
                    <label class="top-subsystem-label">
                        <input class="top-subsystem-checkbox" type="checkbox" data-subsystem="${esc(name)}" ${checked} />
                        ${subsystemChip(name)}
                        <span class="top-subsystem-count">${esc(x.count)}</span>
                    </label>
                </li>
            `;
        })
        .join("");

    refs.topSubsystems.querySelectorAll(".top-subsystem-checkbox").forEach((el) => {
        el.addEventListener("change", () => {
            const chosen = el.getAttribute("data-subsystem") || "";
            if (!chosen) {
                return;
            }

            if (el.checked) {
                if (!state.selectedSubsystems.includes(chosen)) {
                    state.selectedSubsystems.push(chosen);
                }
            } else {
                state.selectedSubsystems = state.selectedSubsystems.filter((x) => x !== chosen);
            }

            state.page = 0;
            queryLogs().catch((error) => {
                refs.sourceMeta.textContent = `Failed: ${error.message}`;
            });
        });
    });

    renderTimeChart(summary);
}

function renderLevelPills() {
    refs.levelPills.querySelectorAll(".level-pill").forEach((btn) => {
        const level = btn.getAttribute("data-level") || "";
        const active = level === "" ? state.selectedLevels.length === 0 : state.selectedLevels.includes(level);
        btn.classList.toggle("active", active);
    });
}

function renderDetail(entry) {
    if (!entry) {
        refs.detailPane.innerHTML = "<h3>Details</h3><p>Select an entry to inspect structured fields and source data.</p>";
        return;
    }

    const parts = splitMessageParts(entry);
    const headline = chooseHeadline(parts, entry.message);
    const structuredParts = parts.filter((x) => x.structured);
    const unstructuredParts = parts.filter((x) => !x.structured && String(x.text || "").trim());
    const rawStructured = parseJsonSafe(entry.raw);

    refs.detailPane.innerHTML = `
    <h3>Entry #${esc(entry.lineNumber)}</h3>
    <div class="kv"><b>Time:</b>${esc(formatDate(entry.timestamp))}</div>
    <div class="kv"><b>Level:</b>${levelBadge(entry.level)}</div>
    <div class="kv"><b>Subsystem:</b>${subsystemChip(entry.subsystem)}</div>
    <div class="kv"><b>Logger:</b>${esc(entry.logger)}</div>
    <div class="kv"><b>Headline:</b>${highlightText(headline)}</div>

    <h3>Structured Payload</h3>
    ${structuredParts.length
            ? structuredParts
                .map(
                    (part) => `
            <section class="payload-block">
              <div class="payload-title">Object part ${part.index + 1}</div>
              ${renderObjectTree(part.structured)}
            </section>
          `
                )
                .join("")
            : "<p class=\"muted-text\">No JSON object payload in message parts.</p>"}

    <h3>Text Fragments</h3>
    ${unstructuredParts.length
            ? `<ul class="text-frags">${unstructuredParts
                .map((part) => `<li>${highlightText(part.text)}</li>`)
                .join("")}</ul>`
            : "<p class=\"muted-text\">No plain text fragments.</p>"}

    <h3>Source Snapshot</h3>
    ${rawStructured ? renderObjectTree(rawStructured) : `<p class=\"muted-text\">Source line is not valid JSON.</p>`}

    <button id="toggleSourceBtn" class="btn source-toggle">${state.showSourceLine ? "Hide" : "Show"} Original Source Line</button>
        ${state.showSourceLine ? `<pre>${highlightText(entry.raw)}</pre>` : ""}
  `;

    const toggleBtn = document.getElementById("toggleSourceBtn");
    if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
            state.showSourceLine = !state.showSourceLine;
            renderDetail(entry);
        });
    }
}

function renderList() {
    refs.entryList.innerHTML = state.entries
        .map((entry) => {
            const activeClass = state.selectedId === entry.id ? "active" : "";
            const headline = chooseHeadline(splitMessageParts(entry), entry.message || "(empty)");
            return `
        <article class="entry ${activeClass}" data-entry-id="${entry.id}">
          <div class="entry-top">
            <span>${levelBadge(entry.level)}</span>
            <span>${esc(formatDate(entry.timestamp))}</span>
          </div>
          <div class="entry-top">
                        <span>${subsystemChip(entry.subsystem)}</span>
            <span>#${esc(entry.lineNumber)}</span>
          </div>
                                        <div class="entry-msg">${highlightText(headline)}</div>
        </article>
      `;
        })
        .join("");

    refs.entryList.querySelectorAll(".entry").forEach((el) => {
        el.addEventListener("click", () => {
            const id = Number(el.getAttribute("data-entry-id"));
            state.selectedId = id;
            state.showSourceLine = false;
            renderList();
            renderDetail(state.entries.find((x) => x.id === id));
        });
    });
}

function renderPaging() {
    const totalPages = Math.max(1, Math.ceil(state.totalFiltered / PAGE_SIZE));
    const currentPage = state.page;

    if (totalPages <= 1) {
        refs.pagingBar.innerHTML = "";
        return;
    }

    refs.pagingBar.innerHTML = `
        <button class="paging-btn" data-action="prev" ${currentPage === 0 ? "disabled" : ""}>&laquo; Prev</button>
        <span class="paging-info">Page ${currentPage + 1} of ${totalPages}</span>
        <button class="paging-btn" data-action="next" ${currentPage >= totalPages - 1 ? "disabled" : ""}>Next &raquo;</button>
    `;

    refs.pagingBar.querySelectorAll(".paging-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const action = btn.getAttribute("data-action");
            if (action === "prev" && state.page > 0) {
                state.page -= 1;
            } else if (action === "next" && state.page < totalPages - 1) {
                state.page += 1;
            }
            queryLogs().catch((error) => {
                refs.sourceMeta.textContent = `Failed: ${error.message}`;
            });
        });
    });
}

async function queryLogs() {
    const params = new URLSearchParams();
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(state.page * PAGE_SIZE));
    params.set("sort", "desc");

    if (state.lastQuery.q) params.set("q", state.lastQuery.q);
    if (state.selectedLevels.length > 0) {
        state.selectedLevels.forEach((level) => params.append("level", level));
    }
    if (state.selectedSubsystems.length > 0) {
        state.selectedSubsystems.forEach((sub) => params.append("subsystem", sub));
    }

    const response = await fetch(`/api/logs?${params.toString()}`);
    const data = await response.json();

    state.entries = data.entries || [];
    state.totalFiltered = data.totalFiltered || 0;
    if (!state.entries.find((x) => x.id === state.selectedId)) {
        state.selectedId = state.entries.length > 0 ? state.entries[0].id : null;
    }

    const pageStart = state.page * PAGE_SIZE + 1;
    const pageEnd = Math.min((state.page + 1) * PAGE_SIZE, state.totalFiltered);
    const pageLabel = state.totalFiltered > 0 ? `${pageStart}–${pageEnd} of ` : "";
    refs.resultCount.textContent = `${pageLabel}${data.totalFiltered} filtered / ${data.totalAll} total`;
    renderStats(data.summary || {});
    renderList();
    renderPaging();
    renderDetail(state.entries.find((x) => x.id === state.selectedId));

    const cfg = await loadConfig();
    refs.sourceMeta.textContent = `Mode: ${cfg.mode} | Loaded: ${formatDate(cfg.loadedAt)} | Current file: ${cfg.currentPath || "none"}`;
}

function bindFilters() {
    const apply = () => {
        state.lastQuery.q = refs.searchInput.value.trim();
        state.page = 0;
        refs.clearSearchBtn.classList.toggle("visible", state.lastQuery.q.length > 0);
        queryLogs().catch((error) => {
            refs.sourceMeta.textContent = `Failed: ${error.message}`;
        });
    };

    refs.searchInput.addEventListener("input", apply);

    refs.levelPills.querySelectorAll(".level-pill").forEach((btn) => {
        btn.addEventListener("click", () => {
            const level = btn.getAttribute("data-level") || "";
            if (!level) {
                state.selectedLevels = [];
            } else if (state.selectedLevels.includes(level)) {
                state.selectedLevels = state.selectedLevels.filter((x) => x !== level);
            } else {
                state.selectedLevels.push(level);
            }
            renderLevelPills();
            apply();
        });
    });

    refs.clearSearchBtn.addEventListener("click", () => {
        refs.searchInput.value = "";
        apply();
        refs.searchInput.focus();
    });
}

async function initialize() {
    bindFilters();
    renderLevelPills();

    refs.refreshBtn.addEventListener("click", async () => {
        try {
            await postJson("/api/logs/reload", {});
            await queryLogs();
        } catch (error) {
            refs.sourceMeta.textContent = `Reload failed: ${error.message}`;
        }
    });

    refs.loadPathBtn.addEventListener("click", async () => {
        if (!refs.fileInput) {
            refs.sourceMeta.textContent = "File picker not available in this browser.";
            return;
        }

        refs.fileInput.click();
    });

    refs.fileInput.addEventListener("change", async () => {
        const file = refs.fileInput.files && refs.fileInput.files[0] ? refs.fileInput.files[0] : null;
        if (!file) {
            return;
        }

        try {
            const content = await file.text();
            await postJson("/api/logs/load-content", {
                content,
                sourceLabel: file.name
            });
            await queryLogs();
        } catch (error) {
            refs.sourceMeta.textContent = `Load failed: ${error.message}`;
        } finally {
            refs.fileInput.value = "";
        }
    });

    refs.sourceMeta.textContent = "No log file loaded. Use the file picker to choose a log file.";
}

initialize();
