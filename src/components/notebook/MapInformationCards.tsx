import { useState, type ReactNode, type Ref } from 'react';
import { ArrowDown, ArrowUp, List, Settings } from 'lucide-react';
import type { MapLayerConfig } from '../../types/config';
import type { PorpoiseRecord } from '../../types/porpoise';
import { PorpoiseExportButton } from './PorpoiseExportButton';
import { DEFAULT_MAP_INFORMATION_ORDER, loadMapInformationOrder, MAP_INFORMATION_ORDER_KEY, moveMapInformationItem, type MapInformationId } from './mapInformationOrder';

interface Props {
  layers: readonly MapLayerConfig[];
  onToggleLayer: (id: string) => void;
  showHazardInformation: boolean;
  onToggleHazardInformation: () => void;
  onOpenNavigationalWarnings?: () => void;
  onOpenRockDocking?: () => void;
  rockDockingCount?: number;
  portNamesVisible?: boolean;
  portNamesCount?: number;
  onTogglePortNames?: () => void;
  permitVisible: boolean;
  permitCount: number;
  onTogglePermits?: () => void;
  showPorpoiseLayer: boolean;
  onTogglePorpoiseLayer: () => void;
  porpoiseRecords: readonly PorpoiseRecord[];
  dockingCount: number;
  hazardCount: number;
  protectedCount: number;
  dockingFilters: ReactNode;
  dockingFiltersOpen: boolean;
  onToggleDockingFilters?: () => void;
  dockingCardRef?: Ref<HTMLLIElement>;
}

const iconButton = 'flex h-11 w-11 touch-manipulation items-center justify-center rounded-lg text-[#003360] hover:bg-sky-50 enabled:active:bg-sky-100 disabled:opacity-30';

