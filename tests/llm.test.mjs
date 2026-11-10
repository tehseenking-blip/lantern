import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import llm from '../electron/llm.js';
const { normaliseBase, openAiRoot, discoverModels, streamChat, buildBody } = llm;
const messages = [{ role:'user', content:'A harmless test sentence.' }];
const event = value => `data: ${typeof value === 'string' ? value : JSON.stringify(value)}\n\n`;
const delta = content => ({ choices:[{ index:0, delta:{content}, finish_reason:null }] });
const finish = { choices:[{ index:0, delta:{}, finish_reason:'stop' }] };
const valid = event(delta('Hello')) + event(finish) + event({choices:[],usage:{prompt_tokens:7, completion_tokens:2}}) + event('[DONE]');
async function server(t, handler) {
  const srv = http.createServer(handler);
  srv.listen(0, '127.0.0.1'); await once(srv, 'listening');
  t.after(() => new Promise(resolve => { srv.close(resolve); srv.closeAllConnections(); }));
  return `http://127.0.0.1:${srv.address().port}`;
}
async function body(req) { let s=''; for await (const part of req) s += part; return JSON.parse(s); }
function sse(res, text = valid) { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.end(text); }
const request = (baseUrl, overrides={}) => streamChat({kind:'colibri',baseUrl,model:'test-model',messages,...overrides});

