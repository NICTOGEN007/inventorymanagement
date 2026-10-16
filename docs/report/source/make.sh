set -e
cd "$(dirname "$0")"
# OUT=out/first-review REPORT_UPTO=methodology ./make.sh builds the first-review report.
O=${OUT:-out}
mkdir -p "$O"
export NODE_PATH=/usr/local/lib/node_modules_global
rm -f "$O"/pages.json
for pass in 1 2 3; do
  node build.js "$O"/report.docx "$O"/pages.json >/dev/null
  (cd "$O" && timeout 240 soffice --headless --convert-to pdf report.docx >/dev/null 2>&1)
  cp "$O"/pages.json "$O"/pages.prev.json 2>/dev/null || echo '{}' > "$O"/pages.prev.json
  python3 pages.py "$O"/report.pdf "$O"/report.markers.json "$O"/pages.json
  if cmp -s "$O"/pages.json "$O"/pages.prev.json; then echo "stable after pass $pass"; break; fi
done
pdfinfo "$O"/report.pdf | grep Pages
