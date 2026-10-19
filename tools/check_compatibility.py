#!/usr/bin/env python3
"""Check native UI fingerprint without installing or changing any game files."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
LAYOUT = 'panorama/layout/popups/citadel_popup_roster_select.vxml_c'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', required=True, type=Path)
    parser.add_argument('--audit', type=Path, default=ROOT / 'dist/audit.json')
    parser.add_argument('--vrf', type=Path, default=ROOT / '.work/vrf/Source2Viewer-CLI')
    args = parser.parse_args()
    audit = json.loads(args.audit.read_text())
    with tempfile.TemporaryDirectory() as tmp:
        native = Path(tmp) / 'native.vxml_c'
        result = subprocess.run([str(args.vrf), '-i', str(args.game / 'game/citadel/pak01_dir.vpk'),
                                 '-f', LAYOUT, '-o', str(native)],
                                check=True, capture_output=True, text=True)
        if not native.is_file():
            raise RuntimeError('Native roster layout could not be extracted: ' + result.stdout + result.stderr)
        actual = hashlib.sha256(native.read_bytes()).hexdigest()
    if actual != audit['native_layout_sha256']:
        print('Roster layout changed: disable/update this release until its UI integration is reviewed.')
        return 2
    print('Native roster layout is unchanged. This check does not verify new hero release dates or online policy.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
