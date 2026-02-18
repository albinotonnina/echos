# Releasing EchOS

This document explains how releases work — for the maintainer (you) and for users.

---

## The big picture

EchOS uses **git tags** to drive releases. When you push a tag like `v0.2.0`, GitHub Actions takes over and does everything automatically:

```
you: git tag v0.2.0 && git push origin v0.2.0
         │
         ▼
GitHub Actions (release.yml)
         │
         ├─► Build Docker image for linux/amd64 + linux/arm64
         │        └─► Push to ghcr.io/albinotonnina/echos:0.2.0
         │        └─► Push to ghcr.io/albinotonnina/echos:latest
         │
         ├─► Create GitHub Release
         │        └─► Auto-generated changelog from commits since last tag
         │
         └─► Deploy to your VPS (if deploy secrets are configured)
                  └─► SSH in → docker compose pull → docker compose up -d
```

You don't build anything locally. You don't SSH anywhere. You just tag and push.

---

## How to cut a release (maintainer)

### 1. Make sure main is in a good state

```bash
pnpm typecheck   # no type errors
pnpm test        # all tests pass
pnpm start       # manually verify it works
```

### 2. Choose a version number

EchOS uses [Semantic Versioning](https://semver.org/):

| Change | Version bump | Example |
|---|---|---|
| Bug fixes, small improvements | patch | `v0.1.0` → `v0.1.1` |
| New features, new plugins | minor | `v0.1.0` → `v0.2.0` |
| Breaking changes (config schema, API) | major | `v0.1.0` → `v1.0.0` |

### 3. Tag and push

```bash
git tag v0.2.0
git push origin v0.2.0
```

That's it. Go to the **Actions** tab on GitHub to watch the pipeline run.

### 4. Check the results

After ~10-15 minutes:

- **GitHub Release** created at `https://github.com/albinotonnina/echos/releases` with an auto-generated changelog
- **Docker image** available at `ghcr.io/albinotonnina/echos:0.2.0` and `:latest`
- **Your VPS** running the new version (`ssh your-server 'cd echos/docker && docker compose ps'`)

### If something goes wrong mid-release

The three jobs (docker, release, deploy) run independently after the image is built. If deploy fails but the image published fine, you can redeploy manually:

```bash
# Option A: re-run the failed job from the GitHub Actions UI
# Actions → release.yml → the failed run → Re-run failed jobs

# Option B: force redeploy from your machine
pnpm run deploy
```

---

## What other users get

When someone else self-hosts EchOS, they don't need to clone the source or build anything. Their `docker-compose.yml` just references the pre-built image:

```yaml
services:
  echos:
    image: ghcr.io/albinotonnina/echos:latest   # ← pulled from GitHub's registry
    ...
```

When a new version is released, they update by running:

```bash
docker compose pull
docker compose up -d
```

Or, if they installed via `install.sh` and run it directly with Node:

```bash
pnpm update-echos
```

### Pinning to a specific version

Users who don't want automatic updates can pin to a version tag:

```yaml
image: ghcr.io/albinotonnina/echos:0.2.0   # won't change until you edit this
```

---

## What the changelog looks like

GitHub auto-generates the changelog from commits and PR titles since the previous tag. This is why commit message format matters — use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add RSS feed plugin
fix: handle undefined cron schedule in wizard
docs: update deployment guide
chore: bump dependencies
```

A release changelog ends up looking like:

```
## What's Changed
* feat: add RSS feed plugin by @albinotonnina in #42
* fix: handle undefined cron schedule in wizard by @albinotonnina in #43
* chore: bump dependencies by @dependabot in #44

**Full Changelog**: https://github.com/albinotonnina/echos/compare/v0.1.0...v0.2.0
```

---

## Deleting a bad tag

If you tagged too early and need to redo it:

```bash
# Delete locally
git tag -d v0.2.0

# Delete on GitHub (this will also cancel the running workflow)
git push origin :refs/tags/v0.2.0

# Fix whatever was wrong, then re-tag
git tag v0.2.0
git push origin v0.2.0
```

---

## Manual deploy (without a release)

If you need to push a fix to your VPS urgently without cutting a release:

```bash
# Option A: use the manual deploy workflow
# GitHub → Actions → "Deploy to VPS" → Run workflow

# Option B: use the local deploy script (builds image locally)
pnpm run deploy
```

Neither of these creates a GitHub Release or publishes a Docker image to ghcr.io.
