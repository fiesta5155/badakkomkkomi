import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createTideCachePlugin } from './scripts/khoa-tide-cache.ts';
import { navigationalWarningPreviewPlugin } from './scripts/navigational-warning-preview.ts';

function resolveViteBasePath(env: NodeJS.ProcessEnv): string {
  const explicitBase = env.VITE_BASE_PATH?.trim();
  if (explicitBase) {
    const stripped = explicitBase.replace(/^\/+|\/+$/g, '');
    return stripped ? `/${stripped}/` : '/';
  }
  if (env.GITHUB_ACTIONS === 'true') {
    const repoFull = env.GITHUB_REPOSITORY?.trim() ?? '';
    const [owner = '', repoName = ''] = repoFull.split('/');
    const cleanOwner = owner.trim();
    const cleanRepo = repoName.trim();
    if (cleanRepo) {
      if (cleanOwner && cleanRepo.toLowerCase() === `${cleanOwner.toLowerCase()}.github.io`) {
        return '/';
      }
      return `/${cleanRepo}/`;
    }
    return '/bada-kkomkkomi/';
  }
  return '/';
}

const base = resolveViteBasePath(process.env);

export default defineConfig({
  base,
  envPrefix: ['VITE_', 'KAKAO_'],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@firebase') || id.includes('/firebase/')) {
              return 'vendor-firebase';
            }
            if (id.includes('leaflet') || id.includes('react-leaflet')) {
              return 'vendor-leaflet';
            }
            if (id.includes('proj4') || id.includes('fflate')) {
              return 'vendor-gis';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    navigationalWarningPreviewPlugin(base),
    react(),
    tailwindcss(),
    {
      name: 'bada-exclude-public-dev-from-dist',
      apply: 'build',
      closeBundle() {
        // 원본 public/dev/* 파일은 절대 건드리지 않고, 빌드 산출물 폴더(dist/dev)에 복사된 사본만 제거하여 배포 아티팩트 순수성 보장
        const distDevDir = path.resolve('dist', 'dev');
        if (fs.existsSync(distDevDir)) {
          fs.rmSync(distDevDir, { recursive: true, force: true });
        }
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // workbox.globPatterns에서 public/ 정적 자산(ico, png, svg, webp, json, geojson)을 일괄 스캔하므로
      // includeAssets / includeManifestIcons 중복 선언 및 globPatterns 내 webmanifest 중복 스캔을 비활성화하여 SW 프리캐시 매니페스트 중복(0건) 보장
      includeAssets: [],
      includeManifestIcons: false,
      manifest: {
        name: '바다꼼꼬미 — 국립공원공단 해양 현장업무 접안·항해 지원 PWA',
        short_name: '바다꼼꼬미',
        description:
          '국립공원공단 한려해상(통영·거제 해역) 해양 현장업무 지원 (꼬미의 바다수첩 55개소 & 바닷길 콕콕 136개 항포구·선착장 · 특별보호구역 20개소) PWA [v2.4]',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#e0f2fe',
        theme_color: '#0284c7',
        categories: ['navigation', 'utilities', 'productivity'],
        icons: [
          {
            src: 'icons/kkomi-v3-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/kkomi-v3-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/kkomi-v3-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/kkomi-v3-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cacheId: 'bada-kkomkkomi-v2.4',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,json,geojson}'],
        globIgnores: ['**/dev/**', '**/data/tides/**', '**/data/navigational-warnings/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/data\//, /\/images\//, /\/config\//],
        runtimeCaching: [
          {
            // Warning pairs carry a generation hash; never pin old JSON in SW caches.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/data\/navigational-warnings\/(latest|status)\.json$/.test(url.pathname),
            handler: 'NetworkOnly',
            options: { fetchOptions: { cache: 'no-store' } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/data\/tides\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bada-khoa-tides-v1',
              networkTimeoutSeconds: 3,
              fetchOptions: { cache: 'no-store' },
              plugins: [createTideCachePlugin()],
            },
          },
          {
            // 1. GeoJSON 및 JSON 설정 파일: 온라인 시 3초 내 최신 파일 우선 조회(비개발자 Git Push 즉시 반영),
            // 해상 음영지역(오프라인) 시 프리캐시/런타임 캐시 즉시 반환
            urlPattern: ({ url }) =>
              url.pathname.endsWith('.geojson') || url.pathname.endsWith('.json'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bada-geojson-and-config-v2.4',
              networkTimeoutSeconds: 3,
              expiration: {
                maxEntries: 40,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30일
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // 2. 현장 접안 사진 에셋: 캐시 즉시 표시 후 백그라운드 갱신 (StaleWhileRevalidate)
            urlPattern: ({ url }) => url.pathname.includes('/images/'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bada-field-images-v2',
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 60 * 60 * 24 * 60, // 60일
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // 3-A. Kakao Maps SDK 스크립트 및 지도/스카이뷰(위성) 타일 CDN:
            // 한 번 열람한 해역의 카카오 일반지도 및 위성 타일은 해상 오프라인에서도 즉시 렌더링
            urlPattern:
              /^https:\/\/(dapi\.kakao\.com|(t\d|mts|map\d?|ctt-image|ssl)\.(kakaocdn|daumcdn)\.net)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bada-kakao-map-tiles-v1',
              expiration: {
                maxEntries: 800,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30일
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // 3-B. 오픈소스 지도 타일(OpenStreetMap - 레거시 폴백 엔진용): 한 번 열람한 해역은 해상 오프라인에서도 열람 가능
            urlPattern: /^https:\/\/[abc]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'bada-osm-tiles-v2',
              expiration: {
                maxEntries: 600,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30일
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
