import { describe, expect, it } from 'vitest';
import { defaultAppEnv } from './env';

describe('VITE_APP_ENV default', () => {
  it('is PRODUCTION in builds, so a deploy without a .env shows no development banner', () => {
    expect(defaultAppEnv(true)).toBe('PRODUCTION');
    expect(defaultAppEnv(false)).toBe('DEVELOPMENT');
  });
});
