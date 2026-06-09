/**
 * One-line layout alert behavior: icon-only inline indicator, with a tap to
 * reveal a popover bubble showing the alert text. Tapping the icon must NOT
 * open the more-info dialog (it has its own action).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHass, mount } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function freezeCard() {
  return mount(
    { layout: "one-line", freeze_threshold: 5 },
    makeHass({ current_temperature: 3 }),
  );
}

describe("one-line alert icon", () => {
  it("test_no_inline_icon_when_no_alert", () => {
    const card = mount({ layout: "one-line" });
    expect(byId(card, "alert-inline").classList.contains("hidden")).toBe(true);
  });

  it("test_inline_icon_shown_on_freeze_risk", () => {
    const card = freezeCard();
    expect(byId(card, "alert-inline").classList.contains("hidden")).toBe(false);
    // ha-icon with the MDI snowflake (matches ec_weather's icon approach).
    const icon = byId(card, "alert-icon-inline").querySelector("ha-icon");
    expect(icon.getAttribute("icon")).toBe("mdi:snowflake");
  });

  it("test_name_turns_red_on_alert_in_one_line", () => {
    const card = freezeCard();
    expect(byId(card, "name").classList.contains("alert-name")).toBe(true);
  });

  it("test_name_not_red_when_no_alert", () => {
    const card = mount({ layout: "one-line" });
    expect(byId(card, "name").classList.contains("alert-name")).toBe(false);
  });

  it("test_full_text_banner_hidden_in_one_line", () => {
    const card = freezeCard();
    // The full-width text banner must not be visible in one-line mode.
    expect(byId(card, "alert-banner").classList.contains("hidden")).toBe(true);
  });

  it("test_popover_hidden_by_default", () => {
    const card = freezeCard();
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(true);
  });

  it("test_tapping_icon_reveals_popover_with_text", () => {
    const card = freezeCard();
    byId(card, "alert-icon-inline").click();
    const pop = byId(card, "alert-popover");
    expect(pop.classList.contains("hidden")).toBe(false);
    expect(pop.textContent).toBe("Freeze risk");
  });

  it("test_tapping_icon_does_not_open_more_info", () => {
    const card = freezeCard();
    let fired = false;
    card.addEventListener("hass-more-info", () => {
      fired = true;
    });
    byId(card, "alert-icon-inline").click();
    expect(fired).toBe(false);
  });

  it("test_tapping_row_elsewhere_still_opens_more_info", () => {
    const card = freezeCard();
    let fired = null;
    card.addEventListener("hass-more-info", (e) => {
      fired = e.detail.entityId;
    });
    byId(card, "name").click();
    expect(fired).toBe("climate.test");
  });

  it("test_struggling_icon_and_text", () => {
    const hass = makeHass({ current_temperature: 9 }, "heat", {
      "timer.heat": { state: "idle", attributes: {} },
      "input_number.thr": { state: "10", attributes: {} },
    });
    const card = mount(
      { layout: "one-line", timer: "timer.heat", threshold: "input_number.thr" },
      hass,
    );
    const icon = byId(card, "alert-icon-inline").querySelector("ha-icon");
    expect(icon.getAttribute("icon")).toBe("mdi:thermometer-alert");
    byId(card, "alert-icon-inline").click();
    expect(byId(card, "alert-popover").textContent).toBe("Struggling to heat");
  });
});
