import type { AppConfig, MapLayerConfig } from '../types/config';
import type {
  GitHubSyncConfig,
  GitHubSyncResult,
  SpatialFeatureCollection,
} from '../types/spatialLayer';

const LS_KEY_GITHUB_SYNC_CONFIG = 'bada_github_sync_config_v1';

export interface GitHubRepoCoords {
  owner: string;
  repo: string;
}

const FALLBACK_REPO_COORDS: GitHubRepoCoords = {
  owner: 'gunnysis',
  repo: 'bada-kkomkkomi',
};

/**
 * Vite 빌드 base 경로 결정 순수 함수 (vite.config.ts 및 단위 테스트 공용)
 * - 1순위: VITE_BASE_PATH 명시값 ('/' 또는 '/custom-path/')
 * - 2순위: GITHUB_ACTIONS === 'true'일 때 GITHUB_REPOSITORY ('owner/repo') 파싱
 *          ('<owner>.github.io' 사용자/조직 루트 사이트면 '/', 일반 프로젝트 저장소면 '/<repo>/')
 * - 3순위: 로컬 개발 기본값 '/'
 */
export function resolveViteBasePath(
  env?: {
    VITE_BASE_PATH?: string;
    GITHUB_ACTIONS?: string;
    GITHUB_REPOSITORY?: string;
  } | null,
): string {
  const explicitBase = env?.VITE_BASE_PATH?.trim();
  if (explicitBase) {
    const stripped = explicitBase.replace(/^\/+|\/+$/g, '');
    return stripped ? `/${stripped}/` : '/';
  }

  if (env?.GITHUB_ACTIONS === 'true') {
    const repoFull = env?.GITHUB_REPOSITORY?.trim() ?? '';
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

/**
 * 런타임 URL(*.github.io) 또는 환경변수에서 기본 GitHub 저장소(owner/repo) 자동 추론
 */
export function inferDefaultGitHubRepoCoords(
  loc?: { hostname?: string; pathname?: string } | null,
  env?: { owner?: string; repo?: string } | null,
): GitHubRepoCoords {
  const envOwner = env?.owner?.trim();
  const envRepo = env?.repo?.trim();
  if (envOwner && envRepo) {
    return { owner: envOwner, repo: envRepo };
  }

  const runtimeLoc =
    loc !== undefined
      ? loc
      : typeof window !== 'undefined'
        ? window.location
        : null;
  const hostname = runtimeLoc?.hostname?.trim().toLowerCase() ?? '';
  const pathname = runtimeLoc?.pathname?.trim() ?? '';

  if (hostname.endsWith('.github.io')) {
    const inferredOwner = hostname.slice(0, -'.github.io'.length).trim();
    const firstSegment = pathname
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (inferredOwner) {
      return {
        owner: envOwner || inferredOwner,
        repo: envRepo || firstSegment || `${inferredOwner}.github.io`,
      };
    }
  }

  return {
    owner: envOwner || FALLBACK_REPO_COORDS.owner,
    repo: envRepo || FALLBACK_REPO_COORDS.repo,
  };
}

function buildDefaultSyncConfig(): GitHubSyncConfig {
  const inlineMetaEnv = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const coords = inferDefaultGitHubRepoCoords(undefined, {
    owner: inlineMetaEnv?.VITE_GITHUB_REPO_OWNER?.trim(),
    repo: inlineMetaEnv?.VITE_GITHUB_REPO_NAME?.trim(),
  });
  return {
    owner: coords.owner,
    repo: coords.repo,
    branch: 'main',
    token: '',
    autoCommitOnSave: false,
  };
}

export function loadGitHubSyncConfig(): GitHubSyncConfig {
  const defaults = buildDefaultSyncConfig();
  try {
    const raw = localStorage.getItem(LS_KEY_GITHUB_SYNC_CONFIG);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      owner: parsed.owner?.trim() || defaults.owner,
      repo: parsed.repo?.trim() || defaults.repo,
      branch: parsed.branch?.trim() || defaults.branch,
      token: typeof parsed.token === 'string' ? parsed.token.trim() : '',
      autoCommitOnSave:
        typeof parsed.autoCommitOnSave === 'boolean'
          ? parsed.autoCommitOnSave
          : defaults.autoCommitOnSave,
    };
  } catch {
    return defaults;
  }
}

export function saveGitHubSyncConfig(next: GitHubSyncConfig): void {
  const defaults = buildDefaultSyncConfig();
  try {
    localStorage.setItem(
      LS_KEY_GITHUB_SYNC_CONFIG,
      JSON.stringify({
        owner: next.owner.trim() || defaults.owner,
        repo: next.repo.trim() || defaults.repo,
        branch: next.branch.trim() || defaults.branch,
        token: next.token.trim(),
        autoCommitOnSave: next.autoCommitOnSave,
      }),
    );
  } catch {
    // ignore
  }
}

/**
 * 관리 화면에서 [저장] 버튼 클릭 시 호출:
 * 원격 GitHub 저장소(main 브랜치)에 변경된 레이어 GeoJSON 파일들(public/data/layers/*.geojson)과
 * 설정 파일(public/config/app_config.json)을 단일 원자적 커밋(Single Atomic Commit)으로 즉시 푸시하여
 * GitHub Pages 자동 배포(deploy-pages.yml)를 트리거합니다.
 */
export async function commitLayersToGitHubRepository(params: {
  baseAppConfig: AppConfig;
  layers: MapLayerConfig[];
  geoJsonById: Record<string, SpatialFeatureCollection>;
  releaseId: string;
  summary: string;
  syncConfig?: GitHubSyncConfig;
}): Promise<GitHubSyncResult> {
  const cfg = params.syncConfig ?? loadGitHubSyncConfig();
  const token = cfg.token.trim();

  if (!token || !cfg.autoCommitOnSave) {
    return {
      success: true,
      status: 'local_only',
      message:
        '현재 기기(브라우저 IndexedDB)에 저장되었습니다. (전 직원 단말기 배포는 GitHub 커밋 또는 관리자 고급 설정의 원격 자동 커밋 활성화 시 수행됩니다.)',
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: true,
      status: 'local_only',
      message:
        '오프라인 상태이므로 앱 및 기기 영속 저장소에 먼저 즉시 운영 반영되었습니다. 온라인 복귀 후 동기화할 수 있습니다.',
    };
  }

  const apiBase = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(
    cfg.repo,
  )}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    // 1. 대상 브랜치(main) 최신 HEAD SHA 조회
    const refRes = await fetch(
      `${apiBase}/git/ref/heads/${encodeURIComponent(cfg.branch)}`,
      { headers },
    );
    if (!refRes.ok) {
      throw new Error(`GitHub 브랜치 조회 실패 (HTTP ${refRes.status})`);
    }
    const refData = await refRes.json();
    const latestCommitSha: string = refData?.object?.sha;
    if (!latestCommitSha) {
      throw new Error('원격 브랜치의 최신 커밋 SHA를 확인할 수 없습니다.');
    }

    // 2. 최신 커밋의 Base Tree SHA 조회
    const commitRes = await fetch(`${apiBase}/git/commits/${latestCommitSha}`, { headers });
    if (!commitRes.ok) {
      throw new Error(`GitHub 커밋 트리 조회 실패 (HTTP ${commitRes.status})`);
    }
    const commitData = await commitRes.json();
    const baseTreeSha: string = commitData?.tree?.sha;

    // 3. 커밋할 파일 트리 항목 구성 (public/data/layers/<id>.geojson + public/config/app_config.json)
    const normalizedLayers: MapLayerConfig[] = params.layers.map((layer) => {
      if (layer.id === 'docking' || layer.isSystemLayer) return layer;
      const safeFileId = layer.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      return {
        ...layer,
        url: layer.url || `/data/layers/${safeFileId}.geojson`,
      };
    });

    const treeItems: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      content: string;
    }> = [];

    for (const layer of normalizedLayers) {
      if (layer.id === 'docking' || layer.isSystemLayer) continue;
      const fc = params.geoJsonById[layer.id];
      if (!fc) continue;
      const relUrl = (layer.url || `/data/layers/${layer.id}.geojson`).replace(/^\/+/, '');
      const repoPath = `public/${relUrl}`;
      treeItems.push({
        path: repoPath,
        mode: '100644',
        type: 'blob',
        content: `${JSON.stringify(fc, null, 2)}\n`,
      });
    }

    const updatedAppConfig: AppConfig = {
      ...params.baseAppConfig,
      layers: normalizedLayers,
    };

    treeItems.push({
      path: 'public/config/app_config.json',
      mode: '100644',
      type: 'blob',
      content: `${JSON.stringify(updatedAppConfig, null, 2)}\n`,
    });

    // 4. 새 Git Tree 생성
    const createTreeRes = await fetch(`${apiBase}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });
    if (!createTreeRes.ok) {
      throw new Error(`GitHub Tree 생성 실패 (HTTP ${createTreeRes.status})`);
    }
    const newTreeData = await createTreeRes.json();

    // 5. 새 Git Commit 생성
    const createCommitRes = await fetch(`${apiBase}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: `feat(layers): apply operational spatial layers [${params.releaseId}] — ${params.summary}`,
        tree: newTreeData.sha,
        parents: [latestCommitSha],
      }),
    });
    if (!createCommitRes.ok) {
      throw new Error(`GitHub Commit 생성 실패 (HTTP ${createCommitRes.status})`);
    }
    const newCommitData = await createCommitRes.json();

    // 6. 브랜치 HEAD 포인터 업데이트
    const updateRefRes = await fetch(
      `${apiBase}/git/refs/heads/${encodeURIComponent(cfg.branch)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          sha: newCommitData.sha,
          force: false,
        }),
      },
    );
    if (!updateRefRes.ok) {
      throw new Error(`GitHub 브랜치 반영 실패 (HTTP ${updateRefRes.status})`);
    }

    const commitSha = String(newCommitData.sha);
    const commitUrl = `https://github.com/${cfg.owner}/${cfg.repo}/commit/${commitSha}`;

    return {
      success: true,
      status: 'synced',
      commitSha,
      commitUrl,
      message: `앱 즉시 반영 및 원격 저장소(${cfg.branch}) 자동 배포 커밋(${commitSha.slice(
        0,
        7,
      )})이 완료되었습니다.`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      status: 'failed',
      message: `기기 내 운영 반영은 완료되었으나 원격 GitHub 동기화 중 오류가 발생했습니다: ${
        err instanceof Error ? err.message : '알 수 없는 오류'
      }`,
    };
  }
}