for (const [input, expected] of [
  ['http://localhost:8000/', 'http://127.0.0.1:8000'],
  [' http://127.0.0.1:8000/v1/// ', 'http://127.0.0.1:8000/v1'],
  ['https://127.0.0.1:8443', 'https://127.0.0.1:8443'],
  ['http://[::1]:8000', 'http://[::1]:8000'],
  ['http://127.10.20.30:8000', 'http://127.10.20.30:8000'],
]) test(`local URL accepted: ${input}`, () => assert.equal(normaliseBase(input), expected));
for (const input of ['https://example.com','http://192.168.1.5:8000','http://0.0.0.0:8000','http://[::]:8000','http://[::ffff:192.168.1.1]:8000','http://localhost.example.com','file:///tmp/model','ftp://localhost/model','http://secret@127.0.0.1:8000','http://127.0.0.1:8000?key=secret','http://127.0.0.1:8000/#x','not-a-url','']) {
  test(`non-local or unsafe URL rejected: ${input || '(empty)'}`, () => assert.throws(() => normaliseBase(input)));
}
test('v1 root is added once, including URLs with trailing slash', () => {
  assert.equal(openAiRoot('http://127.0.0.1:8000'), 'http://127.0.0.1:8000/v1');
  assert.equal(openAiRoot('http://127.0.0.1:8000/v1/'), 'http://127.0.0.1:8000/v1');
});
test('remote URLs and unknown protocols are rejected before fetch', async () => {
  const original = globalThis.fetch; let calls=0;
  globalThis.fetch = () => { calls++; throw new Error('must not fetch'); };
  try {
    await assert.rejects(request('https://example.com'), /loopback/);
    await assert.rejects(discoverModels({ kind:'cloud', baseUrl:'http://127.0.0.1:8000' }), /supported local/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch=original; }
});
test('Colibri discovery sends saved authentication and preserves exact IDs', async t => {
  const url=await server(t,(req,res) => {
    assert.equal(req.url,'/v1/models'); assert.equal(req.headers.authorization,'Bearer fixture-key');
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({data:[{id:'Qwen/custom-model.gguf'},{id:'Qwen/custom-model.gguf'},{id:''},{unexpected:1}]}));
  });
  const result=await discoverModels({kind:'colibri',baseUrl:url+'/v1/',apiKey:'fixture-key'});
  assert.equal(result.length,1); assert.equal(result[0].id,'Qwen/custom-model.gguf');
});
test('Ollama discovery retains model metadata', async t => {
  const url=await server(t,(req,res) => { assert.equal(req.url,'/api/tags'); res.end(JSON.stringify({models:[{name:'gemma:local',size:42,details:{family:'gemma',parameter_size:'27B'}}]})); });
  const list=await discoverModels({kind:'ollama',baseUrl:url}); assert.equal(list[0].parameterSize,'27B');
});
test('LM Studio discovery remains OpenAI-compatible', async t => {
  const url=await server(t,(_req,res) => res.end(JSON.stringify([{id:'loaded-instance'}])));
  assert.equal((await discoverModels({kind:'openai',baseUrl:url}))[0].id,'loaded-instance');
});
test('empty model list is distinct from an invalid payload', async t => {
  const url=await server(t,(req,res) => res.end(req.url.includes('/invalid/') ? '{}' : '{"data":[]}'));
  assert.deepEqual(await discoverModels({kind:'colibri',baseUrl:url}), []);
  await assert.rejects(discoverModels({kind:'colibri',baseUrl:url+'/invalid'}),/invalid model list/);
});
test('invalid discovery JSON is actionable', async t => {
  const url=await server(t,(_req,res) => res.end('<html>dashboard</html>'));
  await assert.rejects(discoverModels({kind:'colibri',baseUrl:url}),/valid JSON/);
});
test('discovery timeout covers a body that never finishes', async t => {
  const url=await server(t,(_req,res) => { res.writeHead(200); res.write('{'); });
  await assert.rejects(discoverModels({kind:'colibri',baseUrl:url,timeoutMs:40}),/did not answer in time/);
});
test('discovery redirect is never followed and never exposes a key', async t => {
  let reached=0;
  const sink=await server(t,(_req,res) => { reached++; res.end('{}'); });
  const url=await server(t,(_req,res) => { res.writeHead(302,{Location:sink}); res.end(); });
  await assert.rejects(discoverModels({kind:'colibri',baseUrl:url,apiKey:'fixture-key'}),/redirect/);
  assert.equal(reached,0);
});
for (const [status, pattern] of [[401,/access key/],[403,/access key/],[404,/404/],[400,/context/],[413,/rejected/],[422,/rejected/],[429,/busy/],[503,/loading/],[500,/500/]]) {
  test(`HTTP ${status} is reported without reflecting sensitive server text`,async t => {
    const url=await server(t,(_req,res) => {res.writeHead(status);res.end('private-prompt-and-key');});
    await assert.rejects(request(url),error => pattern.test(error.message) && !error.message.includes('private-prompt-and-key'));
  });
}
test('chat redirect is blocked before POST body can reach a second server', async t => {
  let reached=0;
  const sink=await server(t,(_req,res) => { reached++; sse(res); });
  const url=await server(t,(_req,res) => { res.writeHead(307,{Location:sink}); res.end(); });
  await assert.rejects(request(url,{apiKey:'fixture-key'}),/redirect/); assert.equal(reached,0);
});
test('stream carries exact model, context, generation fields and bearer key', async t => {
  let sent;
  const url=await server(t,async(req,res) => { assert.equal(req.url,'/v1/chat/completions'); assert.equal(req.headers.authorization,'Bearer fixture-key'); sent=await body(req); sse(res); });
  const pieces=[];
  const result=await request(url,{apiKey:'fixture-key',options:{num_ctx:8192,num_predict:64,temperature:0,top_p:0.8},onDelta:s=>pieces.push(s)});
  assert.deepEqual(sent,{model:'test-model',messages,stream:true,stream_options:{include_usage:true},max_tokens:64,temperature:0,top_p:0.8});
  assert.equal(result.text,'Hello'); assert.deepEqual(pieces,['Hello']); assert.deepEqual(result.usage,{prompt_tokens:7,completion_tokens:2});
});
test('UTF-8 code points and SSE frames survive byte-by-byte splitting',async t => {
  const text='Hello 👋 — مرحبا';
  const url=await server(t,async(_req,res) => {
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    for(const b of Buffer.from(event(delta(text))+event('[DONE]'))) {res.write(Buffer.from([b])); await delay(1);}
    res.end();
  });
  assert.equal((await request(url)).text,text);
});
test('CRLF, comments and multiline SSE data are supported',async t => {
  const text=': keepalive\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"answer"}}]}\r\n\r\n'+event('[DONE]');
  const url=await server(t,(_req,res)=>sse(res,text)); assert.equal((await request(url)).text,'answer');
});
test('final SSE event can omit a trailing blank line',async t => {
  const url=await server(t,(_req,res)=>sse(res,event(delta('done'))+'data: '+JSON.stringify(finish)));
  assert.equal((await request(url)).finishReason,'stop');
});
test('DONE ends reading even when server keeps its socket open',async t => {
  const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(valid);});
  assert.equal((await request(url,{idleTimeoutMs:100})).text,'Hello');
});
test('reasoning is not mixed into the visible answer',async t => {
  const url=await server(t,(_req,res)=>sse(res,event({choices:[{delta:{reasoning_content:'private reasoning'}}]})+valid));
  assert.equal((await request(url)).text,'Hello');
});
test('reasoning-only response explains reply-budget exhaustion',async t => {
  const url=await server(t,(_req,res)=>sse(res,event({choices:[{delta:{reasoning_content:'thinking'}}]})+event({choices:[{delta:{},finish_reason:'length'}]})+event('[DONE]')));
  await assert.rejects(request(url),/reasoning but no answer/);
});
test('empty completed response is not silently saved as success',async t => {
  const url=await server(t,(_req,res)=>sse(res,event('[DONE]'))); await assert.rejects(request(url),/no answer/);
});
test('malformed SSE is an error, not a silently missing chunk',async t => {
  const url=await server(t,(_req,res)=>sse(res,event(delta('partial'))+'data: {invalid}\n\n'));
  const pieces=[]; await assert.rejects(request(url,{onDelta:s=>pieces.push(s)}),/malformed/); assert.deepEqual(pieces,['partial']);
});
test('in-stream model errors preserve already emitted text',async t => {
  const url=await server(t,(_req,res)=>sse(res,event(delta('partial'))+event({error:{message:'private prompt'}})));
  await assert.rejects(request(url),error=>/generation error/.test(error.message)&&!error.message.includes('private prompt'));
});
test('premature EOF is not reported as a completed answer',async t => {
  const url=await server(t,(_req,res)=>sse(res,event(delta('partial')))); await assert.rejects(request(url),/disconnected before finishing/);
});
test('HTML or JSON on the streaming route is rejected',async t => {
  const url=await server(t,(_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{}');});
  await assert.rejects(request(url),/event stream/);
});
test('oversized SSE line is bounded',async t => {
  const url=await server(t,(_req,res)=>sse(res,'data: '+ 'x'.repeat(2*1024*1024+1)));
  await assert.rejects(request(url),/oversized/);
});
test('user cancellation after a delta returns the partial text',async t => {
  const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(event(delta('keep me')));});
  const controller=new AbortController();
  const result=await request(url,{signal:controller.signal,onDelta:()=>controller.abort()});
  assert.equal(result.text,'keep me'); assert.equal(result.stopped,true);
});
test('cancellation before headers does not hang',async t => {
  const url=await server(t,()=>{}); const controller=new AbortController();
  setTimeout(()=>controller.abort(),30);
  await assert.rejects(request(url,{signal:controller.signal}),/Stopped/);
});
test('already cancelled request never reaches the server',async t => {
  let reached=0; const url=await server(t,(_req,res)=>{reached++;sse(res);});
  const controller=new AbortController();controller.abort();
  await assert.rejects(request(url,{signal:controller.signal}),/Stopped/);assert.equal(reached,0);
});
test('idle timeout bounds a server which never responds',async t => {
  const url=await server(t,()=>{});await assert.rejects(request(url,{idleTimeoutMs:40}),/stopped responding/);
});
test('idle timeout also bounds a stalled response body',async t => {
  const url=await server(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(event(delta('partial')));});
  await assert.rejects(request(url,{idleTimeoutMs:40}),/partial reply is preserved/);
});
test('Ollama streaming still sends native options and captures usage',async t => {
  const url=await server(t,async(req,res)=>{
    assert.equal(req.url,'/api/chat'); const sent=await body(req);assert.equal(sent.options.num_ctx,4096);
    res.end(JSON.stringify({message:{content:'Ollama answer'}})+'\n'+JSON.stringify({done:true,prompt_eval_count:5,eval_count:3})+'\n');
  });
  const result=await request(url,{kind:'ollama',options:{num_ctx:4096}});assert.equal(result.text,'Ollama answer');assert.equal(result.usage.completion_tokens,3);
});
test('LM Studio streaming remains supported',async t => {
  const url=await server(t,(_req,res)=>sse(res));assert.equal((await request(url,{kind:'openai'})).text,'Hello');
});
test('thinking override is sent only to Colibri and never forces JSON responses',()=>{
  const colibri=buildBody({kind:'colibri',model:'m',messages,options:{enable_thinking:false}});
  const lm=buildBody({kind:'openai',model:'m',messages,options:{enable_thinking:false}});
  assert.equal(colibri.enable_thinking,false);assert.equal(lm.enable_thinking,undefined);assert.equal(colibri.response_format,undefined);
});
test('missing model/messages fail before a request is sent',async()=>{
  await assert.rejects(request('http://127.0.0.1:8000',{model:''}),/Choose a model/);
  await assert.rejects(request('http://127.0.0.1:8000',{messages:[]}),/at least one/);
});


test('caller deadline is reported as a timeout, not a successful stop', async t => {
  const baseUrl = await server(t, (_req, res) => { res.writeHead(200, {'Content-Type':'text/event-stream'}); res.flushHeaders(); });
  await assert.rejects(request(baseUrl, {signal: AbortSignal.timeout(25)}), /did not answer in time/);
});
test('already expired caller deadline is distinguishable from Stop', async () => {
  const controller = new AbortController(); controller.abort(new DOMException('deadline', 'TimeoutError'));
  await assert.rejects(request('http://127.0.0.1:8000', {signal: controller.signal}), /did not answer in time/);
});
