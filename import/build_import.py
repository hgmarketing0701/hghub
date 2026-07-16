"""HG data import engine — xlsx → MySQL INSERT .sql files.

Usage:  python build_import.py
Reads:  C:\\Users\\User\\hg-migration-data\\sheets-data\\*.xlsx  (production export 2026-07-16)
        import/db-columns.tsv (target catalog dumped from the scratch DB)
        import/mapping.py (file/tab/column mapping registry)
Writes: import/out/data-<NN>-<slug>.sql (batched INSERTs, phpMyAdmin-importable)
        import/out/report.md (unmatched tabs/headers — must be empty before Phase 4 sign-off)

Rules (AI-HANDOFF §5): original string IDs preserved; dates normalized (openpyxl
returns datetimes for serial cells); JSON-string cells pass through as-is after
validation; empty cells → NULL. Audit tabs route to the shared audit_log with the
6/5/4-column variant mapping. Order of output files follows the module order so
masters land before transactions.
"""
import openpyxl, os, re, sys, json, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from mapping import FILES, AUDIT_VARIANTS, COLUMN_OVERRIDES

SRC = r"C:\Users\User\hg-migration-data\sheets-data"
OUT = os.path.join(HERE, "out")
CATALOG = os.path.join(HERE, "db-columns.tsv")
BATCH = 500

# ---------- catalog ----------
tables = {}    # table -> [cols in order]
coltypes = {}  # (table, col) -> data_type
colmaxlen = {} # (table, col) -> char max length (0 = n/a)
overlong = {}  # (table, col) -> max observed length exceeding the column
truncated = {} # (table, col) -> count of values truncated at 768 (junk beyond index-safe width)
with open(CATALOG, encoding="utf-8") as f:
    for line in f:
        t, c, dt, ml = line.rstrip("\n").split("\t")
        tables.setdefault(t, []).append(c)
        coltypes[(t, c)] = dt
        colmaxlen[(t, c)] = int(ml or 0)

def norm(s):
    """normalize a header or column name for matching: lowercase alnum only"""
    return re.sub(r"[^a-z0-9]", "", str(s).lower())

# ---------- value rendering ----------
def sql_escape(v):
    return v.replace("\\", "\\\\").replace("'", "''").replace("\n", "\\n").replace("\r", "")

def epoch_to_kl(n):
    """GAS stored Date.now() epoch numbers in some cells — convert to KL time."""
    if n > 1e12: n = n / 1000.0          # milliseconds
    return datetime.datetime.utcfromtimestamp(n) + datetime.timedelta(hours=8)

def render(v, dtype):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        if dtype in ("datetime", "date"): return "NULL"   # Excel TRUE/FALSE junk in date cells
        return "1" if v else "0"
    if isinstance(v, datetime.datetime):
        return "'" + v.strftime("%Y-%m-%d %H:%M:%S") + "'"
    if isinstance(v, datetime.date):
        return "'" + v.isoformat() + "'"
    if isinstance(v, datetime.time):
        return "'" + v.strftime("%H:%M:%S") + "'"
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
            return "NULL"
        if dtype in ("datetime", "date"):
            if v > 1e9:                                  # epoch seconds or ms
                dt = epoch_to_kl(float(v))
            elif 20000 < v < 80000:                      # Excel serial days
                dt = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(v))
            else:
                return "NULL"                            # junk numeric in a date column
            return "'" + (dt.strftime("%Y-%m-%d %H:%M:%S") if dtype == "datetime" else dt.date().isoformat()) + "'"
        s = repr(v)
        return s if dtype in ("decimal", "int", "bigint", "double", "float", "tinyint") else "'" + s + "'"
    s = str(v).strip()
    if s == "":
        return "NULL"
    # numeric targets: strip RM prefixes/commas quietly
    if dtype in ("decimal", "int", "bigint", "double", "float"):
        cleaned = re.sub(r"[RMrm,\s]", "", s)
        try:
            float(cleaned)
            return cleaned
        except ValueError:
            return "NULL"  # non-numeric junk in a numeric column
    if dtype == "date":
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
        if m: return "'" + m.group(0) + "'"
        try:
            return "'" + datetime.datetime.strptime(s[:10], "%d/%m/%Y").date().isoformat() + "'"
        except ValueError:
            return "NULL"
    if dtype == "datetime":
        if re.match(r"^\d{12,14}(\.0)?$", s):            # epoch ms as string
            return "'" + epoch_to_kl(float(s)).strftime("%Y-%m-%d %H:%M:%S") + "'"
        s2 = s.replace("T", " ").replace("Z", "")
        m = re.match(r"^\d{4}-\d{2}-\d{2}([ ]\d{2}:\d{2}(:\d{2})?)?", s2)
        if m:
            hit = m.group(0)
            if len(hit) == 10: hit += " 00:00:00"
            elif len(hit) == 16: hit += ":00"
            return "'" + hit + "'"
        return "NULL"
    if dtype == "tinyint":
        return "1" if s.lower() in ("true", "yes", "1", "y") else "0"
    return "'" + sql_escape(s) + "'"

