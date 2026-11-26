import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFileSync } from 'node:fs';
import { ROCK_DOCKING_PHOTO_IDS } from '../config/rockDocking.ts';
import { applyRockPhotoPlan, planRockPhotos, sameRockPhotos, RockPhotoCommitUncertain, RockPhotoSaveError, validateRockPhotoData, rockSaveStep, rockSaveDiagnostic, type RockPhotoData, type RockPhotoStore } from '../services/rockDockingPhotoPlan.ts';
import type { RockPhoto } from '../services/rockDockingModel.ts';
const data=(text='new'): RockPhotoData=>({blob:new Blob([text],{type:'image/webp'}),width:800,height:400});
const photo=(id: string=ROCK_DOCKING_PHOTO_IDS[0],role: RockPhoto['role']='wide'):RockPhoto=>({id,path:'rockDocking/p/owner/'+id+'.webp',role,size:3,width:800,height:400});
function memory(initial: [RockPhoto,Blob][]=[]){
 const files=new Map(initial.map(([p,b])=>[p.path,b]));let unchanged=true;const store:RockPhotoStore={read:async p=>files.get(p.path)??null,write:async(p,d)=>{files.set(p.path,d.blob);},restore:async(p,b)=>{files.set(p.path,b);},remove:async p=>{files.delete(p.path);},unchanged:async()=>unchanged};
 return{files,store,setUnchanged:(v:boolean)=>{unchanged=v;}};
}
it('four logical slots retain UUID-compatible metadata',()=>{
 const plan=planRockPhotos('p','owner',[{role:'wide',data:data()},{role:'close',data:data()},{role:'extra',data:data()},{role:'extra',data:data()}],[]);
 assert.deepEqual(plan.photos.map(p=>p.id),[...ROCK_DOCKING_PHOTO_IDS]);assert.equal(new Set(plan.photos.map(p=>p.path)).size,4);
 const rules=readFileSync('storage.rules','utf8');for(const id of ROCK_DOCKING_PHOTO_IDS)assert.ok(rules.includes(id+'.webp'));
 assert.throws(()=>planRockPhotos('p','owner',Array.from({length:5},()=>({role:'extra',data:data()})),[]));
});
it('reordering preserves file identity and replacement reuses the original fixed slot',()=>{
 const a=photo(),b=photo(ROCK_DOCKING_PHOTO_IDS[1],'close');assert.equal(sameRockPhotos([{height:a.height,width:a.width,size:a.size,role:a.role,path:a.path,id:a.id}],[a]),true);assert.equal(sameRockPhotos([a,b],[b,a]),false);assert.equal(sameRockPhotos([{...a,size:99}],[a]),false);const order=planRockPhotos('p','owner',[{role:b.role,photo:b},{role:a.role,photo:a}],[a,b]);assert.equal(order.writes.length,0);assert.equal(order.removals.length,0);assert.deepEqual(order.photos.map(p=>p.id),[b.id,a.id]);
 const next=planRockPhotos('p','owner',[{role:a.role,photo:a,data:data('replacement')}],[a,b]);assert.equal(next.photos[0].path,a.path);assert.deepEqual(next.removals,[b]);
});
it('removed slots may be reused without ever creating a fifth path',()=>{
 const a=photo(),b=photo(ROCK_DOCKING_PHOTO_IDS[1],'close');const plan=planRockPhotos('p','owner',[{role:'wide',data:data()},{role:'close',photo:b}],[a,b]);assert.equal(plan.photos[0].id,a.id);assert.equal(plan.removals.length,0);assert.throws(()=>planRockPhotos('p','owner',[{role:'wide',photo:a},{role:'extra',photo:a}],[a]));assert.throws(()=>planRockPhotos('different','owner',[{role:a.role,photo:a}],[a]));
});
it('validates dimensions, declared WebP type, empty and oversized payloads before I/O',()=>{
 for(const d of [{...data(),width:1601},{...data(),height:0},{...data(),width:1.5},{...data(),blob:new Blob(['png'],{type:'image/png'})},{...data(),blob:new Blob([],{type:'image/webp'})},{...data(),blob:new Blob([new Uint8Array(512001)],{type:'image/webp'})}])assert.throws(()=>validateRockPhotoData(d));
});
it('uploads and deletions precede one metadata commit',async()=>{
 const a=photo(),b=photo(ROCK_DOCKING_PHOTO_IDS[1],'close'),m=memory([[a,data('old').blob],[b,data('old').blob]]);const plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data('replacement')}],[a,b]);let committed=false;
 await applyRockPhotoPlan(plan,m.store,async photos=>{assert.equal(await m.files.get(a.path)!.text(),'replacement');assert.equal(m.files.has(b.path),false);assert.deepEqual(photos,plan.photos);committed=true;});assert.equal(committed,true);
});
it('a failed metadata commit restores replaced and deleted blobs',async()=>{
 const a=photo(),b=photo(ROCK_DOCKING_PHOTO_IDS[1],'close'),m=memory([[a,data('old-wide').blob],[b,data('old-close').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data()}],[a,b]);
 await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{throw Error('commit denied');}),e=>e instanceof RockPhotoSaveError&&!e.needsReload);assert.equal(await m.files.get(a.path)!.text(),'old-wide');assert.equal(await m.files.get(b.path)!.text(),'old-close');
});
it('ambiguous upload failures compensate even when the server already wrote bytes',async()=>{
 const m=memory(),plan=planRockPhotos('p','owner',[{role:'wide',data:data()}],[]);const write=m.store.write;m.store.write=async(p,d)=>{await write(p,d);throw Error('lost response');};let committed=false;
 await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{committed=true;}),RockPhotoSaveError);assert.equal(m.files.size,0);assert.equal(committed,false);
});
it('snapshot failure stops before mutations and revision conflict does not overwrite newer data',async()=>{
 const a=photo(),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data()}],[a]);m.store.read=async()=>{throw Error('read denied');};await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{}));assert.equal(await m.files.get(a.path)!.text(),'old');
 const n=memory([[a,data('old').blob]]);n.setUnchanged(false);await assert.rejects(applyRockPhotoPlan(plan,n.store,async()=>{}),e=>e instanceof RockPhotoSaveError&&e.needsReload);assert.equal(await n.files.get(a.path)!.text(),'old');
});
it('uncertain commits never roll files back under potentially committed metadata',async()=>{
 const a=photo(),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data('new')}],[a]);await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{throw new RockPhotoCommitUncertain();}),RockPhotoCommitUncertain);assert.equal(await m.files.get(a.path)!.text(),'new');
});
it('rollback failure requires reopening and is never reported as a saved result',async()=>{
 const a=photo(),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data('new')}],[a]);m.store.restore=async()=>{throw Error('offline');};await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{throw Error('commit denied');}),e=>e instanceof RockPhotoSaveError&&e.needsReload&&e.message.includes('복구하지 못'));
});
it('legacy random files are removed after metadata commits and cleanup failure is explicit',async()=>{
 const a=photo('11111111-1111-4111-8111-111111111111'),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data()}],[a]);let committed=false;const remove=m.store.remove;m.store.remove=async p=>{assert.equal(committed,true);if(p.path===a.path)throw Error('cleanup denied');await remove(p);};const result=await applyRockPhotoPlan(plan,m.store,async()=>{assert.equal(m.files.has(a.path),true);committed=true;});assert.deepEqual(result.cleanupFailed,[a]);assert.equal(m.files.size,2);
});

