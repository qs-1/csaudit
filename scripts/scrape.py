"""Fetches section lists from FCCU's public Empower course catalog and converts them for the app.

    python scripts/scrape.py              # the newest term, plus the one before it if the app already has it
    python scripts/scrape.py 2027FA       # specific terms
    python scripts/scrape.py --list       # terms the catalog offers

Needs `requests` and `beautifulsoup4`, and Node for the converter. No browser: the catalog page posts its form to
/cfcs/courseCatalog.cfc?method=GetList, which answers with the results table as HTML inside JSON.
Writes scripts/raw/<term>.json, then runs scripts/convert-sections.mjs on it. Every successful run also writes
public/sync.json with the time of the check, which the planner shows as "checked 20m ago".
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE = "https://mysis-fccollege.empower-xl.com/"
PAGE = BASE + "fusebox.cfm?fuseaction=CourseCatalog&rpt=1"
LIST = BASE + "cfcs/courseCatalog.cfc?method=GetList"
ROOT = Path(__file__).resolve().parent.parent
SEASONS = {"SP": "Spring", "SU": "Summer", "FA": "Fall", "WN": "Winter", "WI": "Winter"}
ORDER = {"SP": 1, "SU": 2, "FA": 3, "WN": 4, "WI": 4}

LABEL = re.compile(r"^([A-Z][A-Z0-9/&-]*)\s+(\d{3,4}[A-Z]?)\s+([A-Z0-9]+)$")
TIME = re.compile(r"^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$")


def rank(term: str) -> int:
    return int(term[:4]) * 10 + ORDER.get(term[4:], 0)


def label(term: str) -> str:
    return f"{SEASONS.get(term[4:], term[4:])} {term[:4]}"


def form(html: str) -> dict[str, str]:
    """The search form's fields as the browser would send them, hidden token included."""
    f = BeautifulSoup(html, "html.parser").find("form", id="f1")
    if f is None:
        raise RuntimeError("Catalog page has no search form. Did the page change?")
    data: dict[str, str] = {}
    for el in f.find_all("input"):
        if el.get("name") and (el.get("type") != "checkbox" or el.has_attr("checked")):
            data[el["name"]] = el.get("value", "")
    for el in f.find_all("select"):
        opt = el.find("option", selected=True) or el.find("option")
        data[el["name"]] = opt.get("value", "") if opt else ""
    return data


def terms(html: str) -> list[str]:
    sel = BeautifulSoup(html, "html.parser").find("select", id="empower_global_term_id")
    return [o["value"] for o in sel.find_all("option") if re.fullmatch(r"\d{4}[A-Z]{2}", o.get("value", ""))]


def lines(cell) -> list[str]:
    """A cell's text, one entry per line, without its bold heading."""
    for b in cell.find_all("b"):
        b.decompose()
    text = cell.get_text("\n").replace("\xa0", " ")
    return [re.sub(r"\s+", " ", l).strip() for l in text.split("\n") if l.strip()]


def meeting(room, sched) -> list:
    sl = [l for l in lines(sched) if not l.lower().startswith("start")]
    # The app's week runs Monday to Saturday, so a Sunday (U) meeting is left out.
    days = next((re.sub(r"[ U]", "", l) for l in sl if re.fullmatch(r"[MTWRFSU ]+", l)), "")
    t = next((TIME.match(l) for l in sl if TIME.match(l)), None)
    # Room is the last line under the building ("SBLOCK" / "S312"); "TBD" means not assigned yet.
    rl = lines(room)
    where = [rl[-1]] if rl and rl[-1].upper() != "TBD" else []
    if not t:
        return [days, None, None, *where]
    h1, m1, h2, m2 = map(int, t.groups())
    return [days, h1 * 60 + m1, h2 * 60 + m2, *where]  # convert-sections.mjs fixes 12-hour end times


def num(cell):
    v = " ".join(lines(cell))
    return int(v) if v.isdigit() else None


