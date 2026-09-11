import re, json, sys
from collections import defaultdict

SRC = "nerdc_full.txt"
with open(SRC, encoding="utf-8") as f:
    raw_lines = f.read().split("\n")

SCHEME_SUFFIX_RE = re.compile(r'\s+SCHEME OF WOR[K]?\s*$', re.I)
CLASS_CODE_RE = re.compile(r'^(JSS|SSS|SS)\s*([123])\b', re.I)
TERM_RE = re.compile(r'\b(FIRST|SECOND|THIRD)\s+TERM\b', re.I)
WEEK_HEADER_RE = re.compile(r'^\s*WEEK\b', re.I)
ROW_START_RE = re.compile(r'^(\s{0,6})(\d+(?:\s*[\u2013\u2014-]\s*\d+)?)\.?\s+(.*)$')
NOISE_RE = re.compile(
    r'GET ACCESS TO MORE EDUCATIONAL RESOURCES|NIGERIA NEW EDUCATION|CURRICULUM, 2025|'
    r'NIGERIAN EDUCATIONAL RESEARCH|EDUCATIONAL RESOURCES ARCHIVE|Educational Resources|'
    r'Scheme of Works|Lesson Notes|E-Learning|WAEC Past|JAMB-UTME|CLICK HERE|TABLE OF CONTENT|'
    r'School Management|School Administrative|Exam Question Bank|MOCK Exam|Common Entrance|'
    r'Teaching and Learning',
    re.I)
BULLET_RE = re.compile(r'[\u2022\uf0b7]')
PAGE_NUM_RE = re.compile(r'^\s*\d+\s*$')
PROSE_STOP_RE = re.compile(r'^\s*WEEK\s+\d+\s*:', re.I)  # marks start of narrative lesson-note appendices, not table rows
ADMIN_TOPIC_RE = re.compile(r'\b(mid[\s-]?term|exam(ination)?s?|break|revision|closing|resumption|orientation|registration|holiday)\b', re.I)

# 1. Find every section header: a line starting with a class code (JSS1/SS2/etc.)
#    whose next non-blank line is a term label. Some sub-sections (e.g. trade
#    subjects like "Solar Photovoltaic Installation and Maintenance") don't use
#    the "SCHEME OF WORK" suffix at all, so we can't rely on that phrase alone -
#    doing so silently merges them into the previous subject's block.
headers = []
for i, line in enumerate(raw_lines):
    stripped = line.strip()
    if not CLASS_CODE_RE.match(stripped):
        continue
    for k in range(i + 1, min(i + 4, len(raw_lines))):
        nxt = raw_lines[k].strip()
        if not nxt:
            continue
        if TERM_RE.search(nxt):
            headers.append((i, stripped))
        break

print(f"Found {len(headers)} subject/class scheme headers", file=sys.stderr)

def normalize_class(label):
    m = CLASS_CODE_RE.match(label)
    level, num = m.group(1).upper(), m.group(2)
    level = "JSS" if level == "JSS" else "SS"  # SSS -> SS
    return f"{level}{num}"

def normalize_subject(label):
    rest = CLASS_CODE_RE.sub('', label).strip()
    rest = SCHEME_SUFFIX_RE.sub('', rest).strip()
    rest = re.sub(r'\s+', ' ', rest)
    # Title-case but preserve common all-caps acronyms
    words = rest.split(' ')
    ACR = {"CRS", "IRS", "CCA"}
    out = []
    for w in words:
        clean = w.strip('()')
        if clean.upper() in ACR:
            out.append(w.upper())
        else:
            out.append(w.capitalize() if w.isupper() or w.islower() else w)
    subj = ' '.join(out)
    return subj

SUBJECT_ALIASES = {
    "Christian Religious Studies (CRS)": "Christian Religious Studies",
    "Islamic Religious Studies (IRS)": "Islamic Religious Studies",
    "Cultural & Creative Arts (CCA)": "Cultural And Creative Arts",
    "Cultural And Creative Arts (CCA)": "Cultural And Creative Arts",
    "Physical & Health Education": "Physical And Health Education",
    "Catering And Craft": "Catering And Craft Practice",
    "Literature-in-english": "Literature In English",
    "Literature-in-English": "Literature In English",
    "Fashion Design & Garment Making": "Fashion Design And Garment Making",
    "Solar Photovoltaic (pv) Installation And Maintenance": "Solar Photovoltaic Installation And Maintenance",
    "Solar Photovoltaic Installation & Maintenance": "Solar Photovoltaic Installation And Maintenance",
    "Computer Hardware And Gsm Repairs": "Computer Hardware And GSM Repairs",
}

def canonical_subject(subj, klass):
    subj = SUBJECT_ALIASES.get(subj, subj)
    # SS uses "English Language" as the umbrella subject name; JSS uses "English Studies"
    if subj in ("English Studies", "English Language"):
        subj = "English Studies" if klass.startswith("JSS") else "English Language"
    return subj

def col_start_offsets(line):
    """Return list of (start_offset) for each 2+space-separated token in line."""
    return [m.start() for m in re.finditer(r'\S+(?:\s\S+)*', line)]

def tokenize_with_offsets(line):
    return [(m.start(), m.group(0).strip()) for m in re.finditer(r'\S+(?:\s\S+)*', line)]

records = []  # each: subject, klass, term, week, strand(optional), topic, content

