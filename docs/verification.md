# Verification — Release Order Roster 0.2.1

## Artifact identity

Source/tested Steam build: **26020302**, Linux/Proton. The exact VPK tested on `lab` has SHA-256:

```
f66d647139ab7fd8ff87b371c6cf95f42b1c63b883fe98178767bd2b71102248
```

The manager-installed archive is named `pak12_dir.vpk`; the download contains the same bytes as `pak99_dir.vpk`. Names are not load-priority guarantees. Verification flags in `data/validation.json` are bound to this hash and source build.

## Flicker root cause and correction

Version 0.2.0 moved native roster wrappers into release order, then corrected them on a 0.25-second timer. Runtime instrumentation showed that the game reuses those wrappers **by sibling index**, assigning the alphabetical hero list back into them on subsequent hover/selection updates. Moving the wrappers therefore changed the game's index-to-content mapping. The result was an alphabetical flash until the next corrective tick.

Version 0.2.1 leaves native siblings and card instances untouched. It measures native card spacing/UI scale, disables flowing layout for this grid, and assigns release-ranked visual coordinates plus an explicit scroll height. Native hover updates retain the same index/content mapping and no longer require a corrective sibling reorder. The watchdog handles delayed geometry, replacement wrappers, changed populations and window width. Cached assigned styles avoid continuously invalidating native layout when Panorama's style getters are opaque.

## Actual game checks

The final VPK above was installed into the existing **Release Order Roster** manager record and local-mod cache on `lab`. **Deadlock Mod Manager 1.1.0 (Flatpak)** launched the actual game through Steam. This validation exercised an update of the existing installation, not a new ZIP import; the original import/disable/remove lifecycle is documented separately in [0.2.0 verification](verification-0.2.0.md).

- Recorded **32 hover changes** across the first, middle and last roster rows over **20 seconds**.
- Captured **1,200 video frames** at 60 captures/second. This is capture rate, not a claim of 60 game-rendered frames/second.
- A frame classifier compared inner portrait crops across 44 slots against fixed release-order and alphabetical templates: **1,200 release-order frames, 0 alphabetical frames, 0 ambiguous frames**. This checks the visible order, rather than merely the final sorted state.
- An earlier 0.2.0 baseline recording contained both orders: 240 alphabetical and 156 release-order frames. The shorter baseline is not duration-matched to the final recording.
- The final capture ended on Violet with the live game still responding; no fatal content error or `[release-order] Stopped` appeared on `lab`.
- Native quick search highlighted Violet. Clicking Violet, reopening and selecting Abrams, then reopening and selecting Bebop each closed the picker and selected the correct visual-slot hero in the room.
- Known heroes retain manifest release order and alphabetical ties; locked Nurse Harrow remains last. Native controls and existing cosmetic mods were retained.

[Download the cropped transition recording](https://github.com/ZachZimm/deadlock-release-order/releases/download/v0.2.1/flicker-fix.mp4)

![0.2.1 roster grid during the actual lab test](roster-0.2.1.png)

### Development-machine limitation

On `zen`, isolated Xvfb/Proton tests reproduced the old flicker and showed the new visual layout. Extended scene-hover tests then reported the **base game's `pak01.vpk` as corrupt**, so frozen/error-dialog recordings from those attempts are not accepted as final transition evidence. No base game file was repaired or replaced. Sandbox SteamVR log, shader-cache and dump-directory write warnings also occurred. Final runtime acceptance comes from the successful normal-game test on `lab`, not from subprocess exit codes or the failed sandbox runs.

## Installation safety

The installed VPK and cached local-import VPK were updated in place on both `lab` and `zen`, with originals, manager state, manifest and gameinfo backed up outside addons. Readback verified the exact final VPK. Other addon payloads and the selected Jacket variant were left unchanged. The game is not launched on `zen` as part of this update.

## Automated checks

**16 JavaScript tests and 16 Python tests pass.** The Release .NET build has **0 warnings and 0 errors**.

The styled-panel regressions check zero native sibling moves, stable index/content assignments between watchdog callbacks, scaled geometry, opaque style getters, delayed layout readiness, same-signature replacement wrappers, filtered/empty/larger populations, resize wrapping and scroll extent. The actual packaged script is independently extracted/decompiled and executed against all 43 manifest heroes, unknown cards and nonhero slots; dropping the rank injection must fail the same harness.

Existing checks cover strict manifest validation, locked NuGet restore, exact native-layout preservation after removing the one added include, VJS v4 raw DATA, exact two-asset VPK contents, independent byte equality, licensed ZIP contents, compatibility fingerprints, and hash/build-bound verification metadata. Identical-input builds are compared for reproducibility; see `dist/SHA256SUMS` for download hashes.

## Limits

No matchmaking/anti-cheat-policy certification, Valve approval, gamepad-specific certification, or real-engine non-English-locale certification is claimed. The mod still replaces one UI layout and conflicts with other replacements. A matching layout fingerprint is not complete game-update compatibility enforcement. Initial display/new population timing is distinct from the tested hover flicker; the watchdog is not a verified engine pre-render callback.
