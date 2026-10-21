/** 변환 진행 확인 — pending(아직 시작 전) / inprogress / success / failed 와 진행률. */

import { NextResponse } from 'next/server';
import { APS_API, SCOPE_READ, apsConfigured, apsToken } from '@/lib/aps';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!apsConfigured()) return NextResponse.json({ error: 'unconfigured' }, { status: 503 });

  const urn = new URL(req.url).searchParams.get('urn') ?? '';
  if (!/^[A-Za-z0-9_-]{20,400}$/.test(urn)) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  try {
    const token = await apsToken(SCOPE_READ);
    const res = await fetch(`${APS_API}/modelderivative/v2/designdata/${urn}/manifest`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return NextResponse.json({ status: 'pending', progress: '0%' });
    if (!res.ok) return NextResponse.json({ error: 'aps', status: res.status }, { status: 502 });
    const m = (await res.json()) as { status?: string; progress?: string };
    return NextResponse.json({ status: m.status ?? 'pending', progress: m.progress ?? '' });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
