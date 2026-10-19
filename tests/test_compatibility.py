import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('vpk', ROOT / 'tools/vpk.py')
assert spec and spec.loader
vpk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vpk)


class CompatibilityTests(unittest.TestCase):
    def test_matching_native_layout_is_accepted(self):
        import hashlib
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            game = tmp / 'Deadlock'
            native = b'same native layout'
            vpk.pack({'panorama/layout/popups/citadel_popup_roster_select.vxml_c': native},
                     game / 'game/citadel/pak01_dir.vpk')
            audit = tmp / 'audit.json'
            audit.write_text(json.dumps({'native_layout_sha256': hashlib.sha256(native).hexdigest()}))
            result = subprocess.run(['python3', str(ROOT / 'tools/check_compatibility.py'),
                                     '--game', str(game), '--audit', str(audit)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn('unchanged', result.stdout)

    def test_changed_native_layout_requires_review(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            game = tmp / 'Deadlock'
            vpk.pack({'panorama/layout/popups/citadel_popup_roster_select.vxml_c': b'new layout'},
                     game / 'game/citadel/pak01_dir.vpk')
            audit = tmp / 'audit.json'
            audit.write_text(json.dumps({'native_layout_sha256': '0' * 64}))
            result = subprocess.run(['python3', str(ROOT / 'tools/check_compatibility.py'),
                                     '--game', str(game), '--audit', str(audit)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn('Roster layout changed', result.stdout)


if __name__ == '__main__':
    unittest.main()
