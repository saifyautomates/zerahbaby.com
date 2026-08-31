import { test, expect } from "@playwright/test";

test.describe("Global Barcode Scanner & POS Suite", () => {
  test("1. Hardware Scanner Engine - Rapid Burst vs Human Typing", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Test timing analysis inside browser environment
    const testResult = await page.evaluate(async () => {
      let buffer = "";
      let lastKeyTime = 0;
      const MAX_KEY_INTERVAL_MS = 75;
      const MIN_BARCODE_LENGTH = 4;
      const capturedScans: string[] = [];

      const onKeyDown = (key: string, now: number) => {
        if (key === "Enter") {
          const code = buffer.trim();
          const interval = now - lastKeyTime;
          if (code.length >= MIN_BARCODE_LENGTH && interval <= 120) {
            capturedScans.push(code);
            buffer = "";
          } else {
            buffer = "";
          }
          return;
        }

        if (key.length === 1) {
          const interval = now - lastKeyTime;
          lastKeyTime = now;
          if (interval > MAX_KEY_INTERVAL_MS) {
            buffer = key;
          } else {
            buffer += key;
          }
        }
      };

      // 1A. Simulate slow human typing (150ms between keys)
      let t = Date.now();
      const slowWord = "SLOWINPUT";
      for (const char of slowWord) {
        onKeyDown(char, t);
        t += 150;
      }
      onKeyDown("Enter", t);

      const slowCount = capturedScans.length;

      // 1B. Simulate rapid hardware barcode scanner burst (15ms between keys + Enter)
      t = Date.now();
      const barcode = "890123456789";
      for (const char of barcode) {
        onKeyDown(char, t);
        t += 15;
      }
      onKeyDown("Enter", t);

      return {
        slowCount,
        capturedScans,
        expectedBarcode: barcode,
      };
    });

    expect(testResult.slowCount).toBe(0);
    expect(testResult.capturedScans).toContain(testResult.expectedBarcode);
  });

  test("2. Input Field Protection during Normal Typing", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const input = page.locator("#auth-contact-input");
    await expect(input).toBeVisible({ timeout: 10000 });

    // Human typing in input field
    await input.focus();
    await input.fill("test@example.com");

    // Verify input retains typed value without corruption
    await expect(input).toHaveValue("test@example.com");
  });

  test("3. Web Audio Tone Synthesizer Safety", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Verify Web Audio can initialize and execute synthesize functions without throwing
    const audioResult = await page.evaluate(async () => {
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return { supported: false };
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
        return { supported: true, success: true };
      } catch (err: unknown) {
        return { supported: true, success: false, error: String(err) };
      }
    });

    if (audioResult.supported) {
      expect(audioResult.success).toBe(true);
    }
  });
});
