// Local operator diagnostic. Credentials are loaded from .env, never CLI arguments.
const { loadEnvConfig } = require("@next/env");
loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const { probeImap } = require("../.test-build/src/lib/imap-connection.js");
probeImap().then((result) => {
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}).catch(() => {
  console.error("IMAP provjera nije završena.");
  process.exitCode = 1;
});
