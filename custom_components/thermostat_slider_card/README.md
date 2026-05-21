# Thermostat Slider Card

A Home Assistant Lovelace card for climate control with a visual slider and alert banners. Works with any HA `climate` entity.

[![HACS Default](https://img.shields.io/badge/HACS-Default-41BDF5.svg)](https://github.com/hacs/integration)
[![GitHub Release](https://img.shields.io/github/v/release/olivierplante/thermostat-slider-card)](https://github.com/olivierplante/thermostat-slider-card/releases)

<p>
  <img src="https://raw.githubusercontent.com/olivierplante/thermostat-slider-card/main/screenshots/card.png" alt="Thermostat Slider Card" width="300">
</p>

## What you get

- Large current temperature display with heating/cooling accent colors
- Drag or tap slider for setpoint adjustment (debounced service calls)
- Configurable freeze risk and heating-struggling alert banners
- Theme-compatible with CSS custom property overrides
- No external dependencies

## Install

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=olivierplante&repository=thermostat-slider-card&category=integration)

1. Click the badge above (or search "Thermostat Slider Card" in HACS) and download the integration
2. Restart Home Assistant
3. Settings → Devices & Services → Add Integration → "Thermostat Slider Card"
4. Click Submit. There's nothing to configure.

The Lovelace resource auto-registers, so the card is available immediately.

## Quick usage

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
```

## Docs

- [Configuration](https://github.com/olivierplante/thermostat-slider-card/blob/main/docs/configuration.md): all options, freeze threshold modes, heating-struggling alert
- [Theming](https://github.com/olivierplante/thermostat-slider-card/blob/main/docs/theming.md): CSS variables and override examples
- [Interactions](https://github.com/olivierplante/thermostat-slider-card/blob/main/docs/interactions.md): tap, drag, and more-info behavior

## Support

[Report an issue](https://github.com/olivierplante/thermostat-slider-card/issues) · [MIT License](https://github.com/olivierplante/thermostat-slider-card/blob/main/LICENSE)
