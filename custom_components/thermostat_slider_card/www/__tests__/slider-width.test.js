/**
 * `slider_width` config: a percentage (number) controlling the slider's width
 * in one-line layout, so sliders across stacked cards align. Clamped 20–80,
 * warns + clamps when out of range.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, mount } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("slider_width", () => {
  it("test_defaults_to_55", () => {
    const card = mount({ layout: "one-line" });
    expect(card._config.slider_width).toBe(55);
  });

  it("test_custom_value_applied_to_slider_container", () => {
    const card = mount({ layout: "one-line", slider_width: 60 });
    expect(card._config.slider_width).toBe(60);
    const sc = byId(card, "slider-container");
    // Width applied as a flex-basis / width percentage.
    expect(sc.style.flexBasis || sc.style.width).toContain("60%");
  });

  it("test_clamps_above_max_and_warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mount({ layout: "one-line", slider_width: 200 });
    expect(card._config.slider_width).toBe(80);
    expect(warn).toHaveBeenCalled();
  });

  it("test_clamps_below_min_and_warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mount({ layout: "one-line", slider_width: 5 });
    expect(card._config.slider_width).toBe(20);
    expect(warn).toHaveBeenCalled();
  });

  it("test_non_numeric_falls_back_to_default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mount({ layout: "one-line", slider_width: "wide" });
    expect(card._config.slider_width).toBe(55);
    expect(warn).toHaveBeenCalled();
  });

  it("test_full_layout_ignores_slider_width", () => {
    // slider_width only shapes the one-line row; full layout slider is 100%.
    const card = mount({ layout: "full", slider_width: 60 });
    const sc = byId(card, "slider-container");
    expect(sc.style.flexBasis).toBe("");
  });
});
