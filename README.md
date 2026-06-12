# BET monthly movement automation

This repository archives weekly BVB snapshots and generates monthly Romanian HTML reports for BET constituents.

## GitHub Actions

- `BET weekly BVB snapshot` runs every Saturday morning UTC and archives one BVB snapshot for the previous day.
- `BET monthly performance report` runs on the first day of each month and creates a timestamped HTML report in `docs/reports/`.
- After the monthly report is generated and pushed, the same workflow can also send a monthly email via Resend when the email environment variables are configured in GitHub.

The monthly report does not backfill BVB data. It uses snapshots already archived in `data/bvb_weekly_snapshots`, which keeps the workflow to about four BVB market-data requests per month. The `docs/` folder is ready to be served with GitHub Pages.

## Manual runs

Fetch one snapshot:

```bash
node scripts/bet-report.js snapshot --day 20260528
```

Generate a report from archived snapshots:

```bash
node scripts/bet-report.js report --month 2026-05
```

Send the email for an existing report month:

```bash
node scripts/bet-report.js send-email --month 2026-05
```

## Email configuration

The monthly email feature uses the `resend` Node.js library and is disabled by default.

Required GitHub configuration:

- `RESEND_API_KEY` secret
- `MONTHLY_REPORT_EMAIL_FROM` variable
- `MONTHLY_REPORT_EMAIL_TO` variable, as a comma-separated list
- `MONTHLY_REPORT_EMAIL_ENABLED=true` variable

Optional:

- `MONTHLY_REPORT_SITE_URL` variable to override the public base URL used in the email link. The default is `https://bogdanspan.github.io/bet-monthly-newsletter`.

## Notes

The report is informational and is not investment advice.
