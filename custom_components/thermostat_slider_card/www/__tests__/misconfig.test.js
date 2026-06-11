/**
 * Misconfiguration visibility (issue #7 follow-up): every way a card can be
 * misconfigured should either say so on the card or warn in the console —
 * never limp along silently.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const ATTRS = {
  current_temperature: 20, temperature: 18,
  min_temp: 7, max_temp: 30, supported_features: 385,
};

describe("entity not found", () => {
  it("test_missing_entity_says_not_found_not_offline", () => {
    // A typo'd entity_id must not pretend the device is offline.
    const hass = makeHassEntity("climate.real", ATTRS, "heat");
    const card = mountEntity("climate.typo", {}, hass);
    const message = byId(card, "unsupported");
    expect(message.classList.contains("hidden")).toBe(false);
    expect(message.textContent).toContain("climate.typo");
    expect(message.textContent).toContain("not found");
    expect(byId(card, "offline").classList.contains("hidden")).toBe(true);
  });

  it("test_heals_when_entity_appears", () => {
    // Startup race: entities can register after the dashboard loads.
    const card = mountEntity("climate.late", {}, makeHassEntity("climate.other", ATTRS, "heat"));
    expect(byId(card, "unsupported").classList.contains("hidden")).toBe(false);
    card.hass = makeHassEntity("climate.late", ATTRS, "heat");
    expect(byId(card, "unsupported").classList.contains("hidden")).toBe(true);
    expect(byId(card, "temperature").textContent).toBe("20.0°");
  });
});

describe("invalid range and step config", () => {
  it("test_min_above_max_warns_and_uses_entity_range", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 25, max: 10 }, hass);
    expect(warn).toHaveBeenCalled();
    // Falls back to the entity range 7–30: setpoint 18 → (18-7)/23 ≈ 47.8%
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBeCloseTo(47.8, 0);
  });

  it("test_config_entity_range_conflict_falls_back_safely", () => {
    // config min 40 vs entity max 30 → inverted resolved range → fallback,
    // never NaN.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", ATTRS, "heat");
    const card = mountEntity("climate.x", { min: 40 }, hass);
    const width = parseFloat(byId(card, "slider-fill").style.width);
    expect(Number.isFinite(width)).toBe(true);
  });

  it("test_zero_step_warns_and_uses_entity_step", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x",
      { ...ATTRS, target_temp_step: 1 }, "heat");
    const card = mountEntity("climate.x", { step: 0 }, hass);
    expect(warn).toHaveBeenCalled();
    expect(card._getRange().step).toBe(1);
  });
});

describe("alert references to missing entities warn once", () => {
  it("test_missing_threshold_entity_warns_once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("climate.x", ATTRS, "heat");
    const card = mountEntity("climate.x", { alert_low: "input_number.nope" }, hass);
    card.hass = makeHassEntity("climate.x", ATTRS, "heat"); // second update
    const mentions = warn.mock.calls
      .map((c) => c.join(" "))
      .filter((m) => m.includes("input_number.nope"));
    expect(mentions).toHaveLength(1);
  });

  it("test_missing_timer_entity_warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mountEntity("climate.x",
      { timer: "timer.nope", threshold: 10 },
      makeHassEntity("climate.x", ATTRS, "heat"));
    const mentions = warn.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(mentions).toContain("timer.nope");
  });
});

describe("preset-only fans", () => {
  it("test_fan_without_speed_support_says_so", () => {
    // FanEntityFeature.SET_SPEED = 1; a preset-only fan lacks it.
    const hass = makeHassEntity("fan.extractor",
      { preset_modes: ["low", "high"], supported_features: 8 }, "on");
    const card = mountEntity("fan.extractor", {}, hass);
    const message = byId(card, "unsupported");
    expect(message.classList.contains("hidden")).toBe(false);
    expect(message.textContent).toContain("speed");
    expect(byId(card, "slider-container").classList.contains("hidden")).toBe(true);
  });

  it("test_fan_without_speed_drag_is_inert", () => {
    vi.useFakeTimers();
    const hass = makeHassEntity("fan.extractor",
      { preset_modes: ["low", "high"], supported_features: 8 }, "on");
    const card = mountEntity("fan.extractor", {}, hass);
    const track = byId(card, "slider-track");
    track.getBoundingClientRect = () => ({
      left: 0, width: 200, right: 200, top: 0, bottom: 40, height: 40,
    });
    track.dispatchEvent(new MouseEvent("mousedown", { clientX: 50, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mousemove", { clientX: 150, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    vi.advanceTimersByTime(2000); // past debounce + long-press windows
    expect(hass.calls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("test_fan_with_speed_support_works_normally", () => {
    const hass = makeHassEntity("fan.dyson",
      { percentage: 50, supported_features: 33 }, "on");
    const card = mountEntity("fan.dyson", {}, hass);
    expect(byId(card, "unsupported").classList.contains("hidden")).toBe(true);
    expect(byId(card, "temperature").textContent).toBe("50%");
  });
});
