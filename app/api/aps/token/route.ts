/**
 * Autodesk Platform Services 뷰어용 토큰.
 *
 * Client Secret 은 서버에서만 쓴다. 브라우저에는 모델을 읽기만 하는 짧은 토큰(viewables:read)만 준다.
 * 키가 없으면 503 을 돌려주고, 화면은 "3D 모델을 불러올 수 없어요" 로 넘어간다.
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

let cached: { token: string; expiresAt: number } | null = null;

export async function GET() {
  const id = process.env.APS_CLIENT_ID;
  const secret = process.env.APS_CLIENT_SECRET;
  if (!id || !secret) {
    return NextResponse.json({ error: 'unconfigured' }, { status: 503 });
  }

  const now = Date.now();
  if (cached && cached.expiresAt - now > 60_000) {
    return NextResponse.json({
      access_token: cached.token,
      expires_in: Math.floor((cached.expiresAt - now) / 1000),
    });
  }

  try {
    const res = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'viewables:read' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'auth-failed', status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return NextResponse.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch {
    return NextResponse.json({ error: 'unreachable' }, { status: 502 });
  }
}
