"""Semantic validation of release ranks, independent of the game installation."""
import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import call, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('release_build', ROOT / 'tools/build.py')
assert spec and spec.loader
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ManifestTests(unittest.TestCase):
    def test_patcher_restores_locked_before_running_without_restore(self):
        runner = getattr(build, 'run_patcher', None)
        self.assertTrue(callable(runner), 'Locked patcher invocation is missing')
        assert callable(runner)
        paths = [Path(name) for name in ('native', 'script', 'output', 'audit')]
        with patch.object(build.subprocess, 'run') as run:
            runner(*paths)
        project = str(ROOT / 'src/UiPatcher')
        self.assertEqual(run.call_args_list, [
            call(['dotnet', 'restore', project, '--locked-mode'], check=True),
            call(['dotnet', 'run', '--no-restore', '--project', project, '--',
                  *map(str, paths)], check=True),
        ])

    def test_failed_locked_restore_prevents_patcher_execution(self):
        error = build.subprocess.CalledProcessError(1, ['dotnet', 'restore'])
        with patch.object(build.subprocess, 'run', side_effect=error) as run:
            with self.assertRaises(build.subprocess.CalledProcessError):
                build.run_patcher(*[Path(name) for name in ('native', 'script', 'output', 'audit')])
        self.assertEqual(run.call_count, 1)
        self.assertIn('--locked-mode', run.call_args.args[0])

    def test_rejects_unusable_release_manifests(self):
        hero = {'hero_id': 6, 'name': 'Abrams', 'release_date': '2024-04-24'}
        invalid = [[], {}, [None], [hero, hero]]
        for field, value in [('hero_id', True), ('hero_id', 0), ('hero_id', -1),
                             ('hero_id', '6'), ('release_date', 'not-a-date'),
                             ('release_date', '2026-02-30'), ('release_date', '20260101'),
                             ('release_date', 20260101), ('name', ''), ('name', ' Abrams')]:
            invalid.append([dict(hero, **{field: value})])
        invalid.append([{'hero_id': 6}])
        for manifest in invalid:
            with self.subTest(manifest=manifest):
                validator = getattr(build, 'validate_heroes', None)
                self.assertTrue(callable(validator), 'Release manifest validation is missing')
                assert callable(validator)
                with self.assertRaises(ValueError):
                    validator(manifest)

    def test_validates_and_sorts_without_mutating_source(self):
        heroes = [{'hero_id': 10, 'name': 'New hero', 'release_date': '2026-01-02'},
                  {'hero_id': 15, 'name': 'Bebop', 'release_date': '2024-04-24'},
                  {'hero_id': 6, 'name': 'Abrams', 'release_date': '2024-04-24'}]
        before = copy.deepcopy(heroes)
        self.assertEqual([hero['hero_id'] for hero in build.validate_heroes(heroes)], [6, 15, 10])
        self.assertEqual(heroes, before)


if __name__ == '__main__':
    unittest.main()
