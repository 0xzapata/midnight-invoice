import { test, expect } from './fixtures/test';
import { CreateInvoicePage } from './pages/CreateInvoicePage';

test.describe('Create Invoice Visual Regression', () => {
  let createInvoicePage: CreateInvoicePage;

  test.beforeEach(async ({ page }) => {
    createInvoicePage = new CreateInvoicePage(page);
    await createInvoicePage.goto();
  });

  test('create invoice form renders correctly', async ({ page, capturePage }) => {
    await createInvoicePage.expectLoaded();
    await capturePage('create-invoice-form');
  });

  test('create invoice with filled data', async ({ page, capturePage }) => {
    await createInvoicePage.expectLoaded();
    await createInvoicePage.fillInvoiceNumber('INV-001');
    await capturePage('create-invoice-filled');
  });

  test('create invoice mobile view', async ({ page, capturePage }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await createInvoicePage.expectLoaded();
    await capturePage('create-invoice-mobile', { fullPage: true });
  });
});
