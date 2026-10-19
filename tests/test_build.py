"""Rebuild the actual UI-only artifact and inspect it independently."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('publication_build', ROOT / 'tools/build.py')
assert spec and spec.loader
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

GAME = os.environ.get('DEADLOCK_GAME')
ASSETS = {
    'panorama/layout/popups/citadel_popup_roster_select.vxml_c',
    'panorama/scripts/release_order.vjs_c',
}


class BuildTests(unittest.TestCase):
    @unittest.skipUnless(GAME, 'Set DEADLOCK_GAME to the Deadlock install folder for the game-specific build test.')
    def test_distribution_contains_only_two_ui_assets(self):
        result = subprocess.run(['python3', str(ROOT / 'tools/build.py'), '--game', str(GAME)],
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        audit = json.loads((ROOT / 'dist/audit.json').read_text())
        self.assertTrue(audit.get('ui_only'), 'The release must not contain hero definitions')
        self.assertTrue(audit['only_script_include_added'])
        validation = build.resolve_validation(json.loads((ROOT / 'data/validation.json').read_text()),
                                              audit['vpk_sha256'], audit['source_game_build'])
        for field, expected in validation.items():
            self.assertEqual(audit.get(field), expected, field)
        self.assertTrue(audit['source_game_build'].isdigit())
        self.assertNotIn('tested_game_build', audit)
        self.assertEqual(audit['known_heroes'], 43)
        self.assertEqual(set(audit['files']), ASSETS)
        vpk = ROOT / 'dist/pak99_dir.vpk'
        self.assertEqual(hashlib.sha256(vpk.read_bytes()).hexdigest(), audit['vpk_sha256'])
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run([str(ROOT / '.work/vrf/Source2Viewer-CLI'),
                                     '-i', str(vpk), '-o', tmp], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            files = {p.relative_to(tmp).as_posix() for p in Path(tmp).rglob('*') if p.is_file()}
            self.assertEqual(files, ASSETS)
            self.assertFalse(any(path.endswith('.vdata_c') for path in files))
            compiled_script = Path(tmp) / 'panorama/scripts/release_order.vjs_c'
            decompiled_script = Path(tmp) / 'packaged.js'
            result = subprocess.run([str(ROOT / '.work/vrf/Source2Viewer-CLI'),
                                     '-i', str(compiled_script), '-o', str(decompiled_script), '-d'],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(decompiled_script.is_file(), result.stdout + result.stderr)
            manifest = json.loads((ROOT / 'data/heroes.json').read_text())
            expected = [hero['hero_id'] for hero in sorted(manifest, key=lambda hero:
                        (hero['release_date'], hero['name'].casefold()))]
            result = subprocess.run(['node', str(ROOT / 'tests/exercise_packaged_script.cjs'),
                                     str(decompiled_script), json.dumps(expected), str(ROOT / 'data/heroes.json')],
                                    text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('43 manifest heroes correctly', result.stdout)
            # Prove the end-to-end assertion catches a dropped rank injection.
            broken, replacements = re.subn(r'var RELEASE_RANKS = [^;]+;',
                                            'var RELEASE_RANKS = {};', decompiled_script.read_text(), count=1)
            self.assertEqual(replacements, 1)
            decompiled_script.write_text(broken)
            result = subprocess.run(['node', str(ROOT / 'tests/exercise_packaged_script.cjs'),
                                     str(decompiled_script), json.dumps(expected), str(ROOT / 'data/heroes.json')],
                                    text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0, 'Empty ranks must fail packaged chronology validation')
        with zipfile.ZipFile(ROOT / 'dist/release-order-roster-0.2.0.zip') as release:
            self.assertEqual(set(release.namelist()), {'pak99_dir.vpk', 'README.txt', 'release.json', 'LICENSE'})
            self.assertEqual(release.read('LICENSE'), (ROOT / 'LICENSE').read_bytes())
            readme = release.read('README.txt').decode()
            self.assertIn('Valve game assets remain the property of Valve', readme)
            self.assertIn('MIT license covers original code only', readme)
            self.assertEqual(release.read('pak99_dir.vpk'), vpk.read_bytes())
            self.assertEqual(json.loads(release.read('release.json'))['version'], '0.2.0')
            metadata = json.loads(release.read('release.json'))
            for field, expected in validation.items():
                self.assertEqual(metadata.get(field), expected, field)
            self.assertEqual(metadata['source_game_build'], audit['source_game_build'])
            if validation['all_gates_passed']:
                self.assertIn('VALIDATED: locally in-game and through Mod Manager', readme)
                self.assertNotIn('EXPERIMENTAL', readme)
            else:
                self.assertIn('EXPERIMENTAL', readme)
                self.assertIn('Do not publish', readme)
            if validation['runtime_verified']:
                self.assertIn('Local in-game verification: passed', readme)
            if not validation['manager_verified']:
                self.assertIn('Mod Manager verification: pending', readme)
            self.assertIn('Online/anti-cheat compatibility and Valve approval are NOT guaranteed', readme)

    @unittest.skipUnless(GAME, 'Set DEADLOCK_GAME to the Deadlock install folder for the game-specific build test.')
    def test_validation_variants_produce_consistent_publication_claims(self):
        assert GAME
        source_manifest = Path(GAME).resolve().parents[1] / 'appmanifest_1422450.acf'
        match = re.search(r'"buildid"\s+"(\d+)"', source_manifest.read_text())
        assert match
        source_build = match[1]
        artifact_hash = hashlib.sha256((ROOT / 'dist/pak99_dir.vpk').read_bytes()).hexdigest()
        verified = dict(vpk_sha256=artifact_hash, source_game_build=source_build,
                        runtime_verified=True, manager_verified=True)
        cases = {
            'all gates passed': verified,
            'different artifact': dict(verified, vpk_sha256='0' * 64),
            'different source build': dict(verified, source_game_build='1'),
            'absent record': None,
            'malformed JSON': '{',
            'invalid boolean': dict(verified, manager_verified='true'),
        }
        for label, record in cases.items():
            with self.subTest(case=label), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'src').mkdir()
                (root / 'src/panorama').symlink_to(ROOT / 'src/panorama', target_is_directory=True)
                # Keep MSBuild intermediates private; symlinked projects share obj/bin state.
                shutil.copytree(ROOT / 'src/UiPatcher', root / 'src/UiPatcher',
                                ignore=shutil.ignore_patterns('bin', 'obj'))
                (root / 'LICENSE').symlink_to(ROOT / 'LICENSE')
                (root / 'data').mkdir()
                (root / 'data/heroes.json').symlink_to(ROOT / 'data/heroes.json')
                if record is not None:
                    (root / 'data/validation.json').write_text(record if isinstance(record, str)
                                                              else json.dumps(record))
                command = ('import sys; from pathlib import Path; '
                           'sys.path.insert(0, sys.argv.pop(1)); import build; '
                           'build.ROOT = Path(sys.argv.pop(1)); build.main()')
                result = subprocess.run([
                    'python3', '-c', command, str(ROOT / 'tools'), str(root), '--game', str(GAME),
                    '--vrf', str(ROOT / '.work/vrf/Source2Viewer-CLI'),
                ], text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                expected = build.resolve_validation(record, artifact_hash, source_build)
                audit = json.loads((root / 'dist/audit.json').read_text())
                with zipfile.ZipFile(root / 'dist/release-order-roster-0.2.0.zip') as release:
                    metadata = json.loads(release.read('release.json'))
                    readme = release.read('README.txt').decode()
                    for field, value in expected.items():
                        self.assertEqual(metadata[field], value, field)
                        self.assertEqual(audit[field], value, field)
                    self.assertEqual(hashlib.sha256(release.read('pak99_dir.vpk')).hexdigest(), artifact_hash)
                    self.assertEqual('EXPERIMENTAL' in readme, not expected['all_gates_passed'])
                    self.assertEqual('VALIDATED: locally in-game and through Mod Manager' in readme,
                                     expected['all_gates_passed'])
                    for flag, prefix in [('runtime_verified', 'Local in-game'), ('manager_verified', 'Mod Manager')]:
                        state = 'passed' if expected[flag] else 'pending'
                        self.assertIn(f'{prefix} verification: {state}', readme)
                    self.assertIn('Online/anti-cheat compatibility and Valve approval are NOT guaranteed', readme)


if __name__ == '__main__':
    unittest.main()
