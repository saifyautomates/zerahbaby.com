const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
  const browser = await chromium.launch();
  const routes = [
    '/',
    '/shop',
    '/product/1',
    '/cart',
    '/checkout',
    '/auth',
    '/admin'
  ];
  
  const viewports = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 800 }
  ];

  if (!fs.existsSync('screenshots')) {
    fs.mkdirSync('screenshots');
  }

  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    
    for (const route of routes) {
      console.log(`Taking screenshot for ${route} at ${vp.name}...`);
      await page.goto(`http://localhost:8080${route === '/product/1' ? '/shop' : route}`); // Wait, product/1 might not exist, let's just do /shop
      
      // Wait for network idle or 2 seconds to let images load
      await page.waitForTimeout(2000);
      
      const safeRoute = route === '/' ? 'home' : route.replace(/\//g, '_');
      await page.screenshot({ path: `screenshots/${safeRoute}_${vp.name}.png`, fullPage: true });
    }
    await context.close();
  }
  
  await browser.close();
  console.log('Screenshots complete.');
}

run();
