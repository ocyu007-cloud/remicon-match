'use client';

/**
 * Revit 3D 모델 보기 — Autodesk Platform Services 뷰어.
 *
 * 모델은 미리 한 번 변환해 두고(scripts/aps-upload.mjs), 그 식별 번호(URN)를
 * public/aps-model.json 에 적어 둔다. 여기서는 토큰을 받아 그 URN 만 불러온다.
 * 키가 없거나 URN 이 비었거나 불러오기에 실패하면 이유만 보여 주고 화면은 멀쩡하게 둔다.
 */

import { useEffect, useRef, useState } from 'react';
import type { Spot } from '@/lib/spots';

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

interface PinPos {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

/**
 * urn 을 주면 그 모델을, 안 주면 public/aps-model.json 에 적어 둔 기본 모델을 보여 준다.
 * spots 를 주면 모델 위에 핀으로 그리고, placing 이 true 면 모델을 눌러 지점을 찍는다.
 */
export default function ModelViewer({
  height = 520,
  urn: urnProp,
  spots = [],
  selectedId,
  placing = false,
  onPlace,
  onPinClick,
}: {
  height?: number;
  urn?: string;
  spots?: Spot[];
  selectedId?: string;
  placing?: boolean;
  onPlace?: (point: { x: number; y: number; z: number }) => void;
  onPinClick?: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [state, setState] = useState<State>('loading');
  const [pins, setPins] = useState<PinPos[]>([]);
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;

  function project() {
    const v = viewerRef.current;
    const THREE = (window as any).THREE;
    if (!v || !THREE) return;
    const next: PinPos[] = spotsRef.current.map((s) => {
      const p = v.worldToClient(new THREE.Vector3(s.x, s.y, s.z));
      return { id: s.id, x: p.x, y: p.y, visible: p.z >= -1 && p.z <= 1 };
    });
    setPins(next);
  }

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
        viewerRef.current = viewer;
        viewer.start();
        viewer.addEventListener(A.Viewing.CAMERA_CHANGE_EVENT, project);
        viewer.addEventListener(A.Viewing.VIEWER_RESIZE_EVENT, project);

        // 지점 찍기 — 끌어서 돌리는 동작과 구분하려고 누른 자리와 뗀 자리가 거의 같을 때만 친다
        let down: { x: number; y: number } | null = null;
        const el: HTMLElement = viewer.container;
        el.addEventListener('pointerdown', (e: PointerEvent) => {
          down = { x: e.clientX, y: e.clientY };
        });
        el.addEventListener('pointerup', (e: PointerEvent) => {
          if (!placingRef.current || !down) return;
          const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
          down = null;
          if (moved > 5) return;
          const rect = el.getBoundingClientRect();
          const hit = viewer.clientToWorld(e.clientX - rect.left, e.clientY - rect.top, true);
          if (hit?.point) onPlaceRef.current?.({ x: hit.point.x, y: hit.point.y, z: hit.point.z });
        });
        A.Viewing.Document.load(
          `urn:${urn}`,
          (doc: any) => {
            const node = doc.getRoot().getDefaultGeometry();
            viewer.loadDocumentNode(doc, node).then(() => {
              if (!alive) return;
              setState('ready');
              project();
            });
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
      viewerRef.current = null;
      try {
        viewer?.finish();
      } catch {
        /* 이미 닫힘 */
      }
    };
  }, [urnProp]);

  useEffect(() => {
    project();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, state]);

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
      <div ref={hostRef} style={{ position: 'absolute', inset: 0, cursor: placing ? 'crosshair' : undefined }} />
      {state === 'ready' &&
        pins
          .filter((p) => p.visible)
          .map((p) => {
            const s = spots.find((x) => x.id === p.id);
            if (!s) return null;
            const on = p.id === selectedId;
            return (
              <button
                key={p.id}
                type="button"
                title={s.name}
                onClick={() => onPinClick?.(p.id)}
                style={{
                  position: 'absolute',
                  left: p.x,
                  top: p.y,
                  transform: 'translate(-50%, -100%)',
                  zIndex: 5,
                  padding: '3px 8px',
                  border: `2px solid ${on ? 'var(--color-rust)' : '#fff'}`,
                  borderRadius: 999,
                  background: on ? 'var(--color-rust)' : 'var(--color-concrete-dark)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  boxShadow: '0 2px 6px rgba(0,0,0,.35)',
                }}
              >
                📍 {s.name}
              </button>
            );
          })}
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
