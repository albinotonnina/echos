# EchOS Homebrew Formula

This directory contains the Homebrew formula for EchOS.

## Publishing as a Tap

To publish this as a Homebrew tap, create a separate repository named `homebrew-echos`:

```bash
# Create the tap repository
gh repo create albinotonnina/homebrew-echos --public

# Copy the formula
cp homebrew/echos.rb <path-to-homebrew-echos>/Formula/echos.rb

# Users can then install with:
brew tap albinotonnina/echos
brew install echos
```

## Updating the Formula

When releasing a new version:

1. Create a new Git tag: `git tag v0.X.X`
2. Get the tarball SHA256: `curl -sL https://github.com/albinotonnina/echos/archive/refs/tags/vX.X.X.tar.gz | sha256sum`
3. Update the `url` and `sha256` in `echos.rb`
4. Push to the `homebrew-echos` repository

## Development

To test the formula locally:

```bash
brew install --build-from-source --HEAD ./homebrew/echos.rb
```
