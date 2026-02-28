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

    # Create config directory
    (etc/"echos").mkpath

    # Create wrapper script that points to the CLI
    (bin/"echos").write <<~SH
      #!/bin/bash
      export ECHOS_HOME="#{libexec}"
      export NODE_ENV="${NODE_ENV:-production}"
      cd "#{libexec}"
      exec "#{Formula["node@20"].opt_bin}/node" --env-file="#{etc}/echos/.env" "#{libexec}/packages/cli/dist/index.js" "$@"
    SH

    # Create a wrapper for the daemon
    (bin/"echos-daemon").write <<~SH
      #!/bin/bash
      export ECHOS_HOME="#{libexec}"
      export NODE_ENV="${NODE_ENV:-production}"
      cd "#{libexec}"
      exec "#{Formula["node@20"].opt_bin}/node" --env-file="#{etc}/echos/.env" --import tsx "#{libexec}/src/index.ts" "$@"
    SH

    # Create a wrapper for the setup wizard
    (bin/"echos-setup").write <<~SH
      #!/bin/bash
      export ECHOS_HOME="#{libexec}"
      cd "#{libexec}"
      exec "#{Formula["node@20"].opt_bin}/node" --import tsx "#{libexec}/scripts/setup-server.ts" "$@"
    SH
  end

  def post_install
    # Create data directories
    (var/"echos/knowledge").mkpath
    (var/"echos/db").mkpath
    (var/"echos/sessions").mkpath
    (var/"echos/exports").mkpath
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

      Data is stored in #{var}/echos/
      Configuration: #{etc}/echos/.env

      Redis is required — start it before running EchOS:
        brew services start redis
    EOS
  end

  service do
    run [opt_bin/"echos-daemon"]
    working_dir var/"echos"
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
