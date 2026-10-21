/**
 * Autodesk Platform Services 서버 쪽 공통 — 토큰, 임시 보관함, 모델 식별 번호(URN).
 * Client Secret 은 여기서만 쓴다. 브라우저로는 절대 내보내지 않는다.
 */

export const APS_API = 'https://developer.api.autodesk.com';

/** [가정] 올릴 수 있는 확장자와 크기 — 무료 변환 횟수가 한정돼 있어서 막아 둔다 */
export const UPLOAD_EXT = /\.(rvt|ifc)$/i;
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

export function apsConfigured(): boolean {
  return !!(process.env.APS_CLIENT_ID && process.env.APS_CLIENT_SECRET);
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function apsToken(scope: string): Promise<string> {
  const hit = tokens.get(scope);
  if (hit && hit.expiresAt - Date.now() > 60_000) return hit.token;

  const id = process.env.APS_CLIENT_ID!;
  const secret = process.env.APS_CLIENT_SECRET!;
  const res = await fetch(`${APS_API}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`aps-token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(scope, { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}

/** 사용자가 올린 파일은 24시간 뒤 자동으로 지워지는 임시 보관함에 둔다 */
export function userBucket(): string {
  const id = (process.env.APS_CLIENT_ID ?? '').slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '');
  return `remigo-${id}-tmp`;
}

export async function ensureBucket(token: string, bucketKey: string): Promise<void> {
  const res = await fetch(`${APS_API}/oss/v2/buckets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bucketKey, policyKey: 'transient' }),
    signal: AbortSignal.timeout(15_000),
  });
  // 409 = 이미 있다
  if (!res.ok && res.status !== 409) throw new Error(`aps-bucket ${res.status}`);
}

export const urnOf = (objectId: string) => Buffer.from(objectId).toString('base64url');

export const SCOPE_WRITE = 'data:read data:write data:create bucket:create bucket:read';
export const SCOPE_READ = 'data:read';
