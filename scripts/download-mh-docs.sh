#!/usr/bin/env bash
# Descarga los documentos oficiales del MH (manuales, normativa, catálogos, esquemas, firmador)
# desde https://factura.gob.sv/informacion-tecnica-y-funcional/ a reference/mh-docs/.
set -euo pipefail
DEST="$(cd "$(dirname "$0")/.." && pwd)/reference/mh-docs"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36"
PAGINA="https://factura.gob.sv/informacion-tecnica-y-funcional/"
mkdir -p "$DEST" && cd "$DEST"
curl -sL -A "$UA" "$PAGINA" | grep -oiE "data-downloadurl=['\"][^'\"]+" | sed -E "s/data-downloadurl=['\"]//" | sort -u | while read -r url; do
  curl -sL -A "$UA" -e "$PAGINA" -OJ -w "%{http_code} %{filename_effective}\n" "$url"
done
