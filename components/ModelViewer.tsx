'use client';

/**
 * Revit 3D 모델 보기 — Autodesk Platform Services 뷰어.
 *
 * 모델은 미리 한 번 변환해 두고(scripts/aps-upload.mjs), 그 식별 번호(URN)를
 * public/aps-model.json 에 적어 둔다. 여기서는 토큰을 받아 그 URN 만 불러온다.
 * 키가 없거나 URN 이 비었거나 불러오기에 실패하면 이유만 보여 주고 화면은 멀쩡하게 둔다.
 */

import { useEffect, useRef, useState } from 'react';

const VIEWER_VERSION = '7.*';
const BASE = `https://developer.api.autodesk.com/modelderivative/v2/viewers/${VIEWER_VERSION}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Autodesk?: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('script'));
    document.head.appendChild(el);
  });
}

function loadStyle(href: string) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const el = document.createElement('link');
  el.rel = 'stylesheet';
  el.href = href;
  document.head.appendChild(el);
}

async function fetchToken(): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch('/api/aps/token', { cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 503 ? 'unconfigured' : 'token');
  return res.json();
}

type State = 'loading' | 'ready' | 'unconfigured' | 'no-model' | 'error';

const MESSAGE: Record<Exclude<State, 'loading' | 'ready'>, string> = {
  unconfigured: '3D 모델 보기 키(APS_CLIENT_ID, APS_CLIENT_SECRET)가 아직 연결되지 않았어요.',
  'no-model': '불러올 3D 모델이 아직 없어요. scripts/aps-upload.mjs 로 모델을 올리면 여기에 나와요.',
  error: '3D 모델을 불러올 수 없어요. 잠시 뒤 다시 시도해 주세요.',
};

/** urn 을 주면 그 모델을, 안 주면 public/aps-model.json 에 적어 둔 기본 모델을 보여 준다 */
export default function ModelViewer({ height = 520, urn: urnProp }: { height?: number; urn?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    let viewer: any = null;
    let alive = true;
    setState('loading');

    (async () => {
      try {
        const meta = urnProp
          ? null
          : await fetch('/aps-model.json', { cache: 'no-store' })
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null);
        const urn: string | undefined = urnProp ?? meta?.urn;
        if (!urn) {
          if (alive) setState('no-model');
          return;
        }

        const first = await fetchToken();
        loadStyle(`${BASE}/style.min.css`);
        await loadScript(`${BASE}/viewer3D.min.js`);
        if (!alive || !hostRef.current) return;

        const A = window.Autodesk;
        await new Promise<void>((resolve) => {
          A.Viewing.Initializer(
            {
              env: 'AutodeskProduction2',
              api: 'streamingV2',
              getAccessToken: (done: (t: string, s: number) => void) => {
                fetchToken().then((t) => done(t.access_token, t.expires_in));
              },
            },
            resolve,
          );
        });
        void first;
        if (!alive || !hostRef.current) return;

        viewer = new A.Viewing.GuiViewer3D(hostRef.current);
        viewer.start();
        A.Viewing.Document.load(
          `urn:${urn}`,
          (doc: any) => {
            const node = doc.getRoot().getDefaultGeometry();
            viewer.loadDocumentNode(doc, node).then(() => alive && setState('ready'));
          },
          () => alive && setState('error'),
        );
      } catch (e) {
        if (!alive) return;
        setState(e instanceof Error && e.message === 'unconfigured' ? 'unconfigured' : 'error');
      }
    })();

    return () => {
      alive = false;
      try {
        viewer?.finish();
      } catch {
        /* 이미 닫힘 */
      }
    };
  }, [urnProp]);

  return (
    <div
      style={{
        position: 'relative',
        height,
        border: '1px solid var(--color-line-strong)',
        borderRadius: 'var(--radius-sharp)',
        overflow: 'hidden',
        background: 'var(--color-paper)',
      }}
    >
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {state !== 'ready' && (
        <p
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            margin: 0,
            padding: 24,
            textAlign: 'center',
            fontSize: '0.88rem',
            color: 'var(--color-concrete-wet)',
            background: 'var(--color-paper)',
          }}
        >
          {state === 'loading' ? '3D 모델을 불러오는 중…' : MESSAGE[state]}
        </p>
      )}
    </div>
  );
}
