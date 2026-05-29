#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_URL = "https://bvb.ro/TradingAndStatistics/Trading/HistoricalTradingInfo.ashx";
const DATA_DIR = path.join("data", "bvb_weekly_snapshots");
const REPORTS_DIR = "reports";
const CONFIG_PATH = path.join("config", "bet_symbols.json");

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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

  return {
    source: "BVB HistoricalTradingInfo CSV",
    sourceUrl,
    sourceDay: day,
    createdAt: new Date().toISOString(),
    insecureSslFallback,
    rowCount: rows.length,
    betRowCount: instruments.length,
    instruments,
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

function percentClass(value) {
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "flat";
}

function renderRows(rows) {
  return rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.symbol)}</td>
        <td>${escapeHtml(row.name)}</td>
        <td class="num">${formatNumber(row.startClose)}</td>
        <td class="num">${formatNumber(row.endClose)}</td>
        <td class="num ${percentClass(row.performance)}">${formatPercent(row.performance)}</td>
      </tr>`,
    )
    .join("");
}

function buildReport(month) {
  const snapshots = loadSnapshots(month);
  if (snapshots.length < 2) {
    throw new Error(`Need at least two valid snapshots for ${month}; found ${snapshots.length}.`);
  }

  const startSnapshot = snapshots[0];
  const endSnapshot = snapshots[snapshots.length - 1];
  const rows = calculatePerformance(startSnapshot, endSnapshot);
  if (rows.length === 0) {
    throw new Error(`No overlapping BET symbols found for ${month}.`);
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
    <p><strong>Interval folosit:</strong> ${escapeHtml(startSnapshot.sourceDay)} - ${escapeHtml(endSnapshot.sourceDay)}.</p>
    <p><strong>Snapshoturi disponibile:</strong></p>
    <ul>${snapshotList}</ul>
  </div>

  <h2>Top 5 creșteri</h2>
  <table>
    <thead><tr><th>Simbol</th><th>Companie</th><th class="num">Start</th><th class="num">Final</th><th class="num">Performanță</th></tr></thead>
    <tbody>${renderRows(topRows)}</tbody>
  </table>

  <h2>Top 5 scăderi</h2>
  <table>
    <thead><tr><th>Simbol</th><th>Companie</th><th class="num">Start</th><th class="num">Final</th><th class="num">Performanță</th></tr></thead>
    <tbody>${renderRows(bottomRows)}</tbody>
  </table>

  <h2>Tabel complet BET</h2>
  <table>
    <thead><tr><th>Simbol</th><th>Companie</th><th class="num">Start</th><th class="num">Final</th><th class="num">Performanță</th></tr></thead>
    <tbody>${renderRows(rows)}</tbody>
  </table>

  <p class="small">Acest raport are scop informativ și nu reprezintă recomandare de investiții.</p>
</body>
</html>
`;

  fs.writeFileSync(reportPath, html, "utf8");
  return reportPath;
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
  } else {
    console.error("Usage:");
    console.error("  node scripts/bet-report.js snapshot [--day yyyymmdd]");
    console.error("  node scripts/bet-report.js report --month YYYY-MM");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
