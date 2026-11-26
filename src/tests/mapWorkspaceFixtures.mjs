// Synthetic Firebase and Kakao fixtures; Leaflet and application components remain real.
export let fixture = `
import React from '/node_modules/.vite/deps/react.js';
import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/index.css';
import {App} from '/src/App.tsx';
import {FirebaseAuthContext} from '/src/hooks/useFirebaseAuth.ts';
const vertex=(a,b)=>({latDms:{degrees:34,minutes:a,seconds:0,hemisphere:'N'},lngDms:{degrees:128,minutes:b,seconds:0,hemisphere:'E'},lat:34+a/60,lng:128+b/60});
const make=(id,number,b,start='2026-11-19',end='2026-11-19')=>({id,permitNumber:'통영양식 제'+number+'호',target:'미역',sourceCrs:'EPSG:4326',vertices:[vertex(48,b),vertex(48,b+1),vertex(49,b+1),vertex(49,b)],startDate:start,endDate:end,notes:'',schemaVersion:1,authorUid:'owner',authorName:'범진',revision:1});
window.qaFixtures=[make('p1',1531,32),make('p2',1532,34),make('p3',1533,36),make('expired',1534,38,'2026-11-01','2026-11-18'),make('future',1535,40,'2026-11-20','2026-11-20')];
window.qaPermitSubscriptions=0;window.qaCamera=[];window.qaShapes=[];window.qaOverlays=[];
const none=async()=>{};
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(FirebaseAuthContext.Provider,{value:{status:'ready',user:{uid:'owner'},profile:{uid:'owner',realName:'범진'},error:'',busy:false,editingName:false,login:none,logout:none,retryProfile:none,saveName:none,editName:none,cancelEditName:none}},React.createElement(App)));
`;
export const service = `
export function subscribePermits(db,next){window.qaPermitSubscriptions++;window.qaEmit=records=>next(records,false);queueMicrotask(()=>next([],false));return()=>{window.qaEmit=undefined;};}
export function subscribeInvestigations(db,vessel,month,next){queueMicrotask(()=>next([],false));return()=>{};}
export const savePermit=async()=>{throw new Error('No writes in map QA');};
export const deletePermit=savePermit,addInvestigations=savePermit,updateInvestigation=savePermit,deleteInvestigation=savePermit;
`;
export const mapView = `
import React from '/node_modules/.vite/deps/react.js';
import L from '/node_modules/.vite/deps/leaflet.js';
const leafletStyles = document.createElement('link');
leafletStyles.rel = 'stylesheet'; leafletStyles.href = '/node_modules/leaflet/dist/leaflet.css'; document.head.append(leafletStyles);
import {LegacyLeafletCanvas} from '/src/components/map/LegacyLeafletCanvas.tsx';
import {KakaoMapCanvas} from '/src/components/map/KakaoMapCanvas.tsx';
const fit=L.Map.prototype.qaOriginalFitBounds??L.Map.prototype.fitBounds;L.Map.prototype.qaOriginalFitBounds=fit;
L.Map.prototype.fitBounds=function(...args){window.qaCamera.push('fitBounds');return fit.apply(this,args);};
const markerAdd=L.Marker.prototype.onAdd;
L.Marker.prototype.onAdd=function(map){
  window.qaLeafletMap=map;
  if(this.options.icon?.options.className==='reference-map-point') (window.qaReferenceMarkers??=[]).push(this);
  return markerAdd.call(this,map);
};
class LatLng{constructor(lat,lng){this.lat=lat;this.lng=lng;}getLat(){return this.lat;}getLng(){return this.lng;}}
class Bounds{constructor(){this.points=[];}extend(p){this.points.push(p);}}
class Map{constructor(el,o){this.center=o.center;this.level=o.level;window.qaKakaoMap=this;}getCenter(){return this.center;}setCenter(p){this.center=p;}getLevel(){return this.level;}setLevel(v){this.level=v;}setBounds(b){window.qaCamera.push('setBounds');this.center=b.points[0];}relayout(){}setMapTypeId(){}addOverlayMapTypeId(){}removeOverlayMapTypeId(){}}
class Shape{constructor(o){this.options=o;this.map=o.map;window.qaShapes.push(this);}setMap(m){this.map=m;}}
class Overlay{constructor(o){this.options=o;this.map=o.map;window.qaOverlays.push(this);}setMap(m){this.map=m;}getPosition(){return this.options.position;}setPosition(p){this.options.position=p;}}
const sdk={LatLng,LatLngBounds:Bounds,Map,Polygon:Shape,Polyline:Shape,Circle:Shape,CustomOverlay:Overlay,MapTypeId:{ROADMAP:1,SKYVIEW:2,HYBRID:3},event:{addListener(target,name,fn){(target.qaListeners??={})[name]=fn;},removeListener(target,name){delete target.qaListeners?.[name];},preventMap(){}}};
const viewport={lat:34.8195,lng:128.552,zoom:11},overlays=[];
export function MapView(props){window.qaMapProps=props;const Canvas=window.qaEngine==='kakao'?KakaoMapCanvas:LegacyLeafletCanvas;return React.createElement('div',{style:{height:'100dvh'}},React.createElement(Canvas,{...props,kakaoMaps:sdk,baseMapType:'roadmap',overlayMapTypes:overlays,viewport,onViewportChange:()=>{},zoomStepTrigger:null,onMapClickForRoadview:()=>{}}));}
`;

export async function loadMapViewFixture(origin) {
  const [appSource,mainSource] = await Promise.all(['/src/App.tsx','/src/main.tsx'].map(async path => (await fetch(origin+path)).text()));
  const reactModule = appSource.match(/["']([^"']*\/react\.js[^"']*)["']/)?.[1];
  const domModule = mainSource.match(/["']([^"']*\/react-dom_client\.js[^"']*)["']/)?.[1];
  if (!reactModule || !domModule) throw Error('Vite React module URL not found');
  // Use exactly the application's optimized instances, including its cache directory/query.
  // Separate Vite servers/cache generations otherwise create an invalid-hook-call in QA.
  fixture = fixture.replace('/node_modules/.vite/deps/react.js',reactModule).replace('/node_modules/.vite/deps/react-dom_client.js',domModule);
  const response = await fetch(origin + '/src/components/map/LegacyLeafletCanvas.tsx');
  const canvas = await response.text();
  const leafletModule = canvas.match(/["']([^"']*\/leaflet\.js[^"']*)["']/)?.[1];
  if (!leafletModule) throw Error('Vite Leaflet module URL not found');
  // Instrument the same optimized module instance as the real canvas, including Vite's query.
  return mapView.replace('/node_modules/.vite/deps/leaflet.js',leafletModule).replace('/node_modules/.vite/deps/react.js',reactModule);
}
