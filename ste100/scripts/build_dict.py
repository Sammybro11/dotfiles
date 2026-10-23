#!/usr/bin/env python3
"""Build the local STE100 dictionary from the Valar reproduction.

The source table is a reproduction of the ASD-STE100 Issue 9 dictionary. It is
downloaded once, cached outside the repository, and never committed. Only the
derived swap table and word list are written, and both are gitignored.

Usage:
    python3 build_dict.py --dry-run
    python3 build_dict.py
    python3 build_dict.py --refresh
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
STYLES = BASE / "vale" / "styles" / "STE"
OUT_YML = STYLES / "Dict.yml"
OUT_JSON = Path.home() / ".local" / "share" / "ste100" / "wordlist.json"
CACHE = Path.home() / ".cache" / "ste100" / "pages"

BASE_URL = "https://ste.valaratomics.com/dictionary/?page={}"
PAGES = 299
EXPECTED_ROWS = 2987
DELAY = 0.4
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ste100-local/1.0)"}

WORD_RE = re.compile(r"^(.*)\s+\(([^()]*)\)$")
POS_WORDS = {
    "noun",
    "verb",
    "adjective",
    "adverb",
    "pronoun",
    "article",
    "preposition",
    "conjunction",
}
APPROVED = "\u2714"
REJECTED = "\u2718"


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._buf: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "tr":
            self._row = []
        elif tag == "td" and self._row is not None:
            self._buf = []
        elif tag == "br" and self._buf is not None:
            self._buf.append("\x00")

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._row is not None and self._buf is not None:
            self._row.append(self._cell_text())
            self._buf = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._buf is not None:
            self._buf.append(data)

    def _cell_text(self) -> str:
        text = html.unescape("".join(self._buf or [])).replace("\x00", "\n")
        return "\n".join(
            " ".join(line.split()) for line in text.split("\n") if line.strip()
        )


def fetch_page(number: int, refresh: bool = False) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"page-{number}.html"
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8")

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(BASE_URL.format(number), headers=HEADERS)
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            path.write_bytes(data)
            time.sleep(DELAY)
            return data.decode("utf-8")
        except Exception as error:  # noqa: BLE001 - retry any network failure
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"page {number} failed: {last_error}")


def split_word(raw: str) -> tuple[str, str]:
    for match in re.finditer(r"\(([^()]*)\)", raw):
        pos = match.group(1).strip().lower()
        if pos in POS_WORDS or pos.startswith("technical "):
            word = raw[: match.start()].strip().rstrip(",").strip()
            return word, pos
    return raw.strip(), ""


def split_alternatives(raw: str) -> list[dict[str, str]]:
    parts = [part.strip() for part in raw.split("\n") if part.strip()]
    merged: list[str] = []
    for part in parts:
        if part.startswith("(") and merged:
            merged[-1] = f"{merged[-1]} {part}"
        else:
            merged.append(part)
    return [split_alternative(part) for part in merged]


def split_alternative(raw: str) -> dict[str, str]:
    match = WORD_RE.match(raw)
    if not match:
        return {"term": raw.strip(), "pos": ""}
    return {"term": match.group(1).strip(), "pos": match.group(2).strip().lower()}


def parse_pages(pages: list[str]) -> tuple[list[dict], list[str], int]:
    entries: list[dict] = []
    current: dict | None = None
    anomalies: list[str] = []
    row_count = 0

    for page_number, text in enumerate(pages, start=1):
        parser = TableParser()
        parser.feed(text)
        rows = [row for row in parser.rows if len(row) >= 5]
        rows = [row for row in rows if not row[0].lower().startswith("word (")]
        if not rows:
            anomalies.append(f"page {page_number}: no table rows")
        row_count += len(rows)

        for row in rows:
            word_raw, ste_raw, alt_raw, example, _non_ste = row[:5]
            if word_raw:
                word, pos = split_word(word_raw)
                current = {
                    "word": word,
                    "pos": pos,
                    "ste": ste_raw == APPROVED,
                    "meaning": "",
                    "alternatives": [],
                    "examples": [],
                }
                entries.append(current)
                if ste_raw not in (APPROVED, REJECTED):
                    anomalies.append(f"page {page_number}: no STE mark for {word!r}")
                elif current["ste"] and alt_raw:
                    current["meaning"] = alt_raw
                elif not current["ste"]:
                    current["alternatives"].extend(split_alternatives(alt_raw))
            elif current is None:
                anomalies.append(f"page {page_number}: continuation without a word")
                continue
            elif alt_raw:
                if current["ste"]:
                    current["meaning"] = " ".join(
                        part for part in (current["meaning"], alt_raw) if part
                    )
                else:
                    current["alternatives"].extend(split_alternatives(alt_raw))

            if example:
                current["examples"].append(example)

    for entry in entries:
        seen: set[str] = set()
        unique = []
        for alternative in entry["alternatives"]:
            key = alternative["term"].lower()
            if key and key not in seen:
                seen.add(key)
                unique.append(alternative)
        entry["alternatives"] = unique

    return entries, anomalies, row_count


def report(entries: list[dict], anomalies: list[str], row_count: int) -> None:
    approved = sum(1 for entry in entries if entry["ste"])
    rejected = len(entries) - approved
    counts = Counter(len(entry["alternatives"]) for entry in entries if not entry["ste"])
    by_word: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_word[entry["word"].lower()].append(entry)

    mixed = {word: group for word, group in by_word.items() if len({e["ste"] for e in group}) > 1}
    multiple_pos = {word: group for word, group in by_word.items() if len(group) > 1}
    odd = sorted(
        {
            alternative["term"]
            for entry in entries
            for alternative in entry["alternatives"]
            if re.search(r"[;:$\\\"]", alternative["term"])
        }
    )

    print(f"table rows: {row_count} (expected {EXPECTED_ROWS})")
    print(f"entries after merging continuations: {len(entries)}")
    print(f"approved: {approved}")
    print(f"rejected: {rejected}")
    print(f"alternative-count distribution (rejected): {dict(sorted(counts.items()))}")
    print(f"unique words: {len(by_word)}")
    print(f"words with mixed approval: {len(mixed)}")
    print(f"words with more than one entry: {len(multiple_pos)}")
    print(f"alternatives with punctuation needing care: {len(odd)}")
    for alternative in odd[:20]:
        print(f"  {alternative!r}")
    if anomalies:
        print(f"anomalies ({len(anomalies)}):")
        for anomaly in anomalies[:20]:
            print(f"  {anomaly}")
    else:
        print("anomalies: none")

    print("samples:")
    for entry in entries[:3] + entries[-3:]:
        print(
            f"  {entry['word']!r} ({entry['pos']}) ste={entry['ste']} "
            f"meaning={entry['meaning']!r} alternatives={entry['alternatives']!r}"
        )


def normalize_pos(pos: str) -> str:
    pos = pos.strip().lower()
    if pos.startswith("technical "):
        return pos.removeprefix("technical ")
    return pos


def clean_replacement(word: str, entry: dict, alternative: dict) -> str | None:
    term = alternative["term"].strip()
    if not term or term.casefold() == word.casefold():
        return None
    if not re.fullmatch(r"[\w-]+", word):
        return None
    if not re.fullmatch(r"[A-Z0-9][A-Z0-9 /-]*", term):
        return None
    if len(term.split()) > 4:
        return None
    source_pos = normalize_pos(entry["pos"])
    target_pos = normalize_pos(alternative["pos"])
    if source_pos and target_pos and source_pos != target_pos:
        return None
    return term


def build_swap(entries: list[dict]) -> tuple[dict[str, str], Counter]:
    by_word: dict[str, list[dict]] = defaultdict(list)
    for entry in entries:
        by_word[entry["word"].lower()].append(entry)

    skipped = Counter()
    swaps: dict[str, str] = {}
    for word, group in sorted(by_word.items()):
        if len({entry["ste"] for entry in group}) > 1:
            skipped["mixed approval"] += 1
            continue
        if len(group) != 1:
            skipped["multiple parts of speech"] += 1
            continue
        entry = group[0]
        if entry["ste"]:
            skipped["approved"] += 1
            continue
        if len(entry["alternatives"]) != 1:
            skipped["zero or multiple alternatives"] += 1
            continue
        alternative = clean_replacement(word, entry, entry["alternatives"][0])
        if alternative is None:
            skipped["not a clean replacement"] += 1
            continue
        swaps[word] = alternative

    return swaps, skipped


def write_yaml(swaps: dict[str, str]) -> None:
    STYLES.mkdir(parents=True, exist_ok=True)
    lines = [
        "---",
        "extends: substitution",
        "message: \"STE dictionary: '%s' is the approved alternative to '%s'.\"",
        "level: suggestion",
        "ignorecase: true",
        "swap:",
    ]
    for word, alternative in sorted(swaps.items()):
        escaped_word = re.escape(word).replace("\\ ", " ")
        key = json.dumps(r"\b" + escaped_word + r"\b", ensure_ascii=False)
        value = json.dumps(alternative, ensure_ascii=False)
        lines.append(f"  {key}: {value}")
    OUT_YML.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_json(entries: list[dict]) -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "source": "ASD-STE100 Issue 9 dictionary, via ste.valaratomics.com",
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "entries": [
            {
                "word": entry["word"],
                "pos": entry["pos"],
                "ste": entry["ste"],
                "meaning": entry["meaning"],
                "alternatives": entry["alternatives"],
            }
            for entry in entries
        ],
    }
    OUT_JSON.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="ignore the page cache")
    parser.add_argument("--dry-run", action="store_true", help="parse and report only")
    args = parser.parse_args()

    pages = [fetch_page(number, args.refresh) for number in range(1, PAGES + 1)]
    entries, anomalies, row_count = parse_pages(pages)
    report(entries, anomalies, row_count)

    if row_count != EXPECTED_ROWS:
        print(
            f"error: parsed {row_count} table rows, expected {EXPECTED_ROWS}",
            file=sys.stderr,
        )
        return 1
    if args.dry_run:
        return 0

    swaps, skipped = build_swap(entries)
    print(f"swaps: {len(swaps)}")
    print(f"skipped: {dict(skipped)}")
    write_yaml(swaps)
    write_json(entries)
    print(f"wrote {OUT_YML}")
    print(f"wrote {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
