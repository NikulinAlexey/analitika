export interface SaleRecord {
  d: string; // дата YYYY-MM-DD
  m: string; // месяц YYYY-MM
  sub: string; // субъект РФ
  ct: string | null; // город
  dst: string | null; // район города
  ch: string; // канал продаж
  p: string; // БАД (продукт)
  n: string; // сеть
  pt: string; // участник (аптека)
  q: number; // количество, шт
  s: number; // сумма продаж, руб
  b: number; // бонус, руб
}

export interface SalesFile {
  meta: { from: string; to: string; rows: number };
  records: SaleRecord[];
}
