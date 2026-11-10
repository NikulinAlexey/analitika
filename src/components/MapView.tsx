import { useRef, useState } from 'react';
import type { MapData, MapObject } from '../types';

interface Props {
  mapData: MapData;
  objects: MapObject[];
  packsByDistrict: Map<string, number>;
  selected: string | null;
  onSelect: (name: string) => void;
  showPharmacies: boolean;
  showClinics: boolean;
}

function rgb(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function activeColor(packs: number): string {
  const t = Math.min(packs / 100, 1);
  return t < 0.5 ? rgb([154, 176, 104], [204, 142, 42], t * 2) : '#cc8e2a';
}

export default function MapView({ mapData, objects, packsByDistrict, selected, onSelect, showPharmacies, showClinics }: Props) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [VB_X, VB_Y, VB_W, VB_H] = mapData.viewBox;

  const onWheel = (e: React.WheelEvent) => {
    setZoom((z) => Math.max(0.7, Math.min(4, z * (e.deltaY < 0 ? 1.15 : 0.87))));
  };

  const clampPan = (x: number, y: number, z: number) => {
    const lim = 450 * z;
    return { x: Math.max(-lim, Math.min(lim, x)), y: Math.max(-lim, Math.min(lim, y)) };
  };

  const movedRef = useRef(false);
  const capturedRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    movedRef.current = false;
    capturedRef.current = false;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 5) {
      if (!capturedRef.current) {
        capturedRef.current = true;
        movedRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
    if (capturedRef.current) {
      const next = clampPan(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy), zoom);
      setPan(next);
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (movedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      movedRef.current = false;
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (capturedRef.current) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    }
    dragRef.current = null;
    setDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const districtHandler = (name: string) => ({
    onClick: () => onSelect(name),
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': name,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(name); } },
  });

  const labelProps = (selected_: boolean) => ({
    textAnchor: 'middle' as const,
    fill: selected_ ? '#173f4d' : 'rgba(242,240,230,0.88)',
    fontWeight: selected_ ? 750 : 600,
    className: 'district-label',
    pointerEvents: 'none' as const,
    paintOrder: 'stroke' as const,
    stroke: selected_ ? 'rgba(233,196,106,0.9)' : '#24424f',
    strokeWidth: 3,
    strokeLinejoin: 'round' as const,
  });

  return (
    <div
      className={`map-container ${dragging ? 'is-dragging' : ''}`}
      role="application"
      aria-label="Карта районов Санкт-Петербурга и Ленинградской области"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
      onDoubleClick={resetView}
    >
      <svg
        viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        className="region-map region-map--dark"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '50% 50%' }}
      >
        <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill="#24424f" pointerEvents="none" />

        {/* вода: Финский залив, Нева, озёра */}
        <g className="map-water" pointerEvents="none">
          {mapData.water.map((d, i) => (
            <path key={i} d={d} fill="#1a323d" />
          ))}
        </g>

        {/* граница города */}
        <path d={mapData.cityBorder} fill="none" stroke="rgba(217,220,206,0.22)" strokeWidth={1.6} pointerEvents="none" />

        {/* панель Ленинградской области */}
        <g className="lo-panel">
          <line x1={1024} y1={VB_Y + 18} x2={1024} y2={VB_H - 18} stroke="rgba(217,220,206,0.18)" strokeDasharray="3 6" pointerEvents="none" />
          <text x={1217} y={48} textAnchor="middle" fontSize={15} fontWeight={700} letterSpacing={2} fill="rgba(242,240,230,0.6)" pointerEvents="none">
            ЛЕНИНГРАДСКАЯ ОБЛАСТЬ
          </text>
          <text x={1217} y={66} textAnchor="middle" fontSize={9.5} fill="rgba(242,240,230,0.4)" pointerEvents="none">
            районы размещены схематично
          </text>
          {mapData.loDistricts.map((d) => {
            const isSel = selected === d.name;
            return (
              <g key={d.name}>
                {d.paths.map((p, i) => (
                  <path
                    key={i}
                    d={p}
                    className="district-polygon district-polygon--region"
                    fill={isSel ? activeColor(packsByDistrict.get(d.name) ?? 0) : 'rgba(217,220,206,0.05)'}
                    fillOpacity={isSel ? 0.9 : 1}
                    stroke="rgba(217,220,206,0.45)"
                    strokeWidth={1.1}
                    strokeDasharray="5 4"
                    {...districtHandler(d.name)}
                  />
                ))}
                <text x={d.label[0]} y={d.label[1] + 3.5} fontSize={10.5} {...labelProps(isSel)}>
                  {d.name.replace(' район', '')}
                </text>
              </g>
            );
          })}
        </g>

        {/* районы Санкт-Петербурга */}
        <g className="spb-districts">
          {mapData.districts.map((d) => {
            const isSel = selected === d.name;
            const packs = packsByDistrict.get(d.name) ?? 0;
            return (
              <g key={d.name}>
                {d.paths.map((p, i) => (
                  <path
                    key={i}
                    d={p}
                    className="district-polygon"
                    fill={isSel ? activeColor(packs) : 'rgba(217,220,206,0.12)'}
                    stroke="rgba(217,220,206,0.55)"
                    strokeWidth={1.1}
                    opacity={isSel ? 1 : 0.9}
                    {...districtHandler(d.name)}
                  />
                ))}
                <text x={d.label[0]} y={d.label[1] + 4} fontSize={11} {...labelProps(isSel)}>
                  {d.name}
                </text>
              </g>
            );
          })}
        </g>

        {/* аптеки и поликлиники */}
        <g className="map-objects">
          {objects.map((o, i) => {
            if (o.type === 'pharmacy' && !showPharmacies) return null;
            if (o.type === 'clinic' && !showClinics) return null;
            const isSPb = !o.district.endsWith('район');
            const r = isSPb ? 5 : 5.5;
            return o.type === 'pharmacy' ? (
              <g key={i} transform={`translate(${o.x},${o.y})`} className="map-object">
                <circle r={r} className="obj obj--pharmacy" />
                <path d={`M${-r * 0.45},0h${r * 0.9}M0,${-r * 0.45}v${r * 0.9}`} stroke="#fff" strokeWidth={1.5} />
                <title>{`${o.name} · Аптека · ${o.district}${o.sales != null ? ` · ${o.sales} шт` : ''}`}</title>
              </g>
            ) : (
              <g key={i} transform={`translate(${o.x},${o.y})`} className="map-object">
                <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={2.5} className="obj obj--clinic" />
                <path d={`M${-r * 0.5},0h${r}M0,${-r * 0.5}v${r}`} stroke="#fff" strokeWidth={1.6} />
                <title>{`${o.name} · Поликлиника · ${o.district}`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoom-hint" aria-hidden="true">
        Колесо — масштаб · перетаскивание — сдвиг · двойной клик — сброс
      </div>
    </div>
  );
}
