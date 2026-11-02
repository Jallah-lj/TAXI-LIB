export type GraphicsQuality = 'low' | 'medium' | 'high';
export type RenderScale = 60 | 75 | 100;

export interface GraphicsSettings {
  quality: GraphicsQuality;
  brightness: number;
  renderScale: RenderScale;
  shadows: boolean;
  reducedMotion: boolean;
}

export interface ClientSettings {
  graphics: GraphicsSettings;
  /** Master volume as a percentage. AudioSystem converts it to Web Audio gain. */
  volume: number;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const CLIENT_SETTINGS_STORAGE_KEY = 'taxi-lib.client-settings.v1';
export const BRIGHTNESS_MIN = 80;
export const BRIGHTNESS_MAX = 130;

export const QUALITY_PROFILES = {
  low: { pixelRatioCap: 1, shadowMapSize: 512, rainFraction: 0.45, reflectionSize: 256, showroomShadowMapSize: 512 },
  medium: { pixelRatioCap: 1.65, shadowMapSize: 2048, rainFraction: 1, reflectionSize: 512, showroomShadowMapSize: 1024 },
  high: { pixelRatioCap: 2, shadowMapSize: 4096, rainFraction: 1, reflectionSize: 1024, showroomShadowMapSize: 2048 },
} as const satisfies Record<GraphicsQuality, {
  pixelRatioCap: number;
  shadowMapSize: number;
  rainFraction: number;
  reflectionSize: number;
  showroomShadowMapSize: number;
}>;

export function defaultClientSettings(systemReducedMotion = false): ClientSettings {
  return {
    graphics: {
      quality: 'medium', brightness: 100, renderScale: 100,
      shadows: true, reducedMotion: systemReducedMotion,
    },
    // Preserve the previous effective master gain of 0.65.
    volume: 65,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function quality(value: unknown, fallback: GraphicsQuality): GraphicsQuality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : fallback;
}

function renderScale(value: unknown, fallback: RenderScale): RenderScale {
  return value === 60 || value === 75 || value === 100 ? value : fallback;
}

/** Treat persisted preferences as untrusted input and retain only presentation settings. */
export function normalizeClientSettings(value: unknown, systemReducedMotion = false): ClientSettings {
  const defaults = defaultClientSettings(systemReducedMotion);
  if (!isRecord(value)) return defaults;
  const graphics = isRecord(value.graphics) ? value.graphics : {};
  return {
    graphics: {
      quality: quality(graphics.quality, defaults.graphics.quality),
      brightness: boundedNumber(graphics.brightness, defaults.graphics.brightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX),
      renderScale: renderScale(graphics.renderScale, defaults.graphics.renderScale),
      shadows: typeof graphics.shadows === 'boolean' ? graphics.shadows : defaults.graphics.shadows,
      reducedMotion: typeof graphics.reducedMotion === 'boolean' ? graphics.reducedMotion : defaults.graphics.reducedMotion,
    },
    volume: boundedNumber(value.volume, defaults.volume, 0, 100),
  };
}

export function applyQualityPreset(settings: GraphicsSettings, preset: GraphicsQuality): GraphicsSettings {
  return {
    ...settings,
    quality: preset,
    renderScale: 100,
    shadows: preset !== 'low',
  };
}

/** Actual drawing-buffer ratio, including the user's resolution scale and an optional view-specific cap. */
export function getRenderPixelRatio(settings: GraphicsSettings, devicePixelRatio = 1, viewCap = Number.POSITIVE_INFINITY) {
  const deviceRatio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cap = Math.min(QUALITY_PROFILES[settings.quality].pixelRatioCap, viewCap);
  return Math.max(0.5, Math.min(cap, deviceRatio) * settings.renderScale / 100);
}

export function exposureForBrightness(baseExposure: number, brightness: number) {
  return baseExposure * boundedNumber(brightness, 100, BRIGHTNESS_MIN, BRIGHTNESS_MAX) / 100;
}

export function loadClientSettings(storage: SettingsStorage | null, systemReducedMotion = false): ClientSettings {
  if (!storage) return defaultClientSettings(systemReducedMotion);
  try {
    const serialized = storage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    return serialized ? normalizeClientSettings(JSON.parse(serialized), systemReducedMotion) : defaultClientSettings(systemReducedMotion);
  } catch {
    return defaultClientSettings(systemReducedMotion);
  }
}

/** Returns false when storage is blocked/full; settings still apply for the current tab. */
export function saveClientSettings(settings: ClientSettings, storage: SettingsStorage | null) {
  if (!storage) return false;
  try {
    storage.setItem(CLIENT_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeClientSettings(settings, settings.graphics.reducedMotion)));
    return true;
  } catch {
    return false;
  }
}
