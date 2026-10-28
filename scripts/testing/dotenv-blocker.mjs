// Vitest aliases `dotenv` and `dotenv/config` to this module. Returning an empty
// result preserves the public call shape while ensuring tests never read .env files.
export function config() {
  return { parsed: {} };
}

export const configDotenv = config;
export const populate = () => undefined;
export default { config, configDotenv, populate };
