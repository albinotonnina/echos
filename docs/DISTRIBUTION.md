# Distribution Options for EchOS

This document explores different ways to distribute EchOS for easy installation, comparing the npm global install approach (like openclaw) with alternatives.

---

## 1. The OpenClaw Approach (npm global install)

### How it works

OpenClaw distributes as an npm package with a CLI entry point:

```json
{
  "name": "openclaw",
  "version": "2026.2.16",
  "bin": {
    "openclaw": "openclaw.mjs"
  },
  "type": "module",
  "files": [
    "openclaw.mjs",
    "dist/",
    "extensions/",
    "skills/"
  ]
}
```

Users can install globally and run commands:

```bash
npm install -g openclaw@latest
# or
pnpm add -g openclaw@latest

openclaw onboard --install-daemon
```

### What would be needed for EchOS

To adopt this approach, EchOS would need:

1. **Add a `bin` field to root `package.json`**:
   ```json
   {
     "bin": {
       "echos": "./dist/index.js"
     }
   }
   ```

2. **Build the package for distribution** (compile TypeScript to JS)

3. **Handle environment configuration** - currently EchOS requires `.env` file. Options:
   - Interactive setup wizard (like openclaw's `onboard`)
   - Default configuration with required env vars
   - First-run configuration prompt

4. **Handle data directory** - currently uses `./data` relative to CWD

### Challenges for EchOS

| Challenge | Severity | Solution |
|-----------|----------|----------|
| Native dependencies (`better-sqlite3`, `lancedb`) | High | Use prebuild binaries, or switch to pure JS alternatives |
| Environment configuration | Medium | Interactive CLI wizard or defaults |
| Multiple interfaces (Telegram, Web, TUI) | Medium | Allow selecting interfaces via flags |
| Redis dependency for scheduler | Low | Make optional, graceful degradation |
| pnpm workspace structure | High | Restructure as single package or use workspaces properly |

---

## 2. Alternative Distribution Methods

### Option A: Standalone Script (Quickest)

Create a shell script that handles installation:

```bash
#!/bin/bash
# install-echos.sh

set -e

echo "Installing EchOS..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js 20+ required"
    exit 1
fi

# Clone or use existing
if [ ! -d "echos" ]; then
    git clone https://github.com/albinotonnina/echos.git echos
fi

cd echos
pnpm install
pnpm build

echo "EchOS installed! Copy .env.example to .env and configure."
```

**Pros**: Simple, no restructuring needed
**Cons**: Requires git, pnpm, building from source

---

### Option B: Homebrew Tap (macOS)

```ruby
# Formula/echos.rb
class EchOS < Formula
  desc "Agent-driven personal knowledge management"
  homepage "https://github.com/albinotonnina/echos"
  url "https://github.com/albinotonnina/echos/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "..."
  license "MIT"
  
  depends_on "node@20"
  depends_on "pnpm"
  
  def install
    system "pnpm", "install"
    system "pnpm", "build"
    bin.install "src/index.ts"
  end
end
```

**Usage**:
```bash
brew tap albinotonnina/echos
brew install echos
echos start
```

---

### Option C: Docker (Already Implemented ✅)

EchOS already has Docker support:

```bash
# From docker/
docker-compose up -d

# Or build manually
docker build -t echos .
docker run -it -p 3000:3000 --env-file .env echos
```

**Pros**: Works now, handles all dependencies
**Cons**: Requires Docker, less "app-like" feel

---

### Option D: Systemd Service + Deb/RPM Package

For Linux servers:

```bash
# echos.deb / echos.rpm
# Installs to /usr/bin/echos
# Creates user 'echos'
# Sets up systemd service
# Config: /etc/echos/echos.conf
# Data: /var/lib/echos/
```

---

### Option E: NPX (No Install)

```bash
npx echos@latest
# or
pnpm dlx echos@latest
```

**Limitation**: Doesn't work well for long-running services (Telegram bot)

---

### Option F: Hybrid - CLI Tool + Optional Daemon

This is similar to what you're asking about:

```bash
# Install just the CLI
npm install -g @echos/cli

# Run commands
echos init          # Create config in ~/.echos/
echos start         # Start the daemon
echos status        # Check daemon status
echos stop          # Stop daemon
echos logs          # View logs
echos telegram      # Start Telegram bot only
echos web           # Start web interface only
```

This separates the CLI tool from the running service.

---

## 3. Recommended Path for EchOS

Given the current architecture, here's what I'd recommend:

### Phase 1: Minimal Changes (Quick Win)

Add a simple install script that works with existing structure:

```bash
#!/bin/bash
# install.sh
curl -sL https://github.com/albinotonnina/echos/raw/main/scripts/install.sh | bash
```

The script would:
1. Check Node.js/pnpm versions
2. Clone the repo (or extract tarball)
3. Run `pnpm install && pnpm build`
4. Guide user through `.env` setup

### Phase 2: Add CLI Entry Point

Add to root `package.json`:

```json
{
  "bin": {
    "echos": "./dist/index.js"
  }
}
```

After building, users can:
```bash
pnpm install -g .
echos --help
```

### Phase 3: Build & Publish to npm

```bash
npm publish --access public
# or
pnpm publish
```

Then:
```bash
npm install -g echos
echos start
```

---

## 4. Comparison Matrix

| Method | Ease of Use | Dev Effort | User Experience | Works for EchOS? |
|--------|-------------|------------|------------------|------------------|
| npm global | ⭐⭐⭐⭐⭐ | Medium | ⭐⭐⭐⭐⭐ | ⚠️ Needs native deps handling |
| Docker | ⭐⭐⭐ | Low | ⭐⭐⭐ | ✅ Done |
| Homebrew | ⭐⭐⭐⭐ | Medium | ⭐⭐⭐⭐ | ⚠️ macOS only |
| Script | ⭐⭐⭐ | Low | ⭐⭐⭐ | ✅ Simple |
| Deb/RPM | ⭐⭐⭐⭐ | High | ⭐⭐⭐⭐ | Linux servers |

---

## 5. OpenClaw Deep Dive

Looking at openclaw's approach more closely:

### Key elements that make it work:

1. **Pre-built binaries**: Their `openclaw.mjs` is bundled (using tsdown)
2. **Self-contained**: No external build step needed for users
3. **Extensions system**: Separate from core, can be added later
4. **Platform detection**: Handles macOS, Linux, Windows differently

### What they'd need to change for full npm distribution:

- Bundle all TypeScript to JS
- Handle `better-sqlite3` / `lancedb` native rebuilds
- Add interactive onboarding
- Set up proper npm org/package

---

## 6. Next Steps

If you want to pursue the npm approach:

1. **Test the build**: Ensure `pnpm build` produces working JS
2. **Add bin entry**: Modify root `package.json`
3. **Create onboarding**: Interactive CLI for `.env` setup
4. **Handle native deps**: Test on clean machines
5. **Publish**: Set up npm account and publish

Would you like me to implement any of these options?
