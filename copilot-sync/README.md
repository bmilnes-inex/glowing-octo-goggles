# Copilot Money → OneDrive sync

Automates the manual CSV export you've been doing from Copilot Money. A local
script pulls transactions from Copilot's GraphQL endpoint (the same one the
web app uses) and writes `transactions.csv` into the BHM Finance project
folder in OneDrive, where the existing `import_copilot_csv.py` /
`import_copilot_to_snapshot.py` pipeline picks it up.

**Design choice: everything runs locally.** Transaction data and auth tokens
never touch GitHub — this repo only holds the (data-free) scripts.

```
Copilot Money (GraphQL) ──pull_copilot.py──▶ OneDrive\...\BHM - Investment Strategy\
                                               ├── transactions.csv      ◀── import_copilot_csv.py
                                               └── raw\transactions_<date>.json
Tokens: %APPDATA%\copilot-sync\auth.json   (local only, auto-rotated)
Schedule: Windows Task Scheduler, weekly   (Register-CopilotSync.ps1)
```

## 1. What you need

- Windows machine with OneDrive syncing the `BHM Finance` project folder
- Python 3.10+ (`python --version`) — script is stdlib-only, no pip installs
- A logged-in Copilot Money session at https://app.copilot.money

## 2. Caveat up front

Copilot has **no official API**. This rides the web app's private GraphQL
endpoint with your own session. It can break without notice if Copilot changes
their schema — section 4 shows the 2-minute fix when that happens. Your
fallback is always the manual CSV export from the Accounts page.

## 3. One-time setup: capture your Firebase credentials

Copilot's web app authenticates through Google Firebase. You need two values:

1. Open https://app.copilot.money and log in.
2. Open DevTools (F12) → **Network** tab. Filter requests for `securetoken`.
3. Wait for (or trigger, by refreshing the page) a request to
   `securetoken.googleapis.com/v1/token?key=...`
   - The `key=` query parameter is your **api_key**.
   - In the request payload, `refresh_token` is your **refresh_token**.
4. Create `%APPDATA%\copilot-sync\auth.json`:

```json
{
  "api_key": "AIza...",
  "refresh_token": "AMf-..."
}
```

The script exchanges the refresh token for a short-lived ID token on every
run and saves the rotated refresh token back, so this is a one-time capture
(unless you log out everywhere or change your password — then recapture).

> Treat `auth.json` like a password: it grants full access to your Copilot
> account. It lives under `%APPDATA%`, not OneDrive, deliberately.

## 4. First run + fixing the GraphQL query

```powershell
python pull_copilot.py --output-dir "$env:OneDrive\Brook @ INEX\Claude\PROJECTS\BHM Finance\BHM - Investment Strategy"
```

The script ships with a best-guess transactions query. **If Copilot's schema
differs you'll get a clear GraphQL error.** Fix:

1. In DevTools → Network, filter for `graphql` while scrolling the
   **Transactions** page in the app.
2. Find the request whose response contains transaction rows. Right-click →
   Copy → Copy request payload.
3. Paste it into `query.json` next to `pull_copilot.py` (it must contain
   `operationName`, `query`, `variables`). The script auto-detects pagination
   (`pageInfo.hasNextPage` / `endCursor`) and uses the override from then on.

Output columns match Copilot's own CSV export (`date, name, amount, status,
category, excluded, tags, type, account, account mask, note, recurring`), so
`import_copilot_csv.py` works unchanged.

## 5. Schedule it

```powershell
.\Register-CopilotSync.ps1 -OutputDir "$env:OneDrive\Brook @ INEX\Claude\PROJECTS\BHM Finance\BHM - Investment Strategy"
# test immediately:
Start-ScheduledTask -TaskName "Copilot Money Sync"
```

Default: Mondays 7:00 AM, runs even if the scheduled time was missed
(`-StartWhenAvailable`). Change with `-DayOfWeek` / `-At`.

## 6. After each pull (optional chain)

To rebuild the SQLite DB and push numbers into the Snapshot after every pull,
append to the scheduled task or run manually:

```powershell
python import_copilot_csv.py          # rebuilds copilot_finance.db
python import_copilot_to_snapshot.py  # refreshes the Snapshot xlsx
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `HTTP 400` from securetoken | refresh_token expired/revoked — recapture (section 3) |
| `GraphQL errors` | Schema drift — capture the real query (section 4) |
| `Output dir does not exist` | OneDrive path differs on this machine — check `$env:OneDrive` |
| Empty CSV | Check `raw\transactions_<date>.json` to see what came back |
