import test from 'node:test';
import assert from 'node:assert/strict';
import { trialRockTides, trialRockHeight, rockTrialDate } from '../services/rockDockingTrialTides.ts';
import { rockComparison, estimateRockTide } from '../services/rockDockingModel.ts';
import { ROCK_DOCKING_TIDE_REFERENCE } from '../config/rockDocking.ts';
import type { TideSeriesDay } from '../services/khoaTideSeriesSchema.ts';

const now = Date.parse('2026-11-26T03:02:30Z'); // Trial interpretation: local 12:02:30.
function fixture(): TideSeriesDay {
  return {schemaVersion:1,date:'2026-11-26',generatedAt:'2026-11-26T01:00:00.000Z',unit:'cm',intervalMinutes:5,
    reference:{verticalDatumVerified:false,timeZoneVerified:false},stations:[
      {code:'DT_0014',heightsCm:Array.from({length:288},(_,i)=>-20.5+i*.5),nextMidnightCm:200.25},
      {code:'SO_0552',heightsCm:Array(288).fill(-5.25),nextMidnightCm:4.75},
    ]};
}
test('trial interpolation preserves negatives, decimals and seconds between five-minute samples',()=>{
  const heights = trialRockTides(fixture(),now);
  assert.equal(heights.DT_0014,51.75);
  assert.equal(heights.SO_0552,-5.25);
  assert.equal(trialRockTides(fixture(),Date.parse('2026-11-25T15:02:30Z')).DT_0014,undefined,'future generation is not yet available');
  const early = fixture();early.generatedAt='2026-11-25T14:00:00.000Z';
  assert.equal(trialRockTides(early,Date.parse('2026-11-25T15:02:30Z')).DT_0014,-20.25);
});
test('trial uses embedded nextMidnightCm without loading another day and refuses yesterday at midnight',()=>{
  const day=fixture(),at=Date.parse('2026-11-26T14:57:30Z');
  const heights=trialRockTides(day,at);
  assert.equal(heights.DT_0014,(day.stations[0].heightsCm[287]+200.25)/2);
  assert.equal(heights.SO_0552,-.25);
  assert.equal(rockTrialDate(Date.parse('2026-11-26T15:00:00Z')),'2026-11-27');
  assert.deepEqual(trialRockTides(day,Date.parse('2026-11-26T15:00:00Z')),{});
});
test('station selection is exact; unknown/missing station never falls back to Tongyeong',()=>{
  const h=trialRockTides(fixture(),now);
  assert.equal(trialRockHeight(h,{stationCode:'SO_0552'}),-5.25);
  assert.equal(trialRockHeight({DT_0014:100},{stationCode:'SO_0552'}),null);
  assert.equal(trialRockHeight(h,{stationCode:'other' as 'DT_0014'}),null);
});
test('vessel ranges compare independently using the existing ten-centimeter boundary',()=>{
  const height=trialRockHeight(trialRockTides(fixture(),now),{stationCode:'DT_0014'});
  assert.equal(rockComparison(height,{min:20,max:80}),'inside');
  assert.equal(rockComparison(height,{min:0,max:40}),'outside');
  assert.equal(rockComparison(height,{min:50,max:80}),'boundary');
  assert.equal(rockComparison(40,{min:50,max:80}),'outside');
  assert.equal(rockComparison(60,{min:50,max:80}),'boundary');
  assert.equal(rockComparison(height,null),'unknown');
  assert.equal(rockComparison(null,{min:20,max:80}),'unknown');
});
test('missing, corrupt, stale, wrong-day and false verification claims cannot produce trial colors',()=>{
  for(const day of [null,{}, {...fixture(),generatedAt:'2026-11-24T00:00:00.000Z'}, {...fixture(),date:'2026-11-25'},
    {...fixture(),reference:{verticalDatumVerified:true,timeZoneVerified:true}}]) assert.deepEqual(trialRockTides(day,now),{});
  for(const bad of [null,NaN,Infinity,'1']) {const d=fixture();(d.stations[0].heightsCm as unknown[])[150]=bad;assert.deepEqual(trialRockTides(d,now),{});}
  const duplicate=fixture();duplicate.stations[1].code='DT_0014';assert.deepEqual(trialRockTides(duplicate,now),{});
  assert.deepEqual(trialRockTides(fixture(),NaN),{});
});
test('trial leaves source flags, ranges and the officially verified comparison path untouched',()=>{
  const day=fixture(),before=JSON.stringify(day);trialRockTides(day,now);
  assert.equal(JSON.stringify(day),before);assert.equal(ROCK_DOCKING_TIDE_REFERENCE,null);
  assert.equal(estimateRockTide(null,{stationCode:'DT_0014',datum:'DL'},'2026-11-26T12:00'),null);
});