def parse(html: str) -> list[dict]:
    """Rows mirror the page: a section row (9 cells, or 6 when it meets more than once) followed by
    extra meeting rows (4 cells, or 7 on the last one, which carries the seat counts)."""
    out: list[dict] = []
    cur = None
    for row in BeautifulSoup(html, "html.parser").find_all("div", class_="ui-grid-row", recursive=False):
        cells = row.find_all("div", recursive=False)
        n = len(cells)
        if n in (6, 9):
            head = lines(cells[1])
            m = LABEL.match(head[0]) if head else None
            if not m:
                cur = None
                continue
            cr = " ".join(lines(cells[2]))
            cur = {
                "c": f"{m[1]} {m[2]}", "x": m[3], "t": " ".join(head[1:]).lstrip("*").strip(),
                "cr": float(cr) if cr else 0.0, "m": [meeting(cells[3], cells[4])],
                "i": " ".join(lines(cells[5])), "a": None, "o": None,
            }
            if n == 9:
                cur["o"], cur["a"] = num(cells[6]), num(cells[7])
            out.append(cur)
        elif cur is not None and n in (4, 7):
            cur["m"].append(meeting(cells[1], cells[2]))
            if n == 7:
                cur["o"], cur["a"] = num(cells[4]), num(cells[5])
    return out


def fetch(s: requests.Session, page: str, term: str) -> list[dict]:
    data = form(page)
    data["empower_global_term_id"] = term
    data = form(s.post(PAGE, data=data, timeout=90).text)  # switching term reloads the form with a new token
    if data.get("empower_global_term_id") != term:
        raise RuntimeError(f"Catalog didn't switch to {term}")
    r = s.post(LIST, data=data, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=180)
    r.raise_for_status()
    j = r.json()
    if j.get("SUCCESS") is not True:
        raise RuntimeError(f"GetList failed for {term}: {j.get('MSG')}")
    return parse(j["html"])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("terms", nargs="*", help="Empower term codes, e.g. 2027FA")
    ap.add_argument("--list", action="store_true", help="print the catalog's terms and stop")
    a = ap.parse_args()

    s = requests.Session()
    s.headers["User-Agent"] = "fccu-audit catalog sync"
    page = s.get(PAGE, timeout=90)
    page.raise_for_status()
    offered = sorted(terms(page.text), key=rank)
    if a.list:
        print("\n".join(f"{t}  {label(t)}" for t in reversed(offered)))
        return 0

    checked = datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z")
    have = {p.stem for p in (ROOT / "src/data/terms").glob("*.json")}
    wanted = a.terms or [t for t in offered[-2:] if t == offered[-1] or t in have]
    for term in sorted(wanted, key=rank):
        if term not in offered:
            raise SystemExit(f"{term} isn't in the catalog. It offers: {', '.join(reversed(offered))}")
        sections = fetch(s, page.text, term)
        # A sudden drop means the page changed or the catalog is half loaded. Keep the last good data.
        old = ROOT / f"src/data/terms/{term}.json"
        before = len(json.loads(old.read_text("utf8"))["sections"]) if old.exists() else 0
        if not sections or len(sections) < before * 0.7:
            raise SystemExit(f"{term}: got {len(sections)} sections, had {before}. Not overwriting.")
        raw = ROOT / f"scripts/raw/{term}.json"
        # "at" is when the list last changed, which the app shows as "updated 2h ago". Same list, nothing to write.
        if raw.exists() and json.loads(raw.read_text("utf8"))["s"] == sections:
            print(f"{term}: {len(sections)} sections, unchanged")
            page = s.get(PAGE, timeout=90)
            continue
        raw.parent.mkdir(exist_ok=True)
        at = datetime.now(timezone.utc).isoformat(timespec="minutes").replace("+00:00", "Z")
        raw.write_text(json.dumps({"at": at, "s": sections}, ensure_ascii=False, separators=(",", ":")) + "\n", "utf8")
        print(f"{term}: {len(sections)} sections")
        subprocess.run(["node", "scripts/convert-sections.mjs", str(raw.relative_to(ROOT)), term, label(term)], cwd=ROOT, check=True)
        page = s.get(PAGE, timeout=90)  # fresh token for the next term
    # Only written when every term above came through, so a failed run never claims a fresh check.
    (ROOT / "public/sync.json").write_text(json.dumps({"checked": checked, "terms": sorted(wanted, key=rank)}) + "\n", "utf8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
