import { test, expect } from './fixtures/test';
import { DashboardPage } from './pages/DashboardPage';

test.describe('Dashboard Visual Regression', () => {
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
  });

  test('dashboard renders correctly', async ({ page, capturePage }) => {
    await dashboardPage.expectLoaded();
    await capturePage('dashboard');
  });

  test('dashboard empty state', async ({ page, capturePage }) => {
    await dashboardPage.expectLoaded();
    await capturePage('dashboard-empty');
  });

  test('dashboard with invoices', async ({ page, capturePage }) => {
    await dashboardPage.expectLoaded();
    await capturePage('dashboard-with-invoices');
  });
});
