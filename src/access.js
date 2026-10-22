const keyCache = new Map();
const enabled = value => value === true || value === 'true';
export const accessEnabled = env => enabled(env.ACCESS_ENABLED);

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid JWT');
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), char => char.charCodeAt(0));
}

export async function checkAccess(request, env) {
  if (!accessEnabled(env)) return null;
  const domain = env.ACCESS_TEAM_DOMAIN;
  const audience = env.ACCESS_AUD;
  if (typeof domain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(domain) || typeof audience !== 'string' || !audience.trim()) {
    return {status:503, code:'ACCESS_NOT_CONFIGURED', error:'Cloudflare Access está activado pero faltan ACCESS_TEAM_DOMAIN o ACCESS_AUD.'};
  }
  const denied = {status:403, code:'ACCESS_REQUIRED', error:'Se requiere una sesión válida de Cloudflare Access. Abre la URL protegida por Access.'};
  const token = request.headers.get('cf-access-jwt-assertion') || '';
  if (!token || token.length > 16384) return denied;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return denied;
    const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
    const timestamp = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit !== undefined) return denied;
    if (claims.iss !== `https://${domain}` || !Array.isArray(claims.aud) || !claims.aud.includes(audience)) return denied;
    if (!Number.isFinite(claims.exp) || claims.exp <= timestamp || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > timestamp))) return denied;
    let cached = keyCache.get(domain);
    if (!cached || cached.expires <= Date.now()) {
      let response;
      try {
        response = await fetch(`https://${domain}/cdn-cgi/access/certs`, {redirect:'manual', signal:AbortSignal.timeout(5000)});
        if (!response.ok) throw new Error('JWKS unavailable');
        const jwks = await response.json();
        if (!Array.isArray(jwks.keys) || jwks.keys.length > 20) throw new Error('Invalid JWKS');
        cached = {keys:jwks.keys, expires:Date.now() + 5 * 60000};
        keyCache.set(domain, cached);
      } catch {
        return {status:503, code:'ACCESS_KEYS_UNAVAILABLE', error:'No se pueden verificar las claves de Cloudflare Access. Inténtalo más tarde.'};
      }
    }
    const jwk = cached.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!jwk) return denied;
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['verify']);
    const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return verified ? null : denied;
  } catch {
    return denied;
  }
}
