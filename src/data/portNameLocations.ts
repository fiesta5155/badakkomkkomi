/** Approved WGS84 label positions only. Append corrections; never edit the routing archive. */
interface PortNameLocationCorrection {
  portId: string;
  name: string;
  previous: { lat: number; lng: number };
  position: { lat: number; lng: number };
  source: { kind: 'official-map' | 'user-gps'; reference: string; detail: string };
  approvedOn: string;
}

// The last approved record for an ID wins. Keep prior records when GPS evidence supersedes them.
export const PORT_NAME_LOCATION_CORRECTIONS: readonly PortNameLocationCorrection[] = [
  {
    portId: 'KR-GN-TY-0038', name: '연대항',
    previous: { lat: 34.7295, lng: 128.3975 },
    position: { lat: 34.736514, lng: 128.393951 },
    source: {
      kind: 'official-map', reference: 'https://naraport.mof.go.kr/',
      detail: 'FP000369; gisPortListJson.do fst_knd=NP/appn_at=Y, LA/LO; 2026-11-20 조회 및 사용자 승인',
    },
    approvedOn: '2026-11-20',
  },
  {
    portId: 'KR-GN-TY-0004', name: '학림항',
    previous: { lat: 34.7528, lng: 128.4095 },
    position: { lat: 34.747986, lng: 128.407247 },
    source: {
      kind: 'official-map', reference: 'https://naraport.mof.go.kr/',
      detail: 'FP000372; gisPortListJson.do fst_knd=NP/appn_at=Y, LA/LO; 2026-11-20 조회 및 사용자 승인',
    },
    approvedOn: '2026-11-20',
  },
];

export const PORT_NAME_LOCATIONS = new Map(PORT_NAME_LOCATION_CORRECTIONS.map(record => [record.portId, record.position]));
