#!/usr/bin/env bash
# Rebuild the AI player documents in this directory.
#
#   docs/ai/build.sh            # all graphviz diagrams → SVG, all *.html → PDF
#
# Diagrams are rendered with `dot -Tsvg`; the HTML pages are printed with
# headless Google Chrome (page-margin boxes need Chrome ≥ 131). The older
# LaTeX documents (agents.tex, h2.tex) are not rebuilt here.
set -euo pipefail
cd "$(dirname "$0")"

for dot in h1-decision h1-evaluators bc-pipeline bc-net; do
  dot -Tsvg "$dot.dot" -o "$dot.svg"
done

CHROME=${CHROME:-google-chrome}
for page in heuristics-1 real-ai; do
  "$CHROME" --headless=new --disable-gpu --no-sandbox --no-pdf-header-footer \
    --print-to-pdf="$page.pdf" "file://$PWD/$page.html" 2>/dev/null
  echo "wrote $page.pdf ($(stat -c %s "$page.pdf") bytes)"
done
