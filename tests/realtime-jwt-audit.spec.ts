import { test, expect } from "@playwright/test";

test.describe("Supabase Realtime JWT & Auth Lifecycle Complete Suite", () => {
  test("1. Unauthenticated storefront visitor establishes clean realtime connection without MalformedJWT", async ({
    page,
  }) => {
    const wsMessages: string[] = [];
    const consoleErrors: string[] = [];

    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("http://localhost:8080/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const malformedErrors = consoleErrors.filter(
      (e) =>
        e.includes("MalformedJWT") ||
        e.includes("Expected 3 parts in JWT") ||
        e.includes("The token provided is not a valid JWT"),
    );
    expect(malformedErrors).toHaveLength(0);

    for (const rawMsg of wsMessages) {
      expect(rawMsg).not.toContain('"access_token":"sb_publishable_');
    }
  });

  test("2. Realtime Auth Lifecycle: Login -> Token Refresh -> Logout -> Re-login", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const wsMessages: string[] = [];

    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("http://localhost:8080/");
    await page.waitForLoadState("domcontentloaded");

    // A. Verify initial unauthenticated connection
    const initialToken = await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      return (supabase.realtime as any).accessTokenValue;
    });
    expect(initialToken).toBeNull();

    // B. Simulate valid JWT session (login)
    const mockValidJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6MTk5OTk5OTk5OX0.dummySignature1234567890abcdefghijklmnopqrstuvwxyz";

    await page.evaluate(async (token) => {
      const { supabase } = await import("./src/integrations/supabase/client");
      await (supabase.realtime as any).setAuth(token);
    }, mockValidJwt);

    const authedToken = await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      return (supabase.realtime as any).accessTokenValue;
    });
    expect(authedToken).toBe(mockValidJwt);

    // C. Simulate Token Refresh with refreshed valid JWT
    const refreshedJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImV4cCI6MjAwMDAwMDAwMH0.refreshedSignature1234567890abcdefghijklmnopqrstuvwxyz";

    await page.evaluate(async (token) => {
      const { supabase } = await import("./src/integrations/supabase/client");
      await (supabase.realtime as any).setAuth(token);
    }, refreshedJwt);

    const updatedToken = await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      return (supabase.realtime as any).accessTokenValue;
    });
    expect(updatedToken).toBe(refreshedJwt);

    // D. Simulate Logout
    await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      // Supabase Gotrue calls realtime.setAuth() on logout
      await (supabase.realtime as any).setAuth();
    });

    const loggedOutToken = await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      return (supabase.realtime as any).accessTokenValue;
    });
    expect(loggedOutToken).toBeNull();

    // E. Simulate Login Again
    await page.evaluate(async (token) => {
      const { supabase } = await import("./src/integrations/supabase/client");
      await (supabase.realtime as any).setAuth(token);
    }, mockValidJwt);

    const reloggedInToken = await page.evaluate(async () => {
      const { supabase } = await import("./src/integrations/supabase/client");
      return (supabase.realtime as any).accessTokenValue;
    });
    expect(reloggedInToken).toBe(mockValidJwt);

    // F. Verify zero MalformedJWT errors occurred throughout all lifecycle steps
    const malformedErrors = consoleErrors.filter(
      (e) =>
        e.includes("MalformedJWT") ||
        e.includes("Expected 3 parts in JWT") ||
        e.includes("The token provided is not a valid JWT"),
    );
    expect(malformedErrors).toHaveLength(0);

    for (const rawMsg of wsMessages) {
      expect(rawMsg).not.toContain('"access_token":"sb_publishable_');
    }
  });

  test("3. Admin Realtime channels connect cleanly without MalformedJWT", async ({ page }) => {
    const consoleErrors: string[] = [];
    const wsMessages: string[] = [];

    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "dashboard");
    });

    await page.goto("http://localhost:8080/admin?tab=dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const malformedErrors = consoleErrors.filter(
      (e) =>
        e.includes("MalformedJWT") ||
        e.includes("Expected 3 parts in JWT") ||
        e.includes("The token provided is not a valid JWT"),
    );
    expect(malformedErrors).toHaveLength(0);

    for (const rawMsg of wsMessages) {
      expect(rawMsg).not.toContain('"access_token":"sb_publishable_');
    }
  });

  test("4. Customer & POS Realtime channels operate without token leakage", async ({ page }) => {
    const consoleErrors: string[] = [];
    const wsMessages: string[] = [];

    page.on("websocket", (ws) => {
      ws.on("framesent", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
      ws.on("framereceived", (frame) => {
        if (typeof frame.payload === "string") wsMessages.push(frame.payload);
      });
    });

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("zerah_test_admin", "true");
      localStorage.setItem("zerah_is_admin_00000000-0000-0000-0000-000000000001", "true");
      localStorage.setItem("zerah_admin_active_tab", "billing");
      localStorage.setItem("zerah_admin_active_subtab", "pos");
    });

    await page.goto("http://localhost:8080/admin?tab=billing&subtab=pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const malformedErrors = consoleErrors.filter(
      (e) =>
        e.includes("MalformedJWT") ||
        e.includes("Expected 3 parts in JWT") ||
        e.includes("The token provided is not a valid JWT"),
    );
    expect(malformedErrors).toHaveLength(0);

    for (const rawMsg of wsMessages) {
      expect(rawMsg).not.toContain('"access_token":"sb_publishable_');
    }
  });
});
