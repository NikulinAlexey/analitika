import { useMemo, useState } from 'react';
import type { SaleRecord } from '../types/sales';
import { groupSum } from '../data/sales';

const fmtInt = new Intl.NumberFormat('ru-RU');

const networkLabel = (r: SaleRecord) => r.n === 'Others' ? r.pt : r.n;

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

function FilterField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field field--light">
      <span>{label}</span>
      <div className="field__row">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="field__select">
          <option value="all">Все</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="field__reset"
          title="Сбросить фильтр"
          aria-label={`Сбросить фильтр: ${label}`}
          disabled={value === 'all'}
          onClick={() => onChange('all')}
        >
          ×
        </button>
      </div>
    </label>
  );
}

interface Props {
  records: SaleRecord[];
  month: string;
}

export default function DataTab({ records, month }: Props) {
  const [fAgent, setFAgent] = useState('all');
  const [fSub, setFSub] = useState('all');
  const [fCh, setFCh] = useState('all');
  const [fNet, setFNet] = useState('all');
  const [fProd, setFProd] = useState('all');

  const agents = useMemo(() => {
    const set = [...new Set(records.map((r) => r.a))].sort((a, b) => a.localeCompare(b, 'ru'));
    // служебные строки ("!СПб- не определено") — в конец списка
    return [...set.filter((s) => !s.startsWith('!')), ...set.filter((s) => s.startsWith('!'))];
  }, [records]);
  const subjects = useMemo(() => [...new Set(records.map((r) => r.sub))].sort(), [records]);
  const channels = useMemo(() => [...new Set(records.map((r) => r.ch))].sort(), [records]);
  const networks = useMemo(() => [...new Set(records.map(networkLabel))].sort((a, b) => a.localeCompare(b, 'ru')), [records]);
  const products = useMemo(() => [...new Set(records.map((r) => r.p))].sort(), [records]);

  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (month === 'all' || r.m === month) &&
          (fAgent === 'all' || r.a === fAgent) &&
          (fSub === 'all' || r.sub === fSub) &&
          (fCh === 'all' || r.ch === fCh) &&
          (fNet === 'all' || networkLabel(r) === fNet) &&
          (fProd === 'all' || r.p === fProd),
      ),
    [records, month, fAgent, fSub, fCh, fNet, fProd],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (a, r) => ({ q: a.q + r.q, s: a.s + r.s, pt: a.pt.add(r.pt) }),
        { q: 0, s: 0, pt: new Set<string>() },
      ),
    [filtered],
  );

  const byProduct = useMemo(() => groupSum(filtered, (r) => r.p, (r) => r.s), [filtered]);
  const byNetwork = useMemo(() => groupSum(filtered, networkLabel, (r) => r.s), [filtered]);
  const bySubject = useMemo(() => groupSum(filtered, (r) => r.sub, (r) => r.s), [filtered]);
  const byDistrict = useMemo(
    () => groupSum(filtered.filter((r) => r.dst), (r) => r.dst ?? '', (r) => r.s),
    [filtered],
  );
  const byProductQty = useMemo(() => groupSum(filtered, (r) => r.p, (r) => r.q), [filtered]);
  const byNetworkQty = useMemo(() => groupSum(filtered, networkLabel, (r) => r.q), [filtered]);
  const bySubjectQty = useMemo(() => groupSum(filtered, (r) => r.sub, (r) => r.q), [filtered]);
  const byDistrictQty = useMemo(
    () => groupSum(filtered.filter((r) => r.dst), (r) => r.dst ?? '', (r) => r.q),
    [filtered],
  );

  const participants = useMemo(() => {
    const m = new Map<string, { name: string; net: string; city: string; sub: string; q: number; s: number }>();
    for (const r of filtered) {
      const cur = m.get(r.pt) ?? { name: r.pt, net: r.n, city: r.ct ?? '—', sub: r.sub, q: 0, s: 0 };
      cur.q += r.q; cur.s += r.s;
      m.set(r.pt, cur);
    }
    return [...m.values()].sort((a, b) => b.s - a.s);
  }, [filtered]);

  return (
    <div className="data-tab">
      <div className="data-tab__filters">
        <FilterField label="Агент" value={fAgent} options={agents} onChange={setFAgent} />
        <FilterField label="Субъект РФ" value={fSub} options={subjects} onChange={setFSub} />
        <FilterField label="Канал" value={fCh} options={channels} onChange={setFCh} />
        <FilterField label="Сеть / организация" value={fNet} options={networks} onChange={setFNet} />
        <FilterField label="Продукт (БАД)" value={fProd} options={products} onChange={setFProd} />
        <button type="button" className="data-tab__reset" onClick={() => { setFAgent('all'); setFSub('all'); setFCh('all'); setFNet('all'); setFProd('all'); }}>
          Сбросить фильтры
        </button>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi__value">{fmtInt.format(totals.s)} ₽</span><span className="kpi__label">сумма продаж</span></div>
        <div className="kpi"><span className="kpi__value">{fmtInt.format(totals.q)}</span><span className="kpi__label">штук продано</span></div>
        <div className="kpi"><span className="kpi__value">{totals.pt.size}</span><span className="kpi__label">участников</span></div>
        <div className="kpi"><span className="kpi__value">{filtered.length}</span><span className="kpi__label">строк продаж</span></div>
      </div>

      <div className="charts-grid">
        <Bars title="Продажи по продуктам, ₽" items={byProduct} color="#a9b068" />
        <Bars title="Продажи по сетям / организациям, ₽" items={byNetwork} color="#2e7d5b" />
        <Bars title="Продажи по субъектам, ₽" items={bySubject} color="#173f4d" />
        <Bars title="Продажи по районам СПб, ₽" items={byDistrict} color="#cc8e2a" />
        <Bars title="Продажи по продуктам, шт." items={byProductQty} color="#a9b068" />
        <Bars title="Продажи по сетям / организациям, шт." items={byNetworkQty} color="#2e7d5b" />
        <Bars title="Продажи по субъектам, шт." items={bySubjectQty} color="#173f4d" />
        <Bars title="Продажи по районам СПб, шт." items={byDistrictQty} color="#cc8e2a" />
      </div>

      <div className="table-block table-block--data">
        <h3>Участники продаж{filtered.length !== records.length ? ` · отфильтровано ${filtered.length} из ${records.length}` : ''}</h3>
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Участник</th><th>Сеть</th><th>Город</th><th>Субъект</th><th className="num">Шт</th><th className="num">Сумма, ₽</th></tr>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
