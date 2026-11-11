export interface MapDistrict {
  name: string;
  region: string;
  paths: string[];
  label: [number, number];
}

export interface MapData {
  viewBox: [number, number, number, number];
  water: string[];
  cityBorder: string;
  districts: MapDistrict[];    // Санкт-Петербург
  loDistricts: MapDistrict[];  // Ленинградская область (схематично)
}

export interface MapObject {
  name: string;
  type: 'pharmacy' | 'clinic';
  district: string;
  lon: number;
  lat: number;
  x: number; // позиция на SVG-карте
  y: number;
  sales?: number;
}

export interface DistrictStats {
  name: string;
  region: string;
  packs: number;
  amount: number;
  clinics: number;
  pharmacies: number;
  share: number; // доля в продажах региона, %
  rank: number;
}
