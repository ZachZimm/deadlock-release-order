#!/usr/bin/env python3
"""Build a UI-only VPK and a portable mod-manager download archive."""
import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import zipfile

from vpk import pack

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.2.1'
LAYOUT = 'panorama/layout/popups/citadel_popup_roster_select.vxml_c'
SCRIPT = 'panorama/scripts/release_order.vjs_c'


def validate_heroes(heroes: object) -> list[dict]:
    """Reject unusable release ranks before extracting or publishing any assets."""
    if not isinstance(heroes, list) or not heroes:
        raise ValueError('Release manifest must be a nonempty list.')
    ids = set()
    for hero in heroes:
        if not isinstance(hero, dict):
            raise ValueError('Release manifest entries must be objects.')
        hero_id = hero.get('hero_id')
        name = hero.get('name')
        released = hero.get('release_date')
        if type(hero_id) is not int or hero_id <= 0 or hero_id in ids:
            raise ValueError('Release manifest must have unique positive integer hero IDs (not booleans).')
        if not isinstance(name, str) or not name or name.strip() != name:
            raise ValueError('Release manifest names must be nonempty, trimmed strings.')
        if not isinstance(released, str) or date.fromisoformat(released).isoformat() != released:
            raise ValueError('Release dates must be valid canonical YYYY-MM-DD strings.')
        ids.add(hero_id)
    return sorted(heroes, key=lambda hero: (hero['release_date'], hero['name'].casefold()))


def resolve_validation(record: object, vpk_sha256: str, source_game_build: str) -> dict:
    """Resolve local evidence separately from the complete publication gates."""
    if not isinstance(record, dict):
        record = {}
    valid = (
        isinstance(record.get('vpk_sha256'), str)
        and re.fullmatch(r'[0-9a-f]{64}', record['vpk_sha256']) is not None
        and type(record.get('source_game_build')) in (int, str)
        and re.fullmatch(r'[1-9][0-9]*', str(record['source_game_build'])) is not None
        and type(record.get('runtime_verified')) is bool
        and type(record.get('manager_verified')) is bool
    )
    matches = (valid and record['vpk_sha256'] == vpk_sha256 and
               str(record['source_game_build']) == str(source_game_build))
    runtime = matches and record['runtime_verified']
    manager = matches and record['manager_verified']
    return {
        'runtime_verified': runtime, 'manager_verified': manager,
        'all_gates_passed': runtime and manager,
        'validation_status': ('validated-local-and-manager' if runtime and manager else
                              'experimental-locally-verified' if runtime else
                              'experimental-runtime-unverified'),
    }


