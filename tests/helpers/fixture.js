import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Miniflare, Response, convertV4MiniflareOptions} from 'miniflare';

export const TEST_IMAGE='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=';

export async function fixture(overrides={}) {
  const outbound = [];
  const network = {jwksStatus:200,jwksRequests:0,modelStatus:200,modelRequests:[],modelResponses:[],imageStatus:200,imageResult:null,downloadStatus:200,downloadBytes:Buffer.from(TEST_IMAGE,'base64'),downloads:[],textStatus:200,textBody:null,models:{
    deepseek:{data:[{id:'deepseek-flash',name:'DeepSeek Flash'},{id:'deepseek-v4-pro',name:'DeepSeek Pro'}]},
    openai:{data:[{id:'gpt-4.1-mini'},{id:'gpt-5-mini'},{id:'gpt-4.1'}]},
    gemini:{models:[{name:'models/gemini-2.5-flash',displayName:'Gemini 2.5 Flash',supportedGenerationMethods:['generateContent']}]},
    anthropic:{data:[{id:'claude-sonnet-4-5',display_name:'Claude Sonnet 4.5'}],has_more:false},
    custom:{data:[{id:'Qwen/Qwen3-8B'}]}
  }};
  let bindings = {
    BOOTSTRAP_TOKEN:randomBytes(32).toString('hex'),
    VAULT_KEY:randomBytes(32).toString('hex'),
    ...overrides.bindings
  };
  const options = {
    modules:['../../src/worker.js','../../src/access.js','../../src/models.js','../../src/connections.js','../../src/images.js','../../src/errors.js','../../public/models.js','../../public/modes.js'].map(path=>({type:'ESModule',path:fileURLToPath(new URL(path,import.meta.url))})),
    compatibilityDate:'2026-10-16',
    d1Databases:['DB'],
    r2Buckets:overrides.r2 ? ['FILES'] : [],
    serviceBindings:{ASSETS:overrides.assets||(()=>new Response('<html>OwnAIChat</html>', {headers:{'content-type':'text/html'}}))},
    outboundService:async request => {
      const url = new URL(request.url);
      if (overrides.jwks && url.hostname === bindings.ACCESS_TEAM_DOMAIN && url.pathname === '/cdn-cgi/access/certs') {
        network.jwksRequests++;
        return new Response(JSON.stringify(overrides.jwks),{status:network.jwksStatus,headers:{'content-type':'application/json',location:'https://attacker.test/keys'}});
      }
      const allowed = ['api.deepseek.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'api.anthropic.com','api.runpod.ai','demo-8000.proxy.runpod.net','inference.example.com','images.example.com'];
      if (!allowed.includes(url.hostname)) throw new Error(`Unexpected network request: ${url.hostname}`);
      if(url.hostname==='images.example.com'){network.downloads.push({url:request.url,headers:Object.fromEntries(request.headers)});return new Response(network.downloadBytes,{status:network.downloadStatus,headers:{'content-type':'image/png',location:'https://attacker.test/image'}});}
      if(request.method==='GET'&&url.pathname.endsWith('/models')) {
        const provider={ 'api.deepseek.com':'deepseek','api.openai.com':'openai','generativelanguage.googleapis.com':'gemini','api.anthropic.com':'anthropic'}[url.hostname];
        network.modelRequests.push({url:request.url,headers:Object.fromEntries(request.headers)});
        const payload=network.modelResponses.length?network.modelResponses.shift():network.models[provider||'custom'];
        return new Response(typeof payload==='string'?payload:JSON.stringify(payload),{status:network.modelStatus,headers:{'content-type':'application/json',location:'https://attacker.test/models'}});
      }
      outbound.push({url:request.url, headers:Object.fromEntries(request.headers), body:await request.json()});
      if(url.pathname.endsWith('/images/generations')||url.pathname.endsWith(':generateContent')){
        const payload=network.imageResult||(url.hostname==='generativelanguage.googleapis.com'?{candidates:[{content:{parts:[{text:'Imagen de prueba'},{inlineData:{mimeType:'image/png',data:TEST_IMAGE}}]}}]}:{data:[{b64_json:TEST_IMAGE}]});
        return new Response(typeof payload==='string'?payload:JSON.stringify(payload),{status:network.imageStatus,headers:{'content-type':'application/json',location:'https://attacker.test/image'}});
      }
      const delta = url.hostname === 'api.anthropic.com'
        ? {type:'content_block_delta', delta:{type:'text_delta', text:'Respuesta de prueba'}}
        : {choices:[{delta:{content:'Respuesta de prueba'}}]};
      return new Response(network.textBody||`data: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`, {status:network.textStatus,headers:{'content-type':'text/event-stream',location:'https://attacker.test/chat'}});
    },
    bindings
  };
  const mf = new Miniflare(convertV4MiniflareOptions(options));
  let db;
  try {db = await mf.getD1Database('DB');}
  catch (error) {await mf.dispose();throw error;}
  const directory=new URL('../../migrations/',import.meta.url);
  const migrations=(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
  const migrate = async (limit=Infinity) => {
    await db.prepare('CREATE TABLE IF NOT EXISTS fixture_migrations(name TEXT PRIMARY KEY)').run();
    for(const name of migrations.slice(0,limit)){
      if(await db.prepare('SELECT name FROM fixture_migrations WHERE name=?').bind(name).first())continue;
      const migration=await readFile(new URL(name,directory),'utf8');
      await db.batch([...migration.split(';').filter(statement=>statement.trim()).map(statement=>db.prepare(statement)),db.prepare('INSERT INTO fixture_migrations(name) VALUES(?)').bind(name)]);
    }
  };
  await migrate(overrides.legacy?1:Infinity);
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
