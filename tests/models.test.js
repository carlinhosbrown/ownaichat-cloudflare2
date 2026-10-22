import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/fixture.js';

test('authenticated discovery of provider models keeps API keys private',async context=>{
  const app=await fixture();
  context.after(()=>app.mf.dispose());
  const cookie=await app.setup();
  const key='private-model-discovery-key';
  const list=provider=>app.call(`/api/providers/${provider}/models`,{cookie});
  const configure=provider=>app.call(`/api/providers/${provider}`,{method:'PUT',cookie,body:{key}});

  await context.test('discovery requires a session and cannot select arbitrary endpoints',async()=>{
    assert.equal((await app.call('/api/providers/openai/models')).status,401);
    assert.equal((await list('localhost')).status,404);
    assert.equal((await list('__proto__')).status,404);
    assert.equal(app.network.modelRequests.length,0);
  });
  await context.test('without a key the UI gets clearly marked Flash and Pro suggestions',async()=>{
    const response=await list('deepseek');
    assert.equal(response.status,200);
    const catalog=await response.json();
    assert.equal(catalog.source,'suggested');
    assert.equal(catalog.configured,false);
    assert.deepEqual(catalog.models.map(model=>model.id),['deepseek-flash','deepseek-v4-pro']);
    assert.ok(catalog.warning);
    assert.equal(app.network.modelRequests.length,0);
  });
  await context.test('DeepSeek reads Flash and Pro from the API with the stored encrypted key',async()=>{
    await configure('deepseek');
    const response=await list('deepseek');
    assert.equal(response.headers.get('cache-control'),'no-store');
    const text=await response.text();
    assert.ok(!text.includes(key));
    const catalog=JSON.parse(text);
    assert.equal(catalog.source,'api');
    assert.deepEqual(catalog.models.map(model=>model.id),['deepseek-flash','deepseek-v4-pro']);
    assert.equal(app.network.modelRequests.at(-1).url,'https://api.deepseek.com/models');
    assert.equal(app.network.modelRequests.at(-1).headers.authorization,`Bearer ${key}`);
  });
  await context.test('OpenAI includes account models and fine tunes while filtering specialized endpoints',async()=>{
    await configure('openai');
    app.network.models.openai={data:[
      {id:'gpt-4.1'},{id:'gpt-5-mini'},{id:'o3'},{id:'ft:gpt-4.1-mini:organization:custom:123'},
      {id:'text-embedding-3-large'},{id:'sora-2'},{id:'gpt-image-1'},{id:'gpt-5-pro'},
      {id:'gpt-4o-realtime-preview'},{id:'gpt-4o-audio-preview'},{id:'gpt-5-codex'},{id:'https://attacker.test/model'}
    ]};
    const catalog=await (await list('openai')).json();
    assert.equal(catalog.source,'api');
    assert.deepEqual(catalog.models.map(model=>model.id),['gpt-4.1','gpt-5-mini','o3','ft:gpt-4.1-mini:organization:custom:123','gpt-image-1']);
    assert.equal(catalog.models.at(-1).kind,'image');
    assert.equal(app.network.modelRequests.at(-1).headers.authorization,`Bearer ${key}`);
  });
  await context.test('Gemini handles pagination and only offers recognized text-generation models',async()=>{
    await configure('gemini');
    app.network.modelResponses=[
      {models:[{name:'models/gemini-2.5-flash',displayName:'Gemini Flash',supportedGenerationMethods:['generateContent']},{name:'models/text-embedding-004',supportedGenerationMethods:['embedContent']}],nextPageToken:'next/page?token'},
      {models:[{name:'models/gemini-2.5-pro',displayName:'Gemini Pro',supportedGenerationMethods:['generateContent']},{name:'models/gemini-2.5-flash-image',supportedGenerationMethods:['generateContent']} ]}
    ];
    const catalog=await (await list('gemini')).json();
    assert.deepEqual(catalog.models.map(model=>model.id),['gemini-2.5-flash','gemini-2.5-pro','gemini-2.5-flash-image']);
    assert.equal(catalog.models.at(-1).kind,'image');
    const request=app.network.modelRequests.at(-1);
    assert.equal(request.headers['x-goog-api-key'],key);
    assert.equal(new URL(request.url).searchParams.get('pageToken'),'next/page?token');
    assert.ok(!request.url.includes(key));
  });
  await context.test('Claude preserves model names and follows after_id without retired models',async()=>{
    await configure('anthropic');
    app.network.modelResponses=[
      {data:[{id:'claude-sonnet-4-5',display_name:'Claude Sonnet',lifecycle:'active'}],has_more:true,last_id:'claude-sonnet-4-5'},
      {data:[{id:'claude-haiku-4-5',display_name:'Claude Haiku'},{id:'claude-old',lifecycle:'retired'}],has_more:false}
    ];
    const catalog=await (await list('anthropic')).json();
    assert.deepEqual(catalog.models.map(model=>model.name),['Claude Sonnet','Claude Haiku']);
    const request=app.network.modelRequests.at(-1);
    assert.equal(request.headers['x-api-key'],key);
    assert.equal(request.headers['anthropic-version'],'2023-06-01');
    assert.equal(new URL(request.url).searchParams.get('after_id'),'claude-sonnet-4-5');
  });
  await context.test('catalog failures, invalid JSON and redirects retain usable manual selection',async()=>{
    for(const status of [401,403,429,503,302]){
      app.network.modelStatus=status;
      app.network.modelResponses=[{error:{message:key}}];
      const response=await list('openai');
      assert.equal(response.status,200);
      const text=await response.text();assert.ok(!text.includes(key));
      const catalog=JSON.parse(text);
      assert.equal(catalog.source,'suggested');assert.ok(catalog.warning);assert.ok(catalog.models.length);
    }
    app.network.modelStatus=200;
    for(const payload of ['invalid-json',{unrecognized:[]}]){
      app.network.modelResponses=[payload];
      assert.equal((await (await list('deepseek')).json()).source,'suggested');
    }
  });
  await context.test('malformed and duplicate model IDs are removed and result counts bounded',async()=>{
    app.network.models.deepseek={data:[null,{id:'deepseek-flash'},{id:'deepseek-flash'},{id:'/invalid'},{id:'bad model'},...Array.from({length:510},(_,index)=>({id:`deepseek-test-${index}`}))]};
    const catalog=await (await list('deepseek')).json();
    assert.equal(catalog.models.length,500);
    assert.equal(new Set(catalog.models.map(model=>model.id)).size,500);
  });
  await context.test('pagination loops cannot cause unbounded upstream requests',async()=>{
    app.network.modelResponses=[
      {models:[{name:'models/gemini-2.5-flash',supportedGenerationMethods:['generateContent']}],nextPageToken:'repeat'},
      {models:[],nextPageToken:'repeat'}
    ];
    const before=app.network.modelRequests.length;
    assert.equal((await (await list('gemini')).json()).source,'suggested');
    assert.equal(app.network.modelRequests.length-before,2);
  });
  await context.test('removing the key removes access to its live catalog',async()=>{
    await app.call('/api/providers/deepseek',{method:'DELETE',cookie});
    const before=app.network.modelRequests.length;
    assert.equal((await (await list('deepseek')).json()).configured,false);
    assert.equal(app.network.modelRequests.length,before);
  });
});

