import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare, Response, convertV4MiniflareOptions} from 'miniflare';

export async function fixture(overrides={}) {
  const outbound = [];
  const network = {jwksStatus:200,jwksRequests:0};
  let bindings = {
    BOOTSTRAP_TOKEN:randomBytes(32).toString('hex'),
    VAULT_KEY:randomBytes(32).toString('hex'),
    ...overrides.bindings
  };
  const options = {
    modules:['worker.js','access.js'].map(name=>({type:'ESModule',path:fileURLToPath(new URL(`../../src/${name}`,import.meta.url))})),
    compatibilityDate:'2026-10-16',
    d1Databases:['DB'],
    r2Buckets:overrides.r2 ? ['FILES'] : [],
    serviceBindings:{ASSETS:() => new Response('<html>OwnAIChat</html>', {headers:{'content-type':'text/html'}})},
    outboundService:async request => {
      const url = new URL(request.url);
      if (overrides.jwks && url.hostname === bindings.ACCESS_TEAM_DOMAIN && url.pathname === '/cdn-cgi/access/certs') {
        network.jwksRequests++;
        return new Response(JSON.stringify(overrides.jwks),{status:network.jwksStatus,headers:{'content-type':'application/json',location:'https://attacker.test/keys'}});
      }
      const allowed = ['api.deepseek.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.anthropic.com'];
      if (!allowed.includes(url.hostname)) throw new Error(`Unexpected network request: ${url.hostname}`);
      outbound.push({url:request.url, headers:Object.fromEntries(request.headers), body:await request.json()});
      const delta = url.hostname === 'api.anthropic.com'
        ? {type:'content_block_delta', delta:{type:'text_delta', text:'Respuesta de prueba'}}
        : {choices:[{delta:{content:'Respuesta de prueba'}}]};
      return new Response(`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`, {headers:{'content-type':'text/event-stream'}});
    },
    bindings
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  let db;
  try {db = await mf.getD1Database('DB');}
  catch (error) {await mf.dispose();throw error;}
  const migration = await readFile(new URL('../../migrations/0001_initial.sql', import.meta.url), 'utf8');
  const migrate = async () => {
    for (const statement of migration.split(';').filter(statement => statement.trim())) await db.prepare(statement).run();
  };
  await migrate();
  async function call(path, {method='GET', body, cookie, headers={}}={}) {
    const requestHeaders = {'X-OwnChat-Request':'1', Origin:'https://ownaichat.test', ...headers};
    if (cookie) requestHeaders.Cookie = cookie;
    if (body && !(body instanceof FormData)) {
      requestHeaders['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    if (body instanceof FormData) {
      const encoded=new Request('https://ownaichat.test',{method:'POST',body});
      requestHeaders['Content-Type']=encoded.headers.get('content-type');
      body=new Uint8Array(await encoded.arrayBuffer());
    }
    return mf.dispatchFetch(`https://ownaichat.test${path}`, {method, headers:requestHeaders, body});
  }
  async function setup() {
    const response = await call('/api/setup', {method:'POST', body:{token:bindings.BOOTSTRAP_TOKEN, password:'private test password 12345'}});
    if (response.status !== 201) throw new Error(await response.text());
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function update(changes) {
    bindings = {...bindings, ...changes};
    for (const [key,value] of Object.entries(bindings)) if (value === undefined) delete bindings[key];
    await mf.setOptions(convertV4MiniflareOptions({...options, bindings}));
    db=await mf.getD1Database('DB');
  }
  return {mf, call, setup, update, migrate, outbound, network, get db(){return db;}, get bindings(){return bindings;}};
}
