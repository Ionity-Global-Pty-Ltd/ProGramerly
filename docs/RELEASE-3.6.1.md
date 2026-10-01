# ProGramerly 3.6.1: the DOME in 3D, a real icon set, and Apple Silicon

Ionity (Pty) Ltd | AEDI | Policy 986 AED | 2026-10-01
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-001 | Catalog 1.3.0 | Supersedes 3.6.0 (2026-09-29)

## What changed

**The DOME is three-dimensional.** `src/renderer/dome3d.js` is a new
dependency-free renderer for a shaded glass hemisphere.

- Five strata are drawn as lit bands, with 40 depth-sorted sectors per band and Lambert lighting.
- Each segment is a node you can hover for its value and class.
- Drag the dome to turn it. Click it to open the stratum.
- An apex beacon and a ground ring sit at the top and the base.
- Rendering pauses when the dome is off-screen.

It replaces the flat SVG in three places: the deck card, the hero of the DOME
workspace and the intro. Each figure keeps its class (`measured`, `computed`,
an assessment, or state). A segment that has not been read yet is drawn as
structure only.

**The intro.** The Ionity implosion film plays first (4.5 s, cropped to the
burst). The official IONITY wordmark comes out of it, and then the glass DOME
assembles band by band. The whole intro runs in about 9 seconds and stays
under the 12-second cap.

**A custom icon set.** `src/renderer/icons.js` (`window.PGIcons`) has 29
icons on a 32-pixel grid. Each icon has three layers: a gradient body, a cyan
line and an orange accent. They replace the generic glyphs on every tile, the
dock and the top bar. The dock magnifies as the pointer approaches. Tiles tilt
in 3D under the pointer and their icons light up.

**The official IONITY logo** comes from `TEMPLATE_2026_OFFICAL_v1.1`. It is
fixed in the bottom-right corner, small, in both the app and the website. The
dock and the build chip have moved so that nothing overlaps it.

**Website (ionity.digital).**

- Every card has a custom icon, a 3D tilt and a light that follows the pointer.
- "What is inside" is now a tool page with ten cards. Hovering or focusing a card opens it to show what the tool does and its key terms. On a touch screen, tap to open.
- A 3D DOME sits under the hero. It is an illustration with example readings and is labelled as such.
- The brand film section plays muted while it is on screen, with an opt-in sound button.
- The corner logo links to ionity.co.za.

**macOS Apple Silicon is in the release.** In 3.6.0 the macOS job counted any
`.dmg` as success, so the arm64 image could go missing without anyone
noticing. CI now builds each architecture separately, with three retries and
a forced detach of stale `hdiutil` volumes. The job fails unless both
`ProGramerly-<v>-arm64.dmg`, `-arm64-mac.zip`, `-x64.dmg` and `-mac.zip` exist.
For Apple Silicon, the download page picks the arm64 `.dmg` and falls back to
the arm64 `.zip`.

No account is linked, and no catalog item changed.

## Verification

- `scripts/syntax-check.js`, `validate-catalog.js` and `test-predict.js` (14 checks) all pass.
- `ui-check-350.js` and `ui-check-360.js` were run against the real application under Xvfb. The version check now reads `package.json`.
- Headless screenshots show the deck DOME, the DOME workspace hero, the intro (burst → logo → dome), the corner logo with no overlap, and the site's hero dome, tool cards and film. No page errors.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM

BUILDING TOMORROW, TODAY
