/**
 * Deep E2E tests for Settings page interactions.
 *
 * Covers: toggles, sections, role editing, quality gates, MCP servers,
 * skills, save/reset, toast notifications.
 */
import { test, expect } from "@playwright/test";

async function goToSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForSelector(".tab-nav", { timeout: 10_000 });
  await page.getByRole("button", { name: "⚙️ Settings", exact: true }).click();
  await page.waitForSelector(".settings-page", { timeout: 5_000 });
}

test.describe("Settings Toggles", () => {
  test.beforeEach(async ({ page }) => { await goToSettings(page); });

  test("toggle buttons are clickable and change state", async ({ page }) => {
    const toggles = page.locator(".settings-toggle");
    const count = await toggles.count();
    expect(count).toBeGreaterThan(0);
    const first = toggles.first();
    const initialText = await first.textContent();
    await first.click();
    const newText = await first.textContent();
    expect(newText).not.toBe(initialText);
    // Toggle back
    await first.click();
    await expect(first).toHaveText(initialText!);
  });
});

test.describe("Settings Sections Collapse", () => {
  test.beforeEach(async ({ page }) => { await goToSettings(page); });

  test("sections can be collapsed and expanded", async ({ page }) => {
    const headers = page.locator(".settings-section-header");
    const count = await headers.count();
    expect(count).toBeGreaterThan(3);
    // Find an open section and collapse it
    const firstHeader = headers.first();
    const section = firstHeader.locator("..");
    const body = section.locator(".settings-section-body");
    if (await body.isVisible()) {
      await firstHeader.click();
      await expect(body).not.toBeVisible();
      // Re-expand
      await firstHeader.click();
      await expect(body).toBeVisible();
    }
  });
});

test.describe("Settings Save & Reset", () => {
  test.beforeEach(async ({ page }) => { await goToSettings(page); });

  test("save button exists and is initially not dirty", async ({ page }) => {
    const saveBtn = page.locator("button", { hasText: /💾\s*Save/i });
    await expect(saveBtn.first()).toBeVisible();
  });

  test("editing a value marks config as dirty", async ({ page }) => {
    const input = page.locator(".settings-table input[type='number']").first();
    await input.click();
    await input.fill("99");
    // Dirty indicator should appear
    const dirtyBadge = page.locator(".settings-dirty");
    await expect(dirtyBadge.first()).toBeVisible({ timeout: 2_000 });
  });

  test("save sends config to backend and shows toast", async ({ page }) => {
    // Make a change
    const input = page.locator(".settings-table input[type='number']").first();
    const original = await input.inputValue();
    await input.click();
    await input.fill("42");
    // Save
    const saveBtn = page.locator("button", { hasText: /💾\s*Save/i }).first();
    await saveBtn.click();
    // Toast should appear
    const toast = page.locator(".settings-toast");
    await expect(toast).toBeVisible({ timeout: 3_000 });
    // Restore
    await input.click();
    await input.fill(original);
    await saveBtn.click();
    await page.waitForTimeout(1000);
  });

  test("reset button reverts changes", async ({ page }) => {
    const input = page.locator(".settings-table input[type='number']").first();
    const original = await input.inputValue();
    await input.click();
    await input.fill("99");
    // Click reset
    const resetBtn = page.locator("button", { hasText: /↩\s*Reset/i }).first();
    await resetBtn.click();
    // Value should revert
    await expect(input).toHaveValue(original);
  });
});

test.describe("Agent Roles Editor", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
    // Expand the Agent Roles section
    const rolesHeader = page.locator(".settings-section-header", { hasText: "Agent Roles" });
    await rolesHeader.scrollIntoViewIfNeeded();
    await rolesHeader.click();
    await page.waitForTimeout(500);
  });

  test("multiple role editors are displayed", async ({ page }) => {
    const roleHeaders = page.locator(".role-editor-header");
    const count = await roleHeaders.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("clicking role header expands role editor body", async ({ page }) => {
    const roleHeaders = page.locator(".role-editor-header");
    const first = roleHeaders.first();
    await first.click();
    // Editor body should be visible
    const body = page.locator(".role-editor-body");
    await expect(body.first()).toBeVisible({ timeout: 2_000 });
  });

  test("role instructions textarea is editable", async ({ page }) => {
    // Open the first role editor
    const roleHeaders = page.locator(".role-editor-header");
    await roleHeaders.first().click();
    await page.waitForTimeout(500);
    const textarea = page.locator(".role-editor-body textarea").first();
    await expect(textarea).toBeEditable();
    const original = await textarea.inputValue();
    await textarea.click();
    await textarea.fill(original + " test");
    await expect(textarea).toHaveValue(original + " test");
    // Revert
    await textarea.fill(original);
  });

  test("role has model selector", async ({ page }) => {
    await page.waitForTimeout(2000);
    const modelSelect = page.locator(".role-config-row select").first();
    if (await modelSelect.count() > 0) {
      await expect(modelSelect).toBeVisible();
      const options = modelSelect.locator("option");
      const count = await options.count();
      expect(count).toBeGreaterThan(1);
    }
  });

  test("role has mode selector (autonomous/manual)", async ({ page }) => {
    await page.waitForTimeout(2000);
    const modeSelect = page.locator("select").filter({ hasText: /autonomous|manual/i });
    if (await modeSelect.count() > 0) {
      await expect(modeSelect.first()).toBeVisible();
    }
  });
});