# authoritative JSON columns: every json_valid() CHECK constraint in the schema
json_cols = set()
_jc = os.path.join(HERE, "db-jsoncols.tsv")
if os.path.exists(_jc):
    with open(_jc, encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) == 2:
                m = re.search(r"json_valid\(`([^`]+)`\)", parts[1])
                if m: json_cols.add((parts[0], m.group(1)))

def looks_like_json_col(table, col):
    return (table, col) in json_cols

# ---------- engine ----------
os.makedirs(OUT, exist_ok=True)
report = ["# Import build report", ""]
sql_files = []
total_rows = 0

def audit_map(variant, hdrs):
    """map an audit tab's headers onto the foundation audit_log columns"""
    cols = AUDIT_VARIANTS[variant]
    return "audit_log", cols

for fname in sorted(os.listdir(SRC)):
    if not fname.endswith(".xlsx"): continue
    spec = FILES.get(fname)
    if spec is None:
        report.append(f"- **UNMAPPED FILE**: {fname}"); continue
    if spec.get("skip_file"): continue

    wb = openpyxl.load_workbook(os.path.join(SRC, fname), read_only=True)
    slug = re.sub(r"\.xlsx$", "", fname)
    out_path = os.path.join(OUT, f"data-{slug}.sql")
    lines_out = [f"-- data import: {fname} (exported 2026-07-16)", "SET NAMES utf8mb4;",
                 "SET FOREIGN_KEY_CHECKS=0;"]
    file_rows = 0

    for ws in wb.worksheets:
        tab = ws.title
        if tab in (spec.get("skip") or []): continue
        target = (spec.get("overrides") or {}).get(tab)
        lookup_type = None
        if target and ":" in target:                       # ja_lookups:mall consolidation
            target, lookup_type = target.split(":", 1)
        if target is None:
            # default: prefix + snake(tab)
            guess = spec["prefix"] + re.sub(r"(?<!^)(?=[A-Z])", "_", tab).lower().replace(" ", "_").replace("__", "_")
            target = guess
        audit_variant = target if target in AUDIT_VARIANTS else None
        if audit_variant:
            target = "audit_log"
        if target not in tables:
            report.append(f"- **UNMAPPED TAB**: {fname} / {tab} → `{target}` (no such table)")
            continue

        ws.reset_dimensions()
        rows_iter = ws.iter_rows(values_only=True)
        try:
            hdr_raw = next(rows_iter)
        except StopIteration:
            continue
        hdrs = [str(h) if h is not None else "" for h in hdr_raw]
        while hdrs and hdrs[-1] == "": hdrs.pop()
        if not hdrs: continue

        # column resolution
        tcols = tables[target]
        tnorm = {norm(c): c for c in tcols}
        overrides = COLUMN_OVERRIDES.get(target, {})
        if audit_variant:
            variant_cols = AUDIT_VARIANTS[audit_variant]
            colmap = {}
            for i, h in enumerate(hdrs):
                colmap[i] = variant_cols[i] if i < len(variant_cols) else None
        else:
            colmap, unmatched = {}, []
            for i, h in enumerate(hdrs):
                if not h: colmap[i] = None; continue
                if h in overrides:
                    colmap[i] = None if overrides[h] == "-" else overrides[h]
                    continue
                hit = tnorm.get(norm(h))
                if hit: colmap[i] = hit
                else:
                    colmap[i] = None
                    if spec.get("dynamic_json") and "_json" in tcols:
                        pass  # folded into _json below — not an error
                    else:
                        unmatched.append(h)
            if unmatched:
                report.append(f"- unmatched headers: {fname} / {tab} → `{target}`: " + ", ".join(unmatched))
            # dedupe: two headers resolving to the same column keeps the FIRST
            seen_cols = set()
            for i in sorted(colmap.keys()):
                c = colmap[i]
                if c is None: continue
                if c in seen_cols:
                    report.append(f"- duplicate header dropped: {fname} / {tab}: '{hdrs[i]}' (col `{c}` already used)")
                    colmap[i] = None
                else:
                    seen_cols.add(c)

        if lookup_type:
            colmap = {0: "value"}

        used = [c for c in colmap.values() if c]
        if lookup_type:
            used = ["type", "value"]
        dyn = spec.get("dynamic_json") and "_json" in tcols and not audit_variant

        batch, n = [], 0
        for row in rows_iter:
            if row is None or not any(v is not None and str(v).strip() != "" for v in row):
                continue
            vals = {}
            extra = {}
            for i, v in enumerate(row[:len(hdrs)]):
                col = colmap.get(i)
                if col: vals[col] = v
                elif dyn and hdrs[i] and v is not None: extra[hdrs[i]] = v
            if lookup_type:
                vals = {"type": lookup_type, "value": row[0]}
                if vals["value"] is None or str(vals["value"]).strip() == "": continue
            if dyn:
                # merge stray headers into the _json payload
                j = vals.get("_json")
                base = {}
                if isinstance(j, str) and j.strip().startswith("{"):
                    try: base = json.loads(j)
                    except Exception: base = {}
                base.update({k: (str(v) if isinstance(v, (datetime.date, datetime.datetime)) else v) for k, v in extra.items()})
                if base: vals["_json"] = json.dumps(base, ensure_ascii=False, default=str)
            rendered = []
            for c in used:
                dtype = coltypes.get((target, c), "text")
                v = vals.get(c)
                if dtype == "varchar" and isinstance(v, str):
                    ml = colmaxlen.get((target, c), 0)
                    if ml and len(v) > ml:
                        k = (target, c)
                        overlong[k] = max(overlong.get(k, 0), len(v))
                        if len(v) > 512:  # beyond index-safe widening — truncate junk, log it
                            v = v[:512]
                            truncated[k] = truncated.get(k, 0) + 1
                if looks_like_json_col(target, c) and v is not None:
                    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
                        v = json.dumps(str(v))
                    elif isinstance(v, str):
                        if v.strip() == "": v = None
                        else:
                            try: json.loads(v)
                            except Exception: v = json.dumps(v, ensure_ascii=False)
                rendered.append(render(v, dtype))
            batch.append("(" + ",".join(rendered) + ")")
            n += 1
            if len(batch) >= BATCH:
                lines_out.append(f"REPLACE INTO `{target}` (`" + "`,`".join(used) + "`) VALUES\n" + ",\n".join(batch) + ";")
                batch = []
        if batch:
            lines_out.append(f"REPLACE INTO `{target}` (`" + "`,`".join(used) + "`) VALUES\n" + ",\n".join(batch) + ";")
        if n:
            lines_out.append(f"-- {tab}: {n} rows -> {target}")
            file_rows += n
    wb.close()
    lines_out.append("SET FOREIGN_KEY_CHECKS=1;")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out))
    sql_files.append((out_path, file_rows))
    total_rows += file_rows

widen = []
for (t, c), n in sorted(overlong.items()):
    # cap at VARCHAR(768): utf8mb4 index limit is 3072 bytes = 768 chars — longer values were truncated
    newdef = f"VARCHAR({min(512, ((n // 64) + 1) * 64)})"
    widen.append(f"ALTER TABLE `{t}` MODIFY `{c}` {newdef} NULL;")
with open(os.path.join(OUT, "00-widen.sql"), "w", encoding="utf-8") as f:
    f.write("-- widen columns that production data exceeds (auto-generated, index-safe)\n" + "\n".join(widen) + "\n")
if widen:
    report.append(f"- widened columns ({len(widen)}): see out/00-widen.sql")
for (t, c), n in sorted(truncated.items()):
    report.append(f"- TRUNCATED at 512 chars: {t}.{c} — {n} value(s) (junk beyond index-safe width)")

report.insert(2, f"Total rows rendered: {total_rows}")
with open(os.path.join(OUT, "report.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(report) + "\n")

print(f"rows={total_rows}")
for p, r in sql_files:
    print(f"  {os.path.basename(p)}: {r}")
issues = [l for l in report if l.startswith("- ")]
print(f"report issues: {len(issues)} (see out/report.md)")
