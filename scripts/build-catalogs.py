#!/usr/bin/env python3
"""Genera los catálogos (CAT-001..CAT-033) a partir del Excel oficial del MH.

Uso: python3 scripts/build-catalogs.py "reference/mh-docs/Catálogos - Facturación Electrónica.xlsx"
Salida: packages/dte/src/catalogs/data/{catalogs,actividades}.json
"""
import json, re, sys, unicodedata
from pathlib import Path
import openpyxl

OUT = Path(__file__).resolve().parent.parent / "packages/dte/src/catalogs/data"
PAD2 = {"002", "008", "009", "012", "013", "017", "018", "023", "025", "027", "031"}
DEPTOS = ["AHUACHAPAN", "SANTA ANA", "SONSONATE", "CHALATENANGO", "LA LIBERTAD", "SAN SALVADOR",
          "CUSCATLAN", "LA PAZ", "CABANAS", "SAN VICENTE", "USULUTAN", "SAN MIGUEL", "MORAZAN", "LA UNION"]

def norm(s):
    s = unicodedata.normalize("NFD", str(s).upper())
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()

def code(cat, v):
    if isinstance(v, float) and v.is_integer(): v = int(v)
    s = str(v).strip()
    return s.zfill(2) if cat in PAD2 and s.isdigit() else s

rows = [tuple(r[:2]) for r in openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True).worksheets[0].iter_rows(values_only=True)]
cats, cur, section = {}, None, None
for a, b in rows:
    m = re.match(r"^CAT-(\d{3})\s+(.*)$", str(a).strip()) if a else None
    if m and b is None:
        cur, section = m.group(1), None
        cats[cur] = {"id": f"CAT-{cur}", "nombre": m.group(2).strip(), "valores": []}
        continue
    if cur is None or (a is None and b is None): continue
    if a is not None and str(a).strip().upper() in ("CÓDIGO", "CODIGO"): continue
    if b is None:  # encabezado de sección dentro del catálogo (p. ej. CAT-015)
        sm = re.match(r"^(\d)-", str(a).strip())
        section = int(sm.group(1)) if sm else section
        continue
    if a is None: continue  # agrupadores de CAT-019 sin código
    item = {"codigo": code(cur, a), "valor": re.sub(r"\s+", " ", str(b)).strip()}
    if section is not None: item["seccion"] = section
    cats[cur]["valores"].append(item)

# CAT-014: la hoja trae llamadas a notas al pie pegadas al nombre ("Libra 1", "Otra 6").
for it in cats["014"]["valores"]:
    it["valor"] = re.sub(r"(?<=[a-záéíóúñ]) \d$", "", it["valor"])

# CAT-013: el código de municipio se repite entre departamentos; se deduce por el prefijo del nombre.
for it in cats["013"]["valores"]:
    if it["codigo"] == "00": it["departamento"] = "00"; continue
    n = norm(it["valor"])
    it["departamento"] = next(str(i + 1).zfill(2) for i, d in sorted(enumerate(DEPTOS), key=lambda x: -len(x[1])) if n.startswith(d))

# CAT-008: los distritos vienen en bloques por departamento (el correlativo reinicia en 01).
dep = 0
for it in cats["008"]["valores"]:
    if it["codigo"] == "00": it["departamento"] = "00"; continue
    if it["codigo"] == "01": dep += 1
    it["departamento"] = str(dep).zfill(2)
assert dep == 14, f"se esperaban 14 departamentos en CAT-008, hay {dep}"

actividades = cats.pop("019")
OUT.mkdir(parents=True, exist_ok=True)
(OUT / "catalogs.json").write_text(json.dumps({f"CAT-{k}": v for k, v in sorted(cats.items())}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
(OUT / "actividades.json").write_text(json.dumps(actividades, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
for k, v in sorted(cats.items()): print(f"CAT-{k} {len(v['valores']):4d}  {v['nombre']}")
print(f"CAT-019 {len(actividades['valores']):4d}  {actividades['nombre']}")
