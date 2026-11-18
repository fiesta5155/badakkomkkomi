import { useState } from 'react';
import { APP_VERSION, APP_VERSION_DISPLAY } from '../../config/appVersion';
import { DATA_SOURCE_REGISTRY, buildSourceCitationCopyText, type SourceCategoryKey } from '../../config/dataSources';

const guides = [
  { title: '꼬미의 바다수첩', icon: 'icon_notebook_map_final.png', description: '접안정보를 확인하고, 현장제보와 상괭이 관찰 등 해양 현장정보를 기록·조회합니다.' },
  { title: '바닷길 콕콕', icon: 'icon_navigation_clock_final.png', description: '항로 거리와 소요시간을 계산하고 해양기상 정보를 확인합니다.' },
  { title: '꼬미의 달력', icon: 'icon_calendar_boat_final.png', description: '선박별 운항일정과 직원 메모를 공유하고 물때·날씨를 확인합니다.' },
  { title: '꼬미의 조타실', icon: 'icon_settings_helm_final.png', description: '계정 관리와 기상 기준 등 앱 사용 환경을 설정합니다.' },
];

export function SettingsInformation({ screen, focusSourceId }: { screen: 'guide' | 'sources'; focusSourceId?: SourceCategoryKey | null }) {
  const [copyMessage, setCopyMessage] = useState('');
  const copySources = async () => {
    try {
      await navigator.clipboard.writeText(buildSourceCitationCopyText(APP_VERSION_DISPLAY));
      setCopyMessage('출처를 복사했습니다.');
    } catch {
      setCopyMessage('자동 복사를 사용할 수 없습니다. 화면의 출처를 선택해 복사해 주세요.');
    }
  };
  if (screen === 'guide') return <section aria-label="메뉴별 이용 안내">
    <div className="divide-y divide-sky-100">
      {guides.map((guide) => <div key={guide.title} className="flex items-start gap-3 py-3 first:pt-0">
        <img src={import.meta.env.BASE_URL + 'images/brand/' + guide.icon} alt="" className="h-11 w-11 shrink-0 object-contain" />
        <div className="min-w-0"><h3 className="text-sm font-bold">{guide.title}</h3><p className="mt-1 text-sm leading-relaxed text-slate-600">{guide.description}</p></div>
      </div>)}
    </div>
    <p className="mt-4 rounded-xl bg-sky-50 p-3 text-xs leading-relaxed text-slate-700">항로와 기상정보는 참고용이며, 실제 운항 시에는 현장 상황과 공식 항행정보를 확인해 주세요.</p>
  </section>;

  const provider = (id: SourceCategoryKey) => DATA_SOURCE_REGISTRY.find((item) => item.id === id)?.providerSummary;
  const focusedCategory = focusSourceId === 'ports_docking' ? '항포구·접안정보' : focusSourceId === 'marine_weather' ? '해양기상' : focusSourceId === 'map_gis' ? '지도·공간정보' : focusSourceId ? '기타 데이터·오픈소스' : null;
  return <section aria-label="바다꼼꼬미 앱 정보" className="space-y-5 text-sm leading-relaxed [word-break:keep-all]">
    <div className="flex items-center gap-3">
      <img src={import.meta.env.BASE_URL + 'images/brand/bandali_thumbsup.png'} alt="" className="h-14 w-14 shrink-0 object-contain" />
      <div><h3 className="font-black">바다꼼꼬미 <span className="ml-1 text-xs font-normal text-slate-600">v{APP_VERSION}</span></h3><p className="mt-1 text-slate-600">한려해상국립공원 해양 현장업무를 돕는 직원용 앱입니다.</p></div>
    </div>
    <div>
      <h3 className="font-bold">데이터 출처</h3>
      {focusedCategory && <p className="mt-1 text-xs text-slate-600">요청한 출처: {focusedCategory}</p>}
      <dl className="mt-2 space-y-3 text-xs text-slate-600">
        <div><dt className="font-bold text-[#003360]">지도·공간정보</dt><dd>{provider('map_gis')} · 환경부·국립공원공단 공원경계·특별보호구역. 해안선: © OpenStreetMap 기여자 (<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">ODbL</a>).</dd></div>
        <div><dt className="font-bold text-[#003360]">항포구·접안정보</dt><dd>{provider('ports_docking')} · 국립공원공단 현장 점검자료.</dd></div>
        <div><dt className="font-bold text-[#003360]">해양기상</dt><dd><a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="underline">Open-Meteo</a> · ECMWF IFS(풍속·달력 날씨), WAM(파고). 예보는 현장과 다를 수 있으니 출항 전 기상청 공식 해상특보를 확인해 주세요.</dd></div>
        <div><dt className="font-bold text-[#003360]">기타 데이터·오픈소스</dt><dd>물때: 바다타임 남해 8물식 기준 자체 계산(참고용). 브랜드·캐릭터: 국립공원공단. React·Vite·Tailwind CSS·proj4·fflate·Workbox: MIT, TypeScript·Firebase: Apache-2.0, Leaflet: BSD-2-Clause, Lucide: ISC.</dd></div>
      </dl>
      <button type="button" onClick={() => void copySources()} className="mt-2 min-h-11 touch-manipulation rounded-lg px-2 text-xs font-bold text-[#0066b3] active:bg-sky-50">출처 요약 복사</button>
      {copyMessage && <p role="status" className="text-xs text-slate-600">{copyMessage}</p>}
    </div>
    <div className="space-y-2">
      <h3 className="font-bold">오프라인 이용</h3>
      <p className="text-xs text-slate-600"><strong className="text-[#003360]">인터넷 없이:</strong> 앱과 자료를 미리 내려받은 기기에서 내장 접안·항포구 정보 확인, 직선거리·소요시간 계산, 기기에 저장한 상괭이 기록 이용이 가능합니다.</p>
      <p className="text-xs text-slate-600"><strong className="text-[#003360]">인터넷 필요:</strong> 로그인·계정 변경, 일정·메모 공유와 최신 자료 동기화, 실시간 기상·날씨 조회, 새 배경지도·로드뷰 확인. 연결이 끊기면 해양기상은 ‘미확인(?)’으로 표시됩니다.</p>
    </div>
    <p className="text-xs text-slate-600">항로·수심·위험정보는 참고용입니다. 직선 항로는 육지를 가로지를 수 있으며 공식 전자해도·최신 수로고시와 현장 판단을 대신하지 않습니다.</p>
  </section>;
}
