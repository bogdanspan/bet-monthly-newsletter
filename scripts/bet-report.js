#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_URL = "https://bvb.ro/TradingAndStatistics/Trading/HistoricalTradingInfo.ashx";
const DATA_DIR = path.join("data", "bvb_weekly_snapshots");
const DOCS_DIR = "docs";
const REPORTS_DIR = path.join(DOCS_DIR, "reports");
const CONFIG_PATH = path.join("config", "bet_symbols.json");
const ETF_SYMBOL = "TVBETETF";
const ETF_SOURCE_URL = `https://m.bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=${ETF_SYMBOL}`;
const ETF_MONTH_OVERRIDES = {
  "2026-05": {
    symbol: ETF_SYMBOL,
    price: 50.52,
    priceTimestamp: "2026-05-29 17:50:06",
    sourceUrl: "https://bvb.ro/FinancialInstruments/Details/FinancialInstrumentsDetails.aspx?s=TVBETETF",
  },
};

function nowStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("-") + "_" + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("-");
}

function readSymbols() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return config.symbols;
}

function readTrackedSymbols() {
  return [...readSymbols(), ETF_SYMBOL];
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function reportTitleFromFilename(fileName) {
  const match = fileName.match(/^bet_monthly_performance_(\d{4}-\d{2})_(.+)\.html$/);
  if (!match) return fileName;
  return `Raport BET ${match[1]}`;
}

function buildPublicIndex() {
  ensureDir(REPORTS_DIR);
  const reportFiles = fs
    .readdirSync(REPORTS_DIR)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .reverse();

  const links = reportFiles.length
    ? reportFiles
        .map((file) => {
          const title = reportTitleFromFilename(file);
          return `<li><a href="reports/${escapeHtml(file)}">${escapeHtml(title)}</a><span>${escapeHtml(file)}</span></li>`;
        })
        .join("\n")
    : `<li><span>Nu există încă rapoarte publicate.</span></li>`;

  const content = `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BET monthly newsletter</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; color: #17202a; background: #f7f9fb; }
    main { max-width: 860px; margin: 0 auto; padding: 32px 18px 48px; }
    h1 { margin: 0 0 8px; color: #102a43; font-size: 30px; }
    p { margin: 0 0 18px; color: #52606d; }
    ul { list-style: none; padding: 0; margin: 20px 0 0; background: #fff; border: 1px solid #d9e2ec; }
    li { display: flex; gap: 12px; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid #d9e2ec; }
    li:last-child { border-bottom: 0; }
    a { color: #0b7285; font-weight: 700; text-decoration: none; }
    a:hover { text-decoration: underline; }
    span { color: #627d98; font-size: 13px; overflow-wrap: anywhere; }
    @media (max-width: 640px) {
      li { display: block; }
      span { display: block; margin-top: 4px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>BET monthly newsletter</h1>
    <p>Rapoarte HTML generate automat pentru companiile din indicele BET.</p>
    <ul>
      ${links}
    </ul>
  </main>
</body>
</html>
`;

  fs.writeFileSync(path.join(DOCS_DIR, "index.html"), content, "utf8");
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  return Number(String(value).replace(",", "."));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function fetchText(url, allowInsecureSsl = false) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { "User-Agent": "BET monthly report automation/1.0" },
      rejectUnauthorized: !allowInsecureSsl,
    };

    https
      .get(url, options, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode} from ${url}`));
            return;
          }
          resolve(body);
        });
      })
      .on("error", reject);
  });
}

async function fetchBvbCsv(day) {
  const url = `${BASE_URL}?day=${day}&type=s&filetype=csv&lang=en`;
  let insecureSslFallback = false;
  let text;

  try {
    text = await fetchText(url);
  } catch (error) {
    const certificateProblem =
      error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
      error.code === "CERT_HAS_EXPIRED" ||
      error.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      error.code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY";

    if (!certificateProblem) throw error;

    insecureSslFallback = true;
    text = await fetchText(url, true);
  }

  return { url, rows: parseCsv(text), insecureSslFallback };
}

function defaultSnapshotDay() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

function normalizeSnapshot(day, sourceUrl, rows, insecureSslFallback) {
  const betSymbols = new Set(readSymbols());
  const trackedSymbols = new Set(readTrackedSymbols());
  const instruments = rows
    .filter((row) => betSymbols.has(row.Symbol))
    .map((row) => ({
      symbol: row.Symbol,
      name: row.Name || "",
      market: row.Market || "",
      close: parseNumber(row.Close),
      refPrice: parseNumber(row["Ref. price"]),
      volume: parseNumber(row.Volume),
      value: parseNumber(row.Value),
    }));
  const trackedInstruments = rows
    .filter((row) => trackedSymbols.has(row.Symbol))
    .map((row) => ({
      symbol: row.Symbol,
      name: row.Name || "",
      market: row.Market || "",
      close: parseNumber(row.Close),
      refPrice: parseNumber(row["Ref. price"]),
      volume: parseNumber(row.Volume),
      value: parseNumber(row.Value),
    }));

  return {
    source: "BVB HistoricalTradingInfo CSV",
    sourceUrl,
    sourceDay: day,
    createdAt: new Date().toISOString(),
    insecureSslFallback,
    rowCount: rows.length,
    betRowCount: instruments.length,
    instruments,
    trackedInstruments,
  };
}

function saveSnapshot(snapshot) {
  ensureDir(DATA_DIR);
  const filePath = path.join(
    DATA_DIR,
    `bvb_snapshot_${snapshot.sourceDay}_created_${nowStamp()}.json`,
  );
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return filePath;
}

function loadSnapshots(month) {
  if (!fs.existsSync(DATA_DIR)) return [];
  const monthPrefix = month.replace("-", "");

  return fs
    .readdirSync(DATA_DIR)
    .filter((file) => file.startsWith("bvb_snapshot_") && file.endsWith(".json"))
    .map((file) => {
      const filePath = path.join(DATA_DIR, file);
      const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
      snapshot.sourceDay = snapshot.sourceDay || snapshot.source_day;
      snapshot.sourceUrl = snapshot.sourceUrl || snapshot.source_url;
      snapshot.betRowCount = snapshot.betRowCount ?? snapshot.bet_row_count;
      snapshot.rowCount = snapshot.rowCount ?? snapshot.row_count;
      snapshot.trackedInstruments = snapshot.trackedInstruments || snapshot.instruments || [];
      snapshot.filePath = filePath;
      return snapshot;
    })
    .filter((snapshot) => String(snapshot.sourceDay || "").startsWith(monthPrefix))
    .filter((snapshot) => Number(snapshot.betRowCount || 0) > 0)
    .sort((a, b) => String(a.sourceDay).localeCompare(String(b.sourceDay)));
}

function calculatePerformance(startSnapshot, endSnapshot) {
  const startBySymbol = new Map(startSnapshot.instruments.map((item) => [item.symbol, item]));
  const endBySymbol = new Map(endSnapshot.instruments.map((item) => [item.symbol, item]));

  return readSymbols()
    .map((symbol) => {
      const start = startBySymbol.get(symbol);
      const end = endBySymbol.get(symbol);
      if (!start || !end || !start.close || !end.close) return null;

      return {
        symbol,
        name: end.name || start.name || symbol,
        startClose: start.close,
        endClose: end.close,
        performance: ((end.close / start.close) - 1) * 100,
        endValue: end.value,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.performance - a.performance);
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value.toFixed(digits).replace(".", ",");
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`.replace(".", ",");
}

