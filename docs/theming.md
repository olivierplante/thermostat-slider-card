# Theming

[← Back to README](../README.md)

The card uses HA theme variables by default and works on both dark and light themes. Any color can be overridden via CSS custom properties.

## CSS variables

| Property | Default | Description |
|---|---|---|
| `--tsc-card-bg` | `var(--ha-card-background)` | Card background |
| `--tsc-card-border` | `rgba(255,255,255,0.08)` | Card border color |
| `--tsc-card-radius` | `16px` | Card border radius |
| `--tsc-name-color` | `var(--secondary-text-color)` | Zone name color |
| `--tsc-temp-color` | `var(--primary-text-color)` | Temperature text color |
| `--tsc-heating-color` | `#F59E0B` | Temperature color when heating |
| `--tsc-cooling-color` | `#06B6D4` | Temperature color when cooling |
| `--tsc-slider-track` | `rgba(255,255,255,0.08)` | Slider track background |
| `--tsc-slider-fill` | `linear-gradient(90deg, #F59E0B, #FBBF24)` | Fill for the *raise* family (heat, humidify, water heater) |
| `--tsc-slider-fill-cool` | `linear-gradient(90deg, #06B6D4, #22D3EE)` | Fill for the *lower* family (cool, dry, dehumidify) |
| `--tsc-slider-fill-neutral` | `linear-gradient(90deg, #6B7280, #9CA3AF)` | Fill for the *neutral* family (fans) |
| `--tsc-fill-heat` | family default | Fill override for climate `heat` mode |
| `--tsc-fill-cool` | family default | Fill override for climate `cool` mode |
| `--tsc-fill-dry` | family default | Fill override for climate `dry` mode |
| `--tsc-fill-humidify` | family default | Fill override for humidifiers |
| `--tsc-fill-dehumidify` | family default | Fill override for dehumidifiers |
| `--tsc-fill-fan` | family default | Fill override for fans / `fan_only` |
| `--tsc-fill-water-heater` | family default | Fill override for water heaters |
| `--tsc-alert-bg` | `#EF4444` | Alert banner background (and one-line alert popover) |
| `--tsc-alert-text` | `#FFF` | Alert banner / popover text color |
| `--tsc-alert-name-color` | `#EF4444` | Zone name color while alerting (one-line layout) |
| `--tsc-offline-color` | `var(--disabled-text-color)` | Offline text color |
| `--tsc-setpoint-color` | `var(--primary-text-color)` | Setpoint text when outside fill |

## Range setpoints (dual-handle mode)

Range-setpoint entities (`target_temp_low`/`target_temp_high`, e.g. `heat_cool` or `auto` mode) use the **exact same mode-color resolution** as single-setpoint entities — see the CSS variables table above and [Mode colors](configuration.md#mode-colors) in the configuration docs for the full resolution ladder (`hvac_action`, then `hvac_modes` capability, then sticky last-active-action, then neutral).

The filled band between the two handles picks up whichever family/mode color the entity's current state resolves to — via the same `--tsc-slider-fill`/`--tsc-slider-fill-cool`/`--tsc-slider-fill-neutral` family tokens and the same `--tsc-fill-heat`/`--tsc-fill-cool`/etc. per-mode overrides, exactly as the single-setpoint fill does. There is no per-handle color distinction and no new CSS custom properties for this mode: the Low and High handles themselves render no fill at all (only the band between them is ever colored), so there's nothing to configure beyond what you've already set for single-setpoint entities.

If you've already customized `--tsc-fill-heat`, `--tsc-fill-cool`, `--tsc-slider-fill`, `--tsc-slider-fill-cool`, or `--tsc-slider-fill-neutral`, those same overrides apply automatically to range-setpoint entities — there's nothing additional to configure.

## Override in a theme

```yaml
# In your theme file
thermostat-slider-card:
  --tsc-heating-color: "#FF6B35"
  --tsc-slider-fill: "linear-gradient(90deg, #FF6B35, #FF8C42)"
```

## Override per-card with card-mod

```yaml
type: custom:thermostat-slider-card
entity: climate.bedroom_thermostat
card_mod:
  style: |
    :host {
      --tsc-heating-color: #FF6B35;
    }
```
