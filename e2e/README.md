# Playwright Visual Regression Tests

End-to-end visual regression tests using Playwright.

## Quick Start

```bash
# Install browsers (only needed once)
bunx playwright install chromium

# Run all tests
bun run test:e2e

# Run with UI mode for debugging
bun run test:e2e:ui

# Update snapshots after intentional changes
bun run test:e2e:update
```

## Test Structure

```
e2e/
├── fixtures/
│   └── test.ts          # Custom test fixtures with screenshot helpers
├── pages/
│   ├── DashboardPage.ts      # Page object for dashboard
│   └── CreateInvoicePage.ts  # Page object for create invoice
├── dashboard.spec.ts    # Dashboard visual tests
├── create-invoice.spec.ts  # Create invoice visual tests
├── team-settings.spec.ts   # Team settings visual tests
└── global-ui.spec.ts    # Global UI and responsive tests
```

## Viewports Tested

- **Desktop**: 1280x720 (default)
- **Mobile**: 375x667 (Pixel 5)
- **Tablet**: 768x1024 (iPad Mini)

## Writing Tests

```typescript
import { test } from '../fixtures/test';
import { DashboardPage } from '../pages/DashboardPage';

test('dashboard renders correctly', async ({ page, capturePage }) => {
  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await capturePage('dashboard');
});
```

## Masking Dynamic Content

Dynamic content (timestamps, random IDs) is automatically masked:
- Add `data-testid="timestamp"` to elements that change
- Or use the `maskDynamicContent()` utility

## CI Integration

Tests run automatically in CI with:
- 2 retries on failure
- HTML report generation
- Screenshots on failure