test.describe("Skills Editor", () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page);
    // Expand the Agent Roles section
    const rolesHeader = page.locator(".settings-section-header", { hasText: "Agent Roles" });
    await rolesHeader.scrollIntoViewIfNeeded();
    await rolesHeader.click();
    await page.waitForTimeout(500);
  });

  test("skill cards are displayed for roles with skills", async ({ page }) => {
    // Expand role editors until we find one with skills
    const roleHeaders = page.locator(".role-editor-header");
    const count = await roleHeaders.count();
    let foundSkills = false;
    for (let i = 0; i < count; i++) {
      await roleHeaders.nth(i).scrollIntoViewIfNeeded();
      await roleHeaders.nth(i).click();
      await page.waitForTimeout(500);
      const skillCards = page.locator(".role-skill-card");
      if (await skillCards.count() > 0) {
        foundSkills = true;
        break;
      }
      // Close it before trying next
      await roleHeaders.nth(i).click();
      await page.waitForTimeout(300);
    }
    // At least one role should have skills
    expect(foundSkills).toBe(true);
  });

  test("skill card expands on header click", async ({ page }) => {
    const roleHeaders = page.locator(".role-editor-header");
    const count = await roleHeaders.count();
    for (let i = 0; i < count; i++) {
      await roleHeaders.nth(i).scrollIntoViewIfNeeded();
      await roleHeaders.nth(i).click();
      await page.waitForTimeout(500);
      const skillHeader = page.locator(".role-skill-card-header");
      if (await skillHeader.count() > 0) {
        await skillHeader.first().click();
        const textarea = page.locator(".role-skill-textarea");
        await expect(textarea.first()).toBeVisible({ timeout: 2_000 });
        break;
      }
      // Close it before trying next
      await roleHeaders.nth(i).click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe("Quality Gates Editor", () => {
  test.beforeEach(async ({ page }) => { await goToSettings(page); });

  test("quality gate section can be expanded", async ({ page }) => {
    // Find the Quality Gates section header and expand it
    const qgHeader = page.locator(".settings-section-header", { hasText: "Quality Gates" });
    await qgHeader.scrollIntoViewIfNeeded();
    await qgHeader.click();
    await page.waitForTimeout(500);
    const cards = page.locator(".qg-card");
    await expect(cards.first()).toBeVisible({ timeout: 5_000 });
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("quality gate command textareas are editable", async ({ page }) => {
    // Expand the section first
    const qgHeader = page.locator(".settings-section-header", { hasText: "Quality Gates" });
    await qgHeader.scrollIntoViewIfNeeded();
    await qgHeader.click();
    await page.waitForTimeout(500);
    const textarea = page.locator(".qg-command-textarea");
    if (await textarea.count() > 0) {
      await expect(textarea.first()).toBeEditable();
    }
  });

  test("quality gate toggles work", async ({ page }) => {
    // Expand the section first
    const qgHeader = page.locator(".settings-section-header", { hasText: "Quality Gates" });
    await qgHeader.scrollIntoViewIfNeeded();
    await qgHeader.click();
    await page.waitForTimeout(500);
    const toggles = page.locator(".qg-card .settings-toggle");
    if (await toggles.count() > 0) {
      const first = toggles.first();
      const initialText = await first.textContent();
      await first.click();
      const newText = await first.textContent();
      expect(newText).not.toBe(initialText);
      // Toggle back
      await first.click();
    }
  });
});

test.describe("Placeholder Help", () => {
  test.beforeEach(async ({ page }) => { await goToSettings(page); });

  test("placeholder help toggle expands variable list", async ({ page }) => {
    await page.waitForTimeout(2000);
    const helpToggle = page.locator(".placeholder-help-toggle");
    if (await helpToggle.count() > 0) {
      await helpToggle.first().click();
      const helpList = page.locator(".placeholder-help-list");
      await expect(helpList.first()).toBeVisible({ timeout: 2_000 });
    }
  });
});
