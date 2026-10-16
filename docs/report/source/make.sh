set -e
cd "$(dirname "$0")"
mkdir -p out
export NODE_PATH=/usr/local/lib/node_modules_global
rm -f out/pages.json
for pass in 1 2 3; do
  node build.js out/report.docx out/pages.json >/dev/null
  (cd out && timeout 240 soffice --headless --convert-to pdf report.docx >/dev/null 2>&1)
  cp out/pages.json out/pages.prev.json 2>/dev/null || echo '{}' > out/pages.prev.json
  python3 pages.py out/report.pdf out/report.markers.json out/pages.json
  if cmp -s out/pages.json out/pages.prev.json; then echo "stable after pass $pass"; break; fi
done
pdfinfo out/report.pdf | grep Pages
