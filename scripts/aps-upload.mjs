/**
 * Revit(.rvt) 파일 하나를 Autodesk 에 올리고 웹용으로 변환한 뒤, 모델 식별 번호(URN)를
 * public/aps-model.json 에 적는다. 모델을 바꿀 때만 한 번 돌리면 된다 — 변환은 횟수 제한이 있다.
 *
 *   node scripts/aps-upload.mjs "C:\경로\모델.rvt"
 *
 * 키는 .env.local 의 APS_CLIENT_ID / APS_CLIENT_SECRET 에서 읽는다 (채팅·코드에 적지 않는다).
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const ID = process.env.APS_CLIENT_ID;
const SECRET = process.env.APS_CLIENT_SECRET;
const file = process.argv[2];
if (!ID || !SECRET) throw new Error('.env.local 에 APS_CLIENT_ID, APS_CLIENT_SECRET 을 넣어 주세요.');
if (!file || !existsSync(file)) throw new Error('사용법: node scripts/aps-upload.mjs "모델.rvt 경로"');

const API = 'https://developer.api.autodesk.com';
const bucket = `remigo-${ID.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
const objectName = basename(file).replace(/[^A-Za-z0-9._-]/g, '_');

async function call(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { res, body };
}

// 1) 토큰
const tokenRes = await call(`${API}/authentication/v2/token`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    authorization: `Basic ${Buffer.from(`${ID}:${SECRET}`).toString('base64')}`,
  },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'data:read data:write data:create bucket:create bucket:read',
  }),
});
if (!tokenRes.res.ok) throw new Error(`토큰 실패 ${tokenRes.res.status}: ${JSON.stringify(tokenRes.body)}`);
const auth = { authorization: `Bearer ${tokenRes.body.access_token}` };
console.log('1/5 토큰 OK');

// 2) 버킷 (이미 있으면 409)
const b = await call(`${API}/oss/v2/buckets`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json' },
  body: JSON.stringify({ bucketKey: bucket, policyKey: 'persistent' }),
});
if (!b.res.ok && b.res.status !== 409) throw new Error(`버킷 실패 ${b.res.status}: ${JSON.stringify(b.body)}`);
console.log(`2/5 버킷 OK (${bucket})`);

// 3) 올리기 — 서명된 주소로 직접 올리고 완료를 알린다
const size = statSync(file).size;
console.log(`3/5 올리는 중… (${(size / 1024 / 1024).toFixed(1)}MB)`);
const signed = await call(
  `${API}/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(objectName)}/signeds3upload?parts=1&firstPart=1`,
  { headers: auth },
);
if (!signed.res.ok) throw new Error(`업로드 주소 실패 ${signed.res.status}: ${JSON.stringify(signed.body)}`);
const put = await fetch(signed.body.urls[0], { method: 'PUT', body: readFileSync(file) });
if (!put.ok) throw new Error(`업로드 실패 ${put.status}`);
const done = await call(
  `${API}/oss/v2/buckets/${bucket}/objects/${encodeURIComponent(objectName)}/signeds3upload`,
  {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ uploadKey: signed.body.uploadKey }),
  },
);
if (!done.res.ok) throw new Error(`업로드 완료 실패 ${done.res.status}: ${JSON.stringify(done.body)}`);
const urn = Buffer.from(done.body.objectId).toString('base64url').replace(/=+$/, '');
console.log('3/5 업로드 OK');

// 4) 변환 요청
const job = await call(`${API}/modelderivative/v2/designdata/job`, {
  method: 'POST',
  headers: { ...auth, 'content-type': 'application/json', 'x-ads-force': 'true' },
  body: JSON.stringify({
    input: { urn },
    output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] },
  }),
});
if (!job.res.ok) throw new Error(`변환 요청 실패 ${job.res.status}: ${JSON.stringify(job.body)}`);
console.log('4/5 변환 요청 OK — 끝날 때까지 기다립니다 (몇 분 걸릴 수 있어요)');

// 5) 끝날 때까지 확인
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const m = await call(`${API}/modelderivative/v2/designdata/${urn}/manifest`, { headers: auth });
  const st = m.body.status;
  process.stdout.write(`   상태: ${st} ${m.body.progress ?? ''}\r`);
  if (st === 'success') {
    writeFileSync('public/aps-model.json', JSON.stringify({ urn, file: basename(file) }, null, 2) + '\n');
    console.log('\n5/5 완료 — public/aps-model.json 에 URN 을 적었어요. 이제 커밋하고 올리면 사이트에 나와요.');
    process.exit(0);
  }
  if (st === 'failed' || st === 'timeout') throw new Error(`변환 실패: ${JSON.stringify(m.body)}`);
}
throw new Error('변환이 너무 오래 걸려요. 잠시 뒤 다시 확인해 주세요.');
