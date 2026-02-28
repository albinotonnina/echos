# EchOS Homebrew Formula

This directory contains the Homebrew formula for EchOS. There are two ways to distribute it:

- **Tap (now)**: a separate `homebrew-echos` GitHub repository you maintain — users run `brew tap albinotonnina/echos` first
- **homebrew-core (future)**: the official Homebrew registry — no tap needed, just `brew install echos`

---

## How the Formula Works

The formula has two installation modes:

- **Stable** (`url` + `sha256`): installs from a specific tagged GitHub release tarball. This is what most users get. It is currently **commented out** in `echos.rb` because it requires a real published tag on GitHub — the tarball URL only works after `git push --tags`.
- **HEAD** (`head`): installs directly from the `main` branch. Active right now as the only working mode. Used with `brew install --HEAD echos`.

Once you publish your first release tag (see below), you uncomment and fill in `url`/`sha256` so stable installs work.

---

## Current Status: Tap Distribution

### One-time setup — create the tap repository

```bash
# Create the tap repo on GitHub (must be named homebrew-<something>)
gh repo create albinotonnina/homebrew-echos --public

git clone https://github.com/albinotonnina/homebrew-echos.git
cd homebrew-echos
mkdir -p Formula
cp /path/to/echos/homebrew/echos.rb Formula/echos.rb
git add Formula/echos.rb
git commit -m "Add echos formula"
git push origin main
```

Users then install with:

```bash
brew tap albinotonnina/echos
brew install echos
# or HEAD-only until a release tag exists:
brew install --HEAD echos
```

---

## Releasing a New Version

This updates **two files**: `homebrew/echos.rb` in this repo (source of truth) and `Formula/echos.rb` in the `homebrew-echos` tap repo.

### Step 1 — Create and push a Git tag

```bash
git tag v0.X.X
git push origin v0.X.X
```

GitHub automatically creates a tarball at:
`https://github.com/albinotonnina/echos/archive/refs/tags/v0.X.X.tar.gz`

### Step 2 — Get the tarball SHA256

```bash
curl -sL https://github.com/albinotonnina/echos/archive/refs/tags/v0.X.X.tar.gz | sha256sum
```

Copy the hash (the long hex string before the `-`).

### Step 3 — Update `echos.rb` in this repo

In `homebrew/echos.rb`, replace the commented-out block:

```ruby
# Stable URL is disabled until a release provides the tarball sha256.
# url "https://github.com/albinotonnina/echos/archive/refs/tags/v0.7.4.tar.gz"
# sha256 "will be set by the release process"
```

With the real values (uncommented):

```ruby
url "https://github.com/albinotonnina/echos/archive/refs/tags/v0.X.X.tar.gz"
sha256 "<paste hash here>"
```

### Step 4 — Sync to the tap repository

```bash
cd /path/to/homebrew-echos
cp /path/to/echos/homebrew/echos.rb Formula/echos.rb
git add Formula/echos.rb
git commit -m "echos v0.X.X"
git push origin main
```

Users who already have the tap will get the update on `brew upgrade echos`.

---

## Local Development & Testing

Test the formula from your local file without publishing:

```bash
# HEAD mode (from main branch):
brew install --build-from-source --HEAD ./homebrew/echos.rb

# Stable mode (after updating url/sha256):
brew install --build-from-source ./homebrew/echos.rb

# Run the formula audit:
brew audit --strict ./homebrew/echos.rb
```

---

## Future: Getting into homebrew-core (no tap needed)

`homebrew-core` is the official registry. When a formula is accepted there, users install with just `brew install echos` — no `brew tap` required.

### Requirements to be accepted

- The project must be **open source** with a stable release
- **Notable adoption**: roughly 75–100+ GitHub stars and real-world usage (the Homebrew team reviews this manually)
- The formula must pass `brew audit --new-formula --strict echos.rb` with no errors
- No "versioned" or moving-target dependencies — pinned versions like `node@20` are fine
- HEAD-only formulas are not accepted; a stable tagged release is required

### How to submit

1. Make sure you have a stable tagged release and a passing audit
2. Fork [Homebrew/homebrew-core](https://github.com/Homebrew/homebrew-core)
3. Copy `echos.rb` into `Formula/e/echos.rb` in your fork
4. Open a pull request — the Homebrew team will review it
5. Once merged, users can `brew install echos` directly

Until acceptance, keep the tap as the distribution method. You can continue updating the tap formula as normal even after submitting to homebrew-core.
