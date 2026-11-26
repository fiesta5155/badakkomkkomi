import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {before,beforeEach,after,it} from 'node:test';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,serverTimestamp,Timestamp} from 'firebase/firestore';
import {ref,uploadBytes,getBytes,deleteObject,listAll} from 'firebase/storage';
import {ensureRockIsland,saveRockPoint,getRockPoint,deleteRockPoint,saveRockNote,deleteRockNote,parseRockNote} from '../services/rockDockingService.ts';
import {ROCK_DOCKING_PHOTO_IDS} from '../config/rockDocking.ts';
import {planRockPhotos,applyRockPhotoPlan,RockPhotoSaveError} from '../services/rockDockingPhotoPlan.ts';
import {putStoredRockPhoto,createRockPhotoStore} from '../services/rockDockingPhotoStorage.ts';
let env;
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-bada-profile',firestore:{host:'127.0.0.1',port:8085,rules:readFileSync('firestore.rules','utf8')},storage:{host:'127.0.0.1',port:9199,rules:readFileSync('storage.rules','utf8')}});});
beforeEach(async()=>{await env.clearFirestore();await env.clearStorage();await env.withSecurityRulesDisabled(async c=>{for(const uid of ['owner','other','admin'])await setDoc(doc(c.firestore(),'users',uid),{uid,realName:'범진',createdAt:Timestamp.now(),updatedAt:Timestamp.now()});await setDoc(doc(c.firestore(),'calendarAdmins','admin'),{enabled:true});});});
after(async()=>env?.cleanup());
const context=(uid,provider='google.com')=>env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}),dbFor=uid=>context(uid).firestore(),owner={uid:'owner',realName:'범진'};
const input=()=>({islandId:'소매물도',name:'남측',lat:34.7,lng:128.5,stationCode:'DT_0014',datum:'unverified',ranges:{101:{min:50,max:150},103:null},confirmedOn:'2026-11-23',photos:[]});
async function create(memo){const db=dbFor('owner');await ensureRockIsland(db,owner,' 소 매물도 ');const id=await saveRockPoint(db,owner,input(),undefined,memo);return getRockPoint(db,id);}
it('shared island dedup, point ownership, admin delete-only and stale revisions',async()=>{const p=await create({text:'첫 메모',pinned:true}),db=dbFor('owner');assert.equal(await ensureRockIsland(dbFor('other'),{uid:'other',realName:'범진'},'소매물도'),'소매물도');assert.equal((await getDocs(collection(db,'rockDockingIslands'))).size,1);await assertSucceeds(getRockPoint(dbFor('other'),p.id));for(const uid of ['other','admin'])await assertFails(updateDoc(doc(dbFor(uid),'rockDockingPoints',p.id),{name:'타인 수정',revision:2,updatedAt:serverTimestamp()}));await saveRockPoint(db,owner,{...input(),name:'변경'},p);await assert.rejects(saveRockPoint(db,owner,input(),p));const current=await getRockPoint(db,p.id);await assertFails(deleteRockPoint(dbFor('other'),{uid:'other',realName:'범진'},current));await assertSucceeds(deleteRockPoint(dbFor('admin'),{uid:'admin',realName:'범진'},current));assert.equal((await getDocs(query(collection(db,'rockDockingPoints'),where('deleted','==',false)))).size,0);await assertFails(getDocs(collection(db,'rockDockingPoints',p.id,'notes')));});
it('server rejects untrusted auth, forged fields, ranges, photos and island overwrite',async()=>{const p=await create(),db=dbFor('owner');for(const ctx of [env.unauthenticatedContext(),context('missing'),context('owner','anonymous')])await assertFails(getDoc(doc(ctx.firestore(),'rockDockingPoints',p.id)));for(const patch of [{authorUid:'other'},{ranges:{101:{min:10,max:0},103:null}},{lat:91},{photos:[{path:'data:image/png;base64,bad'}]}])await assertFails(updateDoc(doc(db,'rockDockingPoints',p.id),{...patch,updatedAt:serverTimestamp(),revision:2}));await assertFails(updateDoc(doc(db,'rockDockingIslands','소매물도'),{name:'변경'}));});
it('staff accumulate notes, only own notes can be edited/pinned; admin can delete',async()=>{const p=await create(),db=dbFor('other'),profile={uid:'other',realName:'범진'};await saveRockNote(db,profile,p.id,'직원 메모',true);const d=(await getDocs(collection(db,'rockDockingPoints',p.id,'notes'))).docs[0],n=parseRockNote(d.id,d.data());for(const uid of ['owner','admin'])await assertFails(updateDoc(doc(dbFor(uid),'rockDockingPoints',p.id,'notes',n.id),{text:'타인 편집',pinned:false,revision:2,updatedAt:serverTimestamp()}));await saveRockNote(db,profile,p.id,'수정',false,n);await assert.rejects(saveRockNote(db,profile,p.id,'오래된 수정',false,n));const next=await getDoc(d.ref);await assertFails(deleteRockNote(dbFor('owner'),p.id,parseRockNote(next.id,next.data())));await assertSucceeds(deleteRockNote(dbFor('admin'),p.id,parseRockNote(next.id,next.data())));});
const payload=text=>({blob:new Blob([text],{type:'image/webp'}),width:800,height:400});
const slotPhoto=(p,index,role='wide')=>({id:ROCK_DOCKING_PHOTO_IDS[index],path:'rockDocking/'+p.id+'/owner/'+ROCK_DOCKING_PHOTO_IDS[index]+'.webp',role,size:4,width:800,height:400});
const uploadRaw=(storage,path,photoId,pointId,ownerUid='owner',bytes=new Uint8Array([82,73,70,70]),contentType='image/webp')=>uploadBytes(ref(storage,path),bytes,{contentType,customMetadata:{pointId,ownerUid,photoId}});
it('Storage permits only four fixed files and denies fifth, random and unexpected paths',async()=>{
 const p=await create(),storage=context('owner').storage(),photos=ROCK_DOCKING_PHOTO_IDS.map((_,i)=>slotPhoto(p,i,i===0?'wide':i===1?'close':'extra'));
 for(const photo of photos)await assertSucceeds(putStoredRockPhoto(storage,photo,payload('RIFF').blob));
 const extra='00000000-0000-4000-8000-000000000005',random='11111111-1111-4111-8111-111111111111';
 for(const name of [extra+'.webp',random+'.webp','photo-5.webp','arbitrary.webp','nested/'+photos[0].id+'.webp'])await assertFails(uploadRaw(storage,'rockDocking/'+p.id+'/owner/'+name,name.replace('.webp',''),p.id));
 await assertFails(uploadRaw(storage,'rockDocking/'+p.id+'/other/'+photos[0].id+'.webp',photos[0].id,p.id,'other'));
 await assertFails(uploadRaw(storage,'other/'+p.id+'/owner/'+photos[0].id+'.webp',photos[0].id,p.id));
 await assertFails(listAll(ref(storage,'rockDocking/'+p.id+'/owner')));
 await env.withSecurityRulesDisabled(async c=>assert.equal((await listAll(ref(c.storage(),'rockDocking/'+p.id+'/owner'))).items.length,4));
 await assertFails(getBytes(ref(context('other').storage(),photos[0].path)));
 await saveRockPoint(dbFor('owner'),owner,{...input(),photos},p);
 await assertSucceeds(getBytes(ref(context('other').storage(),photos[0].path)));
});
it('Storage validates Google profiles, path identity, MIME and 512000-byte limit',async()=>{
 const p=await create(),photo=slotPhoto(p,0),good=context('owner').storage();
 for(const ctx of [env.unauthenticatedContext(),context('missing'),context('owner','anonymous')])await assertFails(putStoredRockPhoto(ctx.storage(),photo,payload('RIFF').blob));
 await env.withSecurityRulesDisabled(async c=>{await setDoc(doc(c.firestore(),'users','mismatch'),{uid:'owner',realName:'범진'});await setDoc(doc(c.firestore(),'users','badname'),{uid:'badname',realName:'A'});});
 for(const uid of ['mismatch','badname'])await assertFails(putStoredRockPhoto(context(uid).storage(),{...photo,path:photo.path.replace('/owner/','/'+uid+'/')},payload('RIFF').blob));
 await assertFails(uploadRaw(good,photo.path,photo.id,p.id,'owner',new Uint8Array(512001)));
 await assertFails(uploadRaw(good,photo.path,photo.id,p.id,'owner',new Uint8Array(4),'image/png'));
 await assertFails(uploadRaw(good,photo.path,photo.id,p.id,'owner',new Uint8Array(0)));
 await assertFails(uploadBytes(ref(good,photo.path),new Uint8Array(4),{contentType:'image/webp',customMetadata:{pointId:p.id,ownerUid:'owner',photoId:photo.id,extra:'forbidden'}}));
 await assertFails(uploadRaw(good,photo.path,photo.id,'forged-point'));
 await assertFails(uploadRaw(good,photo.path,ROCK_DOCKING_PHOTO_IDS[1],p.id));
 await assertFails(uploadRaw(good,photo.path,photo.id,p.id,'other'));
 await assertFails(putStoredRockPhoto(good,{...photo,path:photo.path.replace(p.id,'missing-point')},payload('RIFF').blob));
 await assertSucceeds(uploadRaw(good,photo.path,photo.id,p.id,'owner',new Uint8Array(512000)));
 await saveRockPoint(dbFor('owner'),owner,{...input(),photos:[{...photo,size:512000}]},p);
 for(const ctx of [context('mismatch'),context('badname'),context('missing'),context('owner','anonymous')])await assertFails(getBytes(ref(ctx.storage(),photo.path)));
 await assertFails(getBytes(ref(env.unauthenticatedContext().storage(),photo.path)));
});
it('only the point author replaces files; other staff cannot mutate and existing admin cleans up',async()=>{
 const p=await create(),photo=slotPhoto(p,0),storage=context('owner').storage();
 await putStoredRockPhoto(storage,photo,payload('RIFF').blob);
 for(const uid of ['other','admin'])await assertFails(putStoredRockPhoto(context(uid).storage(),photo,payload('changed').blob));
 await assertFails(deleteObject(ref(context('other').storage(),photo.path)));
 await assertSucceeds(putStoredRockPhoto(storage,photo,payload('replacement').blob));
 assert.equal(new TextDecoder().decode(await getBytes(ref(storage,photo.path))),'replacement');
 await assertSucceeds(deleteObject(ref(storage,photo.path)));
 await putStoredRockPhoto(storage,photo,payload('new').blob);
 await deleteRockPoint(dbFor('owner'),owner,p);
 await assertFails(getBytes(ref(storage,photo.path)));
 await assertFails(putStoredRockPhoto(storage,photo,payload('after delete').blob));
 await assertSucceeds(deleteObject(ref(context('admin').storage(),photo.path)));
});
it('real emulator Storage and Firestore preserve replacement/deletion metadata and roll back failed commits',async()=>{
 const initial=await create(),db=dbFor('owner'),storage=context('owner').storage();let current=initial;
 const store=()=>createRockPhotoStore(storage,async()=>{const latest=await getRockPoint(db,initial.id,true);return latest.revision===current.revision&&!latest.deleted;});
 const commit=async photos=>saveRockPoint(db,owner,{...input(),photos},current);
 let plan=planRockPhotos(initial.id,'owner',[{role:'wide',data:payload('old-wide')},{role:'close',data:payload('old-close')}],current.photos);
 await applyRockPhotoPlan(plan,store(),commit);current=await getRockPoint(db,initial.id,true);assert.equal(current.photos.length,2);const removed=current.photos[1];
 plan=planRockPhotos(initial.id,'owner',[{role:'wide',photo:current.photos[0],data:payload('new-wide')}],current.photos);
 await applyRockPhotoPlan(plan,store(),commit);current=await getRockPoint(db,initial.id,true);
 assert.equal(new TextDecoder().decode(await getBytes(ref(storage,current.photos[0].path))),'new-wide');
 await assert.rejects(getBytes(ref(storage,removed.path)),e=>e.code==='storage/object-not-found');
 const priorRevision=current.revision;plan=planRockPhotos(initial.id,'owner',[{role:'wide',photo:current.photos[0],data:payload('same-len')}],current.photos);assert.deepEqual(plan.photos,current.photos);await applyRockPhotoPlan(plan,store(),commit);current=await getRockPoint(db,initial.id,true);assert.equal(current.revision,priorRevision+1);
 const before=current;plan=planRockPhotos(initial.id,'owner',[{role:'wide',photo:current.photos[0],data:payload('rollback')}],current.photos);
 await assert.rejects(applyRockPhotoPlan(plan,store(),async()=>{throw Error('simulated metadata rejection');}),RockPhotoSaveError);
 assert.deepEqual((await getRockPoint(db,initial.id,true)).photos,before.photos);assert.equal(new TextDecoder().decode(await getBytes(ref(storage,before.photos[0].path))),'same-len');
 plan=planRockPhotos(initial.id,'owner',[],current.photos);await applyRockPhotoPlan(plan,store(),commit);current=await getRockPoint(db,initial.id,true);assert.equal(current.photos.length,0);
 await env.withSecurityRulesDisabled(async c=>assert.equal((await listAll(ref(c.storage(),'rockDocking/'+initial.id+'/owner'))).items.length,0));
});

