import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, beforeEach, it } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { loadUserProfile, saveUserProfile } from '../services/userProfileService.ts';

let environment;
before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8085', 'Only the local demo emulator may be used');
  environment = await initializeTestEnvironment({
    projectId: 'demo-bada-profile',
    firestore: { host: '127.0.0.1', port: 8085, rules: readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => { await environment.clearFirestore(); });
after(async () => { await environment?.cleanup(); });

const databaseFor = (uid, provider = 'google.com') => environment.authenticatedContext(uid, {
  firebase: { sign_in_provider: provider },
}).firestore();
const dataFor = (uid, realName = '범진') => ({ uid, realName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

it('creates and reloads the signed-in user profile; name changes preserve creation time', async () => {
  const db = databaseFor('owner');
  assert.equal(await loadUserProfile(db, 'owner'), null);
  await assertSucceeds(saveUserProfile(db, 'owner', '범진'));
  assert.deepEqual(await loadUserProfile(db, 'owner'), { uid: 'owner', realName: '범진' });
  const first = (await getDoc(doc(db, 'users', 'owner'))).data();
  await assertSucceeds(saveUserProfile(db, 'owner', '승환'));
  const next = (await getDoc(doc(db, 'users', 'owner'))).data();
  assert.equal(first.createdAt.isEqual(next.createdAt), true);
  assert.deepEqual(await loadUserProfile(db, 'owner'), { uid: 'owner', realName: '승환' });
});

it('allows the same name for different UIDs without employee approval', async () => {
  for (const uid of ['first', 'second']) {
    await assertSucceeds(setDoc(doc(databaseFor(uid), 'users', uid), dataFor(uid)));
  }
});

it('rejects invalid names in Rules even when UI validation is bypassed', async () => {
  const ref = doc(databaseFor('owner'), 'users', 'owner');
  for (const name of ['', '범', '홍길동', 'ab', 'ㄱㄴ', '가', ' 범진', '범진 ', '범진\n', '범\u200b진', '一二']) {
    await assertFails(setDoc(ref, dataFor('owner', name)));
  }
});

it('denies unauthenticated and non-Google access, other user access, list and delete', async () => {
  const own = databaseFor('owner');
  await assertSucceeds(setDoc(doc(own, 'users', 'owner'), dataFor('owner')));
  for (const db of [environment.unauthenticatedContext().firestore(), databaseFor('other'), databaseFor('owner', 'anonymous')]) {
    await assertFails(getDoc(doc(db, 'users', 'owner')));
    await assertFails(setDoc(doc(db, 'users', 'owner'), dataFor('owner')));
    await assertFails(updateDoc(doc(db, 'users', 'owner'), { realName: '승환', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(db, 'users', 'owner')));
  }
  await assertFails(getDocs(collection(own, 'users')));
  await assertFails(deleteDoc(doc(own, 'users', 'owner')));
  await assertFails(setDoc(doc(own, 'calendar', 'test'), { content: 'not-enabled' }));
});

it('rejects spoofed UIDs, extra privilege fields, forged timestamps and invalid updates', async () => {
  const ref = doc(databaseFor('owner'), 'users', 'owner');
  await assertFails(setDoc(ref, dataFor('other')));
  await assertFails(setDoc(ref, { ...dataFor('owner'), role: 'admin' }));
  await assertFails(setDoc(ref, { ...dataFor('owner'), createdAt: Timestamp.fromMillis(0) }));
  await assertSucceeds(setDoc(ref, dataFor('owner')));
  await assertFails(updateDoc(ref, { uid: 'other', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { createdAt: Timestamp.fromMillis(0), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { realName: '홍길동', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { realName: '승환', updatedAt: Timestamp.fromMillis(0) }));
});
