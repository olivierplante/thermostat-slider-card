/**
 * Baseline behavior of the card as it shipped (full layout). These guard the
 * existing behavior against the one-line refactor — none existed before.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHass, mount } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("setConfig", () => {
  it("test_requires_entity", async () => {
    const { ThermostatSliderCard } = await import(
      "../thermostat-slider-card.js"
    );
    const card = new ThermostatSliderCard();
    expect(() => card.setConfig({})).toThrow(/entity/);
  });

  it("test_defaults", () => {
    const card = mount();
    expect(card._config.min).toBe(14);
    expect(card._config.max).toBe(21);
    expect(card._config.step).toBe(0.5);
    expect(card._config.freeze_threshold).toBe(5);
  });
});

describe("display", () => {
  it("test_current_temperature_rendered", () => {
    const card = mount();
    expect(byId(card, "temperature").textContent).toBe("18.8°");
  });

  it("test_name_override", () => {
    const card = mount({ name: "Kitchen" });
    expect(byId(card, "name").textContent).toBe("Kitchen");
  });

  it("test_name_falls_back_to_friendly_name", () => {
    const card = mount();
    expect(byId(card, "name").textContent).toBe("Test Zone");
  });

  it("test_heating_accent", () => {
    const card = mount({}, makeHass({ hvac_action: "heating" }));
    expect(byId(card, "temperature").classList.contains("heating")).toBe(true);
  });

  it("test_cooling_accent", () => {
    const card = mount({}, makeHass({ hvac_action: "cooling" }));
    expect(byId(card, "temperature").classList.contains("cooling")).toBe(true);
    expect(byId(card, "slider-fill").classList.contains("cooling")).toBe(true);
  });

  it("test_offline_when_unavailable", () => {
    const card = mount({}, makeHass({}, "unavailable"));
    expect(byId(card, "card").classList.contains("unavailable")).toBe(true);
    expect(byId(card, "offline").classList.contains("hidden")).toBe(false);
    expect(byId(card, "slider-container").classList.contains("hidden")).toBe(
      true,
    );
  });
});

describe("alerts (full layout)", () => {
  it("test_freeze_risk_shows_when_below_threshold", () => {
    const card = mount(
      { freeze_threshold: 5 },
      makeHass({ current_temperature: 3 }),
    );
    const banner = byId(card, "alert-banner");
    expect(banner.classList.contains("hidden")).toBe(false);
    expect(byId(card, "alert-text").textContent).toBe("Freeze risk");
  });

  it("test_no_alert_when_warm", () => {
    const card = mount({ freeze_threshold: 5 });
    expect(byId(card, "alert-banner").classList.contains("hidden")).toBe(true);
  });

  it("test_struggling_to_heat_alert", () => {
    const hass = makeHass({ current_temperature: 9 }, "heat", {
      "timer.heat": { state: "idle", attributes: {} },
      "input_number.thr": { state: "10", attributes: {} },
    });
    const card = mount(
      { timer: "timer.heat", threshold: "input_number.thr" },
      hass,
    );
    expect(byId(card, "alert-text").textContent).toBe("Struggling to heat");
  });
});

describe("more-info", () => {
  it("test_tap_card_opens_more_info", () => {
    const card = mount();
    let fired = null;
    card.addEventListener("hass-more-info", (e) => {
      fired = e.detail.entityId;
    });
    byId(card, "name").click();
    expect(fired).toBe("climate.test");
  });
});
