/**
 * `layout: one-line` config handling and rendering.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { byId, mount } from "./helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("layout config", () => {
  it("test_layout_defaults_to_full", () => {
    const card = mount();
    expect(card._config.layout).toBe("full");
    expect(byId(card, "card").classList.contains("layout-one-line")).toBe(
      false,
    );
  });

  it("test_layout_one_line_applies_class", () => {
    const card = mount({ layout: "one-line" });
    expect(card._config.layout).toBe("one-line");
    expect(byId(card, "card").classList.contains("layout-one-line")).toBe(true);
  });

  it("test_unknown_layout_warns_and_falls_back_to_full", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = mount({ layout: "oneline" });
    expect(card._config.layout).toBe("full");
    expect(byId(card, "card").classList.contains("layout-one-line")).toBe(
      false,
    );
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls.map((c) => c.join(" ")).join(" ");
    expect(msg).toContain("oneline");
    expect(msg).toContain("one-line");
  });

  it("test_one_line_still_renders_core_elements", () => {
    const card = mount({ layout: "one-line", name: "Kitchen" });
    expect(byId(card, "name").textContent).toBe("Kitchen");
    expect(byId(card, "temperature").textContent).toBe("18.8°");
    expect(byId(card, "slider-container").classList.contains("hidden")).toBe(
      false,
    );
  });
});
