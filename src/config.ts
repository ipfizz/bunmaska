/**
 * Public `bunmaska/config` entry point. Re-exports only the pure config schema,
 * so importing it from a config file never drags the CLI's loader into a
 * project's runtime bundle.
 */

export {
  type BunmaskaConfig,
  type BunmaskaUpdatesConfig,
  defineConfig,
} from './common/config-schema';
