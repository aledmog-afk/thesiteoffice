# Gumroad bulk upload

Scripted product creation for Gumroad, using the official CLI
([antiwork/gumroad-cli](https://github.com/antiwork/gumroad-cli)) instead of
clicking through the web UI for every file.

## Setup

1. Install the CLI:
   ```
   curl -fsSL https://gumroad.com/install-cli.sh | bash
   ```
   or `brew install antiwork/cli/gumroad` on macOS.

2. Log in once:
   ```
   gumroad auth login --no-input
   ```

3. Open `products.csv`. It's pre-filled with the 49 products that are
   currently advertised on the live site but have no real Gumroad listing
   yet (cross-checked against the actual Gumroad product list on
   2026-08-18 — everything already for sale on Gumroad is excluded). Check
   these against what you actually intend to sell, fix anything wrong, and
   delete rows you don't want.

   Columns:
   - `sku` — your own reference code (kept local, not sent to Gumroad)
   - `name` — product title
   - `category` — used as a tag
   - `price_gbp` — price in pounds, e.g. `9.00`
   - `file_path` — **local path to the file for this product.** Leave blank
     to skip a row for now; fill it in whenever the file is ready and re-run.

4. Dry run (prints the commands it *would* run, touches nothing):
   ```
   python3 upload.py
   ```

5. When it looks right, run for real:
   ```
   python3 upload.py --live
   ```

Products are created as drafts, have the file attached, price/currency/tag
set, then published. Progress is recorded in `upload_log.json` — already-
uploaded rows are skipped on re-run, so you can add file paths gradually and
re-run the script instead of tracking by hand what's done.

6. Once a product is live on Gumroad, note its `gumroad.com/l/...` URL
   (from `upload_log.json` or the Gumroad dashboard) and update that
   product's card on the site — it currently shows a disabled
   "Coming Soon" button instead of "Buy Now" until that's done.

## Notes

- Products upload as-is from the CLI's defaults — no description, cover
  image, or custom sales page copy. Add those in the Gumroad dashboard after,
  or extend `upload.py` with `--description` / `--cover` once you decide on
  copy per product.
- This does not touch the website by itself — it only populates your
  Gumroad catalog. Step 6 above is what connects a newly created product
  back to its "Coming Soon" card on the site.
