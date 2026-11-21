#!/usr/bin/env node
/**
 * Аудит данных: построчная сверка «сырые Excel ↔ то, что на сайте».
 *
 * Проверяет:
 *   1. Расшифровка public/data/sales.enc.json текущим кодом доступа.
 *   2. Все строки всех .xlsx из src/rawData дошли до набора данных
 *      (с учётом правила дедупликации Д6, как в convert.mjs).
 *   3. Даты корректны (floor(serial), без таймзонного сдвига SheetJS).
 *   4. Суммы qty/₽ по агентам и meta совпадают.
 *
 * Запуск: npm run audit  (или: node scripts/audit.mjs)
 * Код доступа: ACCESS_PIN или scripts/access.pin — как в convert.
 * Exit code: 0 — всё сходится, 1 — есть расхождения.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'src', 'rawData');
const ENC_PATH = path.join(ROOT, 'public', 'data', 'sales.enc.json');
const PIN_PATH = path.join(__dirname, 'access.pin');
const req = createRequire(path.join(ROOT, 'package.json'));
const XLSX = req('xlsx');

const LO_SUBJECT = 'Ленинградская область';

const COL = {
  date: 'Дата',
  name: 'Наименование участника',
  subject: 'Субъект РФ',
  address: 'Адрес',
  cityDistrict: 'МД: Район города',
  channel: 'Канал продаж',
  product: 'БАД_Имя',
  network: 'Сеть',
  qty: 'Итог КОЛИЧЕСТВО, шт',
  sales: 'Итог СУММА ПРОДАЖ, руб.',
  city: 'Город',
  agent: 'Агент',
  pharmacyCode: 'Код аптеки',
};

const norm = (v) => (v == null ? '' : String(v).trim());

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Дата Excel = floor(serial) — детерминированно, без Date/таймзон. */
function isoDate(v) {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  const s = norm(v);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Math.floor(Number(s)) - 25569) * 86400000));
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  let m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) return m[3] + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[1]));
  return null;
}

/** Район ЛО из адреса — для сверки полей (не критично для аудита). */
function loDistrictFromAddress(address) {
  const m = address.match(/([А-ЯЁ][а-яё\-]+)\s+(?:р-н|район)/u);
  return m ? m[1] + ' район' : null;
}

function readPin() {
  let pin = process.env.ACCESS_PIN || '';
  if (!pin && fs.existsSync(PIN_PATH)) pin = fs.readFileSync(PIN_PATH, 'utf8').trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Код доступа не задан (ACCESS_PIN или scripts/access.pin)');
  return pin;
}

function parseFile(filePath, fileName) {
  const wb = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'data') ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });

  const headerIdx = rows.findIndex((r) => r && r.some((c) => norm(c) === COL.date));
  if (headerIdx < 0) throw new Error(`В ${fileName} не найдена строка заголовков`);
  const headers = rows[headerIdx].map(norm);
  const idx = {};
  headers.forEach((h, i) => { if (h && !(h in idx)) idx[h] = i; });

  const layout = idx[COL.pharmacyCode] != null ? 'd6' : 'personal';
  const addressIdx = layout === 'd6' ? idx[COL.pharmacyCode] + 1 : idx[COL.address];

  const get = (row, name) => {
    const j = idx[name];
    return j == null || j >= row.length ? null : row[j];
  };

  const records = [];
  let empty = 0, noDate = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === '')) { empty++; continue; }
    const d = isoDate(get(row, COL.date));
    if (!d) { noDate++; continue; }
    const agent = norm(get(row, COL.agent)) || '(без агента)';
    const subject = norm(get(row, COL.subject));
    const address = norm(addressIdx != null && addressIdx < row.length ? row[addressIdx] : null);
    let dst = norm(get(row, COL.cityDistrict));
    if (!dst && subject === LO_SUBJECT && address) dst = loDistrictFromAddress(address) ?? '';
    const city = norm(get(row, COL.city));
    records.push({
      d, m: d.slice(0, 7), a: agent, sub: subject || null,
      ct: !city || city === '-' ? null : city, dst: dst || null,
      ch: norm(get(row, COL.channel)) || null, p: norm(get(row, COL.product)),
      n: norm(get(row, COL.network)) || null, pt: norm(get(row, COL.name)),
      q: toNumber(get(row, COL.qty)), s: toNumber(get(row, COL.sales)),
    });
  }
  const agents = new Set(records.map((r) => r.a));
  return { fileName, records, agents, empty, noDate };
}

function stats(arr) {
  let q = 0, s = 0;
  for (const r of arr) { q += r.q; s += r.s; }
  return { rows: arr.length, q, s };
}

let failed = false;
function check(label, ok, detail) {
  console.log((ok ? '  [OK]  ' : '  [FAIL]') + ' ' + label + (detail ? ' — ' + detail : ''));
  if (!ok) failed = true;
}

