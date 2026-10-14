// Read-only TLS probe. Run in an interactive terminal; secrets are never saved.
import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

export async function readPassword(label = 'Lozinka PFX sertifikata (unos je skriven): ') {
  if (!process.stdin.isTTY) throw new Error('Pokrenite skriptu u interaktivnom terminalu.');
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    const finish = () => {
      process.stdin.off('data', handler);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const handler = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(); reject(new Error('Prekinuto.')); return; }
        if (character === '\r' || character === '\n') { finish(); resolve(value); value = ''; return; }
        if (character === '\u007f' || character === '\b') value = [...value].slice(0, -1).join('');
        else if (character >= ' ') value += character;
      }
    };
    process.stdin.on('data', handler);
  });
}

async function main() {
  const certificatePath = process.argv[2];
  if (!certificatePath) throw new Error('Upotreba: node scripts/sep-probe.mjs "putanja-do.pfx"');
  const pfx = await readFile(certificatePath);
  let passphrase = await readPassword();
  let agent;
  try {
    createSecureContext({ pfx, passphrase });
    console.log('PFX je uspjesno ucitan.');
    agent = new https.Agent({ pfx, passphrase, keepAlive: false });
    await new Promise((resolve, reject) => {
      const request = https.get('https://sep.tax.gov.me/self-care/', {
        agent, timeout: 20000, headers: { Accept: 'text/html' },
      }, (response) => {
        console.log(`SEP HTTP status: ${response.statusCode}`);
        console.log(`Tip odgovora: ${response.headers['content-type'] ?? 'nepoznat'}`);
        // Do not print HTML, cookies, session tokens or redirect URLs.
        response.resume();
        response.on('end', resolve);
        response.on('error', reject);
      });
      request.on('timeout', () => request.destroy(new Error('SEP nije odgovorio u roku od 20 sekundi.')));
      request.on('error', reject);
    });
    console.log('Ovo provjerava vezu; prijava u firmu i preuzimanje racuna jos nijesu potvrdjeni.');
  } finally {
    agent?.destroy();
    pfx.fill(0);
    passphrase = '';
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  // Error codes are sufficient for diagnosis and cannot expose response bodies.
  const code = typeof error.code === 'string' ? error.code : 'PROBE_FAILED';
  console.error(`Provjera nije uspjela (${code}). Provjerite putanju, lozinku i TLS podrsku sertifikata.`);
  process.exitCode = 1;
});
