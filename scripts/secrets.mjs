import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';

const content = `BOOTSTRAP_TOKEN=${randomBytes(32).toString('hex')}\nVAULT_KEY=${randomBytes(32).toString('hex')}\n`;
if (process.argv.includes('--local')) {
  try {
    writeFileSync(new URL('../.dev.vars', import.meta.url), content, {flag:'wx', mode:0o600});
    console.log('Secretos locales creados en .dev.vars. No los publiques ni los uses en producción.');
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '.dev.vars ya existe: no se ha modificado.' : 'No se pudo crear .dev.vars.');
    process.exitCode = 1;
  }
} else {
  process.stdout.write(content);
}
