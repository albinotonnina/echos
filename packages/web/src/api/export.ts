import { createReadStream, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FastifyRateLimitOptions } from '@fastify/rate-limit';

/** Only allow safe filenames — no path traversal, no hidden files. */
const SAFE_FILENAME_RE = /^[\w-]+\.(zip|json|md|txt)$/;

export function registerExportRoutes(app: FastifyInstance, exportsDir: string): void {
  /**
   * GET /api/export/:fileName
   *
   * Downloads an export file from the exports directory.
   * Requires Bearer auth (enforced by the global preHandler hook in index.ts).
   * Validates the filename to prevent path traversal.
   */
  app.get<{ Params: { fileName: string } }>(
    '/api/export/:fileName',
    {
      // Per-route rate limiting to protect filesystem-backed export downloads.
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
        } satisfies FastifyRateLimitOptions,
      },
    },
    async (request, reply) => {
      const { fileName } = request.params;

      if (!SAFE_FILENAME_RE.test(fileName)) {
        return reply.status(400).send({ error: 'Invalid file name' });
      }

      const resolvedExportsDir = resolve(exportsDir);
      const filePath = resolve(resolvedExportsDir, fileName);
      if (!filePath.startsWith(resolvedExportsDir + '/')) {
        return reply.status(400).send({ error: 'Invalid file path' });
      }

      // Defence-in-depth: ensure the resolved path stays inside exportsDir
      // even though SAFE_FILENAME_RE already prevents traversal characters.
      const resolvedFile = resolve(filePath);
      const resolvedDir = resolve(exportsDir);
      if (!resolvedFile.startsWith(resolvedDir + sep)) {
        return reply.status(400).send({ error: 'Invalid file name' });
      }

      if (!existsSync(resolvedFile)) {
        return reply.status(404).send({ error: 'Export file not found or already cleaned up' });
      }

      const ext = fileName.split('.').pop() ?? '';
      const mimeTypes: Record<string, string> = {
        zip: 'application/zip',
        json: 'application/json',
        md: 'text/markdown; charset=utf-8',
        txt: 'text/plain; charset=utf-8',
      };
      const contentType = mimeTypes[ext] ?? 'application/octet-stream';

      void reply.header('Content-Type', contentType);
      // RFC 5987 encoding prevents header injection; fileName is also validated
      // by SAFE_FILENAME_RE so no special chars can appear.
      void reply.header(
        'Content-Disposition',
        `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      return reply.send(createReadStream(resolvedFile));
    },
  );
}