it('four photo references fit rule limits; duplicates, a fifth photo and non-owner paths are denied',async()=>{const p=await create(),db=dbFor('owner');const photos=Array.from({length:4},(_,i)=>{const id='11111111-1111-4111-8111-11111111111'+i;return{id,path:'rockDocking/'+p.id+'/owner/'+id+'.webp',role:i===0?'wide':i===1?'close':'extra',size:200000,width:1600,height:900};});let previous=p;for(let count=1;count<=4;count++){console.log('photo validation count',count);await saveRockPoint(db,owner,{...input(),photos:photos.slice(0,count)},previous);previous=await getRockPoint(db,p.id);}const current=previous;assert.equal(current.photos.length,4);for(const bad of [[...photos,photos[0]],[photos[0],photos[0]],[{...photos[0],path:photos[0].path.replace('/owner/','/other/')}]] )await assertFails(updateDoc(doc(db,'rockDockingPoints',p.id),{photos:bad,updatedAt:serverTimestamp(),revision:current.revision+1}));});

it('pre-rock production rules deny authenticated list queries; merged rules preserve calendar and enable them',async()=>{
  const local=readFileSync('firestore.rules','utf8');
  const start=local.indexOf('    // Shared rock docking data:');
  const end=local.indexOf('    // 명시적으로 허용하지 않은 경로는 기본 거부한다.',start);
  assert.ok(start>0&&end>start);
  const previous=local.slice(0,start)+local.slice(end);
  const old=await initializeTestEnvironment({projectId:'demo-bada-profile',firestore:{host:'127.0.0.1',port:8085,rules:previous}});
  const db=dbFor('owner');
  const lists=[()=>getDocs(collection(db,'rockDockingIslands')),()=>getDocs(query(collection(db,'rockDockingPoints'),where('deleted','==',false)))];
  const status=doc(db,'calendarVessels','101','entries','status_2026-11-23');
  let restored;
  try {
    for(const list of lists){const error=await assertFails(list());assert.equal(error.code,'permission-denied');}
    await assertSucceeds(setDoc(status,{schemaVersion:1,date:'2026-11-23',kind:'planned',content:'달력 보존 확인',authorUid:'owner',authorName:'범진',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),revision:1}));
    restored=await initializeTestEnvironment({projectId:'demo-bada-profile',firestore:{host:'127.0.0.1',port:8085,rules:local}});
    for(const list of lists)assert.equal((await assertSucceeds(list())).size,0);
    assert.equal((await assertSucceeds(getDoc(status))).data().content,'달력 보존 확인');
    const point=await create();assert.equal((await lists[1]()).size,1);await assertSucceeds(getDocs(collection(db,'rockDockingPoints',point.id,'notes')));
    for(const uid of ['missing'])await assertFails(getDocs(query(collection(dbFor(uid),'rockDockingPoints'),where('deleted','==',false))));
  } finally {
    if(!restored)restored=await initializeTestEnvironment({projectId:'demo-bada-profile',firestore:{host:'127.0.0.1',port:8085,rules:local}});
    await old.cleanup();await restored.cleanup();
  }
});

