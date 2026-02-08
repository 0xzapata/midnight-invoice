import { Page, Locator, expect } from '@playwright/test';

export class CreateInvoicePage {
  readonly page: Page;
  readonly invoiceNumber: Locator;
  readonly clientSelect: Locator;
  readonly dateInput: Locator;
  readonly dueDateInput: Locator;
  readonly addItemButton: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.invoiceNumber = page.locator('input[name="invoiceNumber"], [data-testid="invoice-number"]').first();
    this.clientSelect = page.locator('[data-testid="client-select"], select[name="client"]').first();
    this.dateInput = page.locator('input[name="date"], input[type="date"]').first();
    this.dueDateInput = page.locator('input[name="dueDate"], input[name="due"]').first();
    this.addItemButton = page.locator('button:has-text("Add Item"), [data-testid="add-item-btn"]').first();
    this.saveButton = page.locator('button:has-text("Save"), button[type="submit"]').first();
    this.cancelButton = page.locator('button:has-text("Cancel"), a:has-text("Cancel")').first();
  }

  async goto(): Promise<void> {
    await this.page.goto('/create');
    await this.page.waitForLoadState('networkidle');
  }

  async expectLoaded(): Promise<void> {
    await expect(this.invoiceNumber.or(this.clientSelect)).toBeVisible();
  }

  async fillInvoiceNumber(value: string): Promise<void> {
    await this.invoiceNumber.fill(value);
  }

  async clickAddItem(): Promise<void> {
    await this.addItemButton.click();
  }

  async saveInvoice(): Promise<void> {
    await this.saveButton.click();
  }
}