it('a newer revision after mutation prevents rollback over concurrent work',async()=>{
 const a=photo(),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data('new')}],[a]);
 await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>{m.files.set(a.path,data('newer concurrent content').blob);m.setUnchanged(false);throw Error('stale revision');}),RockPhotoCommitUncertain);assert.equal(await m.files.get(a.path)!.text(),'newer concurrent content');
});

it('preserves original Firebase code and failing path through compensation without exposing response secrets',async()=>{
 const m=memory(),plan=planRockPhotos('p','owner',[{role:'wide',data:data()}],[]);
 const original=Object.assign(Error('https://example.test/?token=SECRET'),{code:'storage/unauthorized',serverResponse:'SECRET'});
 m.store.write=async p=>rockSaveStep('사진 업로드',p.path,async()=>{throw original;});
 await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>assert.fail('must not commit')),
 e=>{const d=rockSaveDiagnostic(e);assert.equal(d.code,'storage/unauthorized');assert.equal(d.path,plan.photos[0].path);assert.equal(d.stage,'사진 업로드');assert.ok(!JSON.stringify(d).includes('SECRET'));return e instanceof RockPhotoSaveError&&!e.needsReload;});
 assert.equal(m.files.size,0);
});
it('snapshot denial retains its stage and prevents uploads or metadata changes',async()=>{
 const m=memory(),plan=planRockPhotos('p','owner',[{role:'wide',data:data()}],[]);
 m.store.read=async p=>rockSaveStep('사진 백업',p.path,async()=>{throw Object.assign(Error('denied'),{code:'storage/unauthorized'});});
 m.store.write=async()=>assert.fail('must not upload');
 await assert.rejects(applyRockPhotoPlan(plan,m.store,async()=>assert.fail('must not commit')),e=>rockSaveDiagnostic(e).stage==='사진 백업'&&rockSaveDiagnostic(e).code==='storage/unauthorized');
});
it('metadata denial is distinguishable from upload failure and restores original bytes',async()=>{
 const a=photo(),m=memory([[a,data('old').blob]]),plan=planRockPhotos('p','owner',[{role:'wide',photo:a,data:data()}],[a]);
 await assert.rejects(applyRockPhotoPlan(plan,m.store,()=>rockSaveStep('사진 메타데이터 저장','rockDockingPoints/p',async()=>{throw Object.assign(Error('denied'),{code:'permission-denied'});})),e=>rockSaveDiagnostic(e).stage==='사진 메타데이터 저장'&&rockSaveDiagnostic(e).code==='permission-denied');
 assert.equal(await m.files.get(a.path).text(),'old');
});
