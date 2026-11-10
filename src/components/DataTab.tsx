import { useMemo, useState } from 'react';
import type { SaleRecord } from '../types/sales';
import { groupSum } from '../data/sales';

const fmtInt = new Intl.NumberFormat('ru-RU');

function isoWeek(d: string): string {
  const dt = new Date(d + 'T00:00:00Z');
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const fDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDay + 3);
  const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 864e5));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function Bars({ title, items, color }: { title: string; items: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const shown = items.slice(0, 8);
  return (
    <div className="chart">
      <h4>{title}</h4>
      {shown.length === 0 && <p className="chart__empty">Нет данных по выбранным фильтрам</p>}
      <div className="chart__rows">
        {shown.map((i) => (
          <div className="bar-row" key={i.label}>
            <span className="bar-row__label" title={i.label}>{i.label}</span>
            <div className="bar-row__track">
              <div className="bar-row__fill" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
            </div>
            <span className="bar-row__value">{fmtInt.format(i.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DataTab({ records }: { records: SaleRecord[] }) {
  const [fSub, setFSub] = useState('all');
  const [fCh, setFCh] = useState('all');
  const [fNet, setFNet] = useState('all');
  const [fProd, setFProd] = useState('all');

  const subjects = useMemo(() => [...new Set(records.map((r) => r.sub))].sort(), [records]);
  const channels = useMemo(() => [...new Set(records.map((r) => r.ch))].sort(), [records]);
  const networks = useMemo(() => [...new Set(records.map((r) => r.n))].sort(), [records]);
  const products = useMemo(() => [...new Set(records.map((r) => r.p))].sort(), [records]);

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (fSub === 'all' || r.sub === fSub) &&
          (fCh === 'all' || r.ch === fCh) &&
          (fNet === 'all' || r.n === fNet) &&
          (fProd === 'all' || r.p === fProd),
      ),
    [records, fSub, fCh, fNet, fProd],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, r) => ({ q: a.q + r.q, s: a.s + r.s, b: a.b + r.b, pt: a.pt.add(r.pt) }),
        { q: 0, s: 0, b: 0, pt: new Set<string>() },
      ),
    [filtered],
  );

  const byProduct = useMemo(() => groupSum(filtered, (r) => r.p, (r) => r.s), [filtered]);
  const byNetwork = useMemo(() => groupSum(filtered, (r) => r.n, (r) => r.s), [filtered]);
  const bySubject = useMemo(() => groupSum(filtered, (r) => r.sub, (r) => r.s), [filtered]);
  const byDistrict = useMemo(
    () => groupSum(filtered.filter((r) => r.dst), (r) => r.dst ?? '', (r) => r.s),
    [filtered],
  );
  const byWeek = useMemo(() => {
    const arr = groupSum(filtered, (r) => isoWeek(r.d), (r) => r.s).sort((a, b) => a.label.localeCompare(b.label));
    return arr;
  }, [filtered]);

  const participants = useMemo(() => {
    const m = new Map<string, { name: string; net: string; city: string; sub: string; q: number; s: number; b: number }>();
    for (const r of filtered) {
      const cur = m.get(r.pt) ?? { name: r.pt, net: r.n, city: r.ct ?? '—', sub: r.sub, q: 0, s: 0, b: 0 };
      cur.q += r.q; cur.s += r.s; cur.b += r.b;
      m.set(r.pt, cur);
    }
    return [...m.values()].sort((a, b) => b.s - a.s);
  }, [filtered]);

  return (
    <div className="data-tab">
      <div className="data-tab__filters">
        <label className="field field--light">
          <span>Субъект РФ</span>
          <select value={fSub} onChange={(e) => setFSub(e.target.value)} className="field__select">
            <option value="all">Все</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field field--light">
          <span>Канал</span>
          <select value={fCh} onChange={(e) => setFCh(e.target.value)} className="field__select">
            <option value="all">Все</option>
            {channels.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field field--light">
          <span>Сеть</span>
          <select value={fNet} onChange={(e) => setFNet(e.target.value)} className="field__select">
            <option value="all">Все</option>
            {networks.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field field--light">
          <span>Продукт (БАД)</span>
          <select value={fProd} onChange={(e) => setFProd(e.target.value)} className="field__select">
            <option value="all">Все</option>
            {products.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" className="data-tab__reset" onClick={() => { setFSub('all'); setFCh('all'); setFNet('all'); setFProd('all'); }}>
          Сбросить фильтры
        </button>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi__value">{fmtInt.format(totals.s)} ₽</span><span className="kpi__label">сумма продаж</span></div>
        <div className="kpi"><span className="kpi__value">{fmtInt.format(totals.q)}</span><span className="kpi__label">штук продано</span></div>
        <div className="kpi"><span className="kpi__value">{fmtInt.format(totals.b)} ₽</span><span className="kpi__label">бонусы</span></div>
        <div className="kpi"><span className="kpi__value">{totals.pt.size}</span><span className="kpi__label">участников</span></div>
        <div className="kpi"><span className="kpi__value">{filtered.length}</span><span className="kpi__label">строк продаж</span></div>
      </div>

      <div className="charts-grid">
        <Bars title="Продажи по продуктам, ₽" items={byProduct} color="#a9b068" />
        <Bars title="Продажи по сетям, ₽" items={byNetwork} color="#2e7d5b" />
        <Bars title="Продажи по субъектам, ₽" items={bySubject} color="#173f4d" />
        <Bars title="Продажи по районам СПб, ₽" items={byDistrict} color="#cc8e2a" />
        <Bars title="Динамика по неделям, ₽" items={byWeek} color="#b0533c" />
      </div>

      <div className="table-block table-block--data">
        <h3>Участники продаж{filtered.length !== records.length ? ` · отфильтровано ${filtered.length} из ${records.length}` : ''}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Участник</th><th>Сеть</th><th>Город</th><th>Субъект</th><th className="num">Шт</th><th className="num">Сумма, ₽</th><th className="num">Бонус, ₽</th></tr>
            </thead>
            <tbody>
              {participants.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td>{p.net}</td>
                  <td>{p.city}</td>
                  <td>{p.sub}</td>
                  <td className="num">{fmtInt.format(p.q)}</td>
                  <td className="num">{fmtInt.format(p.s)}</td>
                  <td className="num">{fmtInt.format(p.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
