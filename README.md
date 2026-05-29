# BET monthly movement automation

This repository archives weekly BVB snapshots and generates monthly Romanian HTML reports for BET constituents.

## GitHub Actions

- `BET weekly BVB snapshot` runs every Saturday morning UTC and archives one BVB snapshot for the previous day.
- `BET monthly performance report` runs on the first day of each month and creates a timestamped HTML report in `reports/`.

The monthly report does not backfill BVB data. It uses snapshots already archived in `data/bvb_weekly_snapshots`, which keeps the workflow to about four BVB market-data requests per month.

## Manual runs

Fetch one snapshot:

```bash
node scripts/bet-report.js snapshot --day 20260528
```

Generate a report from archived snapshots:

```bash
node scripts/bet-report.js report --month 2026-05
```

## Notes

The report is informational and is not investment advice.
