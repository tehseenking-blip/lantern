import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import llm from '../electron/llm.js';
import providers from '../electron/providers.js';

function fixture({secret=true}={}) {
  const handlers={}, calls=[];
  let settings={providers:providers.withColibri(),activeProvider:'ollama',lastModel:'old-model',secrets:secret?{colibri:Buffer.from('fixture-key').toString('base64')}:{}};
  const db={getSettings:()=>settings,updateSettings:patch=>{settings={...settings,...patch};return settings;}};
  const fakeLlm={...llm,
    discoverModels: async target=>{calls.push({type:'discover',...target});return [{id:'exact-local-model'}];},
    streamChat:async target=>{calls.push({type:'chat',...target});return {text:'Local works',usage:{prompt_tokens:1,completion_tokens:2}};},
  };
  const fakeElectron={app:{},ipcMain:{handle:(name,fn)=>{handlers[name]=fn;}},safeStorage:{isEncryptionAvailable:()=>true,decryptString:b=>b.toString(),encryptString:s=>Buffer.from(s)}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(new URL('../electron/ipc.js',import.meta.url),'utf8'),{
    module,exports:module.exports,Buffer,Date,Map,AbortController,AbortSignal,
    require(name){
      if(name==='electron')return fakeElectron;
      if(name==='./db')return db;
      if(name==='./llm')return fakeLlm;
      if(name==='./context')return {buildContext:()=>({}),estimateTokens:()=>1};
      return {};
    },
  });
  module.exports.registerIpc({});
  return {call:(name,payload)=>handlers[name]({},payload),calls,settings:()=>settings};
}
test('model discovery obtains the key in the main process',async()=>{
  const f=fixture();const r=await f.call('providers:models',{providerId:'colibri',kind:'colibri',baseUrl:'http://127.0.0.1:8000/v1'});
  assert.equal(r.ok,true);assert.equal(f.calls[0].apiKey,'fixture-key');assert.equal(r.apiKey,undefined);
});
test('connection test also uses authentication',async()=>{
  const f=fixture();const r=await f.call('providers:test',{providerId:'colibri'});
  assert.equal(r.ok,true);assert.equal(r.count,1);assert.equal(f.calls[0].apiKey,'fixture-key');
});
test('stored key cannot be sent to an unsaved changed address',async()=>{
  const f=fixture();const r=await f.call('providers:test',{providerId:'colibri',kind:'colibri',baseUrl:'http://127.0.0.1:9999'});
  assert.equal(r.ok,false);assert.match(r.error,/Save this address/);assert.equal(f.calls.length,0);
});
test('changing protocol cannot silently reuse a stored key',async()=>{
  const f=fixture();const r=await f.call('providers:test',{providerId:'colibri',kind:'ollama',baseUrl:'http://127.0.0.1:8000/v1'});
  assert.equal(r.ok,false);assert.equal(f.calls.length,0);
});
test('a renderer-supplied raw key is ignored',async()=>{
  const f=fixture({secret:false});await f.call('providers:test',{providerId:'colibri',apiKey:'untrusted'});
  assert.equal(f.calls[0].apiKey,null);
});
test('public settings never expose encrypted or plaintext keys',async()=>{
  const f=fixture();const r=await f.call('settings:get');
  assert.equal(r.secrets,undefined);assert.equal(r.secretProviders[0],'colibri');assert.ok(!JSON.stringify(r).includes('fixture-key'));
});
test('settings update rejects remote provider addresses before saving',async()=>{
  const f=fixture();const r=await f.call('settings:update',{providers:[{id:'colibri',kind:'colibri',baseUrl:'https://example.com'}]});
  assert.match(r.__error,/loopback/);assert.equal(f.settings().providers.length,3);
});
test('settings update rejects duplicate provider IDs',async()=>{
  const f=fixture();const p={id:'colibri',kind:'colibri',baseUrl:'http://127.0.0.1:8000'};
  assert.match((await f.call('settings:update',{providers:[p,p]})).__error,/unique ID/);
});
test('settings update rejects unknown provider protocol',async()=>{
  const f=fixture();assert.match((await f.call('settings:update',{providers:[{id:'a',kind:'remote',baseUrl:'http://127.0.0.1:8000'}]})).__error,/Unsupported/);
});
test('renderer cannot bypass encryption by writing the secrets property',async()=>{
  const f=fixture();await f.call('settings:update',{secrets:{colibri:'plaintext-malicious'}});
  assert.notEqual(f.settings().secrets.colibri,'plaintext-malicious');
});
test('response test sends a fixed prompt only and exact discovered model ID',async()=>{
  const f=fixture();const r=await f.call('providers:generateTest',{providerId:'colibri',messages:[{role:'user',content:'private-chat'}]});
  assert.equal(r.ok,true);const chat=f.calls.find(x=>x.type==='chat');
  assert.equal(chat.model,'exact-local-model');assert.equal(chat.apiKey,'fixture-key');assert.equal(chat.options.enable_thinking,false);
  assert.ok(!JSON.stringify(chat.messages).includes('private-chat'));assert.equal(chat.messages.length,1);
});
test('response test rejects a model not returned by discovery',async()=>{
  const f=fixture();const r=await f.call('providers:generateTest',{providerId:'colibri',model:'invented-model'});
  assert.equal(r.ok,false);assert.equal(f.calls.filter(x=>x.type==='chat').length,0);
});
