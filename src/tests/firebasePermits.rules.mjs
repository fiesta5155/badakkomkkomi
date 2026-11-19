import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, beforeEach, after, it } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { savePermit, parsePermit, deletePermit, addInvestigations, updateInvestigation, deleteInvestigation, parseInvestigation } from '../services/activityPermitService.ts';
import { dmsDecimal, permitExpiryDate } from '../services/activityPermitModel.ts';
let env;
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8085');env=await initializeTestEnvironment({projectId:'demo-bada-profile',firestore:{host:'127.0.0.1',port:8085,rules:readFileSync('firestore.rules','utf8')}})});
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{for(const uid of ['owner','other','admin'])await setDoc(doc(ctx.firestore(),'users',uid),{uid,realName:'범진',createdAt:Timestamp.now(),updatedAt:Timestamp.now()});await setDoc(doc(ctx.firestore(),'calendarAdmins','admin'),{enabled:true})})});
after(async()=>env?.cleanup());
const dbFor=(uid,provider='google.com')=>env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}).firestore();
const vertex=(lat,lng)=>{const latDms={degrees:34,minutes:lat,seconds:0,hemisphere:'N'},lngDms={degrees:128,minutes:lng,seconds:0,hemisphere:'E'};return{latDms,lngDms,lat:dmsDecimal(latDms,'lat'),lng:dmsDecimal(lngDms,'lng')}};
const input=()=>({permitNumber:'통영양식 제1531호',target:'미역',sourceCrs:'EPSG:4326',vertices:[vertex(48,24),vertex(48,25),vertex(49,25),vertex(49,24)],startDate:'2026-11-01',endDate:'2026-11-30',notes:''});
const owner={uid:'owner',realName:'범진'};
async function read(db,id){const d=await getDoc(doc(db,'activityPermits',id));return parsePermit(d.id,d.data())}
async function surveys(db){return(await getDocs(collection(db,'permitInvestigations'))).docs.map(d=>parseInvestigation(d.id,d.data()))}

