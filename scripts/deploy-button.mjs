import {readFileSync, writeFileSync} from 'node:fs';

const input = process.argv[2];
if (!input || !/^https:\/\/(github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(input) || input.includes('TU_USUARIO')) {
  console.error('Uso: npm run deploy:button -- https://github.com/USUARIO/REPOSITORIO');
  process.exitCode = 1;
} else {
  const path = new URL('../README.md', import.meta.url);
  const readme = readFileSync(path, 'utf8');
  const button = `[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=${encodeURIComponent(input.replace(/\/$/, ''))})`;
  writeFileSync(path, readme.replace(/\[!\[Deploy to Cloudflare\]\(https:\/\/deploy\.workers\.cloudflare\.com\/button\)\]\([^\n]+\)/, button));
  console.log('Botón actualizado. Publica el contenido en ese repositorio público para utilizarlo.');
}
