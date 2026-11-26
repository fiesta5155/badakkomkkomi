export const ROCK_DOCKING_MIN_ZOOM = 12;
export const ROCK_DOCKING_BOUNDARY_CM = 10;
export const ROCK_DOCKING_PHOTO_MAX_BYTES = 512000;
// Storage rules and the approved cross-service IAM role are deployed; browser/CORS validation is manual.
export const ROCK_DOCKING_STORAGE_ENABLED = true;
// The existing KHOA snapshot does not declare either value. Do not infer them.
export const ROCK_DOCKING_TIDE_REFERENCE: { datum: 'DL'; timeZone: 'Asia/Seoul'; source: string } | null = null;

// photo-1..photo-4: fixed UUIDs retain compatibility with the deployed Firestore rules.
// The per-point directory provides uniqueness; no fifth filename may be created.
export const ROCK_DOCKING_PHOTO_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
] as const;
