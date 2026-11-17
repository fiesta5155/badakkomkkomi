export interface FirebaseEnvironment {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
}

export function resolveFirebaseConfig(env: FirebaseEnvironment) {
  const config = {
    apiKey: env.apiKey?.trim(),
    authDomain: env.authDomain?.trim(),
    projectId: env.projectId?.trim(),
    storageBucket: env.storageBucket?.trim() || undefined,
    messagingSenderId: env.messagingSenderId?.trim() || undefined,
    appId: env.appId?.trim(),
    measurementId: env.measurementId?.trim() || undefined,
  };
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
    return { config: null, error: 'Google 로그인 설정이 아직 준비되지 않았습니다.' };
  }
  if (config.projectId !== 'badakkomkkomi-firebase') {
    return { config: null, error: 'Firebase 프로젝트 설정을 확인해 주세요.' };
  }
  return { config, error: '' };
}
