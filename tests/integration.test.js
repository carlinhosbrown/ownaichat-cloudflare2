import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/fixture.js';

test('Workers + D1 without any R2 or Access binding', async context => {
  const app = await fixture();
  context.after(() => app.mf.dispose());
  let cookie;
  let projectId;
  let chatId;

  await context.test('static shell and status work without optional services', async () => {
    assert.equal((await app.call('/')).status, 200);
    const response = await app.call('/api/status');
    const info = await response.json();
    assert.equal(info.ready, true);
    assert.equal(info.installed, false);
    assert.equal(info.features.attachments.enabled, false);
    assert.equal(info.features.attachments.available, false);
    assert.equal(info.features.access, false);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await app.call('/api/projects')).status, 401);
  });
  await context.test('missing, example and identical secrets keep bootstrap locked', async () => {
    const original = {...app.bindings};
    for (const changes of [
      {BOOTSTRAP_TOKEN:''},
      {VAULT_KEY:''},
      {BOOTSTRAP_TOKEN:'replace_with_a_long_random_setup_token'},
      {BOOTSTRAP_TOKEN:original.VAULT_KEY},
      {VAULT_KEY:'0'.repeat(64)}
    ]) {
      await app.update({...original, ...changes});
      assert.equal((await (await app.call('/api/status')).json()).ready, false);
      assert.equal((await app.call('/api/setup', {method:'POST',body:{token:app.bindings.BOOTSTRAP_TOKEN,password:'private test password 12345'}})).status, 503);
    }
    await app.update(original);
  });
  await context.test('bootstrap token and same-origin protection are required', async () => {
    assert.equal((await app.call('/api/setup', {method:'POST',body:{token:'wrong',password:'private test password 12345'}})).status, 401);
    assert.equal((await app.call('/api/setup', {method:'POST',body:{},headers:{Origin:'https://attacker.test'}})).status, 403);
    assert.equal((await app.call('/api/setup', {method:'POST',body:{},headers:{'X-OwnChat-Request':'0'}})).status, 403);
    assert.equal((await app.call('/api/setup', {method:'POST',body:{token:app.bindings.BOOTSTRAP_TOKEN,password:'short'}})).status, 400);
    assert.equal(await app.db.prepare('SELECT id FROM owner').first(), null);
  });
  await context.test('one private owner with secure session and no second registration', async () => {
    const response = await app.call('/api/setup', {method:'POST',body:{token:app.bindings.BOOTSTRAP_TOKEN,password:'private test password 12345'}});
    assert.equal(response.status, 201);
    const setCookie = response.headers.get('set-cookie');
    for (const part of ['__Host-ownchat_session=', 'HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(setCookie.includes(part));
    cookie = setCookie.split(';')[0];
    assert.equal((await app.call('/api/setup', {method:'POST',body:{}})).status, 409);
    assert.equal((await app.call('/api/me', {cookie})).status, 200);
  });
  await context.test('bootstrap secret can be removed after installation', async () => {
    await app.update({BOOTSTRAP_TOKEN:undefined});
    assert.equal((await (await app.call('/api/status')).json()).ready, true);
    const login = await app.call('/api/login', {method:'POST',body:{password:'private test password 12345'}});
    assert.equal(login.status, 200);
    assert.notEqual(login.headers.get('set-cookie').split(';')[0], cookie);
    assert.equal((await app.call('/api/me', {cookie})).status, 200);
    assert.equal((await app.call('/api/login', {method:'POST',body:{password:'incorrect password'}})).status, 401);
  });
  await context.test('projects and chats persist in D1 without file storage', async () => {
    const project = await app.call('/api/projects', {method:'POST',cookie,body:{name:'Mi proyecto',instructions:'Responde de forma breve.'}});
    assert.equal(project.status, 201);
    projectId = (await project.json()).id;
    const chat = await app.call('/api/chats', {method:'POST',cookie,body:{projectId}});
    assert.equal(chat.status, 201);
    chatId = (await chat.json()).id;
    assert.equal((await (await app.call('/api/projects', {cookie})).json()).projects[0].instructions, 'Responde de forma breve.');
    const files = await (await app.call(`/api/projects/${projectId}/files`, {cookie})).json();
    assert.deepEqual(files.files, []);
    assert.equal(files.attachments.available, false);
  });
  await context.test('disabled attachments return a clear error before parsing multipart', async () => {
    for (const [path,method] of [[`/api/projects/${projectId}/files`,'POST'], [`/api/files/${crypto.randomUUID()}`,'GET'], [`/api/files/${crypto.randomUUID()}`,'DELETE']]) {
      const response = await app.call(path, {method,cookie});
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'ATTACHMENTS_DISABLED');
    }
  });
  await context.test('four API connectors stream responses and save messages with encrypted keys', async () => {
    const models = {deepseek:'deepseek-chat',openai:'test-openai',gemini:'test-gemini',anthropic:'test-claude'};
    for (const [provider,model] of Object.entries(models)) {
      const apiKey = `private-api-key-${provider}`;
      assert.equal((await app.call(`/api/providers/${provider}`, {method:'PUT',cookie,body:{key:apiKey}})).status, 200);
      const encrypted = await app.db.prepare('SELECT ciphertext FROM provider_keys WHERE provider=?').bind(provider).first();
      assert.ok(!encrypted.ciphertext.includes(apiKey));
      const response = await app.call(`/api/chats/${chatId}/messages`, {method:'POST',cookie,body:{content:'Hola desde otro dispositivo',provider,model}});
      assert.equal(response.status, 200);
      const stream = await response.text();
      assert.ok(stream.includes('Respuesta de prueba'));
      assert.ok(stream.includes('"done":true'));
      const sent = app.outbound.at(-1);
      assert.equal(sent.body.model, model);
      assert.equal(provider === 'anthropic' ? sent.headers['x-api-key'] : sent.headers.authorization, provider === 'anthropic' ? apiKey : `Bearer ${apiKey}`);
      assert.ok(JSON.stringify(sent.body).includes('Responde de forma breve.'));
    }
    const providers = await (await app.call('/api/providers', {cookie})).text();
    assert.ok(!providers.includes('private-api-key-'));
    assert.equal((await app.call('/api/providers/localhost', {method:'PUT',cookie,body:{key:'a-private-key'}})).status, 404);
  });
  await context.test('a second device retrieves the same complete history', async () => {
    const response = await app.call('/api/login', {method:'POST',body:{password:'private test password 12345'}});
    const secondCookie = response.headers.get('set-cookie').split(';')[0];
    const history = await (await app.call(`/api/chats/${chatId}`, {cookie:secondCookie})).json();
    assert.equal(history.messages.length, 8);
    assert.equal(history.chat.project_id, projectId);
    const exported = await (await app.call('/api/export', {cookie:secondCookie})).json();
    assert.equal(exported.messages.length, 8);
    assert.equal(exported.projects.length, 1);
    assert.ok(!JSON.stringify(exported).includes('private-api-key-'));
  });
  await context.test('unchanged migration is repeatable and retains MVP data', async () => {
    await app.migrate();
    assert.equal((await app.db.prepare('SELECT count(*) AS total FROM messages').first()).total, 8);
    assert.equal((await app.db.prepare('SELECT count(*) AS total FROM owner').first()).total, 1);
  });
  await context.test('deleting a project without R2 preserves its chat and history', async () => {
    assert.equal((await app.call(`/api/projects/${projectId}`, {method:'DELETE',cookie})).status, 200);
    const history = await (await app.call(`/api/chats/${chatId}`, {cookie})).json();
    assert.equal(history.chat.project_id, null);
    assert.equal(history.messages.length, 8);
  });
  await context.test('logout revokes only its D1 session', async () => {
    assert.equal((await app.call('/api/logout', {method:'POST',cookie})).status, 200);
    assert.equal((await app.call('/api/me', {cookie})).status, 401);
  });
  await context.test('incorrect passwords are rate limited', async () => {
    for (let attempt=0; attempt<6; attempt++) await app.call('/api/login', {method:'POST',body:{password:'incorrect password'}});
    assert.equal((await app.call('/api/login', {method:'POST',body:{password:'private test password 12345'}})).status, 429);
  });
});

