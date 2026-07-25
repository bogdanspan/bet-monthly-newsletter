#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");

const report = require(path.resolve(__dirname, "bet-report.js"));

function testParseCsv() {
  // Verify the CSV parser keeps quoted commas and escaped quotes intact.
  const rows = report.parseCsv([
    'Symbol,Name,Close',
    'TLV,"BANCA, ""TRANSILVANIA""",38.64',
  ].join("\n"));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].Symbol, "TLV");
  assert.equal(rows[0].Name, 'BANCA, "TRANSILVANIA"');
  assert.equal(rows[0].Close, "38.64");
}

function testCalculatePerformance() {
  // Verify performance is calculated correctly and sorted from best to worst.
  const startSnapshot = {
    instruments: [
      { symbol: "TLV", name: "TLV", close: 10, value: 1000 },
      { symbol: "SNP", name: "SNP", close: 20, value: 2000 },
    ],
  };
  const endSnapshot = {
    instruments: [
      { symbol: "TLV", name: "TLV", close: 12, value: 1200 },
      { symbol: "SNP", name: "SNP", close: 18, value: 1800 },
    ],
  };

  const rows = report.calculatePerformance(startSnapshot, endSnapshot);
  assert.deepEqual(
    rows.slice(0, 2).map((row) => row.symbol),
    ["TLV", "SNP"],
  );
  assert.equal(Number(rows[0].performance.toFixed(2)), 20);
  assert.equal(Number(rows[1].performance.toFixed(2)), -10);
}

function testBuildEtfSection() {
  // Verify the ETF section exposes the HTML copy and machine-readable data attributes.
  const section = report.buildEtfSectionData("2026-05", []);

  assert.match(section.html, /TVBETETF la BVB/);
  assert.match(section.dataHtml, /data-etf-symbol="TVBETETF"/);
  assert.match(section.dataHtml, /data-etf-price="50\.5200"/);
}

function testParseEtfDetailsPage() {
  // Verify ETF details parsing extracts the last price and timestamp from the BVB details page.
  const snapshot = report.parseEtfDetailsPage(`
    <html>
      <body>
        <h2>FONDUL DESCHIS DE INVESTITII ETF BET PATRIA-TRADEVILLE</h2>
        61,8200
        24.07.2026 17:59:20
      </body>
    </html>
  `);

  assert.deepEqual(snapshot, {
    symbol: "TVBETETF",
    price: 61.82,
    priceTimestamp: "24.07.2026 17:59:20",
    sourceUrl: report.ETF_SOURCE_URL,
  });
}

function testCalculateMonthlyAverageEtf() {
  // Verify the monthly ETF average is computed from all snapshots that carry a usable ETF value.
  const average = report.calculateMonthlyAverageEtf([
    { etfSnapshot: { symbol: "TVBETETF", price: 50, priceTimestamp: "2026-05-01", sourceUrl: report.ETF_SOURCE_URL } },
    { trackedInstruments: [{ symbol: "TVBETETF", close: 52 }], sourceDay: "20260508" },
    { trackedInstruments: [{ symbol: "TLV", close: 30 }] },
  ]);

  assert.equal(Number(average.price.toFixed(2)), 51);
  assert.equal(average.sampleCount, 2);
}

function main() {
  // Run the lightweight unit checks that guard core report helpers.
  testParseCsv();
  testCalculatePerformance();
  testBuildEtfSection();
  testParseEtfDetailsPage();
  testCalculateMonthlyAverageEtf();
  console.log("Unit checks passed");
}

main();
