# Releasing Scatter apps

Scatter has four pieces. Only the **GUI desktop app** ships as a GitHub
Release; the others are deployed services or built from source:

| Piece              | Kind         | How it ships                                       |
| ------------------ | ------------ | -------------------------------------------------- |
| `apps/web`         | service      | Vercel (push to `main`)                            |
| `apps/coordinator` | service      | Fly.io (`fly deploy`)                              |
| **`apps/gui`**     | **download** | Tauri installers via this release flow             |
| `apps/node` (CLI)  | build-from-source | clone repo + `pnpm --filter node build` (for now) |

The GUI release is fully automated by
[`.github/workflows/release.yml`](./.github/workflows/release.yml) and is
triggered by pushing a **SemVer tag**. The download page on the site
(`apps/web/app/download/page.tsx`) reads the **latest GitHub release** at
runtime and resolves the correct installer URL per platform, so a new release
appears on the site automatically — no site redeploy or URL edits needed.

The headless **node CLI is not packaged as a release artifact** right now;
power users build it from the repo (see below).

## Cutting a release

1. **Bump versions** so the tag matches the artifacts. Set the same version in:
   - `apps/gui/package.json` (`version`)
   - `apps/gui/src-tauri/tauri.conf.json` (`version`)
   - `apps/gui/src-tauri/Cargo.toml` (`package.version`)

   Commit the bump to `main`.

2. **Tag and push**:

   ```sh
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. **Watch the workflow.** The `gui` matrix runs on macOS (Apple Silicon +
   Intel), Windows, and Linux — each builds the Tauri installers for that OS
   and attaches them to the release.

4. **Publish.** The release is created as a **draft**. Open it on GitHub,
   confirm every installer is attached, write the changelog, and click
   **Publish**. The site's download buttons start resolving to it once it is
   published (drafts and prereleases are ignored by `releases/latest`).

To redo a botched release: delete the draft release and the tag
(`git push origin :v0.1.0`), then re-tag.

## What artifacts users get

**GUI** (per `bundle.targets: "all"` in `tauri.conf.json`):

| OS      | Files                                          |
| ------- | ---------------------------------------------- |
| macOS   | `Scatter_<ver>_aarch64.dmg`, `..._x64.dmg` (+ `.app` archives) |
| Windows | `Scatter_<ver>_x64-setup.exe` (NSIS), `..._x64_en-US.msi` |
| Linux   | `scatter_<ver>_amd64.deb`, `..._amd64.AppImage` |

The download page matches these by extension/arch
(`.dmg` + `aarch64`/`x64`, `-setup.exe`/`.msi`, `.AppImage`/`.deb`), so the
filenames can carry the version without breaking the links.

**node CLI** (build from source for now):

```sh
git clone https://github.com/scattertools/scatter
cd scatter && pnpm install --frozen-lockfile
pnpm --filter node build
node apps/node/dist/cli.js start --coordinator https://api.scatter.tools
```

For a background service, follow
[`apps/node/service/README.md`](./apps/node/service/README.md) (systemd /
launchd / NSSM). To ship the CLI as a downloadable tarball later, add a job
that runs `pnpm --filter node deploy --prod` and attaches the tree to the
release.


## Code signing (not yet enabled)

Releases are currently **unsigned**, so OS install warnings appear:

- **macOS**: right-click the app → **Open** (one-time Gatekeeper bypass).
- **Windows**: **More info → Run anyway** on the SmartScreen prompt.

To remove these later, add signing to the `gui` job:

- **macOS notarization**: set `APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` as repo secrets (requires a paid Apple
  Developer account). `tauri-action` reads them automatically.
- **Windows**: configure a code-signing cert via Tauri's
  `bundle.windows.certificateThumbprint` / signing env vars.

## Tauri updater (optional, future)

`tauri.conf.json` has no `updater` plugin configured, so the desktop app does
**not** self-update — users download each new version manually. To enable
in-app updates later, add the updater plugin + an `TAURI_SIGNING_PRIVATE_KEY`
secret and publish a `latest.json` alongside the installers.
