import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class VpkTests(unittest.TestCase):
    def test_pack_is_accepted_by_independent_valvepak_reader(self):
        path = ROOT / 'tools/vpk.py'
        self.assertTrue(path.exists(), 'VPK packer is not implemented')
        spec = importlib.util.spec_from_file_location('vpk', path)
        assert spec is not None and spec.loader is not None
        vpk = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vpk)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'pak99_dir.vpk'
            payload = b'roster release-order test\n'
            vpk.pack({'scripts/test.txt': payload}, output)
            result = subprocess.run([
                str(ROOT / '.work/vrf/Source2Viewer-CLI'), '-i', str(output),
                '-o', str(Path(tmp) / 'extracted'),
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((Path(tmp) / 'extracted/scripts/test.txt').read_bytes(), payload)

    def test_malformed_or_duplicate_logical_paths_are_rejected(self):
        spec = importlib.util.spec_from_file_location('vpk', ROOT / 'tools/vpk.py')
        assert spec is not None and spec.loader is not None
        vpk = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vpk)
        with tempfile.TemporaryDirectory() as tmp:
            for files in [
                {'scripts/a.txt': b'a', 'scripts//a.txt': b'b'},
                {'scripts/a\x00b.txt': b'a'},
            ]:
                with self.subTest(files=files), self.assertRaises(ValueError):
                    vpk.pack(files, Path(tmp) / 'test.vpk')


if __name__ == '__main__':
    unittest.main()
