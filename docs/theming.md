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
| `--tsc-slider-fill` | `linear-gradient(90deg, #F59E0B, #FBBF24)` | Slider fill (heating) |
| `--tsc-slider-fill-cool` | `linear-gradient(90deg, #06B6D4, #22D3EE)` | Slider fill (cooling) |
| `--tsc-alert-bg` | `#EF4444` | Alert banner background |
| `--tsc-alert-text` | `#FFF` | Alert banner text color |
| `--tsc-offline-color` | `var(--disabled-text-color)` | Offline text color |
| `--tsc-setpoint-color` | `var(--primary-text-color)` | Setpoint text when outside fill |

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
