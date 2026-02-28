---
name: update-homebrew-formula
description: 'Update homebrew/echos.rb with the latest git tag SHA256 and push to the homebrew-echos tap repository.'
---

# Update Homebrew Formula

Updates `homebrew/echos.rb` in this repo with the latest release tag and syncs it to the `homebrew-echos` tap repository on GitHub.

## When to Use This Skill

- User says "update the homebrew formula"
- User says "release a new homebrew version"
- User asks to "bump the formula" or "update the tap"

## Steps

Execute in order. Stop and report if any step fails.

### Step 1: Get the latest tag

```bash
git fetch --tags
git tag --sort=-v:refname | head -1
```

Note the tag (e.g. `v0.7.5`). This is the version to release.

### Step 2: Fetch the tarball SHA256

```bash
curl -sL https://github.com/albinotonnina/echos/archive/refs/tags/<TAG>.tar.gz | sha256sum
```

Copy the hex hash (before the `-`).

### Step 3: Update homebrew/echos.rb in this repo

In `homebrew/echos.rb`, update the `url` and `sha256` lines to the new tag and hash:

```ruby
url "https://github.com/albinotonnina/echos/archive/refs/tags/<TAG>.tar.gz"
sha256 "<HASH>"
```

If the lines are commented out, uncomment them. Never leave placeholder text.

### Step 4: Find the local homebrew-echos clone

```bash
find ~/Code ~/CodePersonal ~ -maxdepth 3 -name "homebrew-echos" -type d 2>/dev/null | head -1
```

### Step 5: Sync to the tap repo and push

```bash
cp homebrew/echos.rb <HOMEBREW_ECHOS_PATH>/Formula/echos.rb
cd <HOMEBREW_ECHOS_PATH>
git add Formula/echos.rb
git commit -m "echos <TAG>"
git push origin main
```

### Step 6: Confirm

Report back:
- Which tag was used
- The SHA256 hash applied
- That the tap repo was pushed successfully
