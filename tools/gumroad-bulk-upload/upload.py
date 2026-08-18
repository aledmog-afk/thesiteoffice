#!/usr/bin/env python3
"""
Bulk-create/update Gumroad products from products.csv using the official
Gumroad CLI (https://github.com/antiwork/gumroad-cli).

Setup (one-time):
  1. Install the CLI:
       curl -fsSL https://gumroad.com/install-cli.sh | bash
     or: brew install antiwork/cli/gumroad
  2. Authenticate:
       gumroad auth login --no-input
  3. Fill in products.csv: sku,name,category,price_gbp,file_path
     - file_path is the LOCAL path to the file for that product (docx/zip/pdf).
     - Leave file_path blank for a row to skip it (nothing is uploaded until
       you fill it in) — lets you fill the CSV in gradually.
  4. Dry run first (default — nothing touches your Gumroad account):
       python3 upload.py
  5. When the plan looks right, actually run it:
       python3 upload.py --live

Safe to re-run: products already uploaded (recorded in upload_log.json) are
skipped, so you can fill in more rows and re-run without duplicating anything
already live on Gumroad.
"""
import argparse
import csv
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
CSV_PATH = HERE / "products.csv"
LOG_PATH = HERE / "upload_log.json"


def load_log():
    if LOG_PATH.exists():
        return json.loads(LOG_PATH.read_text())
    return {}


def save_log(log):
    LOG_PATH.write_text(json.dumps(log, indent=2))


def run_cli(args, live):
    cmd = ["gumroad", *args, "--json", "--no-input"]
    print("  $ " + " ".join(cmd))
    if not live:
        return {}
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"CLI command failed: {result.stderr.strip() or result.stdout.strip()}")
    out = result.stdout.strip()
    return json.loads(out) if out else {}


def slug(category):
    return category.strip().lower().replace(" & ", "-").replace(" ", "-") if category else ""


def process_row(row, log, live):
    sku = row["sku"].strip()
    name = row["name"].strip()
    category = row.get("category", "").strip()
    price = row["price_gbp"].strip()
    file_path = row.get("file_path", "").strip()

    if not file_path:
        print(f"[skip] {sku} — {name}: no file_path set yet")
        return
    if sku in log:
        print(f"[skip] {sku} — already uploaded (product id {log[sku]['id']})")
        return
    if not Path(file_path).exists():
        print(f"[error] {sku} — file not found: {file_path}")
        return

    print(f"[upload] {sku} — {name} (£{price})")

    created = run_cli(["products", "create", "--name", name, "--price", price], live)
    product_id = created.get("id") if live else "<dry-run-id>"

    run_cli(["products", "update", str(product_id), "--file", file_path], live)

    tag_args = ["--tag", slug(category)] if category else []
    run_cli(["products", "update", str(product_id), "--price", price, "--currency", "gbp", *tag_args], live)

    run_cli(["products", "publish", str(product_id)], live)

    if live:
        log[sku] = {"id": product_id, "name": name}
        save_log(log)
    print()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Actually call the Gumroad CLI (default is dry-run print-only)")
    args = parser.parse_args()

    if not CSV_PATH.exists():
        sys.exit(f"products.csv not found at {CSV_PATH}")

    log = load_log()
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))

    print(f"{len(rows)} rows in products.csv — {'LIVE run' if args.live else 'DRY RUN (pass --live to actually upload)'}\n")

    for row in rows:
        try:
            process_row(row, log, args.live)
        except Exception as e:
            print(f"[error] {row.get('sku')}: {e}\n")

    uploaded = sum(1 for r in rows if r["sku"] in log)
    pending = sum(1 for r in rows if not r.get("file_path", "").strip())
    print(f"Done. {uploaded} uploaded so far, {pending} rows still need a file_path.")


if __name__ == "__main__":
    main()