test('R2 opt-in, missing binding and preservation of existing files', async context => {
  const app = await fixture({r2:true,bindings:{FILES_ENABLED:'true'}});
  context.after(() => app.mf.dispose());
  const cookie = await app.setup();
  const projectId = (await (await app.call('/api/projects', {method:'POST',cookie,body:{name:'Adjuntos'}})).json()).id;
  let fileId;
  await context.test('upload, private download and text extraction work when enabled', async () => {
    const body = new FormData();
    body.set('file', new File(['Texto privado'], 'notes.txt', {type:'text/plain'}));
    const response = await app.call(`/api/projects/${projectId}/files`, {method:'POST',cookie,body});
    assert.equal(response.status, 201);
    const saved = await response.json();
    assert.equal(saved.readable, true);
    fileId = saved.id;
    assert.equal((await app.call(`/api/files/${fileId}`)).status, 401);
    const download = await app.call(`/api/files/${fileId}`, {cookie});
    assert.equal(await download.text(), 'Texto privado');
    assert.equal(download.headers.get('cache-control'), 'private, no-store');
    const row = await app.db.prepare('SELECT extracted_text FROM files WHERE id=?').bind(fileId).first();
    assert.equal(row.extracted_text, 'Texto privado');
  });
  await context.test('MIME and size limits still apply with R2', async () => {
    for (const [file,status] of [[new File(['<svg/>'],'evil.svg',{type:'image/svg+xml'}),400], [new File([new Uint8Array(3*1024*1024+1)],'large.txt',{type:'text/plain'}),413]]) {
      const body = new FormData();body.set('file',file);
      assert.equal((await app.call(`/api/projects/${projectId}/files`,{method:'POST',cookie,body})).status,status);
    }
  });
  await context.test('binding alone does not enable R2; old files cannot be orphaned by project deletion', async () => {
    await app.update({FILES_ENABLED:undefined});
    assert.equal((await (await app.call('/api/status')).json()).features.attachments.available, false);
    assert.equal((await app.call(`/api/files/${fileId}`,{cookie})).status,409);
    const result = await app.call(`/api/projects/${projectId}`,{method:'DELETE',cookie});
    assert.equal(result.status,409);
    assert.equal((await result.json()).code,'ATTACHMENTS_IN_USE');
    assert.ok(await app.db.prepare('SELECT id FROM projects WHERE id=?').bind(projectId).first());
    assert.ok(await app.db.prepare('SELECT id FROM files WHERE id=?').bind(fileId).first());
    const bucket = await app.mf.getR2Bucket('FILES');
    assert.equal((await bucket.list()).objects.length,1);
  });
  await context.test('reenabling R2 permits safe file and project deletion', async () => {
    await app.update({FILES_ENABLED:'true'});
    assert.equal((await app.call(`/api/files/${fileId}`,{method:'DELETE',cookie})).status,200);
    const body = new FormData();body.set('file',new File(['Document'],'notes.txt',{type:'text/plain'}));
    assert.equal((await app.call(`/api/projects/${projectId}/files`,{method:'POST',cookie,body})).status,201);
    assert.equal((await app.call(`/api/projects/${projectId}`,{method:'DELETE',cookie})).status,200);
    const bucket = await app.mf.getR2Bucket('FILES');
    assert.equal((await bucket.list()).objects.length,0);
    assert.equal((await app.db.prepare('SELECT count(*) AS total FROM files').first()).total,0);
  });
});

test('R2 enabled without a binding returns 503 instead of crashing', async context => {
  const app = await fixture({bindings:{FILES_ENABLED:'true'}});
  context.after(() => app.mf.dispose());
  const cookie = await app.setup();
  const response = await app.call(`/api/projects/${crypto.randomUUID()}/files`,{method:'POST',cookie});
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'R2_NOT_CONFIGURED');
  assert.equal((await app.call('/api/chats',{cookie})).status,200);
});
