import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

test.describe("Bug #4: Maintenance Guard Security & Removal of Hardcoded Bypass", () => {
  const rootRoutePath = path.resolve("src/routes/__root.tsx");
  const maintenanceScreenPath = path.resolve("src/components/site/MaintenanceScreen.tsx");

  test("1. Verify no hardcoded 'saif' magic-word bypass exists in src/routes/__root.tsx", () => {
    const rootCode = fs.readFileSync(rootRoutePath, "utf-8");

    // Must NOT contain 'saif' anywhere in __root.tsx
    expect(rootCode.toLowerCase()).not.toContain('"saif"');
    expect(rootCode.toLowerCase()).not.toContain("'saif'");
    expect(rootCode).not.toContain("typed === ");
    expect(rootCode).not.toContain("typed.slice");
  });

  test("2. Verify no hardcoded 'saif' magic-word bypass exists in MaintenanceScreen.tsx", () => {
    const screenCode = fs.readFileSync(maintenanceScreenPath, "utf-8");

    // Must NOT contain 'saif' in MaintenanceScreen.tsx
    expect(screenCode.toLowerCase()).not.toContain('"saif"');
    expect(screenCode.toLowerCase()).not.toContain("'saif'");
    expect(screenCode).not.toContain("passcode");
    expect(screenCode).not.toContain("handlePasscodeSubmit");
  });

  test("3. Verify MaintenanceGuard authorizes only legitimate admin routes and authenticated admins", () => {
    const rootCode = fs.readFileSync(rootRoutePath, "utf-8");

    // Must check legitimate authorization
    expect(rootCode).toContain("useSession()");
    expect(rootCode).toContain("useIsAdmin(user?.id)");
    expect(rootCode).toContain("if (isAdminRoute || isLoading || isAdmin) return <>{children}</>;");

    // Must not have client-side bypass state
    expect(rootCode).not.toContain("const [bypass, setBypass] = useState(false);");
    expect(rootCode).not.toContain("onBypass");
  });

  test("4. Verify MaintenanceScreen directs staff to authentic admin portal", () => {
    const screenCode = fs.readFileSync(maintenanceScreenPath, "utf-8");

    // Must link to legitimate admin portal
    expect(screenCode).toContain('href="/admin"');
    expect(screenCode).toContain("Admin Access");
  });
});
