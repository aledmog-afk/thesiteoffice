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

Note: Gumroad limits new product *creation* to 10/day per account. Updating
or publishing an already-created product doesn't count against that limit —
only `products create` does. If you hit the daily cap partway through a run,
re-run the same command the next day; already-created rows are remembered
via RECOVERED_PRODUCT_IDS/upload_log.json and won't be recreated.
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
THUMBNAILS_DIR = Path.home() / "thumbnails"

# One-off recovery: these 10 products were successfully created by an
# earlier buggy run (which failed to read the new product's id back out of
# the `create` response, so the follow-up file/price/publish steps failed
# against a bad id). Reusing their real ids here avoids recreating them,
# which would burn more of the 10/day creation limit for no reason. Safe to
# delete this block once these rows show up in upload_log.json.
RECOVERED_PRODUCT_IDS = {
    "TSO-CC-001": "gll_jvcLx6SY3GqVUo-NiA==",
    "TSO-PCI-001": "K7Su97sRPLvyPhl52ew7fw==",
    "TSO-DR-001": "HQQ5Ns1E8LxQgpyUPgPIOA==",
    "TSO-EL-001": "swDdnKnwB5_LmSuOhEtA2A==",
    "TSO-SE-001": "ars0Ucu58-0I_RfRHrqGLA==",
    "TSO-PM-001": "b5Vcj3P1HQnREZDY32akkQ==",
    "TSO-PD-001": "Fje49tlqA4mkB7390d3Yrg==",
    "TSO-PS-001": "mO05DVpE-jphv-pnssF-kQ==",
    "TSO-BW-001": "dgxFSvUCzSQnG0z3h1fFsg==",
    "TSO-CP-001": "Bf1fq_gzMpO0PRxtA8xA4Q==",
}


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


def extract_product_id(response):
    """Gumroad's create response nests the new product under different
    possible keys depending on CLI version. Check them all rather than
    guessing one and silently proceeding with a bad id."""
    if not isinstance(response, dict):
        return None
    if response.get("id"):
        return response["id"]
    for key in ("product", "data"):
        nested = response.get(key)
        if isinstance(nested, dict) and nested.get("id"):
            return nested["id"]
    return None


CATEGORY_TAGS = {
    "CDM & Construction Phase": "cdm",
    "Commercial & Estimating": "commercial",
    "Quality & Environmental": "quality",
}


def slug(category):
    # Gumroad rejects tags over 20 characters
    if not category:
        return ""
    if category in CATEGORY_TAGS:
        return CATEGORY_TAGS[category]
    s = category.strip().lower().replace(" & ", "-").replace(" ", "-")
    return s[:20].rstrip("-")


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

    recovered_id = RECOVERED_PRODUCT_IDS.get(sku)
    if recovered_id:
        product_id = recovered_id
        print(f"  (reusing already-created product {product_id} — not calling 'create' again)")
    else:
        created = run_cli(["products", "create", "--name", name, "--price", price], live)
        if live:
            product_id = extract_product_id(created)
            if not product_id:
                raise RuntimeError(f"could not find new product id in create response: {json.dumps(created)}")
        else:
            product_id = "<dry-run-id>"

    run_cli(["products", "update", str(product_id), "--file", file_path], live)

    tag_args = ["--tag", slug(category)] if category else []
    run_cli(["products", "update", str(product_id), "--name", name, "--price", price, "--currency", "gbp", *tag_args], live)

    run_cli(["products", "publish", str(product_id)], live)

    if live:
        log[sku] = {"id": product_id, "name": name}
        save_log(log)
    print()


def enrich_row(row, log, live):
    """Apply description + cover image / thumbnail to an already-published
    product, without touching its file or re-publishing. Only acts on rows
    that already have a known Gumroad id (in upload_log.json) and have a
    description/thumbnail filled in in the CSV."""
    sku = row["sku"].strip()
    name = row["name"].strip()
    description = row.get("description", "").strip()
    thumbnail = row.get("thumbnail", "").strip()

    if sku not in log:
        print(f"[skip] {sku} — {name}: not uploaded yet, run without --enrich first")
        return
    if not description and not thumbnail:
        print(f"[skip] {sku} — {name}: no description/thumbnail in products.csv")
        return

    product_id = log[sku]["id"]
    image_path = THUMBNAILS_DIR / thumbnail if thumbnail else None
    if image_path and not image_path.exists():
        print(f"[error] {sku} — image not found: {image_path}")
        return

    print(f"[enrich] {sku} — {name}")
    args = ["products", "update", str(product_id)]
    if description:
        args += ["--description", description]
    if image_path:
        # --thumbnail requires a square image; our source images are 1280x720
        # widescreen (cover-image sized), so only --cover-image applies here.
        args += ["--cover-image", str(image_path)]
    run_cli(args, live)
    print()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="Actually call the Gumroad CLI (default is dry-run print-only)")
    parser.add_argument("--enrich", action="store_true", help="Apply description/cover image to already-published products instead of uploading new ones")
    args = parser.parse_args()

    if not CSV_PATH.exists():
        sys.exit(f"products.csv not found at {CSV_PATH}")

    log = load_log()
    with CSV_PATH.open(newline="") as f:
        rows = list(csv.DictReader(f))

    mode = "ENRICH" if args.enrich else ("LIVE" if args.live else "DRY RUN")
    print(f"{len(rows)} rows in products.csv — {mode} run\n")

    for row in rows:
        try:
            if args.enrich:
                enrich_row(row, log, args.live)
            else:
                process_row(row, log, args.live)
        except Exception as e:
            print(f"[error] {row.get('sku')}: {e}\n")

    if args.enrich:
        print("Done.")
    else:
        uploaded = sum(1 for r in rows if r["sku"] in log)
        pending = sum(1 for r in rows if r["sku"] not in log)
        print(f"Done. {uploaded} uploaded so far, {pending} rows still need attention.")


if __name__ == "__main__":
    main()
