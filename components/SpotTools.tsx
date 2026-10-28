'use client';

/**
 * 3D 모델 위 지점 관리 — 지점 등록, QR 코드, 사진 쌓기.
 *
 * 흐름: 지점 등록 → 모델을 눌러 위치 찍기 → 이름 입력 → QR 을 출력해 현장에 붙인다 →
 *       현장에서 QR 을 찍으면 이 화면이 그 지점으로 열린다 → 사진을 찍으면 그 지점에 쌓인다.
 */

import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { Panel } from '@/components/ui';
import {
  addShot,
  loadShots,
  removeShot,
  removeSpot,
  shrinkImage,
  spotLink,
  type Shot,
  type Spot,
} from '@/lib/spots';

const clock = (ms: number) =>
  new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function SpotTools({
  spots,
  placing,
  onTogglePlacing,
  pending,
  onConfirmPending,
  onCancelPending,
  selectedId,
  onSelect,
}: {
  spots: Spot[];
  placing: boolean;
  onTogglePlacing: () => void;
  pending: boolean;
  onConfirmPending: (name: string) => void;
  onCancelPending: () => void;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const [name, setName] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [qr, setQr] = useState<string>('');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = spots.find((s) => s.id === selectedId);

  useEffect(() => {
    const sync = () => setShots(loadShots());
    sync();
    window.addEventListener('remigo-spots', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('remigo-spots', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    setMsg('');
    if (!selected) {
      setQr('');
      return;
    }
    let alive = true;
    QRCode.toDataURL(spotLink(selected, window.location.origin), { width: 320, margin: 1 }).then(
      (u) => alive && setQr(u),
    );
    return () => {
      alive = false;
    };
  }, [selected]);

  async function onPhoto(file: File | undefined) {
    if (!file || !selected) return;
    if (fileRef.current) fileRef.current.value = '';
    try {
      const dataUrl = await shrinkImage(file);
      const ok = addShot(selected.id, dataUrl, note.trim());
      if (ok) {
        setNote('');
        setMsg('');
      } else {
        setMsg('저장 공간이 가득 찼어요. 오래된 사진을 지우고 다시 시도해 주세요.');
      }
    } catch {
      setMsg('사진을 읽지 못했어요. 다른 사진으로 시도해 주세요.');
    }
  }

  const mine = shots.filter((s) => s.spotId === selectedId).sort((a, b) => b.at - a.at);

  return (
    <Panel title="지점과 사진">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={onTogglePlacing} disabled={pending}>
          {placing ? '지점 찍기 취소' : '지점 등록하기'}
        </button>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-concrete-wet)' }}>
          {placing
            ? '위 3D 모델에서 사진을 남길 자리를 한 번 눌러 주세요.'
            : pending
              ? '이 자리의 이름을 정해 주세요.'
              : `지점 ${spots.length}개`}
        </span>
      </div>

      {pending && (
        <form
          style={{ display: 'flex', gap: 8, marginTop: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) return;
            onConfirmPending(n);
            setName('');
          }}
        >
          <input
            className="input"
            placeholder="예: 2층 계단참"
            value={name}
            maxLength={30}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!name.trim()}>
            등록
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={onCancelPending}>
            취소
          </button>
        </form>
      )}

      {spots.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {spots.map((s) => (
            <button
              key={s.id}
              type="button"
              className="chip"
              aria-pressed={s.id === selectedId}
              onClick={() => onSelect(s.id === selectedId ? undefined : s.id)}
            >
              📍 {s.name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--color-line-strong)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <strong>{selected.name}</strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (window.confirm(`"${selected.name}" 지점과 사진을 지울까요?`)) {
                  removeSpot(selected.id);
                  onSelect(undefined);
                }
              }}
            >
              지점 지우기
            </button>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => void onPhoto(e.target.files?.[0])}
          />
          <div style={{ display: 'flex', gap: 8, margin: '10px 0 6px', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 160 }}
              placeholder="메모 (선택)"
              value={note}
              maxLength={80}
              onChange={(e) => setNote(e.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
              사진 찍기 · 올리기
            </button>
          </div>
          {msg && <p style={{ fontSize: '0.82rem', color: 'var(--color-bad)', margin: '0 0 8px' }}>{msg}</p>}

          {mine.length === 0 ? (
            <p style={{ fontSize: '0.84rem', color: 'var(--color-concrete-mid)', margin: '6px 0 0' }}>
              아직 이 지점에 찍은 사진이 없어요.
            </p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
              {mine.map((s) => (
                <figure key={s.id} style={{ margin: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.dataUrl}
                    alt={s.note || `${selected.name} 사진`}
                    style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius-sharp)' }}
                  />
                  <figcaption style={{ fontSize: '0.74rem', color: 'var(--color-concrete-wet)', marginTop: 3 }}>
                    {clock(s.at)}
                    {s.note ? ` · ${s.note}` : ''}{' '}
                    <button
                      type="button"
                      onClick={() => removeShot(s.id)}
                      style={{ border: 0, background: 'none', color: 'var(--color-bad)', cursor: 'pointer', padding: 0 }}
                    >
                      삭제
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`${selected.name} QR 코드`} width={120} height={120} />
            )}
            <div style={{ fontSize: '0.8rem', color: 'var(--color-concrete-wet)', maxWidth: 280 }}>
              <p style={{ margin: '0 0 6px' }}>
                이 QR 을 출력해 이 자리에 붙이세요. 휴대폰으로 찍으면 이 지점이 열리고 사진을 바로 남길 수 있어요.
              </p>
              {qr && (
                <a href={qr} download={`QR-${selected.name}.png`} className="btn btn-outline btn-sm">
                  QR 이미지 내려받기
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <p style={{ fontSize: '0.76rem', color: 'var(--color-concrete-mid)', margin: '14px 0 0' }}>
        지점과 사진은 지금 쓰는 브라우저에 저장돼요(시연용). 다른 기기와 같이 보려면 공유 저장소 연결이 필요해요.
      </p>
    </Panel>
  );
}
