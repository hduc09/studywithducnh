import assert from 'node:assert/strict';
import {
  STORAGE_KEY,PREVIOUS_STORAGE_KEY,RETENTION_MS,
  prepareMigration,cleanupMigration,confirmLegacyRemoval,
  hasLegacyContent,legacyArchive,normalizeLegacyFields,acceptsBackupApp
} from '../js/migration.js';

class MemoryStorage{
  constructor(entries={}){this.values=new Map(Object.entries(entries));this.failKey=''}
  getItem(key){return this.values.get(key)??null}
  setItem(key,value){if(key===this.failKey)throw new Error('QuotaExceededError');this.values.set(key,String(value))}
  removeItem(key){this.values.delete(key)}
}
const now=Date.UTC(2026,10,17);
const retiredDecks=['flash','cards'].join('');
const retiredTrackers=['ha','bits'].join('');
const old={version:3,profile:{name:'Mai',onboarded:true},tasks:[{id:'task-1',title:'Học Toán'}],[retiredDecks]:[{id:'deck-1',cards:[{front:'A',back:'B'}]}],[retiredTrackers]:[{id:'tracker-1',checks:{'2026-11-17':true}}]};
const raw=JSON.stringify(old);
const storage=new MemoryStorage({[PREVIOUS_STORAGE_KEY]:raw});
const migrated=prepareMigration(storage,now);
assert.equal(migrated.copied,true);
assert.deepEqual(migrated.data,old);
assert.equal(storage.getItem(STORAGE_KEY),raw);
assert.equal(storage.getItem(PREVIOUS_STORAGE_KEY),raw);
assert.equal(hasLegacyContent(migrated.data),true);
assert.equal(cleanupMigration(storage,now+RETENTION_MS+1),false);
const clean=confirmLegacyRemoval(migrated.data,storage,now+1000);
assert.equal(clean.version,4);
assert.equal(clean[retiredDecks],undefined);
assert.equal(clean[retiredTrackers],undefined);
assert.deepEqual(clean.tasks,old.tasks);
assert.deepEqual(legacyArchive(clean,storage).data[retiredDecks],old[retiredDecks]);
assert.equal(cleanupMigration(storage,now+RETENTION_MS-1),false);
assert.equal(cleanupMigration(storage,now+RETENTION_MS+1001),true);
assert.equal(storage.getItem(PREVIOUS_STORAGE_KEY),null);
assert.equal(storage.getItem(STORAGE_KEY),JSON.stringify(clean));
assert.deepEqual(normalizeLegacyFields({[retiredDecks]:[],[retiredTrackers]:[],tasks:[]}),{tasks:[]});
assert.equal(acceptsBackupApp(['Study','Nest'].join('')),true);
assert.equal(acceptsBackupApp('studywithducnh'),true);
assert.equal(acceptsBackupApp('other'),false);

const full=new MemoryStorage({[PREVIOUS_STORAGE_KEY]:raw});
full.failKey=STORAGE_KEY;
const failed=prepareMigration(full,now);
assert.equal(failed.copyError,true);
assert.deepEqual(failed.data,old);
assert.equal(full.getItem(PREVIOUS_STORAGE_KEY),raw);
const imported=new MemoryStorage();
imported.failKey='studywithducnh-legacy-archive-v1';
assert.throws(()=>confirmLegacyRemoval(old,imported,now),/Không đủ bộ nhớ/);
assert.equal(imported.getItem(STORAGE_KEY),null);
const changed=new MemoryStorage({[PREVIOUS_STORAGE_KEY]:raw});
prepareMigration(changed,now);
confirmLegacyRemoval(old,changed,now+1);
changed.setItem(PREVIOUS_STORAGE_KEY,JSON.stringify({...old,tasks:[...old.tasks,{id:'new'}]}));
assert.equal(cleanupMigration(changed,now+RETENTION_MS+2),false);
assert.notEqual(changed.getItem(PREVIOUS_STORAGE_KEY),null);

globalThis.localStorage=new MemoryStorage({[PREVIOUS_STORAGE_KEY]:raw});
const {store}=await import('../js/store.js');
assert.equal(store.get().profile.name,'Mai');
assert.equal(store.hasLegacy(),true);
assert.equal(store.confirmLegacy(),true);
assert.equal(store.hasLegacy(),false);
assert.deepEqual(store.legacyArchive().data[retiredTrackers],old[retiredTrackers]);
const before=JSON.stringify(store.get());
localStorage.failKey=STORAGE_KEY;
assert.equal(store.update(s=>s.profile.name='Changed','profile'),false);
assert.equal(JSON.stringify(store.get()),before);
console.log('Stage 7 migration, retention, archive, quota and store checks passed.');

