import { loadConfig, type Config } from '../../src/config';

/** Real configuration of the local stack, exported by scripts/with-local-env.sh. */
export function testConfig(): Config {
  return loadConfig(process.env);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run the tests through "make test".`);
  return value;
}
