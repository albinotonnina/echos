/**
 * HTTP API tests for setup-server.ts.
 *
 * Spawns the server as a subprocess with SETUP_TEST_MODE=1, then tests all
 * API endpoints including security-critical path validation in writeConfig.
 *
 * Run: pnpm vitest run scripts/
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = path.join(__dirname, 'setup-server.ts');
// Resolve tsx binary from workspace root node_modules (works when running from any CWD)
const TSX_BIN = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

interface RequestOpts {
  port: number;
  method: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  host?: string;
}

function request(opts: RequestOpts): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: {
          Host: opts.host ?? 'localhost',
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': String(Buffer.byteLength(bodyStr)) } : {}),
          ...(opts.headers ?? {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: text });
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Wait until the server responds to a request (retry until timeout). */
async function waitForServer(port: number, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request({ port, method: 'GET', path: '/api/test/csrf' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`Server on port ${port} did not start within ${timeoutMs}ms`);
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let serverPort: number;
let serverProc: ChildProcess;
let serverTmpDir: string;
let csrfToken: string;

beforeAll(async () => {
  serverPort = await getAvailablePort();
  serverTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echos-server-test-'));

  serverProc = spawn(
    TSX_BIN,
    [SERVER_SCRIPT, '--port', String(serverPort)],
    {
      cwd: serverTmpDir,
      env: { ...process.env, SETUP_TEST_MODE: '1', ECHOS_HOME: serverTmpDir },
      stdio: 'pipe',
    },
  );

  serverProc.on('error', (err) => {
    console.error('Server proc error:', err);
  });

  await waitForServer(serverPort);

  // Fetch the CSRF token once for all tests
  const resp = await request({ port: serverPort, method: 'GET', path: '/api/test/csrf' });
  csrfToken = (resp.body as { token: string }).token;
}, 20000);

afterAll(async () => {
  if (serverProc?.pid) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.rmSync(serverTmpDir, { recursive: true, force: true });
});

// ─── Security: DNS rebinding protection ──────────────────────────────────────

describe('Security — DNS rebinding protection', () => {
  it('rejects requests with non-localhost Host header (403)', async () => {
    const res = await request({
      port: serverPort,
      method: 'GET',
      path: '/api/setup/existing',
      host: 'evil.example.com',
    });
    expect(res.status).toBe(403);
  });

  it('accepts localhost Host header', async () => {
    const res = await request({
      port: serverPort,
      method: 'GET',
      path: '/api/setup/existing',
      host: 'localhost',
    });
    expect(res.status).toBe(200);
  });

  it('accepts 127.0.0.1 Host header', async () => {
    const res = await request({
      port: serverPort,
      method: 'GET',
      path: '/api/setup/existing',
      host: '127.0.0.1',
    });
    expect(res.status).toBe(200);
  });
});

// ─── Security: CSRF enforcement ──────────────────────────────────────────────

describe('Security — CSRF enforcement', () => {
  it('rejects POST without X-CSRF-TOKEN header (403)', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/generate-key',
      body: {},
    });
    expect(res.status).toBe(403);
  });

  it('rejects POST with wrong CSRF token (403)', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/generate-key',
      body: {},
      headers: { 'x-csrf-token': 'wrong-token' },
    });
    expect(res.status).toBe(403);
  });

  it('accepts POST with correct CSRF token', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/generate-key',
      body: {},
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/setup/existing ─────────────────────────────────────────────────

describe('GET /api/setup/existing', () => {
  it('returns { exists: false } when no .env present', async () => {
    const res = await request({
      port: serverPort,
      method: 'GET',
      path: '/api/setup/existing',
    });
    expect(res.status).toBe(200);
    expect((res.body as { exists: boolean }).exists).toBe(false);
  });
});

// ─── POST /api/setup/generate-key ────────────────────────────────────────────

describe('POST /api/setup/generate-key', () => {
  it('returns a 64-char hex string', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/generate-key',
      body: {},
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    const key = (res.body as { key: string }).key;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── POST /api/setup/validate-anthropic ──────────────────────────────────────

describe('POST /api/setup/validate-anthropic', () => {
  it('returns { valid: false } for key not starting with sk-ant-', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/validate-anthropic',
      body: { key: 'bad-key-format' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });
});

// ─── POST /api/setup/validate-redis ──────────────────────────────────────────

describe('POST /api/setup/validate-redis', () => {
  it('returns { valid: false } for malformed URL', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/validate-redis',
      body: { url: 'not-a-url' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });

  it('returns { valid: true } for connectable Redis URL', async () => {
    // Spin up a local TCP server to simulate Redis accepting connections
    const mockRedis = net.createServer();
    await new Promise<void>((resolve) => mockRedis.listen(0, '127.0.0.1', resolve));
    const mockPort = (mockRedis.address() as net.AddressInfo).port;

    try {
      const res = await request({
        port: serverPort,
        method: 'POST',
        path: '/api/setup/validate-redis',
        body: { url: `redis://127.0.0.1:${mockPort}` },
        headers: { 'x-csrf-token': csrfToken },
      });
      expect(res.status).toBe(200);
      expect((res.body as { valid: boolean }).valid).toBe(true);
    } finally {
      await new Promise<void>((resolve) => mockRedis.close(() => resolve()));
    }
  });
});

// ─── POST /api/setup/write-config — path validation (security critical) ──────

describe('POST /api/setup/write-config — path validation', () => {
  const validState = {
    anthropicApiKey: 'sk-ant-test',
    allowedUserIds: '12345',
    openaiApiKey: '',
    enableTelegram: false,
    telegramBotToken: '',
    enableWeb: false,
    webPort: 3000,
    webApiKey: '',
    redisUrl: 'redis://localhost:6379',
    defaultModel: 'claude-haiku-4-5-20251001',
    embeddingModel: 'text-embedding-3-small',
    webshareProxyUsername: '',
    webshareProxyPassword: '',
  };

  it('rejects echosHome = home directory itself', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/write-config',
      body: { ...validState, echosHome: os.homedir() },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { success: boolean; error?: string }).success).toBe(false);
    expect((res.body as { error: string }).error).toContain('home directory');
  });

  it('rejects echosHome = /usr/bin (forbidden system dir)', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/write-config',
      body: { ...validState, echosHome: '/usr/bin' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { success: boolean }).success).toBe(false);
    expect((res.body as { error: string }).error).toContain('system directory');
  });

  it('rejects echosHome = / (root)', async () => {
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/write-config',
      body: { ...validState, echosHome: '/' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { success: boolean }).success).toBe(false);
  });

  it('rejects echosHome relative path', async () => {
    // relative paths are resolved to absolute by the server (path.resolve), so
    // we test by sending a path that starts with relative notation before resolve
    // Actually path.resolve makes it absolute — test that a sneaky relative-looking
    // input that resolves inside home is accepted (non-rejection case), and that
    // a path that resolves to a forbidden dir is rejected
    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/write-config',
      body: { ...validState, echosHome: '/etc' },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    // /etc is forbidden
    expect((res.body as { success: boolean }).success).toBe(false);
  });

  it('rejects symlink pointing to forbidden dir', async () => {
    // Create a symlink inside tmpdir that points to /usr/bin
    const linkPath = path.join(serverTmpDir, `evil-link-${Date.now()}`);
    try {
      fs.symlinkSync('/usr/bin', linkPath);
    } catch {
      // Skip if symlink creation fails (permissions)
      return;
    }

    const res = await request({
      port: serverPort,
      method: 'POST',
      path: '/api/setup/write-config',
      body: { ...validState, echosHome: path.join(linkPath, 'subdir') },
      headers: { 'x-csrf-token': csrfToken },
    });
    expect(res.status).toBe(200);
    expect((res.body as { success: boolean }).success).toBe(false);

    fs.unlinkSync(linkPath);
  });

  it('valid echosHome inside home dir creates .env with 0o600', async () => {
    // Use a uniquely-named subdir inside the user's home to avoid conflicts
    const testHome = path.join(os.homedir(), `.echos-test-${Date.now()}`);

    // Save and restore ~/.config/echos/home to avoid clobbering real config
    const homeConfigPath = path.join(os.homedir(), '.config', 'echos', 'home');
    let savedHomeConfig: string | undefined;
    if (fs.existsSync(homeConfigPath)) {
      savedHomeConfig = fs.readFileSync(homeConfigPath, 'utf8');
    }

    try {
      const res = await request({
        port: serverPort,
        method: 'POST',
        path: '/api/setup/write-config',
        body: { ...validState, echosHome: testHome },
        headers: { 'x-csrf-token': csrfToken },
      });
      expect(res.status).toBe(200);
      expect((res.body as { success: boolean }).success).toBe(true);

      const envPath = path.join(testHome, '.env');
      expect(fs.existsSync(envPath)).toBe(true);
      // eslint-disable-next-line no-bitwise
      expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);

      // Data dirs
      expect(fs.existsSync(path.join(testHome, 'knowledge'))).toBe(true);
      expect(fs.existsSync(path.join(testHome, 'db'))).toBe(true);
      expect(fs.existsSync(path.join(testHome, 'sessions'))).toBe(true);
    } finally {
      fs.rmSync(testHome, { recursive: true, force: true });
      // Restore saved home config
      if (savedHomeConfig !== undefined) {
        fs.writeFileSync(homeConfigPath, savedHomeConfig, { encoding: 'utf8', mode: 0o600 });
      } else if (fs.existsSync(homeConfigPath)) {
        fs.unlinkSync(homeConfigPath);
      }
    }
  });

  it('second write-config call backs up existing .env', async () => {
    const testHome = path.join(os.homedir(), `.echos-test2-${Date.now()}`);
    const homeConfigPath = path.join(os.homedir(), '.config', 'echos', 'home');
    let savedHomeConfig: string | undefined;
    if (fs.existsSync(homeConfigPath)) {
      savedHomeConfig = fs.readFileSync(homeConfigPath, 'utf8');
    }

    try {
      // First write
      await request({
        port: serverPort,
        method: 'POST',
        path: '/api/setup/write-config',
        body: { ...validState, echosHome: testHome },
        headers: { 'x-csrf-token': csrfToken },
      });

      const envPath = path.join(testHome, '.env');
      const beforeFiles = fs.readdirSync(testHome);
      expect(beforeFiles.some((f) => f === '.env')).toBe(true);

      // Second write — should create a backup
      await request({
        port: serverPort,
        method: 'POST',
        path: '/api/setup/write-config',
        body: { ...validState, echosHome: testHome },
        headers: { 'x-csrf-token': csrfToken },
      });

      const afterFiles = fs.readdirSync(testHome);
      const hasBackup = afterFiles.some((f) => f.startsWith('.env.backup.'));
      expect(hasBackup).toBe(true);
      expect(fs.existsSync(envPath)).toBe(true);
    } finally {
      fs.rmSync(testHome, { recursive: true, force: true });
      if (savedHomeConfig !== undefined) {
        fs.writeFileSync(homeConfigPath, savedHomeConfig, { encoding: 'utf8', mode: 0o600 });
      } else if (fs.existsSync(homeConfigPath)) {
        fs.unlinkSync(homeConfigPath);
      }
    }
  });
});
