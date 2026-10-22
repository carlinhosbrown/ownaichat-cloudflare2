import test from 'node:test';
import assert from 'node:assert/strict';
import {modelCapabilities,generationParameters} from '../public/modes.js';
import {fixture} from './helpers/fixture.js';

test('generation modes use provider-specific parameters, not prompt instructions',()=>{
  assert.deepEqual(generationParameters('deepseek','deepseek-flash').extra,{});
  assert.deepEqual(generationParameters('deepseek','deepseek-flash',{mode:'direct'}).extra,{thinking:{type:'disabled'}});
  assert.deepEqual(generationParameters('deepseek','deepseek-v4-pro',{mode:'reasoning',effort:'max'}).extra,{thinking:{type:'enabled'},reasoning_effort:'max'});
  assert.deepEqual(modelCapabilities('deepseek','deepseek-flash').levels,['low','high','max']);
  assert.deepEqual(generationParameters('openai','gpt-5.4',{mode:'reasoning',effort:'xhigh'}).extra,{reasoning_effort:'xhigh'});
  assert.deepEqual(generationParameters('openai','gpt-5.2',{mode:'direct'}).extra,{reasoning_effort:'none'});
  assert.deepEqual(generationParameters('gemini','gemini-2.5-flash',{mode:'direct'}).extra,{reasoning_effort:'none'});
  assert.deepEqual(generationParameters('gemini','gemini-3-pro',{mode:'reasoning',effort:'high'}).extra,{reasoning_effort:'high'});
  const legacy=generationParameters('anthropic','claude-sonnet-4-5',{mode:'reasoning',effort:'high'}).extra;
  assert.equal(legacy.thinking.budget_tokens,8192);assert.ok(legacy.max_tokens>legacy.thinking.budget_tokens);
  assert.deepEqual(generationParameters('anthropic','claude-sonnet-4-6',{mode:'reasoning',effort:'low'}).extra,{thinking:{type:'adaptive'},output_config:{effort:'low'},max_tokens:16000});
  assert.equal(modelCapabilities('anthropic','claude-sonnet-4-20250514').reasoningStyle,'anthropic-budget');
  assert.equal(modelCapabilities('anthropic','claude-opus-4-1').reasoningStyle,'anthropic-budget');
  assert.equal(generationParameters('anthropic','claude-opus-4-7',{mode:'reasoning',effort:'xhigh'}).extra.output_config.effort,'xhigh');
  assert.equal(generationParameters('anthropic','claude-sonnet-4-6',{mode:'reasoning',effort:'max'}).extra.output_config.effort,'max');
  assert.equal(modelCapabilities('anthropic','claude-fable-5-1').canDirect,false);
  assert.equal(modelCapabilities('anthropic','claude-sonnet-5-5').canDirect,false);
  assert.equal(modelCapabilities('openai','unknown-model').canDirect,false);
  assert.equal(modelCapabilities('openai','gpt-6-astra').canDirect,false);
  assert.equal(modelCapabilities('openai','gpt-6.1-sol').canDirect,false);
});

test('unsupported modes and effort levels are rejected before contacting a provider',()=>{
  for(const [provider,model,settings] of [
    ['deepseek','deepseek-flash',{mode:'reasoning',effort:'medium'}],
    ['openai','gpt-4.1',{mode:'reasoning'}],
    ['openai','gpt-5',{mode:'direct'}],
    ['openai','gpt-5-mini',{mode:'reasoning',effort:'xhigh'}],
    ['openai','o3',{mode:'direct'}],
    ['gemini','gemini-2.5-pro',{mode:'direct'}],
    ['gemini','gemini-3-pro',{mode:'reasoning',effort:'medium'}],
    ['deepseek','deepseek-flash',{mode:'image'}],
    ['openai','gpt-image-1',{mode:'auto'}],
    ['openai','gpt-image-1',{mode:'image',quality:'xhigh'}],
    ['openai','gpt-5',{mode:'reasoning',effort:'ultra'}],
    ['openai','gpt-5',{mode:'unknown'}]
  ])assert.throws(()=>generationParameters(provider,model,settings));
  assert.equal(generationParameters('openai','gpt-image-2.5-flare',{mode:'image',quality:'xhigh'}).selected.quality,'xhigh');
  assert.equal(generationParameters('gemini','gemini-2.5-flash-image',{mode:'image',size:'auto'}).selected.size,'auto');
  assert.equal(modelCapabilities('openai','unknown-model').levels.length,0);
});

