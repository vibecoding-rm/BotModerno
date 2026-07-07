#!/usr/bin/env python3
"""Migra phone_models (esquema legacy) -> phones (esquema nuevo) en Cloudflare D1.

- Elimina las tablas vacias del esquema viejo y aplica sql/schema_d1.sql.
- Transforma los datos: works 'Sí'/'No' -> 1/0, bands/provinces texto -> JSON array,
  nombre_comercial normalizado (minusculas, sin acentos), status segun approved.
- Deduplica por (nombre_comercial, model).
- NO toca phone_models (queda como respaldo historico en D1).

Uso: python scripts/migrate_d1.py  (lee CLOUDFLARE_ACCOUNT_TOKEN y CLOUDFLARE_ACCOUNT_ID de .env)
"""
import json
import re
import sys
import unicodedata
import urllib.request

ACC = "5066dd4f66b2d262852ebd852b6019a0"
DB = "f8cf0093-1f67-465b-b9bd-1a46029f6e9c"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACC}/d1/database/{DB}/query"


def load_token():
    with open(".env", encoding="utf-8") as f:
        for line in f:
            if line.startswith("CLOUDFLARE_ACCOUNT_TOKEN="):
                return line.split("=", 1)[1].strip()
    sys.exit("CLOUDFLARE_ACCOUNT_TOKEN no encontrado en .env")


TOKEN = load_token()


def q(sql, params=None):
    body = {"sql": sql}
    if params:
        body["params"] = params
    req = urllib.request.Request(
        API,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        d = json.load(r)
    if not d.get("success"):
        raise RuntimeError(f"D1 error: {d.get('errors')} -- SQL: {sql[:120]}")
    return d["result"]


def normalize(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def split_statements(sql_text):
    """Divide el SQL respetando bloques BEGIN...END de triggers."""
    stmts, buf, depth = [], [], 0
    for line in sql_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buf.append(line)
        if re.search(r"\bBEGIN\b", stripped, re.I):
            depth += 1
        if re.match(r"END\s*;", stripped, re.I):
            depth -= 1
            stmts.append("\n".join(buf))
            buf = []
            continue
        if depth == 0 and stripped.endswith(";"):
            stmts.append("\n".join(buf))
            buf = []
    if buf:
        stmts.append("\n".join(buf))
    return stmts


def main():
    # 1) Verificar respaldo local antes de dropear nada
    with open("backup/phone_models-2026-07-07.json", encoding="utf-8") as f:
        rows = json.load(f)["result"][0]["results"]
    assert len(rows) >= 378, f"Respaldo incompleto: {len(rows)} filas"
    print(f"Respaldo local OK: {len(rows)} filas de phone_models")

    # 2) Dropear tablas del esquema viejo (todas vacias o con datos de prueba)
    for t in ["phones", "submission_drafts", "reports", "subscriptions", "events", "bot_config"]:
        n = q(f"SELECT COUNT(*) AS n FROM {t}")[0]["results"][0]["n"]
        if t == "phones" and n > 0:
            sys.exit(f"ABORTADO: phones tiene {n} filas, no esperaba datos")
        q(f"DROP TABLE IF EXISTS {t}")
        print(f"DROP {t} (tenia {n} filas)")

    # 3) Aplicar esquema nuevo
    with open("sql/schema_d1.sql", encoding="utf-8") as f:
        schema = f.read()
    for stmt in split_statements(schema):
        q(stmt)
    print("Esquema nuevo aplicado")

    # 4) Transformar y migrar
    seen, migrated, dupes = set(), 0, []
    batch = []
    for r in rows:
        name = (r.get("commercial_name") or "").strip()
        if not name:
            dupes.append(("SIN NOMBRE", r.get("id")))
            continue
        model = (r.get("model") or "").strip().upper() or None
        norm = normalize(name)
        key = (norm, model or "")
        if key in seen:
            dupes.append((name, model))
            continue
        seen.add(key)
        works = 1 if (r.get("works") or "").strip().lower() in ("sí", "si", "yes", "1") else 0
        bands = json.dumps([b.strip() for b in (r.get("bands") or "").split(",") if b.strip()], ensure_ascii=False)
        provinces = json.dumps([p.strip() for p in (r.get("provinces") or "").split(",") if p.strip()], ensure_ascii=False)
        status = "approved" if r.get("approved") == 1 else "pending"
        obs = (r.get("notes") or "").strip() or None
        created = r.get("created_at") or None
        batch.append((name, model, works, bands, provinces, obs, status, norm, created))

    for i in range(0, len(batch), 25):
        chunk = batch[i:i + 25]
        for row in chunk:
            q(
                "INSERT INTO phones (commercial_name, model, works, bands, provinces, observations, status, nombre_comercial, created_at) "
                "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, COALESCE(?9, datetime('now')))",
                list(row),
            )
            migrated += 1
        print(f"  migradas {migrated}/{len(batch)}")

    # 5) Verificacion
    res = q("SELECT status, COUNT(*) n FROM phones GROUP BY status")[0]["results"]
    print("RESULTADO:", res)
    print(f"Migradas: {migrated} | Duplicadas/omitidas: {len(dupes)}")
    if dupes:
        print("Omitidas:", dupes[:15])


if __name__ == "__main__":
    main()
