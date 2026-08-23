#!/usr/bin/env bash
# Reproduce the false-positive evaluation.
#
# Downloads public corpora of real prose, converts them to plain text, and runs
# numlint over the lot. The point of the exercise is the finding count: a linter
# for documents is only useful if it stays silent on documents that are fine.
set -euo pipefail

DEST="${1:-corpus}"
BASE="https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/corpora"
mkdir -p "$DEST/download" "$DEST/text"
cd "$DEST/download"

for c in reuters brown gutenberg state_union abc webtext inaugural; do
  [ -f "$c.zip" ] || curl -sSfL -o "$c.zip" "$BASE/$c.zip"
  [ -d "$c" ] || unzip -q -o "$c.zip"
  echo "have $c"
done

cd - >/dev/null
python3 "$(dirname "$0")/prep.py" "$DEST/download/reuters" "$DEST/text"
python3 "$(dirname "$0")/prep.py" "$DEST/download/brown" "$DEST/text"
for c in gutenberg state_union abc webtext inaugural; do
  python3 "$(dirname "$0")/prep.py" "$DEST/download/$c" "$DEST/text"
done

echo
echo "running numlint over $DEST/text"
node dist/eval/run.js "$DEST/text" "$DEST/findings.jsonl"
