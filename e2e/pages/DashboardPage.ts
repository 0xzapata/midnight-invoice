import { Page, Locator, expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly createInvoiceButton: Locator;
  readonly invoicesList: Locator;
  readonly teamSelector: Locator;
  readonly syncStatus: Locator;

  constructor(page: Page) {
    this.page = page;
    this.createInvoiceButton = page.locator('[data-testid="create-invoice-btn"], a[href="/create"]').first();
    this.invoicesList = page.locator('[data-testid="invoices-list"], .invoices-list').first();
    this.teamSelector = page.locator('[data-testid="team-selector"]').first();
    this.syncStatus = page.locator('[data-testid="sync-status"]').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.locator('body')).toBeVisible();
  }

  async clickCreateInvoice(): Promise<void> {
    await this.createInvoiceButton.click();
    await this.page.waitForURL('**/create');
  }

  async getInvoiceCount(): Promise<number> {
    const items = this.page.locator('[data-testid="invoice-item"], .invoice-item');
    return await items.count();
  }
}
