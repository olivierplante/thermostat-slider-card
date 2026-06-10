/**
 * Mode palette: the slider fill's color family follows the entity's MODE
 * (stable identity), not the transient action. Families: raise → amber,
 * lower → cyan, neutral → grey. The temp-number accent keeps following the
 * action (existing heating/cooling classes), extended to humidifier actions.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function fillOf(card) {
  return byId(card, "slider-fill");
}

const tempAttrs = { current_temperature: 21, temperature: 19, min_temp: 7, max_temp: 35 };

describe("climate modes", () => {
  it("test_heat_mode_is_raise_family", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "heat"));
    expect(fillOf(card).classList.contains("family-raise")).toBe(true);
    expect(fillOf(card).classList.contains("mode-heat")).toBe(true);
  });

  it("test_cool_mode_is_lower_family_even_when_idle", () => {
    // THE issue #7 bug: idle AC must still read as a cooler.
    const card = mountEntity("climate.x", {},
      makeHassEntity("climate.x", { ...tempAttrs, hvac_action: "idle" }, "cool"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
    expect(fillOf(card).classList.contains("mode-cool")).toBe(true);
  });

  it("test_cool_mode_without_hvac_action_still_lower", () => {
    // Integrations that never report hvac_action.
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "cool"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
  });

  it("test_dry_mode_is_lower_family", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "dry"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
  });

  it("test_auto_follows_action_when_reported", () => {
    const card = mountEntity("climate.x", {},
      makeHassEntity("climate.x", { ...tempAttrs, hvac_action: "cooling" }, "auto"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
  });

  it("test_auto_heat_only_capability_is_raise", () => {
    // KaliPete's heat pump: auto + idle, but the device can only heat.
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x",
      { ...tempAttrs, hvac_modes: ["heat", "off", "auto"], hvac_action: "idle" },
      "auto"));
    expect(fillOf(card).classList.contains("family-raise")).toBe(true);
  });

  it("test_auto_cool_only_capability_is_lower", () => {
    // A cool-only AC in auto must not idle amber like a heater.
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x",
      { ...tempAttrs, hvac_modes: ["cool", "dry", "fan_only", "off", "auto"], hvac_action: "idle" },
      "auto"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
  });

  it("test_auto_dual_sticky_action_through_idle", () => {
    // Dual-capable: the last active action's family survives idle cycles.
    const dual = { ...tempAttrs, hvac_modes: ["heat", "cool", "off", "auto"] };
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x",
      { ...dual, hvac_action: "cooling" }, "auto"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
    card.hass = makeHassEntity("climate.x", { ...dual, hvac_action: "idle" }, "auto");
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
  });

  it("test_auto_dual_unknown_is_neutral", () => {
    // Dual-capable, idle since load: no claim, neutral grey (fan color).
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x",
      { ...tempAttrs, hvac_modes: ["heat", "cool", "off", "auto"], hvac_action: "idle" },
      "auto"));
    expect(fillOf(card).classList.contains("family-neutral")).toBe(true);
  });

  it("test_auto_without_any_capability_info_is_neutral", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "auto"));
    expect(fillOf(card).classList.contains("family-neutral")).toBe(true);
  });

  it("test_fan_only_mode_is_neutral", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "fan_only"));
    expect(fillOf(card).classList.contains("family-neutral")).toBe(true);
  });
});

describe("other domains", () => {
  it("test_dehumidifier_is_lower_family", () => {
    const card = mountEntity("humidifier.d", {}, makeHassEntity("humidifier.d", {
      current_humidity: 55, humidity: 50, device_class: "dehumidifier",
    }, "on"));
    expect(fillOf(card).classList.contains("family-lower")).toBe(true);
    expect(fillOf(card).classList.contains("mode-dehumidify")).toBe(true);
  });

  it("test_humidifier_is_raise_family", () => {
    const card = mountEntity("humidifier.h", {}, makeHassEntity("humidifier.h", {
      current_humidity: 30, humidity: 45, device_class: "humidifier",
    }, "on"));
    expect(fillOf(card).classList.contains("family-raise")).toBe(true);
    expect(fillOf(card).classList.contains("mode-humidify")).toBe(true);
  });

  it("test_humidifier_without_device_class_defaults_raise", () => {
    const card = mountEntity("humidifier.h", {}, makeHassEntity("humidifier.h", {
      current_humidity: 30, humidity: 45,
    }, "on"));
    expect(fillOf(card).classList.contains("family-raise")).toBe(true);
  });

  it("test_fan_is_neutral", () => {
    const card = mountEntity("fan.f", {}, makeHassEntity("fan.f", { percentage: 50 }, "on"));
    expect(fillOf(card).classList.contains("family-neutral")).toBe(true);
  });

  it("test_water_heater_is_raise", () => {
    const card = mountEntity("water_heater.w", {}, makeHassEntity("water_heater.w", {
      current_temperature: 40, temperature: 50, min_temp: 30, max_temp: 60,
    }, "heat_pump"));
    expect(fillOf(card).classList.contains("family-raise")).toBe(true);
  });
});

describe("off state", () => {
  it("test_off_dims_card", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "off"));
    expect(byId(card, "card").classList.contains("is-off")).toBe(true);
  });

  it("test_on_removes_dim", () => {
    const card = mountEntity("climate.x", {}, makeHassEntity("climate.x", tempAttrs, "off"));
    card.hass = makeHassEntity("climate.x", tempAttrs, "heat");
    expect(byId(card, "card").classList.contains("is-off")).toBe(false);
  });
});

describe("action accent (temp number) still follows activity", () => {
  it("test_drying_action_gets_cooling_accent", () => {
    const card = mountEntity("humidifier.d", {}, makeHassEntity("humidifier.d", {
      current_humidity: 60, humidity: 50, device_class: "dehumidifier", action: "drying",
    }, "on"));
    expect(byId(card, "temperature").classList.contains("cooling")).toBe(true);
  });

  it("test_humidifying_action_gets_heating_accent", () => {
    const card = mountEntity("humidifier.h", {}, makeHassEntity("humidifier.h", {
      current_humidity: 30, humidity: 45, device_class: "humidifier", action: "humidifying",
    }, "on"));
    expect(byId(card, "temperature").classList.contains("heating")).toBe(true);
  });
});
