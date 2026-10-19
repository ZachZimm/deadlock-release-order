# Distribution and maintenance

## Download

The release ZIP contains one root-level VPK, a README, informational metadata and the full MIT license. Players do not need Python, .NET, a resource compiler, an injector or a separate script runtime.

Use Deadlock Mod Manager's **Add Local Mod** flow to import the ZIP. The actual manager flow was exercised on `lab`; see [verification](verification.md). The manager can rename/reorder installed archives. Internal asset paths, not archive filenames, determine conflicts.

`release.json` is informational. It is not a Mod Manager manifest, GameBanana listing, enforced Steam-build range, or automatic compatibility mechanism. Local imports do not receive GameBanana update checks. GitHub availability alone does not make a mod discoverable in the manager's GameBanana catalog.

## License and credits

The authored ordering script and build code are MIT licensed. Include the full copyright/permission notice when redistributing them. The download includes `LICENSE`; the packaged README separately states that Valve's native UI resources remain Valve's property and are not relicensed.

Hero Select Plus was researched as a concrete example of compiled Panorama script includes. None of its script, style, card layout or hero-data table is shipped here. Release-date sources are retained in `data/heroes.json`.

The public repository starts with a clean source snapshot. It does not expose the earlier full-hero-definition binary, unrelated local research artifacts, personal filesystem paths or legacy development history.

## Conflicts

The VPK overrides:

- `panorama/layout/popups/citadel_popup_roster_select.vxml_c`

It adds:

- `panorama/scripts/release_order.vjs_c`

Any other provider of either path needs review. In particular, the native popup override conflicts with Hero Select Plus. A skin-only mod that supplies different paths is not inherently a conflict; the actual `lab` test retained existing cosmetic mods.

Disable the earlier hero-definition-based version before enabling this version. Do not rely on `pak99` to win. Manager health/repair badges are not compatibility certification, and automatic merging should not be assumed safe for arbitrary layout replacements.

## Update procedure

1. Disable after an unverified game update.
2. Run `tools/check_compatibility.py` against current vanilla. A changed popup fingerprint requires review/rebuild; an unchanged one does not prove all game components compatible.
3. Update source-linked dates when a hero reaches the normal main roster. Unknown heroes remain visible, but exact chronology requires updated data.
4. Rebuild, run tests, exercise the exact VPK in game, and test manager import/enable/disable/restart behavior.
5. Update `data/validation.json` only with actual evidence for the exact VPK hash/build. Verification flags default to false for mismatches.
6. Regenerate the ZIP/checksums and publish the refreshed release with its exact tested build, asset paths and limitations.

The builder stages and verifies outputs before writing distribution files, but does not promise a transactional multi-file update. Do not serve a release directory while a build is actively replacing its files.

No online-matchmaking safety, anti-cheat approval or Valve endorsement is implied by local testing.

Sources: [manager library](https://docs.deadlockmods.app/using-mod-manager/library), [game updates](https://docs.deadlockmods.app/modding/game-updates), [manager conflicts](https://github.com/deadlock-mod-manager/deadlock-mod-manager/blob/main/apps/desktop/src-tauri/src/mod_manager/conflicts.rs).
