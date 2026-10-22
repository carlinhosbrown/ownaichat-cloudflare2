import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicUrl,validateConnection} from '../src/connections.js';
import {fixture} from './helpers/fixture.js';

const config={name:'Mi RunPod',kind:'runpod-serverless',baseUrl:'https://api.runpod.ai/v2/demo/openai/v1',defaultModel:'Qwen/Qwen3-8B',imageModel:'',authType:'bearer',key:'only-this-connection-key',reasoningStyle:'vllm',effortLevels:[]};

test('custom URLs reject local destinations, IPs, credentials, plaintext and job endpoints',()=>{
  for(const url of ['http://inference.example.com/v1','https://localhost/v1','https://metadata.google.internal/v1','https://127.0.0.1/v1','https://2130706433/v1','https://0x7f000001/v1','https://[::1]/v1','https://10.0.0.1/v1','https://192.168.1.2/v1','https://service.local/v1','https://user:secret@inference.example.com/v1','https://inference.example.com:8000/v1','https://inference.example.com/v1?api_key=secret','https://inference.example.com/v1#secret'])assert.throws(()=>validatePublicUrl(url),url);
  for(const suffix of ['/run','/runsync','/chat/completions','/models','/images/generations'])assert.throws(()=>validateConnection({...config,kind:'openai',baseUrl:'https://inference.example.com/v1'+suffix}));
  assert.throws(()=>validateConnection({...config,baseUrl:'https://api.runpod.ai/v2/demo'}));
  assert.throws(()=>validateConnection({...config,baseUrl:'https://attacker.example.com/v2/demo/openai/v1'}));
  assert.equal(validateConnection({...config,baseUrl:config.baseUrl+'/'}).baseUrl,config.baseUrl);
  assert.equal(validateConnection({...config,kind:'runpod-pod',baseUrl:'https://demo-8000.proxy.runpod.net/v1'}).kind,'runpod-pod');
});

test('key preservation is bound to exactly the same destination URL',()=>{
  const existing={ciphertext:'encrypted',auth_type:'bearer',base_url:config.baseUrl};
  assert.equal(validateConnection({...config,key:''},existing).key,'');
  assert.throws(()=>validateConnection({...config,key:'',baseUrl:'https://api.runpod.ai/v2/different/openai/v1'},existing));
  assert.throws(()=>validateConnection({...config,key:'bad\r\nheader'}));
  assert.throws(()=>validateConnection({...config,effortLevels:['ultra']}));
  assert.throws(()=>validateConnection({...config,defaultModel:'https://attacker.example.com'}));
});