it('all three rock paths reject anonymous, non-Google and missing-profile reads and writes',async()=>{
  const p=await create({text:'권한 확인 메모',pinned:false});
  for(const ctx of [env.unauthenticatedContext(),context('owner','anonymous'),context('missing')]){
    const db=ctx.firestore();
    for(const work of [()=>getDocs(collection(db,'rockDockingIslands')),()=>getDocs(query(collection(db,'rockDockingPoints'),where('deleted','==',false))),()=>getDocs(collection(db,'rockDockingPoints',p.id,'notes')),()=>ensureRockIsland(db,owner,'권한검증섬'),()=>saveRockPoint(db,owner,input()),()=>saveRockNote(db,owner,p.id,'권한 없는 메모',true)]){
      const error=await assertFails(work());assert.equal(error.code,'permission-denied');
    }
  }
});

it('legacy UUID files remain readable and migrate without changing deployed Firestore rules',async()=>{
 const p=await create(),id='11111111-1111-4111-8111-111111111111',legacy={...slotPhoto(p,0),id,path:'rockDocking/'+p.id+'/owner/'+id+'.webp'},db=dbFor('owner'),storage=context('owner').storage();
 await env.withSecurityRulesDisabled(async c=>uploadRaw(c.storage(),legacy.path,id,p.id));
 await saveRockPoint(db,owner,{...input(),photos:[legacy]},p);const current=await getRockPoint(db,p.id,true);
 await assertSucceeds(getBytes(ref(context('other').storage(),legacy.path)));await assertFails(uploadRaw(storage,legacy.path,id,p.id));
 const plan=planRockPhotos(p.id,'owner',[{role:'wide',photo:legacy,data:payload('migrated')}],current.photos),store=createRockPhotoStore(storage,async()=>{const d=await getRockPoint(db,p.id,true);return d.revision===current.revision;});
 await applyRockPhotoPlan(plan,store,async photos=>saveRockPoint(db,owner,{...input(),photos},current));
 assert.equal((await getRockPoint(db,p.id,true)).photos[0].id,ROCK_DOCKING_PHOTO_IDS[0]);await assert.rejects(getBytes(ref(storage,legacy.path)),e=>e.code==='storage/object-not-found');
 await env.withSecurityRulesDisabled(async c=>assert.equal((await listAll(ref(c.storage(),'rockDocking/'+p.id+'/owner'))).items.length,1));
});

it('missing new slot reads as absent while denied backup and upload retain SDK code and path',async()=>{
 const p=await create(),photo=slotPhoto(p,0),store=createRockPhotoStore(context('owner').storage(),async()=>true);
 assert.equal(await store.read(photo),null);
 await store.write(photo,payload('RIFF'));
 assert.equal(await (await store.read(photo)).text(),'RIFF');
 const other=createRockPhotoStore(context('other').storage(),async()=>true);
 await assert.rejects(other.read(photo),e=>e.stage==='사진 백업'&&e.path===photo.path&&e.cause.code==='storage/unauthorized');
 await assert.rejects(other.write(photo,payload('RIFF')),e=>e.stage==='사진 업로드'&&e.path===photo.path&&e.cause.code==='storage/unauthorized');
});
