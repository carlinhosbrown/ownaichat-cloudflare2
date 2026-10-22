import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/fixture.js';

test('optional Access validates JWTs on both static assets and APIs', async context => {
  const keyPair = await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const publicKey = {...await crypto.subtle.exportKey('jwk',keyPair.publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  const app = await fixture({bindings:{ACCESS_ENABLED:'true',ACCESS_TEAM_DOMAIN:'ownaichat-test.cloudflareaccess.com',ACCESS_AUD:'test-audience'},jwks:{keys:[publicKey]}});
  context.after(() => app.mf.dispose());
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const defaults = {iss:'https://ownaichat-test.cloudflareaccess.com',aud:['test-audience'],exp:Math.floor(Date.now()/1000)+600};
  async function jwt(claims={},header={}) {
    const input = `${encode({alg:'RS256',kid:'test-key',...header})}.${encode({...defaults,...claims})}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,new TextEncoder().encode(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`;
  }
  const valid = await jwt();
  const headers = token => ({'Cf-Access-Jwt-Assertion':token});
  await context.test('missing JWT fails closed before static assets, D1 or bootstrap', async () => {
    for (const path of ['/','/app.js','/api/status','/api/setup']) {
      const response = await app.call(path);
      assert.equal(response.status,403);
      assert.equal((await response.json()).code,'ACCESS_REQUIRED');
    }
  });
  await context.test('valid signature, issuer, audience and expiry grant access to shell', async () => {
    assert.equal((await app.call('/',{headers:headers(valid)})).status,200);
    assert.equal((await app.call('/api/status',{headers:headers(valid)})).status,200);
    assert.equal((await app.call('/api/projects',{headers:headers(valid)})).status,401);
    assert.equal(app.network.jwksRequests,1);
  });
  await context.test('tampering, wrong claims and unsigned tokens are rejected', async () => {
    const alteredParts = valid.split('.');
    alteredParts[1]=encode({...defaults,aud:['attacker']});
    const badTokens = [
      alteredParts.join('.'),
      'invalid.jwt.signature',
      await jwt({iss:'https://attacker.test'}),
      await jwt({aud:['another-application']}),
      await jwt({exp:0}),
      await jwt({exp:'99999999999'}),
      await jwt({nbf:Math.floor(Date.now()/1000)+3600}),
      await jwt({}, {alg:'none'}),
      await jwt({}, {kid:'unknown-key'})
    ];
    for (const token of badTokens) assert.equal((await app.call('/api/status',{headers:headers(token)})).status,403);
  });
  await context.test('key lookup outages and redirects fail closed without following other hosts', async () => {
    for(const status of [302,503]) {
      const domain=`unavailable-${status}.cloudflareaccess.com`;
      app.network.jwksStatus=status;
      await app.update({ACCESS_TEAM_DOMAIN:domain});
      const response=await app.call('/api/status',{headers:headers(await jwt({iss:`https://${domain}`}))});
      assert.equal(response.status,503);
      assert.equal((await response.json()).code,'ACCESS_KEYS_UNAVAILABLE');
    }
    app.network.jwksStatus=200;
  });
  await context.test('incomplete or unsafe Access configuration returns 503', async () => {
    for (const domain of ['', 'attacker.test', 'test.cloudflareaccess.com/../private', 'https://test.cloudflareaccess.com']) {
      await app.update({ACCESS_TEAM_DOMAIN:domain});
      const response=await app.call('/',{headers:headers(valid)});
      assert.equal(response.status,503);
      assert.equal((await response.json()).code,'ACCESS_NOT_CONFIGURED');
    }
    await app.update({ACCESS_TEAM_DOMAIN:'ownaichat-test.cloudflareaccess.com',ACCESS_AUD:''});
    assert.equal((await app.call('/api/status',{headers:headers(valid)})).status,503);
  });
  await context.test('turning Access off restores password-only installation', async () => {
    await app.update({ACCESS_ENABLED:'false'});
    assert.equal((await app.call('/')).status,200);
    const cookie=await app.setup();
    assert.equal((await app.call('/api/me',{cookie})).status,200);
    assert.equal((await app.call('/api/me')).status,401);
  });
});
