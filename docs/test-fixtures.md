# Local integration-test fixtures

The integration suite reads native binaries/XML from `.work/`, ignored by Git. The builder uses temporary staging and does **not** populate these persistent fixtures. A fresh checkout needs the preparation below after installing the pinned CLI from the README.

Run from the repository root. All outputs stay under `.work/`; these commands do not launch a GUI, install the mod, or change the game.

```bash
export DEADLOCK_GAME="/path/to/SteamLibrary/steamapps/common/Deadlock"
VRF="$PWD/.work/vrf/Source2Viewer-CLI"
VPK="$DEADLOCK_GAME/game/citadel/pak01_dir.vpk"
LAYOUT=panorama/layout/popups/citadel_popup_roster_select.vxml_c
mkdir -p .work/extracted/panorama/layout/popups .work/ui/panorama/layout/popups

"$VRF" -i "$VPK" -f "$LAYOUT" -o ".work/extracted/$LAYOUT"
test -s ".work/extracted/$LAYOUT"
"$VRF" -i ".work/extracted/$LAYOUT" \
  -o .work/ui/panorama/layout/popups/citadel_popup_roster_select.xml -d
test -s .work/ui/panorama/layout/popups/citadel_popup_roster_select.xml

python3 -m unittest discover -s tests -v
node --test tests/roster_sort.test.cjs
```

Stop if a step fails. Source2Viewer can return zero despite reporting an extraction exception, hence the explicit output checks. Do not silently reuse stale fixtures after a game update. Set `DEADLOCK_GAME` so the actual-build integration test can find the installed game.

Source-script/manifest tests do not need extracted game assets, but the full resource/packaging suite needs the CLI and fixtures. The packaged-script harness executes independently decompiled VPK payloads in Node with native-structure panel doubles. It deliberately drops injected ranks to prove chronology assertions can fail; it does not substitute for real engine verification.

The preparation sequence and full integration suite were exercised against the build recorded in [verification](verification.md). Extracted native resources are not committed as fixtures.
