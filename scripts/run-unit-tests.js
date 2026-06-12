#!/usr/bin/env node

const assert = require("node:assert/strict");
const path = require("node:path");

const report = require(path.resolve(__dirname, "bet-report.js"));

function testParseCsv() {
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
  const section = report.buildEtfSection("2026-05", []);

  assert.match(section.html, /TVBETETF la BVB/);
  assert.match(section.dataHtml, /data-etf-symbol="TVBETETF"/);
  assert.match(section.dataHtml, /data-etf-price="50\.5200"/);
}

function main() {
  testParseCsv();
  testCalculatePerformance();
  testBuildEtfSection();
  console.log("Unit checks passed");
}

main();
