// Shared test helpers for the thermostat-slider-card suite.

import { ThermostatSliderCard } from "../thermostat-slider-card.js";

/**
 * Build a stub hass with a single climate entity.
 * @param {object} attrs entity.attributes overrides
 * @param {string} state entity.state (default "heat")
 * @param {object} extraStates additional entities keyed by id
 */
export function makeHass(attrs = {}, state = "heat", extraStates = {}) {
  return {
    states: {
      "climate.test": {
        entity_id: "climate.test",
        state,
        attributes: {
          friendly_name: "Test Zone",
          current_temperature: 18.8,
          temperature: 16,
          hvac_action: "heating",
          ...attrs,
        },
      },
      ...extraStates,
    },
    callService() {},
  };
}

/**
 * Instantiate a card, apply config + hass, and attach it to the document so
 * getBoundingClientRect and event listeners behave.
 */
export function mount(config = {}, hass = makeHass()) {
  const card = new ThermostatSliderCard();
  card.setConfig({ entity: "climate.test", ...config });
  document.body.appendChild(card);
  card.hass = hass;
  return card;
}

export function $(card, selector) {
  return card.shadowRoot.querySelector(selector);
}

export function byId(card, id) {
  return card.shadowRoot.getElementById(id);
}