for idx in range(len(headers)):
    start_i, label = headers[idx]
    end_i = headers[idx + 1][0] if idx + 1 < len(headers) else len(raw_lines)
    block = raw_lines[start_i:end_i]

    klass = normalize_class(label)
    subject = canonical_subject(normalize_subject(label), klass)

    # find term
    term = None
    for line in block[:6]:
        tm = TERM_RE.search(line)
        if tm:
            term = tm.group(1).capitalize() + " Term"
            break
    if not term:
        continue

    # find column header line (starts with WEEK)
    header_idx = None
    for j, line in enumerate(block):
        if WEEK_HEADER_RE.match(line):
            header_idx = j
            break
    if header_idx is None:
        continue

    col_names_line = block[header_idx]
    header_tokens = [t for _, t in tokenize_with_offsets(col_names_line)]
    # header_tokens[0] is usually "Week" (or "Week" merged with first data col if tightly spaced) - ignore, we
    # derive real column offsets from the first populated data row instead (more reliable).

    data_lines = block[header_idx + 1:]

    # --- assemble rows ---
    rows = []  # list of dict: week, cols: list of accumulated strings, col_offsets
    current = None

    for raw_line in data_lines:
        line = raw_line.replace('\u2022', ' ')  # blank out bullet markers, keep spacing/offsets intact
        line = BULLET_RE.sub(' ', line)
        if PROSE_STOP_RE.match(line):
            break  # narrative lesson notes / appendix content follows - not part of the table
        if not line.strip():
            continue
        if NOISE_RE.search(line) or PAGE_NUM_RE.match(line) or line.strip() == '\f':
            continue
        if line.strip().startswith('\f'):
            continue

        m = ROW_START_RE.match(line)
        if m:
            # New row
            week_label = m.group(2)
            rest = m.group(3)
            rest_full = ' ' * (len(m.group(1)) + len(m.group(2)) + 1) + rest  # keep offsets aligned to original line
            toks = tokenize_with_offsets(rest_full)
            current = {"week": week_label, "cols": {}, "col_offsets": []}
            for offset, text in toks:
                current["cols"][offset] = text
                current["col_offsets"].append(offset)
            rows.append(current)
        else:
            if current is None:
                continue
            toks = tokenize_with_offsets(line)
            for offset, text in toks:
                text = BULLET_RE.sub('', text).strip()  # strip leading/embedded bullet markers
                if not text:
                    continue
                # find nearest existing column offset
                if current["col_offsets"]:
                    nearest = min(current["col_offsets"], key=lambda o: abs(o - offset))
                    is_topic_col = nearest == min(current["col_offsets"])
                    if abs(nearest - offset) > 30:  # too far from any known column, register as new
                        current["cols"][offset] = (current["cols"].get(offset, "") + " " + text).strip()
                        current["col_offsets"].append(offset)
                    else:
                        prev = current["cols"][nearest]
                        if is_topic_col:
                            joiner = " "  # topic column continuations are just word-wrap
                        else:
                            sep = "; " if text and text[0].isupper() else " "
                            joiner = sep if prev and not prev.endswith((';', ':', ',')) else " "
                        current["cols"][nearest] = (prev + joiner + text).strip()
                else:
                    current["cols"][offset] = text
                    current["col_offsets"].append(offset)

    # --- turn rows into topic records ---
    for row in rows:
        offsets_sorted = sorted(row["cols"].keys())
        values = [row["cols"][o] for o in offsets_sorted]
        if not values:
            continue

        # Only "English Studies" (JSS) genuinely has multiple independent strand
        # columns (Speech Work / Grammar / Reading / Composition / Literature).
        # Every other subject is really Week+Topic+Content; inline bullet
        # separators without surrounding spaces occasionally cause continuation
        # text to drift into a spurious extra column, so for all other subjects
        # we treat column 0 as the topic and fold everything else into content.
        if subject == "English Studies" and len(values) >= 3:
            for si, val in enumerate(values):
                val = val.strip()
                if not val or ADMIN_TOPIC_RE.search(val.split(';')[0].split(',')[0][:40]):
                    continue
                records.append({
                    "subject": subject, "klass": klass, "term": term,
                    "week": row["week"], "strand": f"Component {si+1}",
                    "topic": val[:160], "content": val
                })
        else:
            topic = values[0].strip() if values else ""
            content = "; ".join(v.strip() for v in values[1:] if v.strip())
            if not topic:
                continue
            if ADMIN_TOPIC_RE.search(topic):
                continue
            records.append({
                "subject": subject, "klass": klass, "term": term,
                "week": row["week"], "strand": None,
                "topic": topic, "content": content
            })

print(f"Parsed {len(records)} topic records", file=sys.stderr)

# --- build nested structure CURRICULUM[subject][class][term] = [records], de-duplicated ---
tree = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
seen = defaultdict(set)
for r in records:
    key = (r["subject"], r["klass"], r["term"])
    dedup_key = (r["week"], r["topic"].lower().strip())
    if dedup_key in seen[key]:
        continue
    seen[key].add(dedup_key)
    tree[r["subject"]][r["klass"]][r["term"]].append({
        "topic": r["topic"], "week": r["week"], "strand": r["strand"], "content": r["content"]
    })

# stats
subjects = sorted(tree.keys())
print(f"Subjects found ({len(subjects)}):", file=sys.stderr)
for s in subjects:
    classes = sorted(tree[s].keys())
    print(f"  {s}: {classes}", file=sys.stderr)

with open("nerdc_curriculum.json", "w", encoding="utf-8") as f:
    json.dump(tree, f, ensure_ascii=False, indent=1)

print("Wrote nerdc_curriculum.json", file=sys.stderr)
