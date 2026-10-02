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
  // Verify ETF details parsing follows the current BVB price-header markup.
  const snapshot = report.parseEtfDetailsPage(`
    <html>
      <body>
        <div id="ctl00_body_HeaderControl_prices">
          <b class="value">61,8200</b><br />
          <span class="date small">24.07.2026 17:59:20</span>
        </div>
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

function testRenderedReportIncludesBvbEtfInformation() {
  // Verify the visible monthly report retains the BVB price, timestamp, source, and average.
  const snapshots = [
    { sourceDay: "20260807", etfSnapshot: { symbol: "TVBETETF", price: 56, priceTimestamp: "07.08.2026 17:59:00", sourceUrl: report.ETF_SOURCE_URL } },
    { sourceDay: "20260814", etfSnapshot: { symbol: "TVBETETF", price: 58, priceTimestamp: "14.08.2026 17:59:00", sourceUrl: report.ETF_SOURCE_URL } },
  ];
  const html = report.renderWebReport({
    month: "2026-08",
    created: "2026-09-01_12-59-06",
    hasSnapshots: false,
    snapshots: [],
    intervalUsed: "20260807 - 20260814",
    noDataMessage: "",
    rows: [],
    topRows: [],
    bottomRows: [],
    etfSection: report.buildEtfSectionData("2026-08", snapshots),
  });

  assert.match(html, /TVBETETF la BVB:<\/strong> 58,0000 lei\./);
  assert.match(html, /Data valorii ETF:<\/strong> 14\.08\.2026 17:59:00\./);
  assert.match(html, new RegExp(report.ETF_SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(`<a href="${report.ETF_SOURCE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener noreferrer">`));
  assert.match(html, /Media ETF in snapshot-urile lunii:<\/strong> 57,0000 lei \(2 observatii\)\./);
}

async function testWeeklySnapshotRequiresEtfValue() {
  // A weekly snapshot must fail before it can be saved when BVB does not yield an ETF value.
  const fetchBvbCsv = async () => ({
    url: "https://bvb.ro/example.csv",
    rows: [{ Symbol: "TLV", Name: "Banca Transilvania", Market: "REGS", Close: "30", "Ref. price": "30", Volume: "1", Value: "30" }],
    insecureSslFallback: false,
  });

  await assert.rejects(
    report.buildWeeklySnapshot("20260807", { fetchBvbCsv, fetchEtfSnapshot: async () => null }),
    /missing valid TVBETETF value from BVB/,
  );

  const snapshot = await report.buildWeeklySnapshot("20260807", {
    fetchBvbCsv,
    fetchEtfSnapshot: async () => ({
      symbol: "TVBETETF",
      price: 56.66,
      priceTimestamp: "07.08.2026 17:59:00",
      sourceUrl: report.ETF_SOURCE_URL,
    }),
  });
  assert.equal(snapshot.etfSnapshot.price, 56.66);
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

async function main() {
  // Run the lightweight unit checks that guard core report helpers.
  testParseCsv();
  testCalculatePerformance();
  testBuildEtfSection();
  testParseEtfDetailsPage();
  testRenderedReportIncludesBvbEtfInformation();
  testCalculateMonthlyAverageEtf();
  await testWeeklySnapshotRequiresEtfValue();
  console.log("Unit checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
