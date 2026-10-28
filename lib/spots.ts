/**
 * 3D 모델 위의 지점(Spot)과 그 지점에서 찍은 사진(Shot).
 *
 * 지점은 모델 위 좌표 하나와 이름이다. QR 코드는 이 지점의 주소를 담고, 현장에서 QR 을
 * 찍으면 그 지점 화면이 열려 사진이 그 지점에 쌓인다.
 *
 * 저장은 브라우저(localStorage)다 — 시연 모드와 같다. 다른 기기에서 같이 보려면 공유 저장소가 필요하다.
 * 지점의 이름과 좌표는 QR 주소에도 실어 두어, 다른 기기에서 열어도 지점이 무엇인지는 알 수 있다.
 */

export interface Spot {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  createdAt: number;
}

export interface Shot {
  id: string;
  spotId: string;
  /** 줄여서 JPEG 로 저장한 사진 */
  dataUrl: string;
  note: string;
  at: number;
}

const SPOT_KEY = 'remigo.spots';
const SHOT_KEY = 'remigo.shots';
/** 사진 한 장의 긴 변 상한(px). 브라우저 저장소가 5MB 안팎이라 작게 줄인다 */
const MAX_EDGE = 900;

function read<T>(key: string): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
    window.dispatchEvent(new Event('remigo-spots'));
    return true;
  } catch {
    return false;
  }
}

export const loadSpots = () => read<Spot>(SPOT_KEY);
export const loadShots = () => read<Shot>(SHOT_KEY);

const rid = () => Math.random().toString(36).slice(2, 8);

export function addSpot(input: { id?: string; name: string; x: number; y: number; z: number }): Spot {
  const list = loadSpots();
  const existing = input.id ? list.find((s) => s.id === input.id) : undefined;
  if (existing) return existing;
  const spot: Spot = { id: input.id ?? rid(), name: input.name, x: input.x, y: input.y, z: input.z, createdAt: Date.now() };
  write(SPOT_KEY, [...list, spot]);
  return spot;
}

export function removeSpot(id: string) {
  write(SPOT_KEY, loadSpots().filter((s) => s.id !== id));
  write(SHOT_KEY, loadShots().filter((s) => s.spotId !== id));
}

/** 저장 공간이 모자라면 false */
export function addShot(spotId: string, dataUrl: string, note: string): boolean {
  const shot: Shot = { id: rid(), spotId, dataUrl, note, at: Date.now() };
  return write(SHOT_KEY, [...loadShots(), shot]);
}

export function removeShot(id: string) {
  write(SHOT_KEY, loadShots().filter((s) => s.id !== id));
}

/** 사진 파일을 줄여서 JPEG data URL 로 만든다 */
export function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image'));
    };
    img.src = url;
  });
}

/** QR 에 넣을 주소 — 이름과 좌표를 같이 실어서 다른 기기에서 열어도 지점을 알 수 있게 한다 */
export function spotLink(spot: Spot, origin: string): string {
  const q = new URLSearchParams({
    spot: spot.id,
    n: spot.name,
    p: [spot.x, spot.y, spot.z].map((v) => v.toFixed(3)).join(','),
  });
  return `${origin}/site/model?${q.toString()}`;
}

export function parseSpotParams(search: string): { id: string; name: string; x: number; y: number; z: number } | null {
  const q = new URLSearchParams(search);
  const id = q.get('spot');
  const p = q.get('p')?.split(',').map(Number);
  if (!id || !/^[a-z0-9]{3,12}$/.test(id) || !p || p.length !== 3 || p.some((v) => !Number.isFinite(v))) return null;
  return { id, name: (q.get('n') ?? '지점').slice(0, 40), x: p[0], y: p[1], z: p[2] };
}
