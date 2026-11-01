import { describe, expect, it } from 'vitest';
import {
  applyQualityPreset, CLIENT_SETTINGS_STORAGE_KEY, defaultClientSettings, exposureForBrightness,
  getRenderPixelRatio, loadClientSettings, normalizeClientSettings, saveClientSettings,
  type ClientSettings, type SettingsStorage,
} from '../src/client/settings';
import { volumePercentToGain } from '../src/client/systems/audio';

class MemoryStorage implements SettingsStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('persistent client presentation settings', () => {
  it('preserves established defaults and honors the operating-system motion preference', () => {
    expect(defaultClientSettings()).toEqual({
      graphics: { quality: 'medium', brightness: 100, renderScale: 100, shadows: true, reducedMotion: false },
      volume: 65,
    });
    expect(defaultClientSettings(true).graphics.reducedMotion).toBe(true);
    expect(loadClientSettings(null, true).graphics.reducedMotion).toBe(true);
  });

  it('retains valid local preferences without requiring an account or server mutation', () => {
    const settings = normalizeClientSettings({
      graphics: { quality: 'high', brightness: 125, renderScale: 75, shadows: false, reducedMotion: true },
      volume: 30,
      unexpected: 'ignored',
    });
    expect(settings).toEqual({
      graphics: { quality: 'high', brightness: 125, renderScale: 75, shadows: false, reducedMotion: true },
      volume: 30,
    });
    expect(settings).not.toHaveProperty('unexpected');
  });

  it('clamps numeric ranges and rejects invalid enum and boolean values', () => {
    const settings = normalizeClientSettings({
      graphics: { quality: 'ultra', brightness: 999, renderScale: 50, shadows: 'yes', reducedMotion: 'no' },
      volume: -20,
    }, true);
    expect(settings.graphics).toEqual({ quality: 'medium', brightness: 130, renderScale: 100, shadows: true, reducedMotion: true });
    expect(settings.volume).toBe(0);
  });

  it('computes bounded drawing-buffer ratios for quality, resolution scale and view caps', () => {
    const graphics = defaultClientSettings().graphics;
    expect(getRenderPixelRatio(graphics, 2)).toBeCloseTo(1.65);
    expect(getRenderPixelRatio({ ...graphics, quality: 'low' }, 2)).toBe(1);
    expect(getRenderPixelRatio({ ...graphics, quality: 'high' }, 2)).toBe(2);
    expect(getRenderPixelRatio({ ...graphics, quality: 'high', renderScale: 60 }, 2)).toBeCloseTo(1.2);
    expect(getRenderPixelRatio({ ...graphics, quality: 'high' }, 2, 1.5)).toBe(1.5);
    expect(getRenderPixelRatio(graphics, Number.NaN)).toBe(1);
  });

  it('applies presets as practical starting points while allowing manual overrides', () => {
    const graphics = { ...defaultClientSettings().graphics, renderScale: 75 as const, shadows: true };
    expect(applyQualityPreset(graphics, 'low')).toMatchObject({ quality: 'low', renderScale: 100, shadows: false });
    expect(applyQualityPreset(graphics, 'high')).toMatchObject({ quality: 'high', renderScale: 100, shadows: true });
    expect({ ...applyQualityPreset(graphics, 'low'), shadows: true }.shadows).toBe(true);
  });

  it('round-trips settings and falls back safely for corrupt or unavailable storage', () => {
    const storage = new MemoryStorage();
    const settings: ClientSettings = {
      graphics: { quality: 'low', brightness: 115, renderScale: 60, shadows: false, reducedMotion: true },
      volume: 40,
    };
    expect(saveClientSettings(settings, storage)).toBe(true);
    expect(storage.getItem(CLIENT_SETTINGS_STORAGE_KEY)).toContain('"brightness":115');
    expect(loadClientSettings(storage)).toEqual(settings);

    storage.setItem(CLIENT_SETTINGS_STORAGE_KEY, '{broken json');
    expect(loadClientSettings(storage)).toEqual(defaultClientSettings());
    const blocked: SettingsStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('full'); },
    };
    expect(loadClientSettings(blocked)).toEqual(defaultClientSettings());
    expect(saveClientSettings(settings, blocked)).toBe(false);
    expect(saveClientSettings(settings, null)).toBe(false);
  });

  it('bounds display exposure and preserves the canonical profile at 100 percent', () => {
    expect(exposureForBrightness(1.32, 100)).toBeCloseTo(1.32);
    expect(exposureForBrightness(1.32, 80)).toBeCloseTo(1.056);
    expect(exposureForBrightness(1.32, 130)).toBeCloseTo(1.716);
    expect(exposureForBrightness(1.32, 999)).toBeCloseTo(1.716);
  });

  it('converts the volume percentage to bounded Web Audio gain', () => {
    expect(volumePercentToGain(65)).toBeCloseTo(0.65);
    expect(volumePercentToGain(0)).toBe(0);
    expect(volumePercentToGain(100)).toBe(1);
    expect(volumePercentToGain(500)).toBe(1);
    expect(volumePercentToGain(-5)).toBe(0);
    expect(volumePercentToGain(Number.NaN)).toBe(0);
  });
});