def run_patcher(native: Path, script: Path, output: Path, audit_path: Path) -> None:
    """Resolve only locked dependencies, then disable implicit restore."""
    project = str(ROOT / 'src/UiPatcher')
    subprocess.run(['dotnet', 'restore', project, '--locked-mode'], check=True)
    subprocess.run(['dotnet', 'run', '--no-restore', '--project', project, '--',
                    str(native), str(script), str(output), str(audit_path)], check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--game', required=True, type=Path, help='Deadlock install folder (contains game/)')
    parser.add_argument('--vrf', type=Path, default=ROOT / '.work/vrf/Source2Viewer-CLI')
    args = parser.parse_args()
    source = args.game.resolve() / 'game/citadel/pak01_dir.vpk'
    if not source.is_file() or not args.vrf.is_file():
        parser.error('Game VPK or Source2Viewer-CLI missing. See README.md.')
    heroes = validate_heroes(json.loads((ROOT / 'data/heroes.json').read_text()))
    ranks = {str(hero['hero_id']): index for index, hero in enumerate(heroes)}
    template = (ROOT / 'src/panorama/release_order.js').read_text()
    marker = '/*__RELEASE_RANKS__*/{}'
    if template.count(marker) != 1:
        raise ValueError('Expected exactly one release-data insertion marker.')
    script_text = template.replace(marker, json.dumps(ranks, separators=(',', ':')))
    hero_marker = '/*__RELEASE_HEROES__*/{}'
    if template.count(hero_marker) != 1:
        raise ValueError('Expected exactly one hero-name insertion marker.')
    hero_names = {str(hero['hero_id']): [hero['name'], hero['internal_name']] for hero in heroes}
    script_text = script_text.replace(hero_marker, json.dumps(hero_names, separators=(',', ':')))
    (ROOT / '.work').mkdir(exist_ok=True)
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=ROOT / '.work') as staging:
        staging = Path(staging)
        native = staging / 'native.vxml_c'
        result = subprocess.run([str(args.vrf), '-i', str(source), '-f', LAYOUT, '-o', str(native)],
                                check=True, capture_output=True, text=True)
        if not native.is_file():
            raise RuntimeError('Native layout extraction failed: ' + result.stdout + result.stderr)
        script = staging / 'release_order.js'
        script.write_text(script_text)
        output = staging / 'mod'
        audit_path = staging / 'audit.json'
        run_patcher(native, script, output, audit_path)
        files = {path.relative_to(output).as_posix(): path.read_bytes()
                 for path in output.rglob('*') if path.is_file()}
        if set(files) != {LAYOUT, SCRIPT}:
            raise RuntimeError('Release allowlist violation: only the roster layout and script are allowed.')
        vpk = staging / 'pak99_dir.vpk'
        pack(files, vpk)
        extracted = staging / 'verified'
        subprocess.run([str(args.vrf), '-i', str(vpk), '-o', str(extracted)],
                       check=True, capture_output=True, text=True)
        actual = {path.relative_to(extracted).as_posix(): path.read_bytes()
                  for path in extracted.rglob('*') if path.is_file()}
        if actual != files:
            raise RuntimeError('Independent archive verification failed.')
        appmanifest = args.game.resolve().parents[1] / 'appmanifest_1422450.acf'
        match = re.search(r'"buildid"\s+"(\d+)"', appmanifest.read_text())
        if not match:
            raise RuntimeError('Installed Steam build ID unavailable.')
        try:
            record = json.loads((ROOT / 'data/validation.json').read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            record = None
        vpk_sha256 = hashlib.sha256(vpk.read_bytes()).hexdigest()
        validation = resolve_validation(record, vpk_sha256, match[1])
        audit = json.loads(audit_path.read_text())
        audit.update(version=VERSION, ui_only=True, known_heroes=len(heroes), source_game_build=match[1],
                     **validation, vpk_sha256=vpk_sha256,
                     release_definition='First main-roster availability; oldest first, English alphabetical ties.')
        metadata = {
            'name': 'Release Order Roster', 'version': VERSION,
            'description': 'UI-only roster sorting by release date, with alphabetical ties.',
            'source_game_build': match[1], 'ui_only': True,
            **validation,
            'overrides': [LAYOUT], 'adds': [SCRIPT],
            'vpk_sha256': audit['vpk_sha256'],
            'metadata_note': 'Informational release metadata, not a manager-specific manifest.',
        }
        status = ('VALIDATED: locally in-game and through Mod Manager for this exact VPK and source build.\n'
                  if validation['all_gates_passed'] else
                  'EXPERIMENTAL: not all local in-game and Mod Manager verification gates have passed.\n'
                  'Do not publish or treat this as a validated public release.\n')
        status += ('Local in-game verification: ' + ('passed' if validation['runtime_verified'] else 'pending') + '\n'
                   'Mod Manager verification: ' + ('passed' if validation['manager_verified'] else 'pending') + '\n\n')
        readme = (
            f'Release Order Roster {VERSION}\n\n'
            + status +
            'UI-only: reorders existing hero cards; contains NO hero definitions or balance data.\n'
            'Oldest main-roster release first, with English alphabetical ties.\n'
            'Unknown future heroes remain at the end in their native relative order.\n\n'
            'INSTALL: Close Deadlock. In Deadlock Mod Manager, choose Mods Library > Add Local Mod,\n'
            'select this ZIP (or the VPK), name it Release Order Roster, then enable it.\n'
            'DISABLE/REMOVE: Use the manager to disable or uninstall this mod, then restart the game.\n'
            'Do not replace gameinfo.gi or any stock game archive.\n\n'
            'CONFLICTS: Other replacements of the roster popup layout, including Hero Select Plus.\n'
            'Disable the old hero-definition-based version before enabling this one.\n'
            f'Built using the roster layout from Steam build {match[1]}. UI layout updates may require\n'
            'a refreshed release. New hero dates need a release-data update for exact chronology.\n'
            'Online/anti-cheat compatibility and Valve approval are NOT guaranteed.\n'
            'Valve game assets remain the property of Valve; the MIT license covers original code only.\n'
            'release.json is informational, not an automatic compatibility enforcement mechanism.\n'
        )
        # Stage the complete release before replacing existing distribution artifacts.
        package = staging / f'release-order-roster-{VERSION}.zip'
        with zipfile.ZipFile(package, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in [('pak99_dir.vpk', vpk.read_bytes()), ('README.txt', readme.encode()),
                               ('LICENSE', (ROOT / 'LICENSE').read_bytes()),
                               ('release.json', (json.dumps(metadata, indent=2) + '\n').encode())]:
                info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                archive.writestr(info, data)
        (dist / 'pak99_dir.vpk').write_bytes(vpk.read_bytes())
        (dist / package.name).write_bytes(package.read_bytes())
        (dist / 'audit.json').write_text(json.dumps(audit, indent=2) + '\n')
        (dist / 'release.json').write_text(json.dumps(metadata, indent=2) + '\n')
        (dist / 'README.txt').write_text(readme)
        (dist / 'roster-order.txt').write_text('\n'.join(
            f"{index:02d}. {hero['release_date']}  {hero['name']}" for index, hero in enumerate(heroes, 1)) + '\n')
        hashes = ''.join(f'{hashlib.sha256((dist / name).read_bytes()).hexdigest()}  {name}\n'
                         for name in ['pak99_dir.vpk', package.name])
        (dist / 'SHA256SUMS').write_text(hashes)
        cache = ROOT / '.work/ui-only'
        cache.mkdir(exist_ok=True)
        (cache / 'release_order.js').write_text(script_text)
        print(f'Built UI-only release {VERSION}: two Panorama assets, {len(heroes)} known heroes.')


if __name__ == '__main__':
    main()
