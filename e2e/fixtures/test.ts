/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, Page, Locator } from '@playwright/test';

export type MaskSelectors = {
  timestamp: string;
  randomId: string;
  userEmail: string;
  dynamicText: string;
};

export const MASK_SELECTORS: MaskSelectors = {
  timestamp: '[data-testid="timestamp"], time, .timestamp',
  randomId: '[data-testid="random-id"], [data-random]',
  userEmail: '[data-testid="user-email"], .user-email',
  dynamicText: '[data-testid="dynamic-text"], .dynamic-content',
};

export async function maskDynamicContent(page: Page): Promise<Locator[]> {
  const masks: Locator[] = [];
  
  for (const selector of Object.values(MASK_SELECTORS)) {
    const elements = page.locator(selector);
    const count = await elements.count();
    if (count > 0) {
      masks.push(elements);
    }
  }
  
  return masks;
}

export async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('body');
}

export async function captureScreenshot(
  page: Page,
  name: string,
  options: { fullPage?: boolean; mask?: Locator[] } = {}
): Promise<void> {
  const { fullPage = true, mask } = options;
  
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage,
    mask: mask || await maskDynamicContent(page),
    maxDiffPixelRatio: 0.02,
  });
}

export interface TestFixtures {
  capturePage: (name: string, options?: { fullPage?: boolean }) => Promise<void>;
  waitForApp: () => Promise<void>;
}

export const test = base.extend<TestFixtures>({
  capturePage: async ({ page }, use) => {
    await use(async (name: string, options = {}) => {
      await captureScreenshot(page, name, options);
    });
  },
  waitForApp: async ({ page }, use) => {
    await use(async () => {
      await waitForAppReady(page);
    });
  },
});

export { expect };
