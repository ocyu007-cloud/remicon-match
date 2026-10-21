'use client';

/**
 * 현장 — Revit 3D 모델 보기.
 * 파일을 올리면 Autodesk 에서 웹용으로 변환한 뒤 아래 뷰어에 띄운다. 안 올리면 기본 모델이 나온다.
 *
 * 올리기: 서버가 한 번용 주소를 만들어 주고 → 브라우저가 Autodesk 저장소로 직접 올리고
 *        → 서버가 변환을 시작하고 → 진행률을 물어 보다가 끝나면 뷰어에 넘긴다.
 */

import { useEffect, useRef, useState } from 'react';
import ModelViewer from '@/components/ModelViewer';
import { SiteShell } from '@/components/RoleShells';
import { Panel } from '@/components/ui';

const MAX_MB = 150;

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; pct: number; name: string }
  | { kind: 'converting'; progress: string; name: string }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; message: string };

function putFile(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`전송 응답 ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('전송 연결 실패'));
    xhr.send(file);
  });
}

function ModelBody() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [urn, setUrn] = useState<string | undefined>(undefined);
  const timer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  function fail(message: string) {
    setPhase({ kind: 'error', message });
  }

  function poll(nextUrn: string, name: string) {
    fetch(`/api/aps/status?urn=${encodeURIComponent(nextUrn)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { status?: string; progress?: string; error?: string }) => {
        if (s.status === 'success') {
          setUrn(nextUrn);
          setPhase({ kind: 'ready', name });
        } else if (s.status === 'failed' || s.status === 'timeout') {
          fail('이 파일은 3D로 변환하지 못했어요. 다른 Revit 파일로 시도해 주세요.');
        } else if (s.error) {
          fail('변환 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
        } else {
          setPhase({ kind: 'converting', progress: s.progress ?? '', name });
          timer.current = window.setTimeout(() => poll(nextUrn, name), 4000);
        }
      })
      .catch(() => fail('변환 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'));
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    if (inputRef.current) inputRef.current.value = '';
    if (!/\.(rvt|ifc)$/i.test(file.name)) return fail('Revit(.rvt) 또는 .ifc 파일만 올릴 수 있어요.');
    if (file.size > MAX_MB * 1024 * 1024) return fail(`파일은 ${MAX_MB}MB 까지만 올릴 수 있어요.`);

    let step = '올리기 시작';
    try {
      setPhase({ kind: 'uploading', pct: 0, name: file.name });
      const startRes = await fetch('/api/aps/upload/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      const start = await startRes.json();
      if (!startRes.ok) {
        return fail(
          start.error === 'unconfigured'
            ? '3D 모델 보기 키가 아직 연결되지 않아 올릴 수 없어요.'
            : (start.message ?? '올리기를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.'),
        );
      }

      step = '파일 전송';
      await putFile(start.url, file, (pct) => setPhase({ kind: 'uploading', pct, name: file.name }));

      step = '변환 시작';
      const finRes = await fetch('/api/aps/upload/finish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ objectName: start.objectName, uploadKey: start.uploadKey }),
      });
      const fin = await finRes.json();
      if (!finRes.ok) return fail('올린 파일을 변환하지 못했어요. 잠시 뒤 다시 시도해 주세요.');

      setPhase({ kind: 'converting', progress: '', name: file.name });
      poll(fin.urn, file.name);
    } catch (e) {
      const detail = e instanceof Error ? e.message : '';
      fail(`올리는 중에 끊겼어요 (${step} 단계${detail ? `: ${detail}` : ''}). 인터넷을 확인하고 다시 시도해 주세요.`);
    }
  }

  const busy = phase.kind === 'uploading' || phase.kind === 'converting';

  return (
    <>
      <Panel title="내 Revit 파일 올리기">
        <input
          ref={inputRef}
          type="file"
          accept=".rvt,.ifc"
          hidden
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            파일 고르기 (.rvt)
          </button>
          <span style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)' }}>
            {phase.kind === 'idle' && `${MAX_MB}MB 까지. 안 올리면 기본 모델이 보여요.`}
            {phase.kind === 'uploading' && `${phase.name} 올리는 중… ${phase.pct}%`}
            {phase.kind === 'converting' &&
              `${phase.name} 3D로 변환하는 중… ${phase.progress} (몇 분 걸려요. 창을 닫지 마세요)`}
            {phase.kind === 'ready' && `${phase.name} — 아래에서 볼 수 있어요.`}
            {phase.kind === 'error' && <span style={{ color: 'var(--color-bad)' }}>{phase.message}</span>}
          </span>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--color-concrete-mid)', margin: '10px 0 0' }}>
          올린 파일은 Autodesk 서버에서 변환되고 24시간 뒤에 지워져요. 시연용 가상 데이터만 올려 주세요.
        </p>
      </Panel>

      <Panel title={urn ? '올린 모델' : '현장 모델'}>
        <ModelViewer urn={urn} />
      </Panel>
    </>
  );
}

export default function ModelPage() {
  return (
    <SiteShell
      title="3D 모델"
      description="Revit 모델을 돌려 보고 확대해서 봅니다. 부재를 누르면 정보가 나옵니다."
      showClock={false}
    >
      {() => <ModelBody />}
    </SiteShell>
  );
}
