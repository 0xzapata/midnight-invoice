import { test, expect } from './fixtures/test';
import { DashboardPage } from './pages/DashboardPage';

test.describe('Global UI Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
  });

  test('navigation renders correctly', async ({ page, capturePage }) => {
    await capturePage('navigation');
  });

  test('sync status indicator', async ({ page, capturePage }) => {
    await capturePage('sync-status');
  });

  test('dark theme applied', async ({ page, capturePage }) => {
    const body = page.locator('body');
    const hasDarkClass = await body.evaluate(el => el.classList.contains('dark'));
    expect(hasDarkClass).toBe(true);
    await capturePage('dark-theme');
  });
});

test.describe('Responsive Layouts', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 667 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'wide', width: 1920, height: 1080 },
  ];

  for (const viewport of viewports) {
    test(`dashboard at ${viewport.name} viewport`, async ({ page, capturePage }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await capturePage(`dashboard-${viewport.name}`);
    });
  }
});
