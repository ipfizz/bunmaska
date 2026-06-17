/**
 * Public `bunmaska/config` entry point.
 *
 * A project's `bunmaska.config.ts` imports {@link defineConfig} from here for
 * type-checking and editor completion. This re-exports only the pure config
 * schema (no filesystem code), so importing it from a config file never drags
 * the CLI's loader into a project's runtime bundle.
 */

export {
  type BunmaskaConfig,
  type BunmaskaUpdatesConfig,
  defineConfig,
} from './common/config-schema';
