class Echos < Formula
  desc "Secure, self-hosted, agent-driven personal knowledge management system"
  homepage "https://github.com/albinotonnina/echos"
  url "https://github.com/albinotonnina/echos/archive/refs/tags/v0.8.0.tar.gz"
  sha256 "13b38d1b7f0de9e7b65f6dfd0be0ddff56a7b9272eff66b189dce685bed6106e"
  license "MIT"
  head "https://github.com/albinotonnina/echos.git", branch: "main"

  depends_on "node@20"
  depends_on "redis"

  def install
    # Install pnpm into a local prefix to avoid writing into Homebrew's Node cellar
    pnpm_prefix = buildpath/"pnpm-global"
    system "npm", "install", "-g", "pnpm@10.30.1", "--prefix", pnpm_prefix
    ENV.prepend_path "PATH", pnpm_prefix/"bin"

    # Install dependencies with prebuilt native modules
    system "pnpm", "install", "--frozen-lockfile"

    # Build all packages
    system "pnpm", "build"

    # Install into libexec (the full project)
    libexec.install Dir["*"]

    # Create wrapper script that points to the CLI
    (bin/"echos").write <<~SH
      #!/bin/bash
      [ -f "$HOME/.config/echos/home" ] && ECHOS_HOME="${ECHOS_HOME:-$(cat "$HOME/.config/echos/home")}"
      export ECHOS_HOME="${ECHOS_HOME:-$HOME/echos}"
      export NODE_ENV="${NODE_ENV:-production}"
      cd "#{libexec}"
      if [ -f "$ECHOS_HOME/.env" ]; then
        exec "#{Formula["node@20"].opt_bin}/node" "--env-file=$ECHOS_HOME/.env" "#{libexec}/packages/cli/dist/index.js" "$@"
      else
        exec "#{Formula["node@20"].opt_bin}/node" "#{libexec}/packages/cli/dist/index.js" "$@"
      fi
    SH

    # Create a wrapper for the daemon
    (bin/"echos-daemon").write <<~SH
      #!/bin/bash
      [ -f "$HOME/.config/echos/home" ] && ECHOS_HOME="${ECHOS_HOME:-$(cat "$HOME/.config/echos/home")}"
      export ECHOS_HOME="${ECHOS_HOME:-$HOME/echos}"
      export NODE_ENV="${NODE_ENV:-production}"
      cd "#{libexec}"
      if [ -f "$ECHOS_HOME/.env" ]; then
        exec "#{Formula["node@20"].opt_bin}/node" "--env-file=$ECHOS_HOME/.env" --import tsx "#{libexec}/src/index.ts" "$@"
      else
        exec "#{Formula["node@20"].opt_bin}/node" --import tsx "#{libexec}/src/index.ts" "$@"
      fi
    SH

    # Create a wrapper for the setup wizard
    (bin/"echos-setup").write <<~SH
      #!/bin/bash
      [ -f "$HOME/.config/echos/home" ] && ECHOS_HOME="${ECHOS_HOME:-$(cat "$HOME/.config/echos/home")}"
      export ECHOS_HOME="${ECHOS_HOME:-$HOME/echos}"
      mkdir -p "$ECHOS_HOME"
      cd "$ECHOS_HOME"
      exec "#{Formula["node@20"].opt_bin}/node" --import tsx "#{libexec}/scripts/setup-server.ts" "$@"
    SH
  end

  def post_install
    # No data directories created here — ECHOS_HOME (~/echos) is managed
    # by the setup wizard and created at runtime.
  end

  def caveats
    <<~EOS
      To get started with EchOS:

        1. Run the setup wizard (opens browser):
           echos-setup

        2. Start the daemon:
           brew services start echos

        3. Use the CLI:
           echos "search my notes"

      Data is stored in ~/echos/ (override with ECHOS_HOME)
      Configuration: ~/echos/.env

      Redis is required — start it before running EchOS:
        brew services start redis
    EOS
  end

  service do
    run [opt_bin/"echos-daemon"]
    keep_alive true
    log_path var/"log/echos.log"
    error_log_path var/"log/echos-error.log"
    environment_variables PATH: std_service_path_env,
                          NODE_ENV: "production"
  end

  test do
    assert_match "echos", shell_output("#{bin}/echos --help 2>&1", 0)
  end
end
