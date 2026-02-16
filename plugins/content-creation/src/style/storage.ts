import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Logger } from 'pino';
import type { EnhancedStyleProfile } from '../types.js';

/**
 * Storage for style profile persistence
 */
export class StyleProfileStorage {
  private readonly filePath: string;
  private readonly logger: Logger;

  constructor(filePath: string, logger: Logger) {
    this.filePath = filePath;
    this.logger = logger;
  }

  /**
   * Check if a style profile exists
   */
  exists(): boolean {
    return existsSync(this.filePath);
  }

  /**
   * Load the style profile from disk
   * @returns The style profile, or null if it doesn't exist
   */
  async load(): Promise<EnhancedStyleProfile | null> {
    if (!this.exists()) {
      this.logger.debug({ filePath: this.filePath }, 'Style profile does not exist');
      return null;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const profile = JSON.parse(content) as EnhancedStyleProfile;
      this.logger.info(
        {
          version: profile.version,
          method: profile.analysisMethod,
          sampleCount: profile.sampleCount,
        },
        'Loaded style profile',
      );
      return profile;
    } catch (error) {
      this.logger.error({ error, filePath: this.filePath }, 'Failed to load style profile');
      throw new Error(`Failed to load style profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save the style profile to disk
   */
  async save(profile: EnhancedStyleProfile): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      const content = JSON.stringify(profile, null, 2);
      await writeFile(this.filePath, content, 'utf-8');

      this.logger.info(
        {
          version: profile.version,
          method: profile.analysisMethod,
          sampleCount: profile.sampleCount,
          filePath: this.filePath,
        },
        'Saved style profile',
      );
    } catch (error) {
      this.logger.error({ error, filePath: this.filePath }, 'Failed to save style profile');
      throw new Error(`Failed to save style profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete the style profile
   */
  async delete(): Promise<void> {
    if (!this.exists()) {
      return;
    }

    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(this.filePath);
      this.logger.info({ filePath: this.filePath }, 'Deleted style profile');
    } catch (error) {
      this.logger.error({ error, filePath: this.filePath }, 'Failed to delete style profile');
      throw new Error(`Failed to delete style profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
