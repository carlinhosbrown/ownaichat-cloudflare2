import test from 'node:test';
import assert from 'node:assert/strict';
import {isProvider,validModel,validateMime,_test} from '../src/worker.js';

const env={VAULT_KEY:'59b0bcab8d099cf1fb5d6f3bdf1e5cfdf7c1062c9bb6d84b8eb916a40d5c613e'};

test('provider allow-list blocks arbitrary model endpoints',()=>{
  for(const p of ['deepseek','openai','gemini','anthropic'])assert.equal(isProvider(p),true);
  for(const p of ['ftp','localhost','openai.evil.tld','__proto__'])assert.equal(isProvider(p),false);
});
test('model IDs are validated',()=>{
  assert.equal(validModel('deepseek-chat'),true);
  assert.equal(validModel('claude-sonnet-4-5'),true);
  assert.equal(validModel('http://localhost:80/private'),false);
  assert.equal(validModel('bad model'),false);
});
test('safe file MIME allow-list',()=>{
  assert.equal(validateMime('notes.md','text/plain'),'text/markdown');
  assert.equal(validateMime('invoice.pdf','application/pdf'),'application/pdf');
  assert.equal(validateMime('evil.svg','image/svg+xml'),null);
  assert.equal(validateMime('malware.html','text/html'),null);
});
test('PBKDF2+pepper is deterministic and password dependent',async()=>{
  const salt='4b819f186c416157aec2f9b0eb9db002';
  const a=await _test.derive('a secure password for testing',salt,env);
  const b=await _test.derive('a secure password for testing',salt,env);
  const c=await _test.derive('a different password for testing',salt,env);
  assert.equal(a,b);assert.notEqual(a,c);assert.equal(a.length,64);
});
test('vault AES-GCM encrypts and decrypts and rejects wrong key',async()=>{
  const saved=await _test.seal(env,'test-sensitive-key');
  assert.equal(await _test.unseal(env,saved),'test-sensitive-key');
  assert.equal(saved.ciphertext.includes('test-sensitive-key'),false);
  await assert.rejects(_test.unseal({VAULT_KEY:'00'.repeat(32)},saved));
});
