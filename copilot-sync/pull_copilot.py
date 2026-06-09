#!/usr/bin/env python3
"""Pull transactions from Copilot Money into the BHM Finance OneDrive folder.

Copilot Money has no official public API. This script uses the same private
GraphQL endpoint the web app (https://app.copilot.money) uses, authenticated
with your own Firebase session. You capture two values once from your browser
(see README.md); after that the script refreshes its own tokens indefinitely.

Outputs (written to --output-dir, which should be your OneDrive project folder):
  transactions.csv                 - rolling export consumed by import_copilot_csv.py
  raw/transactions_<date>.json     - raw GraphQL response, kept for debugging/audit

Secrets live in %APPDATA%\\copilot-sync\\ (never in OneDrive, never in git).

Stdlib only - no pip installs needed.
"""

import argparse
import csv
import datetime as dt
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

GRAPHQL_URL = "https://app.copilot.money/api/graphql"
TOKEN_URL = "https://securetoken.googleapis.com/v1/token"

if sys.platform == "win32":
    import os
    DEFAULT_SECRETS_DIR = Path(os.environ.get("APPDATA", Path.home())) / "copilot-sync"
else:
    DEFAULT_SECRETS_DIR = Path.home() / ".config" / "copilot-sync"

# Default query pulls recent transactions. Copilot's schema is private and can
# change without notice; if this query 400s, copy the exact "operationName",
# "query" and "variables" the web app sends (DevTools > Network > graphql while
# scrolling the Transactions page) into query.json next to this script, and the
# script will use that instead. See README.md section 4.
DEFAULT_QUERY = {
    "operationName": "GetTransactions",
    "query": (
        "query GetTransactions($first: Int, $after: String) {\n"
        "  transactions(first: $first, after: $after) {\n"
        "    edges { node {\n"
        "      id date name amount status excluded note\n"
        "      category { id name }\n"
        "      account { id name mask }\n"
        "      tags { id name }\n"
        "      recurring { id name }\n"
        "    } }\n"
        "    pageInfo { hasNextPage endCursor }\n"
        "  }\n"
        "}"
    ),
    "variables": {"first": 500, "after": None},
}

# Column layout matches Copilot's own CSV export, which the existing
# import_copilot_csv.py pipeline already understands.
CSV_COLUMNS = [
    "date", "name", "amount", "status", "category", "excluded",
    "tags", "type", "account", "account mask", "note", "recurring",
]


def post_json(url: str, payload: dict, headers: dict | None = None,
              form: bool = False) -> dict:
    if form:
        body = "&".join(f"{k}={v}" for k, v in payload.items()).encode()
        content_type = "application/x-www-form-urlencoded"
    else:
        body = json.dumps(payload).encode()
        content_type = "application/json"
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", content_type)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:2000]
        raise SystemExit(f"HTTP {e.code} from {url}:\n{detail}")


def refresh_id_token(secrets_dir: Path) -> str:
    """Exchange the stored Firebase refresh token for a fresh ID token.

    Google rotates refresh tokens on use, so the new one is persisted back.
    """
    cfg_path = secrets_dir / "auth.json"
    if not cfg_path.exists():
        raise SystemExit(
            f"Missing {cfg_path}.\nCreate it with: "
            '{"api_key": "<FIREBASE_API_KEY>", "refresh_token": "<REFRESH_TOKEN>"}\n'
            "See README.md section 3 for how to capture these from your browser."
        )
    cfg = json.loads(cfg_path.read_text())
    data = post_json(
        f"{TOKEN_URL}?key={cfg['api_key']}",
        {"grant_type": "refresh_token", "refresh_token": cfg["refresh_token"]},
        form=True,
    )
    cfg["refresh_token"] = data["refresh_token"]
    cfg_path.write_text(json.dumps(cfg, indent=2))
    return data["id_token"]


def load_query(script_dir: Path) -> dict:
    override = script_dir / "query.json"
    if override.exists():
        return json.loads(override.read_text())
    return DEFAULT_QUERY


def find_transactions(obj):
    """Locate the transactions connection in the response without hardcoding
    the exact path, since the schema is unofficial."""
    if isinstance(obj, dict):
        if "edges" in obj and isinstance(obj["edges"], list):
            return obj
        for v in obj.values():
            found = find_transactions(v)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_transactions(v)
            if found is not None:
                return found
    return None


def node_to_row(node: dict) -> dict:
    def name_of(field):
        v = node.get(field)
        if isinstance(v, dict):
            return v.get("name", "")
        return v or ""

    tags = node.get("tags") or []
    return {
        "date": node.get("date", ""),
        "name": node.get("name", ""),
        "amount": node.get("amount", ""),
        "status": node.get("status", ""),
        "category": name_of("category"),
        "excluded": node.get("excluded", False),
        "tags": ",".join(t.get("name", "") for t in tags if isinstance(t, dict)),
        "type": node.get("type", ""),
        "account": name_of("account"),
        "account mask": (node.get("account") or {}).get("mask", "")
                        if isinstance(node.get("account"), dict) else "",
        "note": node.get("note", ""),
        "recurring": name_of("recurring"),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--output-dir", required=True,
                    help="OneDrive folder to write into, e.g. "
                         '"C:/Users/you/OneDrive/.../BHM - Investment Strategy"')
    ap.add_argument("--secrets-dir", default=str(DEFAULT_SECRETS_DIR),
                    help=f"Where auth.json lives (default: {DEFAULT_SECRETS_DIR})")
    ap.add_argument("--max-pages", type=int, default=20,
                    help="Safety cap on GraphQL pagination (default 20)")
    args = ap.parse_args()

    out_dir = Path(args.output_dir)
    if not out_dir.is_dir():
        raise SystemExit(f"Output dir does not exist: {out_dir}")
    secrets_dir = Path(args.secrets_dir)
    secrets_dir.mkdir(parents=True, exist_ok=True)

    print("Refreshing Firebase session...")
    id_token = refresh_id_token(secrets_dir)
    headers = {"Authorization": f"Bearer {id_token}"}

    query = load_query(Path(__file__).resolve().parent)
    rows, raw_pages, cursor = [], [], None
    for page in range(args.max_pages):
        q = json.loads(json.dumps(query))  # deep copy
        if cursor is not None and isinstance(q.get("variables"), dict):
            q["variables"]["after"] = cursor
        data = post_json(GRAPHQL_URL, q, headers=headers)
        if data.get("errors"):
            raise SystemExit(
                "GraphQL errors (the default query likely no longer matches "
                "Copilot's private schema - see README.md section 4 to capture "
                f"the real one):\n{json.dumps(data['errors'], indent=2)[:2000]}"
            )
        raw_pages.append(data)
        conn = find_transactions(data)
        if conn is None:
            raise SystemExit("No transactions connection found in response; "
                             "dump saved for inspection.")
        rows.extend(node_to_row(e["node"]) for e in conn["edges"] if e.get("node"))
        info = conn.get("pageInfo") or {}
        if not info.get("hasNextPage"):
            break
        cursor = info.get("endCursor")
        print(f"  page {page + 1}: {len(rows)} transactions so far...")

    today = dt.date.today().isoformat()
    raw_dir = out_dir / "raw"
    raw_dir.mkdir(exist_ok=True)
    (raw_dir / f"transactions_{today}.json").write_text(
        json.dumps(raw_pages, indent=1))

    csv_path = out_dir / "transactions.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Done: {len(rows)} transactions -> {csv_path}")
    print("Next step (optional): run import_copilot_csv.py to rebuild the "
          "SQLite DB and refresh the Snapshot.")


if __name__ == "__main__":
    main()
