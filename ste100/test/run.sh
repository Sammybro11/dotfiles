#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
config="$HOME/dotfiles/vale/.config/vale/.vale.ini"

run() {
  vale --config "$config" --no-exit --output=JSON "$1"
}

run "$here/violations.md" | python3 -c '
import json, sys
expected = {
    "STE.Ambiguity",
    "STE.BritishVariants",
    "STE.Contractions",
    "STE.Gerunds",
    "STE.Modals",
    "STE.NounCluster",
    "STE.PassiveVoice",
    "STE.Semicolon",
    "STE.SentenceLength20",
    "STE.SentenceLength25",
}
found = {a["Check"] for f in json.load(sys.stdin).values() for a in f if a["Check"].startswith("STE.")}
missing = expected - found
extra = found - expected
if missing or extra:
    print(f"violations: missing={sorted(missing)} extra={sorted(extra)}")
    sys.exit(1)
print(f"violations: all {len(expected)} rules fired")
'

run "$here/clean.md" | python3 -c '
import json, sys
found = sorted({a["Check"] for f in json.load(sys.stdin).values() for a in f if a["Check"].startswith("STE.")})
if found:
    print(f"clean: unexpected STE alerts {found}")
    sys.exit(1)
print("clean: no STE alerts")
'
