#!/usr/bin/env node
/**
 * Конвертация Excel-выгрузок из src/rawData/*.xlsx -> public/data/sales.json
 *
 * Формат записей (см. src/types/sales.ts):
 *   { d, m, a, sub, ct, dst, ch, p, n, pt, q, s }
 *   d - дата YYYY-MM-DD, m - месяц YYYY-MM, a - агент, sub - субъект РФ,
 *   ct - город, dst - район (СПб из "МД: Район города", ЛО - из адреса),
 *   ch - канал продаж, p - БАД, n - сеть, pt - наименование участника,
 *   q - количество, s - сумма продаж. Бонусы не экспортируются (todo п.6).
 *
 * Правило дедупликации (todo п.2, п.5):
 *   - файл с одним агентом = персональный отчёт -> берём все строки;
 *   - файл с несколькими агентами (общий, напр. "Симарева Ольга окт Д6") ->
 *     берём только строки агентов, НЕ покрытых персональными файлами
 *     (сегодня это Морозова Анна и "!СПб- не определено").
 *     Так при появлении персонального файла Морозовой дубли исчезнут сами.
 *
 * Запуск: npm run convert
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'src', 'rawData');
const OUT_PATH = path.join(ROOT, 'public', 'data', 'sales.json');

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

function toYMD(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Excel serial (1900-система) -> YYYY-MM-DD */
function serialToYMD(n) {
  return toYMD(new Date(Math.round((n - 25569) * 86400000)));
}

