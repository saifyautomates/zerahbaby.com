import { chromium } from "playwright";

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log("BROWSER CONSOLE:", msg.type(), msg.text());
  });
  page.on("pageerror", (error) => console.log("BROWSER ERROR:", error.message, error.stack));

  await page.goto("http://localhost:8080");
  await page.waitForTimeout(3000);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("BODY TEXT:", bodyText.substring(0, 500));

  await browser.close();
})();
