"""Publication claims apply only to the exact artifact and source game build."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('validation_build', ROOT / 'tools/build.py')
assert spec and spec.loader
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

HASH = 'f66d647139ab7fd8ff87b371c6cf95f42b1c63b883fe98178767bd2b71102248'
BUILD = 26020302


class ValidationTests(unittest.TestCase):
    def record(self):
        return dict(vpk_sha256=HASH, source_game_build=BUILD,
                    runtime_verified=True, manager_verified=True)

    def resolve(self, record, vpk_hash=HASH, source_build=str(BUILD)) -> dict:
        resolver = getattr(build, 'resolve_validation', None)
        self.assertTrue(callable(resolver), 'Artifact-bound validation resolution is missing')
        assert callable(resolver)
        before = copy.deepcopy(record)
        result = resolver(record, vpk_hash, source_build)
        assert isinstance(result, dict)
        self.assertEqual(record, before, 'Resolution must not mutate its input')
        return result

    def test_validation_record_identifies_the_tested_artifact(self):
        path = ROOT / 'data/validation.json'
        self.assertTrue(path.is_file(), 'The tested artifact validation record is missing')
        record = json.loads(path.read_text())
        self.assertEqual(record['vpk_sha256'], HASH)
        self.assertEqual(record['source_game_build'], BUILD)
        self.assertIs(type(record['runtime_verified']), bool)
        self.assertIs(type(record['manager_verified']), bool)

    def test_local_verification_does_not_claim_all_gates(self):
        record = dict(self.record(), manager_verified=False)
        self.assertEqual(self.resolve(record), {
            'runtime_verified': True, 'manager_verified': False,
            'all_gates_passed': False, 'validation_status': 'experimental-locally-verified',
        })

    def test_only_both_verifications_pass_all_gates(self):
        for runtime in (False, True):
            for manager in (False, True):
                with self.subTest(runtime=runtime, manager=manager):
                    result = self.resolve(dict(self.record(), runtime_verified=runtime,
                                               manager_verified=manager))
                    self.assertIs(result['runtime_verified'], runtime)
                    self.assertIs(result['manager_verified'], manager)
                    self.assertIs(result['all_gates_passed'], runtime and manager)
                    if runtime and manager:
                        self.assertEqual(result['validation_status'], 'validated-local-and-manager')
                    else:
                        self.assertTrue(result['validation_status'].startswith('experimental-'))

    def test_absent_or_invalid_record_clears_both_gates(self):
        invalid = [None, {}, [], 'not a record']
        for field in self.record():
            record = self.record()
            del record[field]
            invalid.append(record)
        for field, values in {
            'vpk_sha256': [None, '', True, HASH.upper(), 'g' * 64],
            'source_game_build': [None, True, 0, -1, float(BUILD), '026020302', ''],
            'runtime_verified': [None, 1, 0, 'true', 'false'],
            'manager_verified': [None, 1, 0, 'true', 'false'],
        }.items():
            for value in values:
                invalid.append(dict(self.record(), **{field: value}))
        for record in invalid:
            with self.subTest(record=record):
                self.assertEqual(self.resolve(record), {
                    'runtime_verified': False, 'manager_verified': False,
                    'all_gates_passed': False, 'validation_status': 'experimental-runtime-unverified',
                })

    def test_mismatched_artifact_or_build_clears_both_gates(self):
        for current_hash, current_build in [('0' * 64, str(BUILD)), (HASH, '26020303')]:
            with self.subTest(vpk=current_hash, build=current_build):
                self.assertEqual(self.resolve(self.record(), current_hash, current_build), {
                    'runtime_verified': False, 'manager_verified': False,
                    'all_gates_passed': False, 'validation_status': 'experimental-runtime-unverified',
                })


if __name__ == '__main__':
    unittest.main()
