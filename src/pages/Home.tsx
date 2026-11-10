import { useEffect, useMemo, useState } from 'react';
import type { MapData, DistrictStats, MapObject } from '../types';
import type { SaleRecord } from '../types/sales';
import { loadSales } from '../data/sales';
import MapView from '../components/MapView';
import DataTab from '../components/DataTab';
import '@/styles/app.scss';

const fmtInt = new Intl.NumberFormat('ru-RU');

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const monthLabel = (key: string) => {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
};

export default function Home() {
  const [tab, setTab] = useState<'map' | 'data'>('map');
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [objects, setObjects] = useState<MapObject[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [month, setMonth] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [showPharmacies, setShowPharmacies] = useState(true);
  const [showClinics, setShowClinics] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    fetch('data/spb-map.json').then((r) => r.json()).then(setMapData);
    fetch('data/objects.json').then((r) => r.json()).then(setObjects);
    loadSales().then(setSales);
  }, []);

  const months = useMemo(() => [...new Set(sales.map((r) => r.m))].sort(), [sales]);
  const byMonth = useMemo(
    () => (month === 'all' ? sales : sales.filter((r) => r.m === month)),
    [sales, month],
  );

  const packsByDistrict = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of byMonth) {
      if (r.dst) m.set(r.dst, (m.get(r.dst) ?? 0) + r.q);
    }
    return m;
  }, [byMonth]);

  const stats: DistrictStats[] = useMemo(() => {
    if (!mapData) return [];
    const counts = (t: MapObject['type'], d: string) => objects.filter((o) => o.type === t && o.district === d).length;
    const salesBy = new Map<string, { q: number; s: number }>();
    for (const r of byMonth) {
      if (!r.dst) continue;
      const cur = salesBy.get(r.dst) ?? { q: 0, s: 0 };
      cur.q += r.q; cur.s += r.s;
      salesBy.set(r.dst, cur);
    }
    const all = [
      ...mapData.districts.map((d) => ({ ...d, region: 'Санкт-Петербург' as const })),
      ...mapData.loDistricts.map((d) => ({ ...d, region: 'Ленинградская область' as const })),
    ];
    const totalAmount = [...salesBy.values()].reduce((a, v) => a + v.s, 0);
    const list: DistrictStats[] = all.map((d) => {
      const rec = salesBy.get(d.name);
      const amount = rec?.s ?? 0;
      return {
        name: d.name,
        region: d.region,
        packs: rec?.q ?? 0,
        amount,
        clinics: counts('clinic', d.name),
        pharmacies: counts('pharmacy', d.name),
        share: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
        rank: 0,
      };
    });
    [...list].sort((a, b) => b.packs - a.packs).forEach((s, i) => { s.rank = i + 1; });
    return list;
  }, [mapData, objects, byMonth]);

  const total = useMemo(
    () => stats.reduce((acc, s) => ({ packs: acc.packs + s.packs, amount: acc.amount + s.amount }), { packs: 0, amount: 0 }),
    [stats],
  );

  const selectedStats = selected ? stats.find((s) => s.name === selected) ?? null : null;
  const tableRows = useMemo(() => [...stats].sort((a, b) => b.amount - a.amount), [stats]);

  const handleSelect = (name: string) => {
    setSelected((prev) => (prev === name ? null : name));
    setPanelOpen(true);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M13 2a11 11 0 1 0 0 22 11 11 0 0 0 0-22z" fill="#173f4d" />
              <path d="M13 6.2l1.6 4.6 4.9.1-3.9 2.9 1.4 4.7L13 15.5l-4 2.9 1.4-4.7-3.9-2.9 4.9-.1L13 6.2z" fill="#e9c46a" />
            </svg>
          </span>
          <div>
            <h1>Медицинская аналитика</h1>
            <p>Северо-Западный федеральный округ</p>
          </div>
        </div>
        <div className="topbar__controls">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'map'} className={`tab ${tab === 'map' ? 'is-active' : ''}`} onClick={() => setTab('map')}>Карта</button>
            <button type="button" role="tab" aria-selected={tab === 'data'} className={`tab ${tab === 'data' ? 'is-active' : ''}`} onClick={() => setTab('data')}>Данные</button>
          </div>
          {tab === 'map' && (
            <>
              <label className="field">
                <span>Период</span>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="field__select">
                  <option value="all">Весь период</option>
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                </select>
              </label>
              <button type="button" className={`chip chip--pharm ${showPharmacies ? 'is-on' : ''}`} aria-pressed={showPharmacies} onClick={() => setShowPharmacies((v) => !v)}>
                Аптеки
              </button>
              <button type="button" className={`chip chip--clinic ${showClinics ? 'is-on' : ''}`} aria-pressed={showClinics} onClick={() => setShowClinics((v) => !v)}>
                Поликлиники
              </button>
            </>
          )}
        </div>
      </header>

      {tab === 'data' ? (
        <DataTab records={sales} />
      ) : (
        <main className="layout">
          <section className={`map-wrap ${panelOpen ? 'is-narrow' : ''}`}>
            {mapData && (
              <MapView
                mapData={mapData}
                objects={objects}
                packsByDistrict={packsByDistrict}
                selected={selected}
                onSelect={handleSelect}
                showPharmacies={showPharmacies}
                showClinics={showClinics}
              />
            )}
            <div className="legend legend--dark" aria-label="Легенда">
              <span className="legend__title">Продажи, шт</span>
              <div className="legend__bar" />
              <div className="legend__scale"><span>0</span><span>{fmtInt.format(100)}+</span></div>
            </div>
            <button type="button" className={`panel-toggle ${panelOpen ? 'is-on' : ''}`} onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen}>
              {panelOpen ? 'К карте' : 'Статистика'}
            </button>
          </section>

          <aside className={`panel ${panelOpen ? 'is-open' : ''}`} aria-label="Статистика по районам">
            {selectedStats && (
              <div className="district-card">
                <div className="district-card__head">
                  <div>
                    <span className="district-card__region">{selectedStats.region}</span>
                    <h2>{selectedStats.name}</h2>
                  </div>
                  <button type="button" className="district-card__close" onClick={() => setSelected(null)} aria-label="Снять выделение">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                  </button>
                </div>
                <div className="district-card__grid">
                  <div className="metric"><span className="metric__value">{fmtInt.format(selectedStats.packs)}</span><span className="metric__label">штук продано</span></div>
                  <div className="metric"><span className="metric__value">{fmtInt.format(selectedStats.amount)} ₽</span><span className="metric__label">сумма продаж</span></div>
                  <div className="metric"><span className="metric__value">{selectedStats.pharmacies}</span><span className="metric__label">аптек на карте</span></div>
                  <div className="metric"><span className="metric__value">{selectedStats.clinics}</span><span className="metric__label">поликлиник</span></div>
                  <div className="metric"><span className="metric__value">{selectedStats.share.toFixed(1)}%</span><span className="metric__label">доля в продажах региона</span></div>
                  <div className="metric"><span className="metric__value">№ {selectedStats.rank}</span><span className="metric__label">по продажам региона</span></div>
                </div>
              </div>
            )}

            <div className="totals">
              <div><span className="totals__label">Итого{month === 'all' ? '' : ` за ${monthLabel(month)}`}</span><strong>{fmtInt.format(total.packs)} шт</strong></div>
              <div><strong>{fmtInt.format(total.amount)} ₽</strong></div>
            </div>

            <div className="table-block">
              <h3>Продажи по районам{month === 'all' ? '' : ` · ${monthLabel(month)}`}</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Район</th><th className="num">Шт</th><th className="num">Сумма, ₽</th></tr>
                  </thead>
                  <tbody>
                    {tableRows.map((s) => (
                      <tr key={s.name} className={s.name === selected ? 'is-selected' : ''}>
                        <td>
                          <button type="button" className="row-link" onClick={() => handleSelect(s.name)}>
                            {s.name}
                          </button>
                          <span className="row-region">{s.region}</span>
                        </td>
                        <td className="num">{fmtInt.format(s.packs)}</td>
                        <td className="num">{fmtInt.format(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}
