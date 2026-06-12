#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const fixturesMonth = "2026-05";
const fixtureStamp = "2026-06-12_15-00-00";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bet-regression-"));
const docsDir = path.join(tempRoot, "docs");
const reportsDir = path.join(docsDir, "reports");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function calculateExpectedRows() {
  // Rebuild the expected ranking from archived fixtures instead of trusting generated HTML.
  const config = readJson(path.join(repoRoot, "config", "bet_symbols.json"));
  const trackedSymbols = config.symbols;
  const snapshots = [
    readJson(path.join(repoRoot, "data", "bvb_weekly_snapshots", "bvb_snapshot_20260522_created_2026-05-29_15-01-51.json")),
    readJson(path.join(repoRoot, "data", "bvb_weekly_snapshots", "bvb_snapshot_20260529_created_2026-05-30_09-29-12.json")),
  ];

  const startBySymbol = new Map(snapshots[0].instruments.map((item) => [item.symbol, item]));
  const endBySymbol = new Map(snapshots[1].instruments.map((item) => [item.symbol, item]));

  return trackedSymbols
    .map((symbol) => {
      const start = startBySymbol.get(symbol);
      const end = endBySymbol.get(symbol);
      if (!start || !end) return null;

      return {
        symbol,
        startClose: start.close,
        endClose: end.close,
        performance: ((end.close / start.close) - 1) * 100,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.performance - left.performance);
}

function extractTableRows(html, tableId) {
  // Extract rendered table cells so we can assert visible report content end-to-end.
  const tableMatch = html.match(new RegExp(`<table[^>]*id="${tableId}"[\\s\\S]*?<tbody>([\\s\\S]*?)<\\/tbody>`, "i"));
  assert.ok(tableMatch, `Missing table ${tableId}`);

  const rowMatches = [...tableMatch[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
  return rowMatches.map((rowMatch) => {
    const cellMatches = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
    return cellMatches.map((cell) => cell[1].replace(/<[^>]+>/g, "").trim());
  });
}

function run() {
  // Generate the report in a temp docs folder to avoid polluting the checked-in artifacts.
  fs.mkdirSync(reportsDir, { recursive: true });

  const env = {
    ...process.env,
    BET_DOCS_DIR: docsDir,
    BET_REPORTS_DIR: reportsDir,
    BET_NOW_STAMP: fixtureStamp,
  };

  execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts", "bet-report.js"), "report", "--month", fixturesMonth],
    { cwd: repoRoot, env, stdio: "pipe" },
  );

  const reportPath = path.join(reportsDir, `bet_monthly_performance_${fixturesMonth}_${fixtureStamp}.html`);
  const indexPath = path.join(docsDir, "index.html");
  assert.ok(fs.existsSync(reportPath), "Report file was not generated");
  assert.ok(fs.existsSync(indexPath), "Index file was not generated");

  const html = fs.readFileSync(reportPath, "utf8");
  const expectedRows = calculateExpectedRows();
  const fullTable = extractTableRows(html, "bet-full-table");
  const topTable = extractTableRows(html, "top-gainers");
  const losersTable = extractTableRows(html, "top-losers");

  // Check the main user-visible facts and rankings rendered into the report.
  assert.match(html, /Interval folosit:<\/strong> 20260522 - 20260529\./);
  assert.match(html, /TVBETETF la BVB:<\/strong> 50,5200 lei\./);
  assert.match(html, /data-etf-symbol="TVBETETF"/);
  assert.equal(fullTable.length, expectedRows.length, "Full table row count mismatch");
  assert.equal(topTable[0][0], expectedRows[0].symbol, "Top gainer symbol mismatch");
  assert.equal(losersTable[0][0], expectedRows[expectedRows.length - 1].symbol, "Top loser symbol mismatch");
  assert.equal(fullTable[0][0], expectedRows[0].symbol, "Full table first row should be highest performer");
  assert.equal(fullTable[fullTable.length - 1][0], expectedRows[expectedRows.length - 1].symbol, "Full table last row should be lowest performer");

  const indexHtml = fs.readFileSync(indexPath, "utf8");
  // Verify publish index generation still links to the newly created report file.
  assert.match(indexHtml, new RegExp(`reports/bet_monthly_performance_${fixturesMonth}_${fixtureStamp}\\.html`));

  console.log(`Regression report checks passed for ${reportPath}`);
}

try {
  run();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
