import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, it } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { dmsDecimal } from '../services/activityPermitModel.ts';
import { savePermit } from '../services/activityPermitService.ts';
let env;
const environments = [];
const original = readFileSync('docs/backups/firestore.production-before-permits.rules', 'utf8');
const merged = readFileSync('firestore.rules', 'utf8');
async function useRules(rules) {
  const instance = await initializeTestEnvironment({ projectId: 'demo-bada-profile', firestore: { host: '127.0.0.1', port: 8085, rules } });
  environments.push(instance);
  return instance;
}
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Only the local demo emulator is allowed');
  env = await useRules(original);
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'users', 'owner'), { uid: 'owner', realName: '범진', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  });
});
after(async () => Promise.all(environments.map(instance => instance.cleanup())));

it('supplied production rules deny permits; merged rules enable the actual list query; restoring the backup preserves calendar data', async () => {
  const db = env.authenticatedContext('owner', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  const list = () => getDocs(query(collection(db, 'activityPermits'), orderBy('endDate', 'desc')));
  const denied = async work => { const error = await assertFails(work()); assert.equal(error.code, 'permission-denied'); };
  await denied(list);
  await denied(() => getDocs(collection(db, 'permitInvestigations')));
  const status = doc(db, 'calendarVessels', '101', 'entries', 'status_2026-11-19');
  await assertSucceeds(setDoc(status, { schemaVersion: 1, date: '2026-11-19', kind: 'planned', content: '기존 운항 상태', authorUid: 'owner', authorName: '범진', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), revision: 1 }));
  const vertex = (a, b) => {
    const latDms = { degrees: 34, minutes: a, seconds: 0, hemisphere: 'N' }, lngDms = { degrees: 128, minutes: b, seconds: 0, hemisphere: 'E' };
    return { latDms, lngDms, lat: dmsDecimal(latDms, 'lat'), lng: dmsDecimal(lngDms, 'lng') };
  };
  const input = { permitNumber: '통영양식 제1531호', target: '미역', sourceCrs: 'EPSG:4326', vertices: [vertex(48,24),vertex(48,25),vertex(49,25),vertex(49,24)], startDate: '2026-11-01', endDate: '2026-11-30', notes: '' };
  await denied(() => savePermit(db, { uid: 'owner', realName: '범진' }, input));
  await useRules(merged);
  assert.equal((await assertSucceeds(list())).size, 0);
  await savePermit(db, { uid: 'owner', realName: '범진' }, input);
  assert.equal((await assertSucceeds(list())).size, 1);
  assert.equal((await assertSucceeds(getDoc(status))).data().content, '기존 운항 상태');
  await useRules(original);
  await denied(list);
  await denied(() => getDocs(collection(db, 'permitInvestigations')));
  assert.equal((await assertSucceeds(getDoc(status))).data().content, '기존 운항 상태');
  await env.withSecurityRulesDisabled(async ctx => assert.equal((await getDocs(collection(ctx.firestore(), 'activityPermits'))).size, 1, 'Restoring rules must not delete documents'));
});
