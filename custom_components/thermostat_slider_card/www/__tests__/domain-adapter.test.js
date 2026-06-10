/**
 * Domain adapter: the card supports climate, humidifier, fan and water_heater
 * entities — per-domain attributes, service, unit, precision, and
 * entity-driven min/max/step defaults (config always overrides).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { byId, makeHassEntity, mountEntity } from "./helpers.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function stubTrackRect(card, left = 0, width = 200) {
  const track = byId(card, "slider-track");
  track.getBoundingClientRect = () => ({
    left, width, right: left + width, top: 0, bottom: 40, height: 40,
  });
  return track;
}

function dragTo(card, clientX) {
  const track = stubTrackRect(card);
  track.dispatchEvent(new MouseEvent("mousedown", { clientX: 0, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mousemove", { clientX, bubbles: true }));
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  vi.advanceTimersByTime(500);
}

describe("climate (baseline domain)", () => {
  it("test_climate_reads_and_unit", () => {
    const hass = makeHassEntity("climate.ac", {
      current_temperature: 21.84, temperature: 19,
      min_temp: 7, max_temp: 35,
    }, "cool");
    const card = mountEntity("climate.ac", {}, hass);
    expect(byId(card, "temperature").textContent).toBe("21.8°");
    expect(byId(card, "slider-setpoint").textContent).toBe("19.0°");
  });

  it("test_climate_drag_calls_set_temperature", () => {
    const hass = makeHassEntity("climate.ac", {
      current_temperature: 21, temperature: 19, min_temp: 10, max_temp: 30,
    }, "heat");
    const card = mountEntity("climate.ac", { min: 10, max: 30, step: 1 }, hass);
    dragTo(card, 200); // far right → max
    expect(hass.calls).toEqual([
      { domain: "climate", service: "set_temperature",
        data: { entity_id: "climate.ac", temperature: 30 } },
    ]);
  });
});

describe("humidifier", () => {
  it("test_humidifier_reads_percent_no_decimals", () => {
    const hass = makeHassEntity("humidifier.dehum", {
      current_humidity: 57.4, humidity: 50,
      min_humidity: 30, max_humidity: 80, device_class: "dehumidifier",
    }, "on");
    const card = mountEntity("humidifier.dehum", {}, hass);
    expect(byId(card, "temperature").textContent).toBe("57%");
    expect(byId(card, "slider-setpoint").textContent).toBe("50%");
  });

  it("test_humidifier_drag_calls_set_humidity", () => {
    const hass = makeHassEntity("humidifier.dehum", {
      current_humidity: 57, humidity: 50,
      min_humidity: 0, max_humidity: 100, device_class: "dehumidifier",
    }, "on");
    const card = mountEntity("humidifier.dehum", { step: 1 }, hass);
    dragTo(card, 100); // middle of 0–100 → 50... drag to 150 → 75
    dragTo(card, 150);
    const last = hass.calls.at(-1);
    expect(last.domain).toBe("humidifier");
    expect(last.service).toBe("set_humidity");
    expect(last.data.humidity).toBe(75);
  });

  it("test_humidifier_range_from_entity_attributes", () => {
    const hass = makeHassEntity("humidifier.dehum", {
      current_humidity: 50, humidity: 60,
      min_humidity: 20, max_humidity: 80, device_class: "dehumidifier",
    }, "on");
    const card = mountEntity("humidifier.dehum", {}, hass);
    // setpoint 60 in 20–80 → (60-20)/(80-20) = 66.7% fill
    const fill = byId(card, "slider-fill");
    expect(parseFloat(fill.style.width)).toBeCloseTo(66.7, 0);
  });
});

describe("fan", () => {
  it("test_fan_speed_is_both_current_and_target", () => {
    const hass = makeHassEntity("fan.dyson", { percentage: 66.66, percentage_step: 33.33 }, "on");
    const card = mountEntity("fan.dyson", {}, hass);
    expect(byId(card, "temperature").textContent).toBe("67%");
    expect(byId(card, "slider-setpoint").textContent).toBe("67%");
  });

  it("test_fan_drag_calls_set_percentage", () => {
    const hass = makeHassEntity("fan.dyson", { percentage: 50 }, "on");
    const card = mountEntity("fan.dyson", { step: 1 }, hass);
    dragTo(card, 200); // → 100
    const last = hass.calls.at(-1);
    expect(last).toMatchObject({
      domain: "fan", service: "set_percentage",
      data: { entity_id: "fan.dyson", percentage: 100 },
    });
  });
});

describe("water_heater", () => {
  it("test_water_heater_reads_and_range", () => {
    const hass = makeHassEntity("water_heater.hp", {
      current_temperature: 20.5, temperature: 40,
      min_temp: 30, max_temp: 60,
    }, "heat_pump");
    const card = mountEntity("water_heater.hp", {}, hass);
    expect(byId(card, "temperature").textContent).toBe("20.5°");
    expect(byId(card, "slider-setpoint").textContent).toBe("40.0°");
    // 40 in 30–60 → 33.3%
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBeCloseTo(33.3, 0);
  });

  it("test_water_heater_drag_calls_its_service", () => {
    const hass = makeHassEntity("water_heater.hp", {
      current_temperature: 20, temperature: 40, min_temp: 30, max_temp: 60,
    }, "heat_pump");
    const card = mountEntity("water_heater.hp", { step: 1 }, hass);
    dragTo(card, 200);
    expect(hass.calls.at(-1)).toMatchObject({
      domain: "water_heater", service: "set_temperature",
      data: { entity_id: "water_heater.hp", temperature: 60 },
    });
  });
});

describe("range resolution", () => {
  it("test_config_overrides_entity_range", () => {
    const hass = makeHassEntity("climate.ac", {
      current_temperature: 20, temperature: 18, min_temp: 7, max_temp: 35,
    }, "heat");
    const card = mountEntity("climate.ac", { min: 14, max: 21 }, hass);
    // setpoint 18 in 14–21 → 57.1%, NOT (18-7)/(35-7)=39.3%
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBeCloseTo(57.1, 0);
  });

  it("test_entity_step_used_when_config_absent", () => {
    const hass = makeHassEntity("climate.ac", {
      current_temperature: 20, temperature: 18,
      min_temp: 10, max_temp: 30, target_temp_step: 1,
    }, "heat");
    const card = mountEntity("climate.ac", {}, hass);
    const track = stubTrackRect(card);
    // tap right of setpoint → step up by entity step 1 (not the old 0.5)
    track.dispatchEvent(new MouseEvent("mousedown", { clientX: 190, bubbles: true }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    vi.advanceTimersByTime(500);
    expect(hass.calls.at(-1).data.temperature).toBe(19);
  });

  it("test_climate_fallback_when_entity_has_no_range", () => {
    const hass = makeHassEntity("climate.ac", {
      current_temperature: 20, temperature: 21,
    }, "heat");
    const card = mountEntity("climate.ac", {}, hass);
    // fallback 7–35 → (21-7)/(35-7) = 50%
    expect(parseFloat(byId(card, "slider-fill").style.width)).toBeCloseTo(50, 0);
  });
});

describe("unknown domain", () => {
  it("test_unknown_domain_warns_and_uses_climate_behavior", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hass = makeHassEntity("sensor.thing", {
      current_temperature: 20, temperature: 18,
    }, "on");
    const card = mountEntity("sensor.thing", {}, hass);
    expect(warn).toHaveBeenCalled();
    expect(byId(card, "temperature").textContent).toBe("20.0°");
  });
});
