export interface InstallationDevice {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/** Instructions only: installation availability is decided by beforeinstallprompt. */
export function installationInstructions(device: InstallationDevice): string[] {
  if (/iPad|iPhone|iPod/.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1)) {
    return ['Safari에서 바다꼼꼬미를 엽니다.', '공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택합니다.', '앱 이름을 확인하고 ‘추가’를 누릅니다.'];
  }
  if (/Android/.test(device.userAgent)) {
    return ['Chrome 등 설치를 지원하는 브라우저에서 바다꼼꼬미를 엽니다.', '브라우저 메뉴(⋮)에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택합니다.', '메뉴가 보이지 않으면 Chrome으로 다시 열거나 이미 추가되어 있는지 확인해 주세요.'];
  }
  return ['Chrome 또는 Edge에서 바다꼼꼬미를 엽니다.', '주소창의 설치 아이콘 또는 브라우저 메뉴의 앱 설치 항목을 선택합니다.', '설치 항목이 보이지 않으면 이 브라우저에서 설치를 지원하지 않거나 이미 설치되어 있을 수 있습니다.'];
}