function main() {
  // ---- 1. расшифровка файла сайта ----
  const pin = readPin();
  const enc = JSON.parse(fs.readFileSync(ENC_PATH, 'utf8'));
  const salt = Buffer.from(enc.salt, 'base64');
  const iv = Buffer.from(enc.iv, 'base64');
  const blob = Buffer.from(enc.data, 'base64');
  const key = crypto.pbkdf2Sync(pin, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(blob.subarray(blob.length - 16));
  const file = JSON.parse(
    Buffer.concat([decipher.update(blob.subarray(0, blob.length - 16)), decipher.final()]).toString('utf8')
  );
  const records = file.records;
  console.log('1) Расшифровка sales.enc.json: OK,', records.length, 'записей');

  // ---- 2. парсинг сырых Excel ----
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith('.xlsx')).sort();
  console.log('\n2) Сырые файлы в src/rawData:', files.length);
  const parsed = [];
  let skippedNoDate = 0, skippedEmpty = 0;
  for (const f of files) {
    const p = parseFile(path.join(RAW_DIR, f), f);
    console.log('  ' + f + ': строк ' + p.records.length + ', без даты ' + p.noDate + ', пустых ' + p.empty + ', агенты: ' + [...p.agents].join(', '));
    skippedNoDate += p.noDate;
    skippedEmpty += p.empty;
    parsed.push(p);
  }
  check('В сырых файлах нет строк без даты', skippedNoDate === 0, 'пропущено без даты: ' + skippedNoDate);

  // ---- 3. воспроизводим дедупликацию и сверяем построчно ----
  const personalAgents = new Set();
  for (const p of parsed) if (p.agents.size === 1) for (const a of p.agents) personalAgents.add(a);
  const taken = [];
  for (const p of parsed) for (const r of p.records) if (p.agents.size === 1 || !personalAgents.has(r.a)) taken.push(r);

  console.log('\n3) Построчная сверка (после правила дедупликации Д6):');
  const keyOf = (r) => [r.d, r.a, r.pt, r.p, r.q, r.s].join('|');
  const rawMap = new Map();
  for (const r of taken) { const k = keyOf(r); rawMap.set(k, (rawMap.get(k) || 0) + 1); }
  const recMap = new Map();
  for (const r of records) { const k = keyOf(r); recMap.set(k, (recMap.get(k) || 0) + 1); }

  let missing = 0, extra = 0;
  const examples = [];
  for (const [k, c] of rawMap) {
    const rc = recMap.get(k) || 0;
    if (rc < c) { missing += c - rc; if (examples.length < 5) examples.push('нет на сайте: ' + k); }
  }
  for (const [k, c] of recMap) {
    const rc = rawMap.get(k) || 0;
    if (rc < c) { extra += c - rc; if (examples.length < 10) examples.push('лишняя на сайте: ' + k); }
  }
  check('Количество строк', taken.length === records.length, taken.length + ' ↔ ' + records.length);
  check('Построчное совпадение (дата+агент+участник+БАД+qty+сумма)', missing === 0 && extra === 0, 'не найдено ' + missing + ', лишних ' + extra);
  for (const e of examples) console.log('        ' + e);

  // ---- 4. суммы по агентам ----
  console.log('\n4) Суммы по агентам:');
  const agg = (arr) => {
    const m = new Map();
    for (const r of arr) { const t = m.get(r.a) || { rows: 0, q: 0, s: 0 }; t.rows++; t.q += r.q; t.s += r.s; m.set(r.a, t); }
    return m;
  };
  const ra = agg(taken), sa = agg(records);
  for (const a of [...new Set([...ra.keys(), ...sa.keys()])].sort()) {
    const x = ra.get(a) || { rows: 0, q: 0, s: 0 };
    const y = sa.get(a) || { rows: 0, q: 0, s: 0 };
    const ok = x.rows === y.rows && x.q === y.q && x.s === y.s;
    check(a, ok, x.rows + '↔' + y.rows + ' строк, ' + x.q + '↔' + y.q + ' шт, ' + x.s + '↔' + y.s + ' ₽');
  }

  // ---- 5. meta и итоги ----
  const dates = records.map((r) => r.d).sort();
  const expectMeta = { from: dates[0], to: dates[dates.length - 1], rows: records.length };
  console.log('\n5) meta в файле сайта:');
  check('meta.rows', file.meta.rows === expectMeta.rows, file.meta.rows + ' ↔ ' + expectMeta.rows);
  check('meta.from', file.meta.from === expectMeta.from, file.meta.from + ' ↔ ' + expectMeta.from);
  check('meta.to', file.meta.to === expectMeta.to, file.meta.to + ' ↔ ' + expectMeta.to);

  const rawTotals = stats(taken), siteTotals = stats(records);
  console.log('\nИтого: ' + rawTotals.rows + '↔' + siteTotals.rows + ' строк, ' + rawTotals.q + '↔' + siteTotals.q + ' шт, ' + rawTotals.s + '↔' + siteTotals.s + ' ₽');
  if (failed) { console.log('\nАУДИТ: ЕСТЬ РАСХОЖДЕНИЯ'); process.exit(1); }
  console.log('\nАУДИТ ПРОЙДЕН: данные на сайте полностью соответствуют сырым таблицам');
}

main();

