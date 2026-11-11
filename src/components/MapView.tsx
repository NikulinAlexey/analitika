import { useCallback, useEffect, useRef } from 'react';
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

const ZOOM_MIN = 0.7, ZOOM_MAX = 4;

export default function MapView({ mapData, objects, packsByDistrict, selected, onSelect, showPharmacies, showClinics }: Props) {
  const [VB_X, VB_Y, VB_W, VB_H] = mapData.viewBox;

  // Панорама и зум — только CSS-transform (translate + scale) на GPU-слое:
  // без скролл-контейнеров, без синхронизаций, единственный источник правды viewRef.
  // transform-origin 50% 50% + flex-центрирование => центр карты совпадает с центром вьюпорта.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fitRef = useRef(1);
  const viewRef = useRef({ zoom: 1, tx: 0, ty: 0 }); // tx,ty — сдвиг в px экрана
  const movedRef = useRef(false);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);

  const applyView = useCallback(() => {
    const svg = svgRef.current;
    const el = containerRef.current;
    if (!svg || !el) return;
    const { zoom } = viewRef.current;
    const zf = fitRef.current * zoom;
    // пределы пана: при текущем зуме можно дотянуться до любой кромки карты, но не дальше
    const mX = Math.max(0, (VB_W * zf - el.clientWidth) / 2);
    const mY = Math.max(0, (VB_H * zf - el.clientHeight) / 2);
    const tx = Math.max(-mX, Math.min(mX, viewRef.current.tx));
    const ty = Math.max(-mY, Math.min(mY, viewRef.current.ty));
    viewRef.current.tx = tx;
    viewRef.current.ty = ty;
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${zf})`;
  }, [VB_W, VB_H]);

  useEffect(() => { applyView(); }, [applyView]);

  // fit-масштаб: карта целиком вмещается во вьюпорт при zoom=1
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      fitRef.current = Math.min(el.clientWidth / (VB_W + 80), el.clientHeight / (VB_H + 80));
      applyView();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [applyView, VB_W, VB_H]);

  // wheel: зум к курсору
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopMomentum();
      const { zoom, tx, ty } = viewRef.current;
      const f = e.deltaY < 0 ? 1.15 : 0.87;
      const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * f));
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const s = nz / zoom;
      viewRef.current = {
        zoom: nz,
        tx: cx - (cx - tx) * s,
        ty: cy - (cy - ty) * s,
      };
      applyView();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [applyView]);

  // инерция после отпускания (px в мс)
  const momentumRef = useRef(0);
  const stopMomentum = useCallback(() => {
    if (momentumRef.current) cancelAnimationFrame(momentumRef.current);
    momentumRef.current = 0;
  }, []);
  const startMomentum = useCallback((vx: number, vy: number) => {
    stopMomentum();
    let last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(64, t - last);
      last = t;
      const el = containerRef.current;
      if (!el) { momentumRef.current = 0; return; }
      viewRef.current.tx += vx * dt;
      viewRef.current.ty += vy * dt;
      applyView();
      const zf = fitRef.current * viewRef.current.zoom;
      const limX = Math.max(0, (VB_W * zf - el.clientWidth) / 2);
      const limY = Math.max(0, (VB_H * zf - el.clientHeight) / 2);
      if (Math.abs(viewRef.current.tx) >= limX) vx = 0;
      if (Math.abs(viewRef.current.ty) >= limY) vy = 0;
      const k = Math.pow(0.9, dt / 16);
      vx *= k; vy *= k;
      momentumRef.current = (Math.abs(vx) + Math.abs(vy) > 0.02) ? requestAnimationFrame(step) : 0;
    };
    momentumRef.current = requestAnimationFrame(step);
  }, [applyView, VB_W, VB_H]);

  // pinch-zoom (два пальца) — браузер не зумит SVG с touch-action: pan-x pan-y,
  // поэтому делаем щипок сами через pointer-события (математика простая и стабильная)
  const pinchRef = useRef<{ d: number; cx: number; cy: number; z: number; tx: number; ty: number } | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number; type: string }>());

  const panStartRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const velRef = useRef({ x: 0, y: 0, t: 0 });

  const onPointerDown = (e: React.PointerEvent) => {
    stopMomentum();
    downPosRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    velRef.current = { x: 0, y: 0, t: performance.now() };
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        d: Math.hypot(b.x - a.x, b.y - a.y) || 1,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        z: viewRef.current.zoom,
        tx: viewRef.current.tx,
        ty: viewRef.current.ty,
      };
      panStartRef.current = null;
      movedRef.current = true;
    } else if (pointersRef.current.size === 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY, tx: viewRef.current.tx, ty: viewRef.current.ty };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = downPosRef.current;
    if (d && (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 8)) movedRef.current = true;

    if (!pointersRef.current.has(e.pointerId)) return;

    if (pinchRef.current && pointersRef.current.size >= 2) {
      const ids = [...pointersRef.current.keys()];
      const otherId = ids[0] === e.pointerId ? ids[1] : ids[0];
      const other = pointersRef.current.get(otherId)!;
      const a = { x: e.clientX, y: e.clientY };
      // расстояние ДО обновления Map: движущийся - новый, второй - предыдущий
      const dist = Math.hypot(other.x - a.x, other.y - a.y) || 1;
      pointersRef.current.set(e.pointerId, { ...a, type: e.pointerType });
      const cx = (a.x + other.x) / 2, cy = (a.y + other.y) / 2;
      const s0 = pinchRef.current;
      const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, s0.z * (dist / s0.d)));
      const scale = nz / s0.z;
      // зум к центру пальцев, с сохранением этого центра
      viewRef.current = {
        zoom: nz,
        tx: cx - (s0.cx - s0.tx) * scale,
        ty: cy - (s0.cy - s0.ty) * scale,
      };
      applyView();
      movedRef.current = true;
    } else if (panStartRef.current && pointersRef.current.size === 1) {
      const p0 = panStartRef.current;
      // скорость для инерции (px/мс, экспоненциальное сглаживание)
      const prev = pointersRef.current.get(e.pointerId);
      const now = performance.now();
      if (prev) {
        const dt = now - velRef.current.t;
        if (dt > 0 && dt < 80) {
          const k = 0.4;
          velRef.current = {
            x: velRef.current.x * (1 - k) + k * ((e.clientX - prev.x) / dt),
            y: velRef.current.y * (1 - k) + k * ((e.clientY - prev.y) / dt),
            t: now,
          };
        } else {
          velRef.current = { x: 0, y: 0, t: now };
        }
      }
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      viewRef.current = {
        zoom: viewRef.current.zoom,
        tx: p0.tx + (e.clientX - p0.x),
        ty: p0.ty + (e.clientY - p0.y),
      };
      applyView();
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasPan = panStartRef.current && pointersRef.current.size === 1 && !pinchRef.current;
    pointersRef.current.delete(e.pointerId);
    downPosRef.current = null;
    if (pointersRef.current.size === 0) {
      panStartRef.current = null;
      pinchRef.current = null;
      if (wasPan && movedRef.current) {
        const v = velRef.current;
        const speed = Math.hypot(v.x, v.y);
        if (speed > 0.05) startMomentum(v.x, v.y);
      }
    } else if (pointersRef.current.size === 1) {
      const [, p] = [...pointersRef.current.entries()][0];
      panStartRef.current = { x: p.x, y: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty };
      velRef.current = { x: 0, y: 0, t: performance.now() };
      pinchRef.current = null;
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (movedRef.current) { e.preventDefault(); e.stopPropagation(); movedRef.current = false; }
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
      ref={containerRef}
      className="map-container"
      role="application"
      aria-label="Карта районов Санкт-Петербурга и Ленинградской области"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
      {/* вся геометрия — один GPU-transform на svg, жесты обрабатываем сами */}
      <div className="map-flex-center">
        <svg
          ref={svgRef}
          viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`}
          className="region-map region-map--dark"
          width={VB_W}
          height={VB_H}
        >
        <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill="#24424f" pointerEvents="none" />

        <g className="map-water" pointerEvents="none">
          {mapData.water.map((d, i) => (
            <path key={i} d={d} fill="#1a323d" />
          ))}
        </g>

        <path d={mapData.cityBorder} fill="none" stroke="rgba(217,220,206,0.22)" strokeWidth={1.6} pointerEvents="none" />

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
      </div>
      <div className="zoom-hint" aria-hidden="true">
        Колесо / щипок — масштаб · перетаскивание — сдвиг
      </div>
    </div>
  );
}