export function MapInformationCards(props: Props) {
  const [order, setOrder] = useState<MapInformationId[]>(() => {
    try { return loadMapInformationOrder(window.localStorage); } catch { return [...DEFAULT_MAP_INFORMATION_ORDER]; }
  });
  const [message, setMessage] = useState('');
  const items: Record<MapInformationId, { name: string; count: string; checked: boolean; toggle: () => void; disabled?: boolean }> = {
    docking: {
      name: props.onOpenRockDocking ? '갯바위 접안정보' : '갯바위 접안 포인트', count: `${props.rockDockingCount ?? props.dockingCount}곳`,
      checked: props.layers.find(layer => layer.id === 'docking')?.visible ?? false,
      toggle: () => props.onToggleLayer('docking'), disabled: !props.layers.some(layer => layer.id === 'docking'),
    },
    protected_area: {
      name: '특별보호구역', count: `${props.protectedCount}곳`,
      checked: props.layers.find(layer => layer.id === 'protected_area')?.visible ?? false,
      toggle: () => props.onToggleLayer('protected_area'), disabled: !props.layers.some(layer => layer.id === 'protected_area'),
    },
    hazard: { name: '항행경보', count: '공식 경보 목록', checked: props.showHazardInformation, toggle: props.onToggleHazardInformation },
    port_names: { name: '항·포구 명칭', count: `${props.portNamesCount ?? 0}곳`, checked: props.portNamesVisible ?? false, toggle: () => props.onTogglePortNames?.(), disabled: !props.onTogglePortNames },
    permits: { name: '행위허가', count: `${props.permitCount}곳`, checked: props.permitVisible, toggle: () => props.onTogglePermits?.(), disabled: !props.onTogglePermits },
    porpoise: { name: '상괭이 관찰 기록', count: `${props.porpoiseRecords.length}건 · 이 기기`, checked: props.showPorpoiseLayer, toggle: props.onTogglePorpoiseLayer },
  };
  const move = (id: MapInformationId, direction: -1 | 1) => {
    const next = moveMapInformationItem(order, id, direction);
    setOrder(next);
    try {
      window.localStorage.setItem(MAP_INFORMATION_ORDER_KEY, JSON.stringify(next));
      setMessage(`${items[id].name} 항목을 ${next.indexOf(id) + 1}번째로 옮겼습니다.`);
    } catch { setMessage('목록 순서를 기기에 저장하지 못했습니다. 이번 화면에서만 적용됩니다.'); }
  };
  return <div>
    <ol aria-label="지도 정보 목록" className="space-y-2">
      {order.map((id, index) => {
        const item = items[id];
        const hasAction = (id === 'docking' && (props.dockingCount > 0 || !!props.onOpenRockDocking)) || id === 'porpoise' || id === 'hazard';
        return <li key={id} ref={id === 'docking' ? props.dockingCardRef : undefined} data-map-information={id}
          onKeyDown={event => {
            if (id === 'docking' && props.dockingFiltersOpen && event.key === 'Escape') {
              event.preventDefault(); event.stopPropagation(); props.onToggleDockingFilters?.();
              document.getElementById('docking-filter-toggle')?.focus();
            }
          }}
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-x-0.5 rounded-2xl border border-sky-200 bg-white px-1.5 py-1.5 shadow-2xs">
            <label className={`col-start-1 row-start-1 flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 ${hasAction ? '' : 'col-span-2'}`}>
              <span className="flex h-11 w-6 shrink-0 items-center justify-center">
                <input type="checkbox" checked={item.checked} onChange={item.toggle} disabled={item.disabled} aria-label={`${item.name} 표시`}
                  className="h-5 w-5 rounded border-slate-400 bg-white accent-[#00846c]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-keep text-[13px] leading-4 font-black text-[#003360]">{item.name}</span>
                <span className="block break-keep text-[11px] leading-4 font-semibold text-[#484843]">{item.count}</span>
              </span>
            </label>
            {id === 'docking' && <div className="col-start-2 row-start-1 flex gap-1">{props.dockingCount > 0 && <button type="button" id="docking-filter-toggle" aria-label="등급·권역 필터" title="등급·권역 필터"
              aria-expanded={props.dockingFiltersOpen} aria-controls={props.dockingFiltersOpen ? 'docking-color-filter-popover' : undefined}
              disabled={!props.onToggleDockingFilters} onClick={props.onToggleDockingFilters}
              className={`${iconButton} col-start-2 row-start-1`}><Settings className="h-4 w-4" aria-hidden="true" /></button>}
            {props.onOpenRockDocking && <button type="button" onClick={props.onOpenRockDocking} aria-label="갯바위 접안정보 목록" title="갯바위 접안정보 목록" className={iconButton + ' col-start-2 row-start-1'}><List aria-hidden="true" className="h-4 w-4" /></button>}</div>}
            {id === 'porpoise' && <PorpoiseExportButton records={props.porpoiseRecords} compact />}
            {id === 'hazard' && <button type="button" onClick={props.onOpenNavigationalWarnings} disabled={!props.onOpenNavigationalWarnings}
              aria-label="항행경보 목록" title="항행경보 목록" className={`${iconButton} col-start-2 row-start-1`}><List aria-hidden="true" className="h-4 w-4" /></button>}
            <button type="button" onClick={() => move(id, -1)} disabled={index === 0} aria-label={`${item.name} 위로`} className={`${iconButton} col-start-3 row-start-1`}><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => move(id, 1)} disabled={index === order.length - 1} aria-label={`${item.name} 아래로`} className={`${iconButton} col-start-4 row-start-1`}><ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></button>
          {id === 'docking' && props.dockingCount > 0 && props.dockingFiltersOpen && <div className="col-span-full row-start-2 mt-1 min-w-0 border-t border-sky-100 px-1.5 pt-2">{props.dockingFilters}</div>}
        </li>;
      })}
    </ol>
    <p role="status" className="mt-2 text-xs font-semibold leading-relaxed text-[#484843]">{message}</p>
  </div>;
}