test('custom API connections are private, encrypted and independently configurable',async context=>{
  const app=await fixture();context.after(()=>app.mf.dispose());const cookie=await app.setup();let provider,chatId;
  await context.test('connection changes require authentication and same-origin requests',async()=>{
    assert.equal((await app.call('/api/connections',{method:'POST',body:config})).status,401);
    assert.equal((await app.call('/api/connections',{method:'POST',cookie,body:config,headers:{Origin:'https://attacker.test'}})).status,403);
  });
  await context.test('save and discovery never return plaintext or ciphertext',async()=>{
    const response=await app.call('/api/connections',{method:'POST',cookie,body:config});assert.equal(response.status,201);provider=(await response.json()).id;assert.match(provider,/^custom-/);
    const row=await app.db.prepare('SELECT * FROM custom_providers WHERE id=?').bind(provider).first();assert.ok(row.ciphertext);assert.ok(!JSON.stringify(row).includes(config.key));
    const listing=await (await app.call('/api/providers',{cookie})).text();assert.ok(!listing.includes(config.key));assert.ok(!listing.includes(row.ciphertext));const listed=JSON.parse(listing);assert.ok(listed.configured.includes(provider));assert.equal(listed.customProviders[0].baseUrl,config.baseUrl);
    const catalog=await (await app.call(`/api/providers/${provider}/models`,{cookie})).json();assert.equal(catalog.source,'api');assert.equal(catalog.models[0].id,config.defaultModel);
    assert.equal(app.network.modelRequests.at(-1).url,config.baseUrl+'/models');assert.equal(app.network.modelRequests.at(-1).headers.authorization,`Bearer ${config.key}`);
  });
  await context.test('RunPod vLLM streaming sends only its key and preserves model and mode',async()=>{
    await app.call('/api/providers/openai',{method:'PUT',cookie,body:{key:'unrelated-openai-secret'}});
    chatId=(await (await app.call('/api/chats',{method:'POST',cookie,body:{provider,settings:{mode:'reasoning'}}})).json()).id;
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Hola RunPod',endpoint:'https://attacker.test',key:'injected-key'}});assert.equal(response.status,200);assert.match(await response.text(),/Respuesta de prueba/);
    const sent=app.outbound.at(-1);assert.equal(sent.url,config.baseUrl+'/chat/completions');assert.equal(sent.headers.authorization,`Bearer ${config.key}`);assert.equal(sent.body.model,config.defaultModel);assert.deepEqual(sent.body.chat_template_kwargs,{enable_thinking:true});assert.ok(!JSON.stringify(sent).includes('unrelated-openai-secret'));
    const history=await (await app.call(`/api/chats/${chatId}`,{cookie})).json();assert.equal(history.chat.provider,provider);assert.equal(history.chat.settings.mode,'reasoning');
  });
  await context.test('editing retains a key only for the same URL, and allows key rotation',async()=>{
    assert.equal((await app.call(`/api/connections/${provider}`,{method:'PUT',cookie,body:{...config,key:'',name:'Renombrado'}})).status,200);
    assert.equal((await app.call(`/api/connections/${provider}`,{method:'PUT',cookie,body:{...config,key:'',baseUrl:'https://api.runpod.ai/v2/other/openai/v1'}})).status,400);
    assert.equal((await app.call(`/api/connections/${provider}`,{method:'PUT',cookie,body:{...config,key:'rotated-connection-secret'}})).status,200);
    await app.call(`/api/providers/${provider}/models`,{cookie});assert.equal(app.network.modelRequests.at(-1).headers.authorization,'Bearer rotated-connection-secret');
  });
  await context.test('public Pod connections work without Authorization or a catalog',async()=>{
    const created=await app.call('/api/connections',{method:'POST',cookie,body:{...config,kind:'runpod-pod',name:'Pod público',baseUrl:'https://demo-8000.proxy.runpod.net/v1',authType:'none',key:'',reasoningStyle:'openai',effortLevels:['low','high','xhigh']}});assert.equal(created.status,201);const pod=(await created.json()).id;
    app.network.modelStatus=404;const catalog=await (await app.call(`/api/providers/${pod}/models`,{cookie})).json();assert.equal(catalog.source,'suggested');assert.equal(catalog.models[0].id,config.defaultModel);assert.ok(!app.network.modelRequests.at(-1).headers.authorization);app.network.modelStatus=200;
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Prueba Pod',provider:pod,model:config.defaultModel,settings:{mode:'reasoning',effort:'xhigh'}}});await response.text();assert.equal(response.status,200);assert.equal(app.outbound.at(-1).body.reasoning_effort,'xhigh');assert.equal(app.outbound.at(-1).headers.authorization,undefined);
  });
  await context.test('upstream redirects and errors are not followed or echoed',async()=>{
    app.network.textStatus=302;app.network.textBody='rotated-connection-secret';
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Prueba redirect',provider,model:config.defaultModel,settings:{mode:'auto'}}});assert.equal(response.status,502);assert.ok(!(await response.text()).includes('rotated-connection-secret'));app.network.textStatus=200;app.network.textBody=null;
  });
  await context.test('deleting a connection preserves chats and reports an actionable error on reuse',async()=>{
    const newChat=(await (await app.call('/api/chats',{method:'POST',cookie,body:{provider}})).json()).id;
    assert.equal((await app.call(`/api/connections/${provider}`,{method:'DELETE',cookie})).status,200);
    assert.equal((await app.call(`/api/chats/${newChat}`,{cookie})).status,200);
    const response=await app.call(`/api/chats/${newChat}/messages`,{method:'POST',cookie,body:{content:'Prueba'}});assert.equal(response.status,404);assert.match((await response.json()).error,/conexión/i);
  });
});

test('new migration preserves existing owner, secrets, projects and chat messages',async context=>{
  const app=await fixture({legacy:true});context.after(()=>app.mf.dispose());const cookie=await app.setup();
  await app.call('/api/providers/deepseek',{method:'PUT',cookie,body:{key:'pre-migration-secret'}});
  const chatId=crypto.randomUUID(),messageId=crypto.randomUUID(),projectId=crypto.randomUUID();
  await app.db.prepare('INSERT INTO projects(id,name,instructions) VALUES(?,?,?)').bind(projectId,'Anterior','Mantener').run();
  await app.db.prepare('INSERT INTO chats(id,project_id,provider,model) VALUES(?,?,?,?)').bind(chatId,projectId,'deepseek','deepseek-chat').run();
  await app.db.prepare('INSERT INTO messages(id,chat_id,role,content) VALUES(?,?,?,?)').bind(messageId,chatId,'assistant','Historial anterior').run();
  const before=await app.db.prepare('SELECT * FROM owner').first();const keyBefore=await app.db.prepare('SELECT * FROM provider_keys').first();
  await app.migrate();await app.migrate();
  assert.deepEqual(await app.db.prepare('SELECT * FROM owner').first(),before);assert.deepEqual(await app.db.prepare('SELECT * FROM provider_keys').first(),keyBefore);
  const history=await (await app.call(`/api/chats/${chatId}`,{cookie})).json();assert.equal(history.chat.project_id,projectId);assert.deepEqual(history.chat.settings,{});assert.equal(history.messages[0].content,'Historial anterior');assert.equal(history.messages[0].kind,'text');assert.deepEqual(history.messages[0].images,[]);
});
