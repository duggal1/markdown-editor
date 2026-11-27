import assert from 'node:assert/strict';
import { plannerId, plannerRows, appendPlannerItems, editPlannerRow, selectPlannerContext } from '../src/lib/planner.ts';
import { setTaskChecked } from '../src/lib/taskList.ts';
import { generatePlanner, reasoningEffort, validateItems, MODEL } from '../server/planner.js';
assert.notEqual(plannerId('todo','ws'),plannerId('memory','ws'));
assert.notEqual(plannerId('todo','ws'),plannerId('todo','ws','folder'));
const one = appendPlannerItems('', 'todo', [{category:'Release',text:'Ship v1'},{category:'Release',text:'Test CI'}]);
const two = appendPlannerItems(one, 'todo', [{category:'release',text:'Ship v1'},{category:'Release',text:'Write docs'}]);
assert.equal(plannerRows(two,'todo').length,3);
assert.equal(two.match(/## Release/g).length,1);
const row=plannerRows(two,'todo')[0];
const checked=setTaskChecked(two,row.line,true);
assert.equal(plannerRows(checked,'todo')[0].done,true);
assert.equal(editPlannerRow(checked,'todo',row,'Wrong'),checked);
assert.equal(plannerRows(editPlannerRow(checked,'todo',plannerRows(checked,'todo')[0],null),'todo').length,2);
const memory=appendPlannerItems('', 'memory',[{category:'Preferences',text:'Use native UI'}]);
assert.equal(plannerRows(memory,'memory')[0].text,'Use native UI');
const contexts = appendPlannerItems('', 'memory', [{category:'Projects',text:'Jupiter uses Swift'}, {category:'Other',text:'A long unrelated entry'}]);
assert.match(selectPlannerContext(contexts,'memory','Jupiter Swift',32),/Jupiter uses Swift/);
assert.equal(plannerRows('~~~md\n- [ ] not a task\n~~~','todo').length,0);
assert.equal(reasoningEffort('Buy milk'),'low');
assert.equal(reasoningEffort('Break down the dependencies and milestones'),'medium');
assert.throws(()=>validateItems('{"items":[{"text":"a\\nb","category":"x"}]}'));
const result=await generatePlanner({input:'Buy milk',kind:'todo',apiKey:'test',fetcher:async (url, options)=>{
  assert.equal(url,'https://api.reflection.ai/openai/v1/chat/completions');
  const body=JSON.parse(options.body);
  assert.equal(body.model,MODEL); assert.equal(body.reasoning_effort,'low');
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"items":[{"text":"Buy milk","category":"Inbox"}]}'}}]}));
}});
assert.equal(result.items[0].text,'Buy milk');
await assert.rejects(()=>generatePlanner({input:'a',kind:'memory',apiKey:'test',fetcher:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{}'}}]}))}));
console.log('Planner tests passed');

// Fragmented provider SSE and client NDJSON, including multibyte text, errors and truncation.
const { consumePlannerStream, streamedItems } = await import('../src/lib/plannerStream.ts');
const bytes = new TextEncoder();
function chunked(value) {
  const data = bytes.encode(value);
  return new Response(new ReadableStream({ start(controller) {
    for (let i=0;i<data.length;i+=7) controller.enqueue(data.slice(i,i+7));
    controller.close();
  }}));
}
const packet = (delta, finish_reason = null) => 'data: ' + JSON.stringify({choices:[{delta,finish_reason}]}) + '\r\n\r\n';
const events=[];
const streamResult=await generatePlanner({input:'Buy tea',kind:'todo',apiKey:'test',onDelta:event=>events.push(event),fetcher:async (_, opts)=>{
  assert.equal(JSON.parse(opts.body).stream,true);
  return chunked(packet({reasoning_content:'Think café'})+packet({content:'{"items":[{"text":"Buy '})+packet({content:'tea","category":"Inbox"}]}'})+packet({},'stop')+'data: [DONE]\r\n\r\n');
}});
assert.equal(streamResult.items[0].text,'Buy tea');
assert.deepEqual(events.map(e=>e.type),['reasoning','content','content']);
assert.equal(events[0].text,'Think café');
const clientEvents=[];
await consumePlannerStream(chunked([...events,{type:'done',...streamResult}].map(e=>JSON.stringify(e)+'\n').join('')),e=>clientEvents.push(e));
assert.equal(clientEvents.at(-1).type,'done');
assert.deepEqual(streamedItems('{"items":[{"text":"Buy te'),['Buy te']);
assert.deepEqual(streamedItems('{"items":[{"text":"Buy tea","category":"Inbox"},{"text":"Write docs'),['Buy tea','Write docs']);
await assert.rejects(()=>consumePlannerStream(chunked(JSON.stringify(events[0])+'\n'),()=>{}),/interrupted/);
await assert.rejects(()=>generatePlanner({input:'a',kind:'todo',apiKey:'test',onDelta:()=>{},fetcher:async()=>chunked(packet({content:'{}'},'stop'))}),/Incomplete/);
console.log('Streaming tests passed');

assert.deepEqual(streamedItems('{"items":[{"text":"One"},{"text":"Two"}]}'),['One','Two']);