it('staff share permits, author edits and admin deletes without editing others',async()=>{
 const db=dbFor('owner'),other=dbFor('other'),admin=dbFor('admin');const id=await savePermit(db,owner,input());let current=await read(db,id);
 await assertSucceeds(getDoc(doc(other,'activityPermits',id)));
 for(const otherDb of [other,admin])await assertFails(updateDoc(doc(otherDb,'activityPermits',id),{target:'굴',revision:2,updatedAt:serverTimestamp()}));
 await savePermit(db,owner,{...input(),endDate:'2026-12-31'},current);current=await read(db,id);
 assert.equal(current.expiresAt.seconds*1000,permitExpiryDate('2026-12-31').getTime());
 await assertFails(deleteDoc(doc(other,'activityPermits',id)));await assertSucceeds(deletePermit(admin,current));
});
it('rejects anonymous/non-Google/missing profile users, forged ownership and TTL removal',async()=>{
 const db=dbFor('owner'),id=await savePermit(db,owner,input());
 for(const bad of [env.unauthenticatedContext().firestore(),dbFor('missing'),dbFor('owner','anonymous')]){
  await assertFails(getDoc(doc(bad,'activityPermits',id)));await assertFails(getDocs(collection(bad,'activityPermits')));
 }
 await assertFails(updateDoc(doc(db,'activityPermits',id),{authorUid:'admin',updatedAt:serverTimestamp(),revision:2}));
 await assertFails(updateDoc(doc(db,'activityPermits',id),{expiresAt:Timestamp.fromMillis(0),updatedAt:serverTimestamp(),revision:2}));
 await assertFails(updateDoc(doc(db,'activityPermits',id),{endDate:'2026-12-31',updatedAt:serverTimestamp(),revision:2}));
 const raw=(await getDoc(doc(db,'activityPermits',id))).data();
 await assertFails(setDoc(doc(db,'activityPermits','forged-author'),{...raw,authorUid:'other',createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
 const bad=structuredClone(input());bad.sourceCrs='EPSG:4162';
 await assertFails(setDoc(doc(db,'activityPermits','bad'),{...bad,schemaVersion:1,expiresAt:Timestamp.fromDate(permitExpiryDate(bad.endDate)),authorUid:'owner',authorName:'범진',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),revision:1}));
});
it('explicit one-day vessel schedules are independent, movable and retained after permit deletion',async()=>{
 const db=dbFor('owner'),id=await savePermit(db,owner,input());
 await addInvestigations(db,owner,[id],'101','2026-11-10');let rows=await surveys(db);assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-11-10');assert.equal(rows[0].vessel,'101');
 await updateInvestigation(db,owner,rows[0],{date:'2026-11-11',vessel:'103',status:'completed'});rows=await surveys(db);assert.equal(rows[0].date,'2026-11-11');assert.equal(rows[0].vessel,'103');assert.equal(rows[0].status,'completed');
 await deletePermit(db,await read(db,id));assert.equal((await surveys(db)).length,1);
 await updateInvestigation(db,owner,rows[0],{date:'2026-11-12',vessel:'101',status:'planned'});rows=await surveys(db);assert.equal(rows[0].permitSnapshot.vertices.length,4);
 assert.equal((await getDocs(collection(db,'calendarVessels','101','entries'))).size,0);
 await deleteInvestigation(db,rows[0]);assert.equal((await surveys(db)).length,0);
});
it('schedule ownership, admin delete-only and snapshot authenticity are enforced by rules',async()=>{
 const db=dbFor('owner'),other=dbFor('other'),admin=dbFor('admin');const id=await savePermit(db,owner,input());await addInvestigations(db,owner,[id],'101','2026-11-10');const s=(await surveys(db))[0];
 for(const bad of [other,admin])await assertFails(updateDoc(doc(bad,'permitInvestigations',s.id),{status:'completed',updatedAt:serverTimestamp(),revision:2}));
 await assertFails(updateDoc(doc(db,'permitInvestigations',s.id),{authorUid:'other',updatedAt:serverTimestamp(),revision:2}));
 await assertFails(updateDoc(doc(db,'permitInvestigations',s.id),{permitSnapshot:{...s.permitSnapshot,target:'위조'},updatedAt:serverTimestamp(),revision:2}));
 await assertFails(updateDoc(doc(db,'permitInvestigations',s.id),{date:'2026-12-01',updatedAt:serverTimestamp(),revision:2}));
 await assertFails(deleteDoc(doc(other,'permitInvestigations',s.id)));await assertSucceeds(deleteInvestigation(admin,s));
});
it('batch adds several areas atomically and rejects invalid periods and stale revisions',async()=>{
 const db=dbFor('owner');const a=await savePermit(db,owner,input()),b=await savePermit(db,owner,{...input(),target:'굴'});
 await addInvestigations(db,owner,[a,b],'101','2026-11-10');assert.equal((await surveys(db)).length,2);
 await assert.rejects(addInvestigations(db,owner,[a],'101','2026-12-01'));assert.equal((await surveys(db)).length,2);
 const old=await read(db,a);await savePermit(db,owner,{...input(),notes:'변경'},old);await assert.rejects(savePermit(db,owner,input(),old));
});
it('accepts the maximum 20-point polygon within Firestore rule evaluation limits',async()=>{
 const dms=(n,hemisphere)=>{const degrees=Math.floor(n),minuteValue=(n-degrees)*60,minutes=Math.floor(minuteValue);return{degrees,minutes,seconds:(minuteValue-minutes)*60,hemisphere}};
 const vertices=Array.from({length:20},(_,i)=>{const angle=i*Math.PI/10,latDms=dms(34.8+Math.sin(angle)*.01,'N'),lngDms=dms(128.4+Math.cos(angle)*.01,'E');return{latDms,lngDms,lat:dmsDecimal(latDms,'lat'),lng:dmsDecimal(lngDms,'lng')}});
 const db=dbFor('owner'),id=await savePermit(db,owner,{...input(),vertices});assert.equal((await read(db,id)).vertices.length,20);
 await addInvestigations(db,owner,[id],'101','2026-11-10');assert.equal((await surveys(db))[0].permitSnapshot.vertices.length,20);
});
it('multi-area registration respects Firestore access limits at the supported batch size',async()=>{
 const db=dbFor('owner'),ids=[];for(let i=0;i<6;i++)ids.push(await savePermit(db,owner,{...input(),target:'조사 '+i}));
 await assert.rejects(addInvestigations(db,owner,ids,'101','2026-11-10'));assert.equal((await surveys(db)).length,0);
 await addInvestigations(db,owner,ids.slice(0,5),'101','2026-11-10');assert.equal((await surveys(db)).length,5);
 await addInvestigations(db,owner,ids.slice(5),'101','2026-11-10');assert.equal((await surveys(db)).length,6);
});
