/**
 * Alert popover toggle + auto-hide lifecycle, plus the card's static config
 * helpers and card size.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThermostatSliderCard } from "../thermostat-slider-card.js";
import { byId, makeHass, mount } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function freezeCard() {
  return mount(
    { layout: "one-line", alert_low: 5 },
    makeHass({ current_temperature: 3 }),
  );
}

describe("popover lifecycle", () => {
  it("test_popover_auto_hides_after_timeout", () => {
    const card = freezeCard();
    byId(card, "alert-icon-inline").click();
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(
      false,
    );
    vi.advanceTimersByTime(3000);
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(true);
  });

  it("test_tapping_icon_again_hides_popover", () => {
    const card = freezeCard();
    const icon = byId(card, "alert-icon-inline");
    icon.click(); // show
    icon.click(); // hide
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(true);
  });

  it("test_popover_resets_when_alert_clears", () => {
    const card = freezeCard();
    byId(card, "alert-icon-inline").click();
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(
      false,
    );
    // Temperature rises above threshold → alert clears, popover resets.
    card.hass = makeHass({ current_temperature: 18 });
    expect(byId(card, "alert-popover").classList.contains("hidden")).toBe(true);
    expect(byId(card, "alert-inline").classList.contains("hidden")).toBe(true);
  });
});

describe("static helpers", () => {
  it("test_get_card_size", () => {
    const card = mount();
    expect(card.getCardSize()).toBe(3);
  });

  it("test_get_stub_config", () => {
    // Ranges are entity-driven since 1.3.0 — the stub only needs an entity.
    const stub = ThermostatSliderCard.getStubConfig();
    expect(stub.entity).toBeTruthy();
  });

  it("test_get_config_element", () => {
    const el = ThermostatSliderCard.getConfigElement();
    expect(el).toBeTruthy();
  });
});
