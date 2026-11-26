// Local UI regression: real App, config/storage hooks, file parser and Leaflet canvas.
// All nonlocal requests are blocked; Firebase is synthetic and remote saves are intercepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fixture, service, loadMapViewFixture } from './mapWorkspaceFixtures.mjs';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE, headless: true });
const origin = process.env.QA_ORIGIN ?? 'http://127.0.0.1:5173';
const mapView = await loadMapViewFixture(origin);
const { features: operationalPorts } = JSON.parse(readFileSync(new URL('../../data/public-port-names.final-candidate.geojson', import.meta.url), 'utf8'));
const operationalPortPoints = operationalPorts.map(({ id, properties, geometry }) => ({
  id, name: properties.name, lng: geometry.coordinates[0], lat: geometry.coordinates[1],
}));
const defaultOrder = ['docking', 'protected_area', 'hazard', 'port_names', 'permits', 'porpoise'];
const orderKey = 'bada_map_information_ui_order_v1';
const recordKey = 'bada_finless_porpoise_records_v1';
const records = JSON.stringify([{ id: 'local', lat: 34.8, lng: 128.4, observedAt: '2026-11-20T00:05', count: 2, createdAt: 1 }]);
const sample = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[128.4, 34.8], [128.41, 34.8], [128.41, 34.81], [128.4, 34.81], [128.4, 34.8]]] }, properties: { id: 'qa-area', name: '현장 조사구역', notes: '기존 비고' } }] };

