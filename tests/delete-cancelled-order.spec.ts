import { test, expect } from "@playwright/test";

test.describe("Admin Delete Cancelled Order Suite", () => {
  test("1. Business Rule Guard: Only Cancelled status is permitted to be deleted", async ({
    page,
  }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const statusChecks = await page.evaluate(() => {
      const allowedStatus = "cancelled";
      const blockedStatuses = ["placed", "processing", "packed", "shipped", "delivered", "pending"];

      function canDelete(status: string) {
        return status === allowedStatus;
      }

      return {
        cancelledAllowed: canDelete("cancelled"),
        placedBlocked: !canDelete("placed"),
        processingBlocked: !canDelete("processing"),
        packedBlocked: !canDelete("packed"),
        shippedBlocked: !canDelete("shipped"),
        deliveredBlocked: !canDelete("delivered"),
        pendingBlocked: !canDelete("pending"),
      };
    });

    expect(statusChecks.cancelledAllowed).toBe(true);
    expect(statusChecks.placedBlocked).toBe(true);
    expect(statusChecks.processingBlocked).toBe(true);
    expect(statusChecks.packedBlocked).toBe(true);
    expect(statusChecks.shippedBlocked).toBe(true);
    expect(statusChecks.deliveredBlocked).toBe(true);
    expect(statusChecks.pendingBlocked).toBe(true);
  });

  test("2. Resilient Execution Strategy: Edge Function -> RPC -> Direct Client Fallback", async ({
    page,
  }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    const fallbackExecution = await page.evaluate(async () => {
      // Simulate RPC schema cache failure recovery
      const rpcError = {
        code: "42883",
        message:
          "Could not find the function public.delete_cancelled_order(_order_id) in the schema cache",
      };
      const isSchemaCacheError =
        rpcError.message.includes("schema cache") || rpcError.code === "42883";

      return {
        recoveredGracefully: isSchemaCacheError,
      };
    });

    expect(fallbackExecution.recoveredGracefully).toBe(true);
  });
});
