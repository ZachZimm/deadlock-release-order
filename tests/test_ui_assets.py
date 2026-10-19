import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UiAssetTests(unittest.TestCase):
    def test_adds_only_a_script_include_to_native_layout(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            script = tmp / 'release_order.js'
            script.write_text('$.Msg("release-order test");\n')
            result = subprocess.run([
                'dotnet', 'run', '--project', str(ROOT / 'src/UiPatcher'), '--',
                str(ROOT / '.work/extracted/panorama/layout/popups/citadel_popup_roster_select.vxml_c'),
                str(script), str(tmp / 'ui'), str(tmp / 'audit.json'),
            ], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            layout = tmp / 'ui/panorama/layout/popups/citadel_popup_roster_select.vxml_c'
            exported = tmp / 'layout.xml'
            subprocess.run([str(ROOT / '.work/vrf/Source2Viewer-CLI'), '-i', str(layout),
                            '-o', str(exported), '-d'], check=True, capture_output=True)
            import xml.etree.ElementTree as ET
            actual = ET.fromstring(exported.read_text())
            scripts = actual.find('scripts')
            self.assertIsNotNone(scripts)
            self.assertEqual([node.attrib for node in scripts],
                             [{'src': 's2r://panorama/scripts/release_order.vjs_c'}])
            actual.remove(scripts)
            original = ET.parse(ROOT / '.work/ui/panorama/layout/popups/citadel_popup_roster_select.xml').getroot()
            for tree in (actual, original):
                for node in tree.iter():
                    node.text = (node.text or '').strip()
                    node.tail = (node.tail or '').strip()
            self.assertEqual(ET.tostring(actual), ET.tostring(original))
            compiled_script = tmp / 'ui/panorama/scripts/release_order.vjs_c'
            # Independently parse the resource envelope: VJS v4 is raw UTF-8,
            # unlike the CRC/image-prefixed legacy v1 format.
            import struct
            binary = compiled_script.read_bytes()
            size, header, version, table_offset, count = struct.unpack_from('<IHHII', binary)
            self.assertEqual((size, header, version), (len(binary), 12, 4))
            blocks = {}
            for index in range(count):
                offset = 8 + table_offset + 12 * index
                kind, relative, length = struct.unpack_from('<4sII', binary, offset)
                blocks[kind] = binary[offset + 4 + relative:offset + 4 + relative + length]
            self.assertEqual(blocks[b'DATA'], script.read_bytes())
            exported_script = tmp / 'script.js'
            subprocess.run([str(ROOT / '.work/vrf/Source2Viewer-CLI'), '-i', str(compiled_script),
                            '-o', str(exported_script), '-d'], check=True, capture_output=True)
            self.assertEqual(exported_script.read_text(), script.read_text())
            self.assertTrue(json.loads((tmp / 'audit.json').read_text())['only_script_include_added'])


if __name__ == '__main__':
    unittest.main()