test('custom profiles only send the explicitly configured reasoning format',()=>{
  const connection={custom:true,reasoningStyle:'vllm',effortLevels:[]};
  assert.deepEqual(generationParameters('custom-example','Qwen/Qwen3-8B',{mode:'reasoning'},connection).extra,{chat_template_kwargs:{enable_thinking:true}});
  assert.deepEqual(generationParameters('custom-example','Qwen/Qwen3-8B',{mode:'direct'},connection).extra,{chat_template_kwargs:{enable_thinking:false}});
  assert.throws(()=>generationParameters('custom-example','Qwen/Qwen3-8B',{mode:'reasoning',effort:'high'},connection));
  connection.reasoningStyle='openai';connection.effortLevels=['low','high','xhigh'];
  assert.deepEqual(generationParameters('custom-example','my-model',{mode:'reasoning',effort:'xhigh'},connection).extra,{reasoning_effort:'xhigh'});
});

test('reasoning options are validated, sent and synchronized between sessions',async context=>{
  const app=await fixture();context.after(()=>app.mf.dispose());const cookie=await app.setup();
  for(const provider of ['deepseek','openai','gemini','anthropic'])await app.call(`/api/providers/${provider}`,{method:'PUT',cookie,body:{key:`fake-key-${provider}`}});
  const chatId=(await (await app.call('/api/chats',{method:'POST',cookie,body:{provider:'deepseek'}})).json()).id;
  await context.test('DeepSeek effort and mode persist with each message and the chat',async()=>{
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Resuelve este problema',settings:{mode:'reasoning',effort:'max',baseUrl:'https://attacker.test'}}});
    assert.equal(response.status,200);assert.match(await response.text(),/"done":true/);
    const sent=app.outbound.at(-1);assert.equal(sent.body.reasoning_effort,'max');assert.deepEqual(sent.body.thinking,{type:'enabled'});assert.ok(!('baseUrl' in sent.body));
    const login=await app.call('/api/login',{method:'POST',body:{password:'private test password 12345'}});
    const cookie2=login.headers.get('set-cookie').split(';')[0];
    const history=await (await app.call(`/api/chats/${chatId}`,{cookie:cookie2})).json();
    assert.equal(history.chat.settings.effort,'max');assert.equal(history.messages.length,2);
    assert.equal(history.messages[1].settings.mode,'reasoning');assert.ok(!('baseUrl' in history.chat.settings));
    const next=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie:cookie2,body:{content:'Continúa'}});await next.text();
    assert.equal(app.outbound.at(-1).body.reasoning_effort,'max');
  });
  await context.test('switching models without settings clears incompatible old options',async()=>{
    const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Otro modelo',provider:'openai',model:'gpt-4.1-mini'}});
    assert.equal(response.status,200);await response.text();assert.ok(!('reasoning_effort' in app.outbound.at(-1).body));
  });
  await context.test('four providers receive their own documented fields',async()=>{
    for(const [provider,model,settings,expected] of [
      ['deepseek','deepseek-flash',{mode:'direct'},{thinking:{type:'disabled'}}],
      ['openai','gpt-5.4',{mode:'reasoning',effort:'xhigh'},{reasoning_effort:'xhigh'}],
      ['gemini','gemini-2.5-flash',{mode:'reasoning',effort:'medium'},{reasoning_effort:'medium'}],
      ['anthropic','claude-sonnet-4-5',{mode:'reasoning',effort:'low'},{thinking:{type:'enabled',budget_tokens:1024},max_tokens:5120}],
      ['anthropic','claude-sonnet-4-6',{mode:'reasoning',effort:'high'},{thinking:{type:'adaptive'},output_config:{effort:'high'}}]
    ]){const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Prueba de modo',provider,model,settings}});assert.equal(response.status,200);await response.text();for(const [field,value] of Object.entries(expected))assert.deepEqual(app.outbound.at(-1).body[field],value);}
  });
  await context.test('invalid settings and unsupported capabilities do not generate charges',async()=>{
    const previous=app.outbound.length;
    for(const settings of [null,[],{mode:'image'},{mode:'reasoning',effort:'xhigh'}]){
      const response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'No enviar',provider:'deepseek',model:'deepseek-flash',settings}});
      assert.equal(response.status,400);
    }
    assert.equal(app.outbound.length,previous);
  });
  await context.test('only final answer text is shown and provider error bodies never leak keys',async()=>{
    app.network.textBody='data: {"choices":[{"delta":{"reasoning_content":"private internal thoughts"}}]}\n\ndata: {"choices":[{"delta":{"content":"Respuesta final"}}]}\n\ndata: [DONE]\n\n';
    let response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Prueba',provider:'deepseek',model:'deepseek-flash',settings:{mode:'auto'}}});
    const text=await response.text();assert.match(text,/Respuesta final/);assert.ok(!text.includes('private internal thoughts'));
    app.network.textBody='data: {"type":"error","error":{"message":"fake-key-deepseek"}}\n\n';
    response=await app.call(`/api/chats/${chatId}/messages`,{method:'POST',cookie,body:{content:'Prueba error'}});
    const error=await response.text();assert.match(error,/"error"/);assert.ok(!error.includes('fake-key-deepseek'));
  });
});