function formatDelta(value, digits = 4) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.abs(value), digits)}`;
}

function percentClass(value) {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "flat";
}

function parseReportMonthFromFilename(fileName) {
  const match = fileName.match(/^bet_monthly_performance_(\d{4}-\d{2})_(.+)\.html$/);
  return match ? match[1] : null;
}

function parseEtfSnapshotFromReport(reportPath) {
  const html = fs.readFileSync(reportPath, "utf8");
  const match = html.match(/<div class="etf-report-data"[^>]*data-etf-symbol="([^"]+)"[^>]*data-etf-price="([^"]+)"[^>]*data-etf-price-timestamp="([^"]+)"[^>]*data-etf-source-url="([^"]*)"[^>]*><\/div>/);
  if (!match) return null;

  return {
    symbol: match[1],
    price: Number(match[2]),
    priceTimestamp: match[3],
    sourceUrl: match[4],
  };
}

function loadPreviousEtfSnapshot(month) {
  if (!fs.existsSync(REPORTS_DIR)) return null;

  const previousFiles = fs
    .readdirSync(REPORTS_DIR)
    .filter((file) => file.endsWith(".html"))
    .map((file) => ({
      file,
      month: parseReportMonthFromFilename(file),
    }))
    .filter((entry) => entry.month && entry.month < month)
    .sort((a, b) => {
      const monthCompare = b.month.localeCompare(a.month);
      return monthCompare !== 0 ? monthCompare : b.file.localeCompare(a.file);
    });

  for (const entry of previousFiles) {
    const reportPath = path.join(REPORTS_DIR, entry.file);
    const snapshot = parseEtfSnapshotFromReport(reportPath);
    if (snapshot && snapshot.symbol === ETF_SYMBOL && Number.isFinite(snapshot.price)) {
      return snapshot;
    }
  }

  return null;
}

function extractEtfFromSnapshot(snapshot) {
  const instruments = snapshot?.trackedInstruments || [];
  const instrument = instruments.find((item) => item.symbol === ETF_SYMBOL && Number.isFinite(item.close));
  if (!instrument) return null;

  return {
    symbol: instrument.symbol,
    price: instrument.close,
    priceTimestamp: String(snapshot.sourceDay || ""),
    sourceUrl: snapshot.sourceUrl || ETF_SOURCE_URL,
  };
}

function resolveEtfSnapshot(month, snapshots) {
  const override = ETF_MONTH_OVERRIDES[month];
  if (override) return override;

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const etfSnapshot = extractEtfFromSnapshot(snapshots[index]);
    if (etfSnapshot) return etfSnapshot;
  }

  return null;
}

function buildEtfSection(month, snapshots) {
  const current = resolveEtfSnapshot(month, snapshots);
  if (!current) {
    return {
      html: `<p><strong>TVBETETF:</strong> valoarea nu a putut fi determinata pentru luna ${escapeHtml(month)}.</p>`,
      dataHtml: "",
    };
  }

  const previous = loadPreviousEtfSnapshot(month);
  let comparisonHtml = "<p><strong>Evolutie fata de luna trecuta:</strong> fara baza de comparatie.</p>";

  if (previous && previous.price) {
    const delta = current.price - previous.price;
    const deltaPercent = ((current.price / previous.price) - 1) * 100;
    comparisonHtml = `<p><strong>Evolutie fata de luna trecuta:</strong> <span class="${percentClass(delta)}">${escapeHtml(formatDelta(delta))} lei (${escapeHtml(formatPercent(deltaPercent))})</span>, fata de ${escapeHtml(formatNumber(previous.price))} lei.</p>`;
  }

  return {
    html: `
    <p><strong>TVBETETF la BVB:</strong> ${escapeHtml(formatNumber(current.price))} lei.</p>
    <p><strong>Data valorii ETF:</strong> ${escapeHtml(current.priceTimestamp)}.</p>
    <p><strong>Sursa ETF:</strong> <a href="${escapeHtml(current.sourceUrl)}">${escapeHtml(current.sourceUrl)}</a>.</p>
    ${comparisonHtml}`,
    dataHtml: `<div class="etf-report-data" data-etf-symbol="${escapeHtml(current.symbol)}" data-etf-price="${escapeHtml(current.price.toFixed(4))}" data-etf-price-timestamp="${escapeHtml(current.priceTimestamp)}" data-etf-source-url="${escapeHtml(current.sourceUrl)}"></div>`,
  };
}

function renderRows(rows) {
  return rows
    .map(
      (row) => `
      <tr>
        <td${useSortData ? ` data-sort-value="${escapeHtml(row.symbol)}"` : ""}>${escapeHtml(row.symbol)}</td>
        <td${useSortData ? ` data-sort-value="${escapeHtml(row.name)}"` : ""}>${escapeHtml(row.name)}</td>
        <td class="num"${useSortData ? ` data-sort-value="${escapeHtml(row.startClose)}"` : ""}>${formatNumber(row.startClose)}</td>
        <td class="num"${useSortData ? ` data-sort-value="${escapeHtml(row.endClose)}"` : ""}>${formatNumber(row.endClose)}</td>
        <td class="num ${percentClass(row.performance)}"${useSortData ? ` data-sort-value="${escapeHtml(row.performance)}"` : ""}>${formatPercent(row.performance)}</td>
      </tr>`,
    )
    .join("");
}

function renderTable(rows, options = {}) {
  const { sortable = false, tableClass = "", tableId = "" } = options;
  const headers = [
    { label: "Simbol", type: "text", className: "" },
    { label: "Companie", type: "text", className: "" },
    { label: "Start", type: "number", className: "num" },
    { label: "Final", type: "number", className: "num" },
    { label: "Performanță", type: "number", className: "num" },
  ];
  const tableAttributes = [
    tableId ? `id="${escapeHtml(tableId)}"` : "",
    tableClass ? `class="${escapeHtml(tableClass)}"` : "",
    sortable ? 'data-sortable="true"' : "",
  ]
    .filter(Boolean)
    .join(" ");
  const headHtml = headers
    .map((header, index) => {
      if (!sortable) {
        return `<th${header.className ? ` class="${header.className}"` : ""}>${header.label}</th>`;
      }

      const classes = [header.className, "sortable-column"].filter(Boolean).join(" ");
      return `<th class="${classes}" scope="col" aria-sort="none"><button type="button" class="sort-button" data-column-index="${index}" data-sort-type="${header.type}" data-direction="">${header.label}<span class="sort-indicator" aria-hidden="true"></span></button></th>`;
    })
    .join("");

  return `
  <table${tableAttributes ? ` ${tableAttributes}` : ""}>
    <thead><tr>${headHtml}</tr></thead>
    <tbody>${renderRows(rows, sortable)}</tbody>
  </table>`;
}

function sortingScript() {
  return `
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      const textCollator = new Intl.Collator("ro-RO", { sensitivity: "base" });
      const getCellValue = (row, columnIndex, sortType) => {
        const cell = row.children[columnIndex];
        if (!cell) return sortType === "number" ? 0 : "";

        const rawValue = cell.dataset.sortValue ?? cell.textContent ?? "";
        if (sortType === "number") {
          const numericValue = Number(rawValue);
          return Number.isNaN(numericValue) ? 0 : numericValue;
        }

        return rawValue;
      };

      document.querySelectorAll("table[data-sortable='true']").forEach((table) => {
        const tbody = table.querySelector("tbody");
        const buttons = table.querySelectorAll(".sort-button");
        if (!tbody || buttons.length === 0) return;

        buttons.forEach((button) => {
          button.addEventListener("click", () => {
            const columnIndex = Number(button.dataset.columnIndex);
            const sortType = button.dataset.sortType || "text";
            const nextDirection = button.dataset.direction === "asc" ? "desc" : "asc";
            const rows = Array.from(tbody.querySelectorAll("tr"));

            rows.sort((leftRow, rightRow) => {
              const leftValue = getCellValue(leftRow, columnIndex, sortType);
              const rightValue = getCellValue(rightRow, columnIndex, sortType);

              if (sortType === "text") {
                const comparison = textCollator.compare(leftValue, rightValue);
                return nextDirection === "asc" ? comparison : -comparison;
              }

              if (leftValue < rightValue) return nextDirection === "asc" ? -1 : 1;
              if (leftValue > rightValue) return nextDirection === "asc" ? 1 : -1;
              return 0;
            });

            rows.forEach((row) => tbody.appendChild(row));

            buttons.forEach((otherButton) => {
              const isActive = otherButton === button;
              const th = otherButton.closest("th");
              otherButton.dataset.direction = isActive ? nextDirection : "";
              if (th) {
                th.setAttribute("aria-sort", isActive ? nextDirection : "none");
              }
            });
          });
        });
      });
    });
  </script>`;
}

function buildReport(month) {
  const snapshots = loadSnapshots(month);
  const hasSnapshots = snapshots.length > 0;
  const startSnapshot = hasSnapshots ? snapshots[0] : null;
  const endSnapshot = hasSnapshots ? snapshots[snapshots.length - 1] : null;
  let rows = [];

  if (hasSnapshots) {
    rows = calculatePerformance(startSnapshot, endSnapshot);
    if (rows.length === 0) {
      throw new Error(`No overlapping BET symbols found for ${month}.`);
    }
  }

  const topRows = rows.slice(0, 5);
  const bottomRows = [...rows].sort((a, b) => a.performance - b.performance).slice(0, 5);
  const created = nowStamp();
  ensureDir(REPORTS_DIR);
  const reportPath = path.join(REPORTS_DIR, `bet_monthly_performance_${month}_${created}.html`);
  const snapshotList = snapshots
    .map(
      (snapshot) => `
      <li>
        ${escapeHtml(snapshot.sourceDay)}: ${escapeHtml(snapshot.betRowCount)} companii BET,
        sursa: <a href="${escapeHtml(snapshot.sourceUrl)}">${escapeHtml(snapshot.sourceUrl)}</a>
      </li>`,
    )
    .join("");

  const noDataMessage = hasSnapshots
    ? ""
    : `<p><strong>Nu exista snapshoturi valide pentru luna ${escapeHtml(month)}.</strong></p>`;
  const intervalUsed = hasSnapshots
    ? `${escapeHtml(startSnapshot.sourceDay)} - ${escapeHtml(endSnapshot.sourceDay)}`
    : "N/A";
  const snapshotListHtml = hasSnapshots
    ? `<ul>${snapshotList}</ul>`
    : "<p>Nu exista snapshoturi disponibile.</p>";
  const etfSection = buildEtfSection(month, snapshots);
  const performanceSections = hasSnapshots
    ? `
  <h2>Top 5 creșteri</h2>
  ${renderTable(topRows, { sortable: true, tableClass: "sortable-table top-table", tableId: "top-gainers" })}

  <h2>Top 5 scăderi</h2>
  ${renderTable(bottomRows, { sortable: true, tableClass: "sortable-table top-table", tableId: "top-losers" })}

  <h2>Tabel complet BET</h2>
  ${renderTable(rows, { sortable: true, tableClass: "sortable-table full-table", tableId: "bet-full-table" })}`
    : "";

  const html = `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <title>BET - performanță lunară ${escapeHtml(month)}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; color: #17202a; margin: 36px; line-height: 1.5; }
    h1 { margin: 0 0 6px; color: #102a43; }
    h2 { margin-top: 28px; color: #102a43; border-bottom: 1px solid #d9e2ec; padding-bottom: 6px; }
    .meta { padding: 12px 14px; margin: 16px 0; border-left: 4px solid #1f7a8c; background: #f5f8fb; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 14px; }
    th { background: #102a43; color: white; text-align: left; padding: 8px; }
    td { border-bottom: 1px solid #d9e2ec; padding: 7px 8px; vertical-align: top; }
    .sortable-column { padding: 0; }
    .sort-button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 700; padding: 8px; cursor: pointer; text-align: inherit; }
    .sort-button:hover { background: rgba(255, 255, 255, 0.08); }
    .sort-button:focus-visible { outline: 2px solid #9fb3c8; outline-offset: -2px; }
    .sort-indicator { width: 12px; flex: 0 0 12px; text-align: center; color: #d9e2ec; }
    .sort-button[data-direction="asc"] .sort-indicator::before { content: "\\25B2"; color: #ffffff; }
    .sort-button[data-direction="desc"] .sort-indicator::before { content: "\\25BC"; color: #ffffff; }
    .num { text-align: right; white-space: nowrap; }
    .gain { color: #0f7b45; font-weight: 700; }
    .loss { color: #b42318; font-weight: 700; }
    .flat { color: #52606d; font-weight: 700; }
    .small { color: #52606d; font-size: 13px; }
  </style>
</head>
<body>
  <h1>BET - performanță lunară ${escapeHtml(month)}</h1>
  <p class="small">Generat la ${escapeHtml(created)}</p>

  <div class="meta">
    <p><strong>Metodologie:</strong> raportul folosește snapshoturile BVB arhivate local. Performanța este calculată între cel mai vechi și cel mai recent snapshot valid al lunii.</p>
    <p><strong>Interval folosit:</strong> ${intervalUsed}.</p>
    <p><strong>Snapshoturi disponibile:</strong></p>
    ${snapshotListHtml}
    ${noDataMessage}
    ${etfSection.html}
    ${etfSection.dataHtml}
  </div>

  ${performanceSections}

  <p class="small">Acest raport are scop informativ și nu reprezintă recomandare de investiții.</p>
  ${sortingScript()}
</body>
</html>
`;

  fs.writeFileSync(reportPath, html, "utf8");
  buildPublicIndex();
  return reportPath;
}

function commandPublish() {
  ensureDir(REPORTS_DIR);
  buildPublicIndex();
  console.log(`Published reports to ${DOCS_DIR}`);
}

async function commandSnapshot(day) {
  const snapshotDay = day || defaultSnapshotDay();
  const result = await fetchBvbCsv(snapshotDay);
  const snapshot = normalizeSnapshot(
    snapshotDay,
    result.url,
    result.rows,
    result.insecureSslFallback,
  );
  const snapshotPath = saveSnapshot(snapshot);

  console.log(`Saved snapshot: ${snapshotPath}`);
  console.log(`BVB rows: ${snapshot.rowCount}; BET rows: ${snapshot.betRowCount}`);
  if (snapshot.betRowCount === 0) {
    console.warn("Warning: snapshot has no BET rows.");
  }
  if (snapshot.insecureSslFallback) {
    console.warn("Warning: used SSL verification fallback for BVB request.");
  }
}

function commandReport(month) {
  if (!month) throw new Error("Missing --month YYYY-MM");
  const reportPath = buildReport(month);
  console.log(`Saved report: ${reportPath}`);
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

async function main() {
  const command = process.argv[2];
  if (command === "snapshot") {
    await commandSnapshot(getArg("--day"));
  } else if (command === "report") {
    commandReport(getArg("--month"));
  } else if (command === "publish") {
    commandPublish();
  } else {
    console.error("Usage:");
    console.error("  node scripts/bet-report.js snapshot [--day yyyymmdd]");
    console.error("  node scripts/bet-report.js report --month YYYY-MM");
    console.error("  node scripts/bet-report.js publish");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
