import assert from 'node:assert/strict';
import {stableStringify,checksum,changesBetween,applyCloudRecord,mergeWithoutOverwrite} from '../js/sync-model.js';

const state=()=>({tasks:[],subjects:[],sessions:[],notes:[],schedule:[],thoughts:[],
  priorities:{},reviews:{},profile:{name:''},settings:{},layout:{},audio:{},
  rewards:{},weather:{},timer:{},scratch:'',trash:[]});
const a=state(),b=state();
b.notes.push({id:'n1',title:'A',body:'B'});
const ops=changesBetween(a,b,()=> 'op-1');
assert.equal(ops.filter(op=>op.kind==='note').length,1);
assert.equal(ops.find(op=>op.kind==='note').patch.body,'B');
const c=structuredClone(b);c.notes[0].body='new';
assert.deepEqual(changesBetween(b,c,()=> 'op-2').find(op=>op.kind==='note').patch,{body:'new'});
const d=structuredClone(b);d.notes=[];
assert.equal(changesBetween(b,d,()=> 'op-3').find(op=>op.kind==='note').deleted,true);
const deleted=applyCloudRecord(b,{kind:'note',entity_id:'n1',deleted_at:new Date().toISOString()});
assert.equal(deleted.notes.length,0);assert.equal(deleted.trash.length,1);
const divergent=structuredClone(b);divergent.notes[0].body='other';
const merged=mergeWithoutOverwrite(b,divergent,()=> 'n2');
assert.equal(merged.data.notes.length,2);assert.equal(merged.data.notes[0].body,'B');
assert.equal(merged.data.notes[1].body,'other');
assert.equal(stableStringify({b:1,a:2}),stableStringify({a:2,b:1}));
assert.equal(await checksum({b:1,a:2}),await checksum({a:2,b:1}));
console.log('Sync model, soft delete, conflict-safe merge and checksum checks passed.');
