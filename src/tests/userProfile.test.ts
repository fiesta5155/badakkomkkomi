import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolveFirebaseConfig } from '../config/firebaseConfig.ts';
import { firebaseErrorMessage, isValidRealName, parseUserProfile } from '../services/userProfileService.ts';

it('accepts exactly two precomposed Korean syllables and rejects whitespace, jamo and other scripts', () => {
  for (const name of ['범진', '승환']) assert.equal(isValidRealName(name), true);
  for (const name of ['', '김', '홍길동', 'ab', '김a', 'ㄱㄴ', '가', '범진 ', ' 범진', '범진\n', '범\n진', '범진\r\n', '김😀', '一二', '범\u200b진', null, undefined, 12]) {
    assert.equal(isValidRealName(name), false, `Invalid name accepted: ${JSON.stringify(name)}`);
  }
});

it('identifies profiles by UID and allows identical names on different accounts', () => {
  assert.deepEqual(parseUserProfile({ uid: 'first', realName: '범진' }, 'first'), { uid: 'first', realName: '범진' });
  assert.deepEqual(parseUserProfile({ uid: 'second', realName: '범진' }, 'second'), { uid: 'second', realName: '범진' });
  assert.equal(parseUserProfile({ uid: 'first', realName: '범진' }, 'second'), null);
  assert.equal(parseUserProfile({ uid: 'first', realName: '범진\n' }, 'first'), null);
  assert.equal(parseUserProfile(null, 'first'), null);
});

it('does not invent missing Firebase settings or initialize a different project', () => {
  assert.equal(resolveFirebaseConfig({}).config, null);
  const env = { apiKey: 'test-only-key', authDomain: 'test.example', projectId: 'badakkomkkomi-firebase', appId: 'test-only-app' };
  assert.equal(resolveFirebaseConfig(env).error, '');
  assert.equal(resolveFirebaseConfig({ ...env, projectId: 'other-project' }).config, null);
  assert.equal(resolveFirebaseConfig({ ...env, appId: '' }).config, null);
});

it('uses safe error messages instead of exposing SDK errors or credentials', () => {
  const message = firebaseErrorMessage({ code: 'unknown', message: 'private-token-and-profile-data' });
  assert.equal(message.includes('private-token'), false);
  assert.match(firebaseErrorMessage({ code: 'permission-denied' }), /Rules/);
  assert.match(firebaseErrorMessage({ code: 'auth/popup-blocked' }), /팝업/);
  assert.match(firebaseErrorMessage({ code: 'auth/unauthorized-domain' }), /도메인/);
});
