import type { SalesFile, SaleRecord } from '../types/sales';

const PBKDF2_ITERATIONS = 100000;

interface EncFile {
  salt: string; // base64
  iv: string;   // base64
  data: string; // base64: ciphertext + GCM tag
}

let cache: { pin: string; records: SaleRecord[] } | null = null;

function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new ArrayBuffer(bin.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return out;
}

// AES-256-GCM, ключ = PBKDF2-SHA256(код, salt, 100k) — зеркально к scripts/convert.mjs
async function deriveKey(pin: string, saltB64: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

async function fetchEncFile(): Promise<EncFile> {
  const r = await fetch('data/sales.enc.json');
  if (!r.ok) throw new Error(`Не удалось загрузить данные (${r.status})`);
  return (await r.json()) as EncFile;
}

// Проверка кода: неверный код падает на расшифровке (GCM auth tag). Без кэша.
export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const enc = await fetchEncFile();
    const key = await deriveKey(pin, enc.salt);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
    return true;
  } catch {
    return false;
  }
}

// Загружает и расшифровывает выгрузку продаж. Кэш привязан к коду.
export async function loadSales(pin: string): Promise<SaleRecord[]> {
  if (cache && cache.pin === pin) return cache.records;
  const enc = await fetchEncFile();
  const key = await deriveKey(pin, enc.salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(enc.iv) }, key, b64ToBytes(enc.data));
  const file = JSON.parse(new TextDecoder().decode(plain)) as SalesFile;
  cache = { pin, records: file.records };
  return cache.records;
}

export function groupSum(
  records: SaleRecord[],
  key: (r: SaleRecord) => string,
  val: (r: SaleRecord) => number,
): { label: string; value: number }[] {
  const m = new Map<string, number>();
  for (const r of records) {
    const k = key(r);
    m.set(k, (m.get(k) ?? 0) + val(r));
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}
