# Changelog

## 1.2.0

**Compact one-line layout.** A new `layout: one-line` option renders the thermostat as a single horizontal row — name on the left, current temperature in the middle, slider on the right. Ideal for stacking several thermostats in a small space.

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
layout: one-line
```

**Adjustable slider width.** In one-line mode, `slider_width` sets the slider's width as a percentage of the card (default `55`, range 20–80), so the sliders in a stack of cards line up neatly. The current temperature and any alert icon stay fully visible; the room name truncates if space is tight.

**Refined alerts in one-line mode.** When a zone has a freeze-risk or heating-struggling alert, a small icon appears next to the name and the name turns red. Tap the icon to see the alert text. The full layout keeps its alert banner as before.

## 1.1.0

**Add and remove from the UI** — Thermostat Slider Card now uses Home Assistant's config flow. Install from Settings > Devices & Services > Add Integration. The Lovelace resource is automatically cleaned up when you remove the integration, so uninstalls no longer leave a dangling `/thermostat_slider_card/thermostat-slider-card.js` 404 in the browser console.

**Automatic YAML migration** — Existing users with `thermostat_slider_card:` in `configuration.yaml` are migrated automatically on first restart. Nothing breaks. The YAML line is no longer needed and can be removed at your convenience; a one-time deprecation warning in the logs will remind you.

**Documentation restructure** — The README is now scoped to what the card does and how to install it. Configuration, theming, and interaction details moved to dedicated pages under `docs/`.

**README screenshot path fixed** — The card screenshot now uses an absolute URL so it renders correctly inside HACS, not just on GitHub.

## 1.0.5

**CI** — Updated GitHub Actions to Node.js 24 (`actions/checkout@v6`).

## 1.0.4

Add MIT license.

## 1.0.3
- Fix manifest key ordering for hassfest compliance

## 1.0.2
- Add brand icon, issue tracker, and validation workflows for HACS submission

## 1.0.1
- Add HACS and hassfest validation workflows

## 1.0.0
- Initial release
- Thermostat card with visual slider control
- Heating and cooling accent colors
- Configurable freeze risk alert (static value or entity)
- Heating struggling alert with timer integration
- Theme-compatible CSS with custom property overrides
- Tap and drag slider with debounced service calls
