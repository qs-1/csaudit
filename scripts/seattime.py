"""How long after you add or drop a section does the public catalog show it? Run it while registration is open.

    python scripts/seattime.py "CSCS 100 B" "MATH 120 A"       # sections you'll add or drop yourself
    python scripts/seattime.py "CSCS 100 B" --every 15 --minutes 25

Press Enter the moment you click Add or Drop in Empower; type a note first if you like ("add cscs").
The script polls only the departments of those sections, one request at a time (one small request every
`--every` seconds), and prints every seat change it sees in those departments, with the time. Changes by
other students are useful too: they show how busy registration is. On errors or slow replies it waits longer.
Everything is logged to scripts/raw/seattime-<time>.jsonl, which git ignores.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape import LIST, PAGE, form, parse, rank, terms  # noqa: E402

XHR = {"X-Requested-With": "XMLHttpRequest"}
marks: list[tuple[float, str]] = []


def now() -> str:
    return datetime.now().strftime("%H:%M:%S")


def listen() -> None:
    for line in sys.stdin:
        marks.append((time.time(), line.strip() or "mark"))
        print(f"{now()}  MARK  {marks[-1][1]}", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sections", nargs="+", help='e.g. "CSCS 100 B"')
    ap.add_argument("--every", type=float, default=15, help="seconds between polls of each department (default 15)")
    ap.add_argument("--minutes", type=float, default=30, help="stop after this long (default 30)")
    ap.add_argument("--term", help="term code (default: newest)")
    a = ap.parse_args()

    mine = set()
    for s in a.sections:
        p = s.split()
        if len(p) != 3:
            raise SystemExit(f'Write sections as "DEPT NUM SEC", e.g. "CSCS 100 B" (got {s!r})')
        mine.add((f"{p[0].upper()} {p[1].upper()}", p[2].upper()))
    depts = sorted({c.split()[0] for c, _ in mine})

    log = Path(__file__).resolve().parent / "raw" / f"seattime-{datetime.now():%Y%m%d-%H%M}.jsonl"
    log.parent.mkdir(exist_ok=True)
    out = log.open("a", encoding="utf8")

    def write(**kw) -> None:
        out.write(json.dumps({"t": time.time(), **kw}) + "\n")
        out.flush()

    s = requests.Session()
    s.headers["User-Agent"] = "fccu-audit seat timing test (student project)"

    def token() -> dict:
        t = time.time()
        page = s.get(PAGE, timeout=60)
        page.raise_for_status()
        d = form(page.text)
        d["empower_global_term_id"] = a.term or sorted(terms(page.text), key=rank)[-1]
        write(kind="token", ms=int((time.time() - t) * 1000))
        return d

    data = token()
    print(f"Term {data['empower_global_term_id']}, departments {', '.join(depts)}, every {a.every:g}s for {a.minutes:g} min.")
    print("Press Enter right when you click Add/Drop (type a note first if you like). Ctrl+C to stop.\n", flush=True)
    threading.Thread(target=listen, daemon=True).start()

    seen: dict[tuple[str, str], int] = {}
    base: list[float] = []  # recent normal response times, for spotting a slowdown
    wait = a.every
    end = time.time() + a.minutes * 60
    try:
        while time.time() < end:
            for dept in depts:
                d = dict(data, empower_global_dept_id=dept)
                t = time.time()
                try:
                    r = s.post(LIST, data=d, headers=XHR, timeout=60)
                    ms = int((time.time() - t) * 1000)
                    j = r.json()
                    if j.get("SUCCESS") is not True:
                        raise RuntimeError(f"FCCU said {j.get('MSG')!r}")
                except Exception as e:  # noqa: BLE001
                    ms = int((time.time() - t) * 1000)
                    wait = min(wait * 2, 300)
                    print(f"{now()}  {dept} failed after {ms} ms: {str(e)[:120]}. Next try in {wait:g}s, with a fresh token.", flush=True)
                    write(kind="error", dept=dept, ms=ms, err=str(e)[:300])
                    time.sleep(wait)
                    try:
                        data = token()
                    except Exception as e2:  # noqa: BLE001
                        write(kind="error", dept="token", err=str(e2)[:300])
                    break
                secs = parse(j["html"])
                write(kind="poll", dept=dept, ms=ms, n=len(secs))
                slow = len(base) >= 5 and ms > 3 * sorted(base)[len(base) // 2]
                base = (base + [ms])[-20:]
                wait = min(wait * 2, 300) if slow else a.every
                if slow:
                    print(f"{now()}  {dept} slow ({ms} ms, usually ~{sorted(base)[len(base) // 2]} ms). Easing off to {wait:g}s.", flush=True)
                for x in secs:
                    k = (x["c"], x["x"])
                    if k in seen and seen[k] != x["a"]:
                        star = "  <-- yours" if k in mine else ""
                        since = ""
                        if k in mine and marks:
                            mt, note = marks[-1]
                            since = f"  ({time.time() - mt:.0f}s after mark '{note}')"
                        print(f"{now()}  {x['c']} {x['x']}: {seen[k]} -> {x['a']} of {x['o']}{star}{since}", flush=True)
                        write(kind="change", sec=f"{x['c']} {x['x']}", before=seen[k], after=x["a"], cap=x["o"], mine=k in mine,
                              marks=[[m, n] for m, n in marks])
                    seen[k] = x["a"]
                for k in [k for k in mine if k[0].split()[0] == dept]:
                    if k not in seen:
                        print(f"Note: {k[0]} {k[1]} isn't in the {k[0].split()[0]} list. Check the section letter.", flush=True)
                        mine = mine - {k}
                        break
            else:
                time.sleep(wait)
    except KeyboardInterrupt:
        pass
    for mt, note in marks:
        write(kind="mark", at=mt, note=note)
    print(f"\nSaved {log}. Send me that file (or paste it). Don't commit it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
