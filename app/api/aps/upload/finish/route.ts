/** 올리기 끝 — 올라간 파일을 확정하고 웹용으로 변환을 시작한다. 돌려주는 urn 으로 진행을 묻는다. */

import { NextResponse } from 'next/server';
import { APS_API, SCOPE_WRITE, apsConfigured, apsToken, urnOf, userBucket } from '@/lib/aps';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!apsConfigured()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { objectName?: unknown; uploadKey?: unknown };
  const objectName = typeof body.objectName === 'string' ? body.objectName : '';
  const uploadKey = typeof body.uploadKey === 'string' ? body.uploadKey : '';
  // 우리가 만들어 준 이름만 받는다
  if (!/^[a-z0-9]+-[a-f0-9]{8}\.(rvt|ifc)$/.test(objectName) || !uploadKey) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  try {
    const token = await apsToken(SCOPE_WRITE);
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const bucket = userBucket();

    const done = await fetch(`${APS_API}/oss/v2/buckets/${bucket}/objects/${objectName}/signeds3upload`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ uploadKey }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!done.ok) return NextResponse.json({ error: 'complete-failed', status: done.status }, { status: 502 });
    const { objectId } = (await done.json()) as { objectId: string };
    const urn = urnOf(objectId);

    const job = await fetch(`${APS_API}/modelderivative/v2/designdata/job`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ input: { urn }, output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!job.ok) return NextResponse.json({ error: 'translate-failed', status: job.status }, { status: 502 });

    return NextResponse.json({ urn });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
