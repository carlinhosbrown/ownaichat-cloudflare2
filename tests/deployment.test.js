import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, cp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const root=new URL('../',import.meta.url);

test('default deployment needs only Workers Static Assets and D1',async()=>{
  const config=JSON.parse(await readFile(new URL('wrangler.jsonc',root),'utf8'));
  assert.equal(config.main,'src/worker.js');
  assert.equal(config.assets.binding,'ASSETS');
  assert.equal(config.assets.directory,'./public');
  assert.equal(config.assets.run_worker_first,true);
  assert.deepEqual(config.d1_databases.map(database=>database.binding),['DB']);
  assert.equal(config.vars.FILES_ENABLED,'false');
  assert.equal(config.vars.ACCESS_ENABLED,'false');
  assert.ok(!Object.hasOwn(config,'r2_buckets'));
  for(const key of ['kv_namespaces','durable_objects','services','secrets_store_secrets']) assert.ok(!Object.hasOwn(config,key));
  const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
  assert.equal(pkg.scripts.deploy,'npm run db:remote && wrangler deploy');
  assert.equal(pkg.scripts['db:remote'],'wrangler d1 migrations apply DB --remote');
  assert.ok(!Object.hasOwn(pkg.cloudflare.bindings,'FILES'));
  const example=await readFile(new URL('.dev.vars.example',root),'utf8');
  assert.match(example,/^BOOTSTRAP_TOKEN=$/m);
  assert.match(example,/^VAULT_KEY=$/m);
});

test('secret generator uses distinct random secrets, private permissions and refuses overwrite',async context=>{
  const folder=await mkdtemp(join(tmpdir(),'ownaichat-secrets-'));
  context.after(()=>rm(folder,{recursive:true,force:true}));
  await cp(new URL('scripts/',root),join(folder,'scripts'),{recursive:true});
  const script=join(folder,'scripts','secrets.mjs');
  const first=spawnSync(process.execPath,[script,'--local'],{encoding:'utf8'});
  assert.equal(first.status,0,first.stderr);
  assert.ok(!first.stdout.includes('VAULT_KEY='));
  const content=await readFile(join(folder,'.dev.vars'),'utf8');
  const secrets=Object.fromEntries(content.trim().split('\n').map(line=>line.split('=')));
  assert.match(secrets.BOOTSTRAP_TOKEN,/^[a-f0-9]{64}$/);
  assert.match(secrets.VAULT_KEY,/^[a-f0-9]{64}$/);
  assert.notEqual(secrets.BOOTSTRAP_TOKEN,secrets.VAULT_KEY);
  if(process.platform!=='win32') assert.equal((await stat(join(folder,'.dev.vars'))).mode&0o777,0o600);
  assert.equal(spawnSync(process.execPath,[script,'--local']).status,1);
  assert.equal(await readFile(join(folder,'.dev.vars'),'utf8'),content);
});

test('deploy button can be configured with a real public repository URL',async context=>{
  const folder=await mkdtemp(join(tmpdir(),'ownaichat-button-'));
  context.after(()=>rm(folder,{recursive:true,force:true}));
  await cp(new URL('scripts/',root),join(folder,'scripts'),{recursive:true});
  await cp(new URL('README.md',root),join(folder,'README.md'));
  const script=join(folder,'scripts','deploy-button.mjs');
  assert.equal(spawnSync(process.execPath,[script,'https://attacker.test/repo']).status,1);
  const result=spawnSync(process.execPath,[script,'https://github.com/example/ownaichat'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const readme=await readFile(join(folder,'README.md'),'utf8');
  assert.ok(readme.includes('https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fexample%2Fownaichat'));
});
