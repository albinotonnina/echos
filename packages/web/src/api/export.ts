import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

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
    async (request, reply) => {
      const { fileName } = request.params;

      if (!SAFE_FILENAME_RE.test(fileName)) {
        return reply.status(400).send({ error: 'Invalid file name' });
      }

      const filePath = join(exportsDir, fileName);

      if (!existsSync(filePath)) {
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
      void reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
      return reply.send(createReadStream(filePath));
    },
  );
}
