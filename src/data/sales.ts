import type { SalesFile, SaleRecord } from '../types/sales';

let cache: SaleRecord[] | null = null;

// Загружает выгрузку продаж (sales.json, подготовленный из Excel-файла)
export async function loadSales(): Promise<SaleRecord[]> {
  if (cache) return cache;
  const r = await fetch('data/sales.json');
  const file = (await r.json()) as SalesFile;
  cache = file.records;
  return cache;
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