try {
  for (const engine of (process.env.QA_ENGINES ?? 'leaflet,kakao').split(',')) for (const width of (process.env.QA_WIDTHS ?? '320,390,1280').split(',').map(Number)) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 600, serviceWorkers: 'block', acceptDownloads: true });
    await context.addInitScript(({ key, value, engine }) => { window.qaEngine = engine; localStorage.setItem(key, value); }, { key: recordKey, value: records, engine });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.clock.setFixedTime(new Date('2026-11-20T12:00:00+09:00'));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: fixture }));
    await page.route('**/src/components/MapView.tsx*', route => route.fulfill({ contentType: 'application/javascript', body: mapView }));
    await page.route('**/src/services/activityPermitService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: service }));
    await page.route('**/src/services/announcementService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeAnnouncementAdmin(db,uid,next){queueMicrotask(()=>next(false));return()=>{};}export function subscribeAnnouncements(db,admin,next){queueMicrotask(()=>next([],false));return()=>{};}export const saveAnnouncement=async()=>{throw Error("No writes");};export const deleteAnnouncement=saveAnnouncement;' }));
    await page.route('**/src/services/firebaseClient.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export const getFirebaseClient=()=>({db:{}});export const firebaseConfigurationError="";' }));
    await page.route('**/src/services/calendarFirestoreService.ts*', route => route.fulfill({ contentType: 'application/javascript', body: 'export function subscribeCalendar(db,v,m,next){queueMicrotask(()=>next([],false));return()=>{};}export function subscribeCalendarAdmin(db,u,next){queueMicrotask(()=>next(false));return()=>{};}export const saveSharedEntry=async()=>{throw new Error("No writes");};export const deleteSharedEntry=saveSharedEntry;' }));
    await page.route('**/src/services/githubLayerSyncService.ts*', async route => {
      const response = await route.fetch();
      const source = (await response.text()).replace('async function commitLayersToGitHubRepository(', 'async function originalCommitLayersToGitHubRepository(');
      await route.fulfill({ contentType: 'application/javascript', body: source + '\nexport async function commitLayersToGitHubRepository(params){window.qaRemoteSaves=(window.qaRemoteSaves||[]).concat([params]);return {status:"local_only",message:"QA local save"};}' });
    });
    await page.goto(origin + '/?screen=notebook' + (process.env.QA_WARNING_PREVIEW === '1' ? '&navWarningPreview=1' : ''));
    await page.waitForFunction(() => window.qaMapProps?.layers.some(layer => layer.id === 'protected_area') && window.qaMapProps.geoJsonLayersData.protected_area?.features.length === 20);
    const open = async () => { await page.getByRole('group', { name: '바다수첩 기능' }).getByRole('button').first().click(); await page.getByRole('heading', { name: '지도 정보 관리', exact: true }).waitFor(); };
    const order = () => page.locator('[data-map-information]').evaluateAll(elements => elements.map(el => el.dataset.mapInformation));
    const mapState = () => page.evaluate(() => JSON.stringify({ layers: window.qaMapProps.layers, data: window.qaMapProps.geoJsonLayersData }));
    const assertFits = async view => {
      const bounds = await page.getByRole('dialog').evaluate(dialog => {
        const scroller = dialog.querySelector('.overflow-y-auto');
        return { viewport: innerWidth, dialog: dialog.scrollWidth, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth };
      });
      assert.ok(bounds.dialog <= width && bounds.scrollWidth <= bounds.clientWidth + 1, `${view}: ${JSON.stringify(bounds)}`);
    };
    await open();
    assert.deepEqual(await order(), defaultOrder);
    assert.equal(await page.getByRole('checkbox').count(), 6);
    assert.equal(await page.locator('#docking-color-filter-popover').count(), 0);
    assert.equal(await page.getByRole('button', { name: '등급·권역 필터', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '관찰기록 내보내기', exact: true }).innerText(), '');
    assert.ok(!/REL-INITIAL|QGIS|EPSG|CP949|GeoJSON|Polygon|국립공원 경계|지도에 표시할 정보/.test(await page.getByRole('dialog').innerText()));
    const initialMap = await mapState();
    await page.getByRole('button', { name: '항행경보 목록', exact: true }).click();
    await page.getByRole('heading', { name: '항행경보', exact: true }).waitFor();
    if (process.env.QA_WARNING_PREVIEW === '1') {
      await page.getByText('과거 수집 자료 · 개발용 미리보기', { exact: true }).waitFor();
      await page.getByRole('status').getByText(/수집 자료 9건/).waitFor();
    } else await page.getByText('아직 수집된 항행경보 자료가 없습니다.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('heading', { name: '지도 정보 관리', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '항행경보 목록');
    assert.equal(await mapState(), initialMap, 'reading warnings must not change map layers or geometry');
    const initialMetadata = await page.evaluate(() => localStorage.getItem('bada_operational_layers_meta_v2'));
    await page.getByRole('button', { name: '갯바위 접안정보 아래로', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await order(), ['protected_area', 'docking', 'hazard', 'port_names', 'permits', 'porpoise']);
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '갯바위 접안정보 아래로');
    assert.equal(await mapState(), initialMap, 'UI order must preserve layer data, array order, styles and z-index');
    assert.equal(await page.evaluate(() => localStorage.getItem('bada_operational_layers_meta_v2')), initialMetadata);
    await page.getByRole('button', { name: '레이어 창 닫기' }).click(); await open();
    assert.deepEqual(await order(), ['protected_area', 'docking', 'hazard', 'port_names', 'permits', 'porpoise']);
    await page.getByRole('button', { name: '갯바위 접안정보 위로', exact: true }).click();
    assert.deepEqual(await order(), defaultOrder);

    const layout = await page.locator('[data-map-information]').evaluateAll(cards => cards.map(card => {
      const r = card.getBoundingClientRect();
      return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, fits: card.scrollWidth <= card.clientWidth + 1,
        buttons: [...card.querySelectorAll('button')].map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })) };
    }));
    assert.ok(layout.every(card => card.left >= 0 && card.right <= width && card.fits && card.buttons.every(button => button.width >= 44 && button.height >= 44)), JSON.stringify(layout));
    assert.ok(layout.every(card => card.width === layout[0].width));
    assert.ok(layout.every(card => card.height >= 56 && card.height <= 64), JSON.stringify(layout));
    const cardGaps = layout.slice(1).map((card, index) => card.top - layout[index].bottom);
    // Browser layout returns fractional CSS pixels, even for the nominal 8px gap.
    assert.ok(cardGaps.every(gap => gap >= 5.99 && gap <= 8.01), JSON.stringify(cardGaps));
    if (width === 390) assert.ok(layout.at(-1).bottom <= 844, 'six compact rows fit in the mobile viewport');
    if (process.env.QA_SCREENSHOT_DIR) { await page.getByRole('heading', { name: '지도 정보 관리', exact: true }).focus(); await page.screenshot({ path: `${process.env.QA_SCREENSHOT_DIR}/map-information-${width}.png` }); }

    for (const [name, id] of [['갯바위 접안정보 표시', 'docking'], ['특별보호구역 표시', 'protected_area']]) {
      const checkbox = page.getByRole('checkbox', { name, exact: true });
      await checkbox.uncheck();
      await page.waitForFunction(id => window.qaMapProps.layers.find(layer => layer.id === id).visible === false, id);
      await checkbox.check();
      await page.waitForFunction(id => window.qaMapProps.layers.find(layer => layer.id === id).visible === true, id);
    }
    assert.equal(await page.evaluate(() => window.qaMapProps.features.length), 0);
    assert.equal(await page.evaluate(() => window.qaMapProps.hazardPoints.length), 0);
    assert.equal(await page.locator('[data-map-information="hazard"]').getByText('공식 경보 목록', { exact: true }).count(), 1);
    assert.equal(await page.evaluate(() => window.qaMapProps.portNamePoints.length), 154);
    const countReferences = kind => page.evaluate(({engine,kind}) => engine === 'leaflet'
      ? document.querySelectorAll('[data-reference-point="' + kind + '"]').length
      : window.qaOverlays.filter(overlay => overlay.map && overlay.options.content?.matches?.('[data-reference-point="' + kind + '"]')).length, { engine, kind });
    assert.equal(await countReferences('port_names'), 154);
    assert.deepEqual(await page.evaluate(() => window.qaMapProps.portNamePoints.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }))), operationalPortPoints);
    await page.getByRole('checkbox', { name: '항·포구 명칭 표시', exact: true }).uncheck();
    await page.waitForFunction(() => window.qaMapProps.portNamePoints.length === 0);
    assert.equal(await countReferences('port_names'), 0);
    await page.getByRole('checkbox', { name: '항행경보 표시', exact: true }).uncheck();
    assert.equal(await page.evaluate(() => window.qaMapProps.features.length), 0);
    await page.reload();
    await page.waitForFunction(() => window.qaMapProps?.portNamePoints?.length === 0 && window.qaMapProps.geoJsonLayersData.protected_area?.features.length === 20);
    await open();
    assert.equal(await page.getByRole('checkbox', { name: '항·포구 명칭 표시', exact: true }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: '항행경보 표시', exact: true }).isChecked(), false);
    await page.getByRole('checkbox', { name: '항·포구 명칭 표시', exact: true }).check();
    await page.getByRole('checkbox', { name: '항행경보 표시', exact: true }).check();
    const porpoise = page.getByRole('checkbox', { name: '상괭이 관찰 기록 표시', exact: true });
    await porpoise.uncheck(); await page.waitForFunction(() => !window.qaMapProps.showPorpoiseLayer);
    await porpoise.check(); await page.waitForFunction(() => window.qaMapProps.showPorpoiseLayer);
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }); });
    await page.getByRole('button', { name: '관찰기록 내보내기', exact: true }).click();
    assert.match((await downloadEvent).suggestedFilename(), /^상괭이모니터링_\d{8}\.csv$/);

    // Selecting a geographical name reveals only its label, without route or camera effects.
    await page.getByRole('button', { name: '레이어 창 닫기' }).click();
    const routeBefore = await page.evaluate(() => JSON.stringify(window.qaMapProps.routeWaypoints));
    const cameraBefore = await page.evaluate(() => window.qaCamera.length);
    await page.evaluate(engine => {
      if (engine === 'leaflet') document.querySelector('[data-reference-point="port_names"]').click();
      else window.qaOverlays.find(o => o.map && o.options.content?.matches?.('[data-reference-point="port_names"]')).options.content.click();
    }, engine);
    assert.equal(await page.evaluate(() => JSON.stringify(window.qaMapProps.routeWaypoints)), routeBefore);
    assert.equal(await page.evaluate(() => window.qaCamera.length), cameraBefore);
    await open();

    // Expert operations use the existing parser, draft and save path.
    await page.getByRole('button', { name: '상세 관리', exact: true }).click();
    await assertFits('advanced layers');
    await page.locator('summary', { hasText: '보존 자료' }).click();
    await assertFits('archive information');
    const archiveDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: '기존 접안 55건 원본 내려받기', exact: true }).click();
    assert.equal((await archiveDownload).suggestedFilename(), 'docking_points.geojson');
    await page.locator('summary', { hasText: '보존 자료' }).click();
    assert.equal(await page.getByRole('checkbox', { name: '한려해상국립공원 경계 표시 전환', exact: true }).count(), 1);
    const nationalBefore = await page.evaluate(() => JSON.stringify(window.qaMapProps.geoJsonLayersData.national_park));
    await page.getByRole('button', { name: '+ 파일 등록', exact: true }).click();
    await assertFits('file registration');
    await page.locator('input[type=file]').setInputFiles({ name: 'field-area.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(sample)) });
    await page.getByText(/인식된 공간 레이어 \(1건\)/).waitFor();
    await page.getByRole('button', { name: '레이어 목록 탭으로 먼저 담기', exact: true }).click();
    const custom = page.getByRole('checkbox', { name: /field-area.*표시 전환/ });
    await custom.waitFor();
    const card = custom.locator('xpath=../../..');
    await card.getByRole('button', { name: '스타일·라벨 설정', exact: true }).click();
    await assertFits('style editor');
    const nameField = card.locator('input[type=text]').first();
    await nameField.fill('현장 조사구역');
    await page.getByRole('checkbox', { name: '현장 조사구역 표시 전환', exact: true }).locator('xpath=../../..').getByRole('button', { name: /속성·피처 편집/ }).click();
    const editorName = page.locator('label').filter({ hasText: /^name$/ }).locator('..').locator('input');
    await assertFits('feature editor');
    await editorName.fill('확인된 조사구역');
    await page.getByRole('button', { name: /^레이어 \(/ }).click();
    const updatedCard = page.getByRole('checkbox', { name: '현장 조사구역 표시 전환', exact: true }).locator('xpath=../../..');
    const geoDownload = page.waitForEvent('download');
    await updatedCard.getByRole('button', { name: 'GeoJSON 내보내기', exact: true }).click();
    assert.match((await geoDownload).suggestedFilename(), /\.geojson$/);
    await page.getByRole('button', { name: '기본 목록으로', exact: true }).click();
    assert.deepEqual(await order(), defaultOrder);
    assert.equal(await page.getByRole('checkbox').count(), 6);
    await page.getByRole('button', { name: /상세 관리/ }).click();
    await page.getByRole('button', { name: '저장 (운영 반영)', exact: true }).click();
    await page.waitForFunction(() => window.qaRemoteSaves?.length === 1);
    await page.getByText(/즉시 운영 반영 완료/).first().waitFor();
    const saved = await page.evaluate(() => window.qaRemoteSaves[0]);
    const savedLayer = saved.layers.find(layer => layer.name === '현장 조사구역');
    assert.ok(savedLayer);
    assert.equal(saved.geoJsonById[savedLayer.id].features[0].properties.name, '확인된 조사구역');
    assert.equal(await page.evaluate(() => JSON.stringify(window.qaMapProps.geoJsonLayersData.national_park)), nationalBefore);
    assert.ok(!JSON.stringify(saved).includes(orderKey));
    await page.getByRole('button', { name: '이력·원격연동', exact: true }).click();
    await assertFits('history');
    await page.getByRole('button', { name: '이 버전으로 복원 선택', exact: true }).first().waitFor();
    assert.ok(await page.locator('summary', { hasText: '관리자 고급 설정' }).count());
    await page.getByRole('button', { name: '이 버전으로 복원 선택', exact: true }).first().click();
    await page.getByRole('checkbox', { name: '현장 조사구역 표시 전환', exact: true }).waitFor();
    await page.getByRole('checkbox', { name: '현장 조사구역 표시 전환', exact: true }).locator('xpath=../../..').getByRole('button', { name: '삭제', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { name: '현장 조사구역 표시 전환', exact: true }).count(), 0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), records);
    if (width === 390) {
      // Synthetic obstacle exists only in this isolated QA response, never in production data.
      await page.route('**/data/operational/hazards.geojson', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [128.4, 34.8] }, properties: { id: 'qa-only', name: '테스트 장애물' } }] }) }));
      await page.reload();
      await page.waitForFunction(() => window.qaMapProps?.hazardPoints?.length === 1);
      await open();
      await page.getByRole('checkbox', { name: '갯바위 접안정보 표시', exact: true }).uncheck();
      assert.equal(await page.evaluate(() => window.qaMapProps.hazardPoints.length), 1);
      assert.equal(await countReferences('hazard'), 1);
      await page.getByRole('checkbox', { name: '항행경보 표시', exact: true }).uncheck();
      await page.waitForFunction(() => window.qaMapProps.hazardPoints.length === 0);
      assert.equal(await countReferences('hazard'), 0);
      assert.equal(await page.evaluate(() => window.qaMapProps.features.length), 0);
      await page.getByRole('checkbox', { name: '항행경보 표시', exact: true }).check();
      await page.waitForFunction(() => window.qaMapProps.hazardPoints.length === 1);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), records);
      await page.route('**/data/operational/hazards.geojson', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'QA unavailable' }));
      await page.reload();
      await page.getByText('데이터 로드 오류: 항행경보 준비 자료를 불러오지 못했습니다.', {exact:true}).waitFor();
      await page.waitForFunction(() => window.qaMapProps?.portNamePoints.length === 154);
      assert.equal(await page.evaluate(() => window.qaMapProps.hazardPoints.length), 0);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ engine, width, orderPersistence: true, mapPriorityUnchanged: true, togglesAndFilters: true, advancedImportEditExportSaveHistoryDelete: true, remoteSave: 'intercepted', nationalParkPreserved: true, porpoiseStoragePreserved: true }));
    await context.close();
  }
} finally { await browser.close(); }
