import { test, expect } from '@playwright/test';

const PROD_URL = 'https://zerahkids.com';

test.describe('Final Production Smoke Test - Zerah Kids', () => {
  test('1. Environment & Localhost Leak Verification', async ({ page }) => {
    const errors: string[] = [];
    const consoleLogs: string[] = [];
    
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleLogs.push(msg.text());
      }
    });

    // Listen for failed network requests
    page.on('requestfailed', request => {
      errors.push(`Request failed: ${request.url()} - ${request.failure()?.errorText}`);
    });

    page.on('response', response => {
      if (response.status() >= 400 && response.status() !== 404) { // Ignore 404s for tracking pixels etc
        if (!response.url().includes('google-analytics') && !response.url().includes('facebook')) {
          errors.push(`HTTP Error: ${response.url()} - Status: ${response.status()}`);
        }
      }
      
      // Check for localhost leaks in network requests
      if (response.url().includes('localhost') || response.url().includes('127.0.0.1')) {
        errors.push(`LOCALHOST LEAK FOUND IN NETWORK: ${response.url()}`);
      }
    });

    await page.goto(PROD_URL, { waitUntil: 'networkidle' });

    // Verify title and basic layout
    await expect(page).toHaveTitle(/Zerah/i);
    
    // Check if body content contains localhost
    const pageContent = await page.content();
    if (pageContent.includes('localhost:') || pageContent.includes('127.0.0.1:')) {
      errors.push('LOCALHOST LEAK FOUND IN DOM CONTENT');
    }

    console.log('--- Network & Console Errors ---');
    console.log(errors);
    console.log(consoleLogs);
    console.log('--------------------------------');
    
    expect(errors.filter(e => e.includes('LOCALHOST'))).toHaveLength(0);
  });

  test('2. Home Page Smoke Test', async ({ page }) => {
    await page.goto(PROD_URL);
    
    // Check for logo
    const logo = page.locator('header img, header svg').first();
    await expect(logo).toBeVisible();

    // Check navigation
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible();
    
    // Check search functionality
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]').first();
    if (await searchInput.isVisible()) {
       await searchInput.fill('dress');
       // If there's a search button, click it, or just press Enter
       await searchInput.press('Enter');
       await page.waitForLoadState('networkidle');
       expect(page.url()).toContain('search'); // or similar
    }
  });

  test('3. Shop & Product Detail Smoke Test', async ({ page }) => {
    // Go to shop or search page
    await page.goto(`${PROD_URL}/shop`);
    
    // Click on the first product
    const firstProduct = page.locator('a[href*="/product/"]').first();
    if (await firstProduct.isVisible()) {
      await firstProduct.click();
      await page.waitForLoadState('networkidle');
      
      // Verify product page elements
      const addToCart = page.locator('button:has-text("Add to Cart"), button:has-text("Add To Cart")');
      await expect(addToCart).toBeVisible();
      
      // Add to cart
      await addToCart.click();
      
      // Verify cart updates
      const cartIcon = page.locator('a[href*="/cart"], button:has-text("Cart")').first();
      await expect(cartIcon).toBeVisible();
    }
  });

  test('4. Admin Login Entry Verification', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin`);
    // Should be redirected to login or show login form
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
  });
});
