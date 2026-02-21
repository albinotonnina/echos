import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Logger } from 'pino';
import type { EchosPlugin, PluginContext, ScheduledJob } from './types.js';

/**
 * Manages plugin lifecycle: registration, setup, teardown.
 */
export class PluginRegistry {
  private readonly plugins: Map<string, EchosPlugin> = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly tools: AgentTool<any>[] = [];
  private readonly jobs: Map<string, ScheduledJob> = new Map();
  private readonly logger: Logger;
  private initialized = false;

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'plugin-registry' });
  }

  /**
   * Register a plugin. Must be called before `setupAll()`.
   */
  register(plugin: EchosPlugin): void {
    if (this.initialized) {
      throw new Error(`Cannot register plugin "${plugin.name}" after setup`);
    }

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, plugin);
    this.logger.info({ plugin: plugin.name, version: plugin.version }, 'Plugin registered');
  }

  /**
   * Initialize all registered plugins and collect their tools and jobs.
   */
  async setupAll(context: PluginContext): Promise<void> {
    if (this.initialized) {
      throw new Error('Plugins already initialized');
    }

    for (const [name, plugin] of this.plugins) {
      try {
        const result = await plugin.setup(context);
        this.tools.push(...result.tools);

        if (result.jobs) {
          for (const job of result.jobs) {
            if (this.jobs.has(job.type)) {
              throw new Error(
                `Plugin "${name}" registers job type "${job.type}" which is already registered`,
              );
            }
            this.jobs.set(job.type, job);
          }
        }

        this.logger.info(
          { plugin: name, toolCount: result.tools.length, jobCount: result.jobs?.length ?? 0 },
          'Plugin initialized',
        );
      } catch (error) {
        this.logger.error({ plugin: name, error }, 'Plugin setup failed');
        throw error;
      }
    }

    this.initialized = true;
    this.logger.info(
      { pluginCount: this.plugins.size, totalTools: this.tools.length, totalJobs: this.jobs.size },
      'All plugins initialized',
    );
  }

  /**
   * Get all tools registered by plugins.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTools(): AgentTool<any>[] {
    return [...this.tools];
  }

  /**
   * Get all scheduled jobs registered by plugins, keyed by job type.
   */
  getJobs(): Map<string, ScheduledJob> {
    return new Map(this.jobs);
  }

  /**
   * Teardown all plugins in reverse order.
   */
  async teardownAll(): Promise<void> {
    const entries = [...this.plugins.entries()].reverse();

    for (const [name, plugin] of entries) {
      if (plugin.teardown) {
        try {
          await plugin.teardown();
          this.logger.debug({ plugin: name }, 'Plugin torn down');
        } catch (error) {
          this.logger.warn({ plugin: name, error }, 'Plugin teardown error');
        }
      }
    }

    this.plugins.clear();
    this.tools.length = 0;
    this.jobs.clear();
    this.initialized = false;
  }
}