function toISODate(v) {
  if (v instanceof Date && !isNaN(v)) return toYMD(v);
  if (typeof v === 'number' && Number.isFinite(v)) return serialToYMD(v);
  const s = norm(v);
  if (/^\d+$/.test(s)) return serialToYMD(Number(s));
  let m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) return `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  return null;
}

/** Район ЛО из адреса: "..., Всеволожский р-н, ..." -> "Всеволожский" */
function loDistrictFromAddress(address) {
  const m = address.match(/([А-ЯЁ][а-яё\-]+)\s+(?:р-н|район)/u);
  return m ? `${m[1]} район` : null;
}

function parseFile(filePath, fileName) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => n.trim().toLowerCase() === 'data') ?? wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerIdx = rows.findIndex((r) => r && r.some((c) => norm(c) === COL.date));
  if (headerIdx < 0) throw new Error(`В ${fileName} не найдена строка заголовков`);
  const headers = rows[headerIdx].map(norm);

  const idx = {};
  headers.forEach((h, i) => {
    if (h && !(h in idx)) idx[h] = i;
  });

  // Д6: колонка адреса идёт сразу после "Код аптеки" и не имеет заголовка
  const layout = idx[COL.pharmacyCode] != null ? 'd6' : 'personal';
  const addressIdx =
    layout === 'd6' ? idx[COL.pharmacyCode] + 1 : idx[COL.address];

  const get = (row, name) => {
    const j = idx[name];
    return j == null || j >= row.length ? null : row[j];
  };

  const records = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((c) => c == null || c === '')) continue;
    const date = toISODate(get(row, COL.date));
    const agent = norm(get(row, COL.agent)) || '(без агента)';
    const subject = norm(get(row, COL.subject)).replace(/^г\s*[.]?\s*/u, '');
    const address = norm(addressIdx != null && addressIdx < row.length ? row[addressIdx] : null);
    let dst = norm(get(row, COL.cityDistrict)).replace(/^р-\s*н\s+/u, '');
    if (!dst && subject === LO_SUBJECT && address) dst = loDistrictFromAddress(address) ?? '';
    const city = norm(get(row, COL.city));
    const q = toNumber(get(row, COL.qty));
    const s = toNumber(get(row, COL.sales));
    if (date == null) {
      console.warn(`  ! ${fileName}: строка ${i + 1} без даты - пропущена`);
      continue;
    }
    records.push({
      d: date,
      m: date.slice(0, 7),
      a: agent,
      sub: subject || null,
      ct: !city || city === '-' ? null : city,
      dst: dst || null,
      ch: norm(get(row, COL.channel)) || null,
      p: norm(get(row, COL.product)),
      n: norm(get(row, COL.network)) || null,
      pt: norm(get(row, COL.name)),
      q,
      s,
    });
  }

  const agents = new Set(records.map((r) => r.a));
  return { fileName, sheetName, layout, records, agents };
}
function fileStats(records) {
  let q = 0;
  let s = 0;
  for (const r of records) {
    q += r.q;
    s += r.s;
  }
  return { rows: records.length, q, s };
}

function main() {
  if (!fs.existsSync(RAW_DIR)) throw new Error(`Нет папки ${RAW_DIR}`);
  const files = fs
    .readdirSync(RAW_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    .sort();
  if (files.length === 0) throw new Error(`В ${RAW_DIR} нет .xlsx файлов`);

  console.log(`Файлов в ${path.relative(ROOT, RAW_DIR)}: ${files.length}`);
  const parsed = files.map((f) => {
    const p = parseFile(path.join(RAW_DIR, f), f);
    console.log(
      `  ${f} [${p.layout}] лист "${p.sheetName}": строк ${p.records.length}, агентов: ${[...p.agents].join(', ')}`
    );
    return p;
  });

  // Персональные файлы = файлы ровно с одним агентом
  const personalAgents = new Set();
  for (const p of parsed) {
    if (p.agents.size === 1) for (const a of p.agents) personalAgents.add(a);
  }

  const taken = [];
  for (const p of parsed) {
    for (const r of p.records) {
      if (p.agents.size === 1 || !personalAgents.has(r.a)) taken.push(r);
    }
  }

  // Сверка: персональный файл vs общий (Д6) по агентам
  const aggregateFiles = parsed.filter((p) => p.agents.size > 1);
  if (aggregateFiles.length > 0 && personalAgents.size > 0) {
    console.log('\nСверка персональных файлов с общим(и):');
    for (const a of personalAgents) {
      const personal = parsed.filter((p) => p.agents.has(a) && p.agents.size === 1);
      const perStats = fileStats(personal.flatMap((p) => p.records.filter((r) => r.a === a)));
      const aggStats = fileStats(
        aggregateFiles.flatMap((p) => p.records.filter((r) => r.a === a))
      );
      const same =
        aggStats.rows === 0 ||
        (perStats.rows === aggStats.rows &&
          perStats.q === aggStats.q &&
          perStats.s === aggStats.s);
      console.log(
        `  ${a}: персонально ${perStats.rows} строк / ${perStats.q} шт / ${perStats.s} ₽` +
          (aggStats.rows > 0
            ? ` | в общем ${aggStats.rows} строк / ${aggStats.q} шт / ${aggStats.s} ₽` +
              (same ? ' - совпадает' : '  ! РАСХОЖДЕНИЕ')
            : '')
      );
    }
  }

  // Итоги по агентам
  const totals = new Map();
  for (const r of taken) {
    const t = totals.get(r.a) ?? { rows: 0, q: 0, s: 0 };
    t.rows += 1;
    t.q += r.q;
    t.s += r.s;
    totals.set(r.a, t);
  }
  console.log('\nЗаписей в итоговом наборе:');
  for (const [a, t] of [...totals.entries()].sort((x, y) => y[1].s - x[1].s)) {
    console.log(`  ${a}: ${t.rows} строк / ${t.q} шт / ${t.s} ₽`);
  }

  const total = fileStats(taken);
  const dates = taken.map((r) => r.d).filter(Boolean);
  const meta = {
    from: dates.reduce((m, d) => (d < m ? d : m)),
    to: dates.reduce((m, d) => (d > m ? d : m)),
    rows: total.rows,
  };

  taken.sort(
    (x, y) =>
      x.d.localeCompare(y.d) ||
      x.a.localeCompare(y.a, 'ru') ||
      x.pt.localeCompare(y.pt, 'ru') ||
      x.p.localeCompare(y.p, 'ru')
  );

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify({ meta, records: taken }, null, 1) + '\n', 'utf8');

  console.log(
    `\nИтого: ${meta.rows} строк, ${total.q} шт, ${total.s} ₽, период ${meta.from}..${meta.to}`
  );
  console.log(`Записано: ${path.relative(ROOT, OUT_PATH)}`);
}

main();

