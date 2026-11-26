import assert from 'node:assert/strict';
import { it } from 'node:test';
import { rockReadErrorMessage, rockIslandId, validateRock, rockComparison, estimateRockTide, validateRockNote, type RockInput } from '../services/rockDockingModel.ts';
import type { TideSnapshot } from '../services/khoaTideSchema.ts';
const input = (): RockInput => ({islandId:'소매물도',name:'남측',lat:34.7,lng:128.5,stationCode:'DT_0014',datum:'DL',ranges:{101:{min:50,max:150},103:null},confirmedOn:'2026-11-23',photos:[]});
const now=Date.parse('2026-11-23T00:00:00Z'), ref={datum:'DL',timeZone:'Asia/Seoul',source:'test confirmed reference'} as const;
const snapshot = (): TideSnapshot => ({schemaVersion:1,source:'KHOA',generatedAt:new Date(now).toISOString(),unit:'cm',stations:[{code:'DT_0014',name:'통영',days:[{date:'2026-11-22',events:[{time:'23:00',kind:'low',heightCm:0,extrSe:2}]},{date:'2026-11-23',events:[{time:'05:00',kind:'high',heightCm:200,extrSe:1},{time:'11:00',kind:'low',heightCm:0,extrSe:2}]}]}]});
it('island canonical names deduplicate spaces, case and compatibility letters',()=>{assert.equal(rockIslandId(' 소 매물도 '),'소매물도');assert.equal(rockIslandId('Ａ Island'),'aisland');assert.throws(()=>rockIslandId('../bad'));});
it('validates optional vessel ranges, coordinate bounds, dates and memo',()=>{validateRock(input());for(const value of [{lat:NaN},{lng:181},{confirmedOn:'2026-02-30'},{ranges:{101:{min:200,max:100},103:null}},{ranges:{101:null}}])assert.throws(()=>validateRock({...input(),...value} as RockInput));assert.throws(()=>validateRockNote('   '));assert.throws(()=>validateRockNote('a'.repeat(4001)));});
it('four comparison states use a ten-centimetre inner boundary, without claiming safety',()=>{const r={min:50,max:150};assert.equal(rockComparison(100,r),'inside');for(const h of [50,60,140,150])assert.equal(rockComparison(h,r),'boundary');assert.equal(rockComparison(49,r),'outside');assert.equal(rockComparison(null,r),'unknown');assert.equal(rockComparison(100,null),'unknown');});
it('interpolates adjacent high/low observations across midnight only with confirmed reference',()=>{assert.equal(estimateRockTide(snapshot(),input(),'2026-11-23T02:00',ref,now),100);assert.equal(estimateRockTide(snapshot(),input(),'2026-11-23T05:00',ref,now),200);assert.equal(estimateRockTide(snapshot(),input(),'2026-11-23T08:00',ref,now),100);});
it('unknown datum/timezone, missing, stale and outside coverage never produce a height',()=>{for(const p of [input(),{...input(),datum:'unverified' as const},{...input(),stationCode:'SO_0552' as const}])assert.equal(estimateRockTide(snapshot(),p,'2026-11-23T02:00',null,now),null);assert.equal(estimateRockTide(snapshot(),{...input(),datum:'unverified'},'2026-11-23T02:00',ref,now),null);for(const time of ['2026-11-22T22:00','2026-11-23T12:00','2026-02-30T02:00','bad'])assert.equal(estimateRockTide(snapshot(),input(),time,ref,now),null);assert.equal(estimateRockTide(snapshot(),input(),'2026-11-23T02:00',ref,now+37*3600000),null);const s=snapshot();s.stations[0].days[1].events[0].kind='low';assert.equal(estimateRockTide(s,input(),'2026-11-23T02:00',ref,now),null);});
it('photo metadata is limited, bound to its owner path and has no inline image storage',()=>{const id='11111111-1111-4111-8111-111111111111',photo={id,path:'rockDocking/p/u/'+id+'.webp',role:'wide' as const,size:200000,width:1600,height:900};validateRock({...input(),photos:[photo]},'p','u');for(const p of [{...photo,path:'data:image/png;base64,abc'},{...photo,width:1601},{...photo,size:512001}])assert.throws(()=>validateRock({...input(),photos:[p]},'p','u'));assert.throws(()=>validateRock({...input(),photos:[photo,photo]},'p','u'));});

it('read errors distinguish permissions, authentication and transport without exposing raw errors',()=>{
  for(const code of ['permission-denied','unauthenticated','unavailable','deadline-exceeded','failed-precondition','resource-exhausted']){
    assert.ok(rockReadErrorMessage({code,message:'SECRET_TOKEN UID RAW_URL'}).endsWith('('+code+')'));
    assert.equal(rockReadErrorMessage({code:'firestore/'+code}),rockReadErrorMessage({code}));
    assert.ok(!rockReadErrorMessage({code,message:'SECRET_TOKEN'}).includes('SECRET_TOKEN'));
  }
  assert.notEqual(rockReadErrorMessage({code:'permission-denied'}),rockReadErrorMessage({code:'unavailable'}));
  for(const cause of [null,new Error('SECRET_TOKEN'),{code:'untrusted SECRET_TOKEN'}, {code:'toString'}])assert.equal(rockReadErrorMessage(cause),'접안정보를 읽지 못했습니다. 연결 또는 자료 형식을 확인해 주세요.');
});