test('selected models are sent exactly and persist in chat history',async context=>{
  const app=await fixture();
  context.after(()=>app.mf.dispose());
  const cookie=await app.setup();
  await app.call('/api/providers/deepseek',{method:'PUT',cookie,body:{key:'private-streaming-test-key'}});
  const create=async body=>(await (await app.call('/api/chats',{method:'POST',cookie,body})).json()).id;
  const chatId=await create({});
  assert.equal((await (await app.call(`/api/chats/${chatId}`,{cookie})).json()).chat.model,'deepseek-flash');
  for(const model of ['deepseek-flash','deepseek-v4-pro','custom-model-v1']){
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Comprueba el modelo elegido',model}});
    assert.equal(response.status,200);
    assert.ok((await response.text()).includes('"done":true'));
    assert.equal(app.outbound.at(-1).body.model,model);
    assert.equal((await (await app.call(`/api/chats/${chatId}`,{cookie})).json()).chat.model,model);
  }
  const login=await app.call('/api/login',{method:'POST',body:{password:'private test password 12345'}});
  const secondCookie=login.headers.get('set-cookie').split(';')[0];
  const history=await (await app.call(`/api/chats/${chatId}`,{cookie:secondCookie})).json();
  assert.equal(history.chat.model,'custom-model-v1');assert.equal(history.messages.length,6);
  const openaiChat=await create({provider:'openai'});
  assert.equal((await (await app.call(`/api/chats/${openaiChat}`,{cookie})).json()).chat.model,'gpt-4.1-mini');
});
