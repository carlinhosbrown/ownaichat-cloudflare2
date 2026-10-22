import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,TEST_IMAGE} from './helpers/fixture.js';

test('generated images persist privately in D1 without R2',async context=>{
  const app=await fixture();context.after(()=>app.mf.dispose());const cookie=await app.setup();let chatId,imageId;
  for(const provider of ['openai','gemini'])await app.call(`/api/providers/${provider}`,{method:'PUT',cookie,body:{key:`fake-image-key-${provider}`}});
  const send=body=>app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Un paisaje de montaña',...body}});
  await context.test('OpenAI uses Images API without unsupported response_format',async()=>{
    const created=await app.call('/api/chats',{method:'POST',cookie,body:{provider:'openai',model:'gpt-image-1',settings:{mode:'image',quality:'high',size:'1536x1024'}}});assert.equal(created.status,201);chatId=(await created.json()).id;
    const response=await send();assert.equal(response.status,201);const result=await response.json();imageId=result.message.images[0].id;assert.equal(result.message.kind,'image');assert.equal(result.message.settings.quality,'high');assert.ok(!JSON.stringify(result).includes(TEST_IMAGE));
    const sent=app.outbound.at(-1);assert.equal(sent.url,'https://api.openai.com/v1/images/generations');assert.equal(sent.body.quality,'high');assert.equal(sent.body.size,'1536x1024');assert.equal(sent.body.n,1);assert.ok(!('response_format' in sent.body));assert.ok(!('stream' in sent.body));assert.equal(sent.headers.authorization,'Bearer fake-image-key-openai');
  });
  await context.test('preview and download require login and are never cached',async()=>{
    assert.equal((await app.call(`/api/images/${imageId}`)).status,401);
    const response=await app.call(`/api/images/${imageId}`,{cookie});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(TEST_IMAGE,'base64'));
    const download=await app.call(`/api/images/${imageId}?download=1`,{cookie});assert.match(download.headers.get('content-disposition'),/^attachment/);await download.arrayBuffer();
    assert.equal((await app.call(`/api/images/${crypto.randomUUID()}`,{cookie})).status,404);
  });
  await context.test('another session receives the same image references and settings',async()=>{
    const login=await app.call('/api/login',{method:'POST',body:{password:'private test password 12345'}});const cookie2=login.headers.get('set-cookie').split(';')[0];
    const history=await (await app.call(`/api/chats/${chatId}`,{cookie:cookie2})).json();assert.equal(history.chat.settings.mode,'image');assert.equal(history.messages.length,2);assert.equal(history.messages[1].images[0].id,imageId);assert.equal((await app.call(`/api/images/${imageId}`,{cookie:cookie2})).status,200);
    const exported=await (await app.call('/api/export',{cookie})).text();assert.ok(exported.includes(imageId));assert.ok(!exported.includes(TEST_IMAGE));assert.ok(!exported.includes('fake-image-key'));
    assert.equal((await (await app.call('/api/status')).json()).features.attachments.available,false);
  });
  await context.test('Gemini uses its native image endpoint and inline parts',async()=>{
    app.network.imageResult={candidates:[{content:{parts:[{thought:true,text:'Private thinking'},{text:'Imagen de prueba'},{inlineData:{mimeType:'image/png',data:TEST_IMAGE}}]}}]};
    const response=await send({provider:'gemini',model:'gemini-2.5-flash-image',settings:{mode:'image',size:'auto'}});assert.equal(response.status,201);assert.equal((await response.json()).message.content,'Imagen de prueba');
    const sent=app.outbound.at(-1);assert.equal(sent.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent');assert.equal(sent.headers['x-goog-api-key'],'fake-image-key-gemini');assert.deepEqual(sent.body.generationConfig.responseModalities,['TEXT','IMAGE']);
    app.network.imageResult=null;
  });
  await context.test('custom image connection supports URL responses without leaking Authorization',async()=>{
    const connection=await app.call('/api/connections',{method:'POST',cookie,body:{name:'Custom images',kind:'openai',baseUrl:'https://inference.example.com/v1',defaultModel:'my-chat',imageModel:'my-image',authType:'bearer',key:'custom-image-key',reasoningStyle:'none'}});const provider=(await connection.json()).id;
    app.network.imageResult={data:[{url:'https://images.example.com/result.png?signature=private'}]};
    const response=await send({provider,model:'my-image',settings:{mode:'image'}});assert.equal(response.status,201);await response.json();assert.equal(app.outbound.at(-1).url,'https://inference.example.com/v1/images/generations');assert.equal(app.outbound.at(-1).body.response_format,'b64_json');assert.equal(app.network.downloads.at(-1).headers.authorization,undefined);
    app.network.imageResult=null;
  });
  await context.test('invalid, oversized and malicious images fail without saving partial turns',async()=>{
    const previous=(await app.db.prepare('SELECT count(*) AS total FROM messages').first()).total;
    for(const payload of [
      {data:[{b64_json:Buffer.from('<html>Not an image</html>').toString('base64')}]},
      {data:[{b64_json:'@'.repeat(40)}]},
      {data:[{b64_json:'A'.repeat(8*1024*1024+4)}]},
      {data:[{url:'http://localhost/private'}]},
      'not JSON',{error:{message:'fake-image-key-openai'}}
    ]){app.network.imageResult=payload;const response=await send({provider:'openai',model:'gpt-image-1',settings:{mode:'image'}});assert.ok([400,413,502].includes(response.status));assert.ok(!(await response.text()).includes('fake-image-key-openai'));}
    app.network.imageResult={data:[{url:'https://images.example.com/redirect'}]};app.network.downloadStatus=302;assert.equal((await send({provider:'openai',model:'gpt-image-1',settings:{mode:'image'}})).status,502);app.network.downloadStatus=200;
    app.network.imageResult=null;app.network.imageStatus=429;assert.equal((await send({provider:'openai',model:'gpt-image-1',settings:{mode:'image'}})).status,502);app.network.imageStatus=200;
    assert.equal((await app.db.prepare('SELECT count(*) AS total FROM messages').first()).total,previous);
  });
  await context.test('chunked image storage stays below per-row limits and reconstructs identical bytes',async()=>{
    const bytes=Buffer.alloc(500000);Buffer.from(TEST_IMAGE,'base64').copy(bytes);app.network.imageResult={data:[{b64_json:bytes.toString('base64')}]};
    const response=await send({provider:'openai',model:'gpt-image-1',settings:{mode:'image'}});assert.equal(response.status,201);const saved=(await response.json()).message.images[0];
    const chunks=await app.db.prepare('SELECT length(data) AS bytes FROM generated_image_chunks WHERE image_id=?').bind(saved.id).all();assert.ok(chunks.results.length>1);assert.ok(chunks.results.every(chunk=>chunk.bytes<=240000));
    const download=await app.call(saved.url,{cookie});assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);app.network.imageResult=null;
  });
  await context.test('the full 6 MiB limit fits into 35 bounded D1 chunks',async()=>{
    const bytes=Buffer.alloc(6*1024*1024);Buffer.from(TEST_IMAGE,'base64').copy(bytes);app.network.imageResult={data:[{b64_json:bytes.toString('base64')}]};
    const response=await send({provider:'openai',model:'gpt-image-1',settings:{mode:'image'}});assert.equal(response.status,201);const image=(await response.json()).message.images[0];
    const count=await app.db.prepare('SELECT count(*) AS total FROM generated_image_chunks WHERE image_id=?').bind(image.id).first();assert.equal(count.total,35);
    const download=await app.call(image.url,{cookie});assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);app.network.imageResult=null;
  });
  await context.test('deleting a chat cascades to generated image metadata and chunks',async()=>{
    assert.equal((await app.call(`/api/chats/${chatId}`,{method:'DELETE',cookie})).status,200);
    assert.equal((await app.db.prepare('SELECT count(*) AS total FROM generated_images').first()).total,0);assert.equal((await app.db.prepare('SELECT count(*) AS total FROM generated_image_chunks').first()).total,0);
    assert.equal((await app.call(`/api/images/${imageId}`,{cookie})).status,404);
  });
});
