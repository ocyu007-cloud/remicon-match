/**
 * 올리기 시작 — 브라우저가 Autodesk 저장소로 직접 올릴 수 있는 한 번용 주소를 만들어 준다.
 * 파일 자체는 이 서버를 지나가지 않는다 (Vercel 함수는 본문이 4.5MB 까지라 모델 파일이 안 들어간다).
 */

import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  APS_API,
  MAX_UPLOAD_BYTES,
  SCOPE_WRITE,
  UPLOAD_EXT,
  apsConfigured,
  apsToken,
  ensureBucket,
  userBucket,
} from '@/lib/aps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!apsConfigured()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { fileName?: unknown; size?: unknown };
  const fileName = typeof body.fileName === 'string' ? body.fileName : '';
  const size = typeof body.size === 'number' ? body.size : 0;
  if (!UPLOAD_EXT.test(fileName)) {
    return NextResponse.json({ error: 'bad-type', message: 'Revit(.rvt) 또는 .ifc 파일만 올릴 수 있어요.' }, { status: 400 });
  }
  if (size <= 0 || size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'too-large', message: '파일은 150MB 까지만 올릴 수 있어요.' }, { status: 400 });
  }

  try {
    const token = await apsToken(SCOPE_WRITE);
    const bucket = userBucket();
    await ensureBucket(token, bucket);

    const ext = fileName.toLowerCase().endsWith('.ifc') ? 'ifc' : 'rvt';
    const objectName = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`;
    const res = await fetch(
      `${APS_API}/oss/v2/buckets/${bucket}/objects/${objectName}/signeds3upload?parts=1&firstPart=1&minutesExpiration=15`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) return NextResponse.json({ error: 'aps', status: res.status }, { status: 502 });
    const data = (await res.json()) as { uploadKey: string; urls: string[] };
    return NextResponse.json({ objectName, uploadKey: data.uploadKey, url: data.urls[0] });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
