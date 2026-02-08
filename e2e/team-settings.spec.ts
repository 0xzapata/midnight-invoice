import { test, expect } from './fixtures/test';
import { DashboardPage } from './pages/DashboardPage';

test.describe('Team Settings Visual Regression', () => {
  test.beforeEach(async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
  });

  test('team settings modal renders correctly', async ({ page, capturePage }) => {
    await page.click('[data-testid="team-settings-btn"], button:has-text("Settings")');
    await page.waitForSelector('[data-testid="team-settings-modal"], [role="dialog"]');
    await capturePage('team-settings-modal');
  });

  test('team member list view', async ({ page, capturePage }) => {
    await page.click('[data-testid="team-settings-btn"], button:has-text("Settings")');
    await page.click('[data-testid="members-tab"], button:has-text("Members")');
    await capturePage('team-settings-members');
  });

  test('team billing view', async ({ page, capturePage }) => {
    await page.click('[data-testid="team-settings-btn"], button:has-text("Settings")');
    await page.click('[data-testid="billing-tab"], button:has-text("Billing")');
    await capturePage('team-settings-billing');
  });
});
