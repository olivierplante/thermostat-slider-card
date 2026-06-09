# Configuration

[← Back to README](../README.md)

## Minimum

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
```

## Full options

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
name: Living Room                       # Optional: override display name
layout: full                            # Optional: 'full' (default) or 'one-line'
slider_width: 55                        # Optional: one-line slider width % (default: 55)
min: 14                                 # Optional: slider minimum (default: 14)
max: 21                                 # Optional: slider maximum (default: 21)
step: 0.5                               # Optional: slider increment (default: 0.5)
freeze_threshold: 5                     # Optional: freeze risk alert (default: 5)
timer: timer.living_room_heat           # Optional: heating struggling timer entity
threshold: input_number.heat_threshold  # Optional: heating struggling threshold entity
```

| Key | Default | Description |
|---|---|---|
| `entity` | required | The `climate.*` entity to control |
| `name` | entity name | Display name shown on the card |
| `layout` | `full` | Card layout: `full` (stacked) or `one-line` (compact row) |
| `slider_width` | `55` | One-line only: slider width as a % of the card (number, clamped 20–80) |
| `min` | `14` | Minimum slider value |
| `max` | `21` | Maximum slider value |
| `step` | `0.5` | Slider increment |
| `freeze_threshold` | `5` | Temperature (or entity) below which the freeze risk alert shows |
| `timer` | none | Timer entity for the heating-struggling alert |
| `threshold` | none | Threshold entity for the heating-struggling alert |

## Layout

By default the card uses the `full` layout: name, large current temperature, and a full-width slider stacked vertically.

Set `layout: one-line` for a compact single-row layout — name on the left, current temperature in the middle, slider on the right:

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
name: Living Room
layout: one-line
```

This is ideal for stacking several thermostats in a small space (e.g. a `vertical-stack`).

The slider has a fixed width set by `slider_width` (a percentage of the card, default `55`), so the sliders in a stack of cards line up neatly:

```yaml
type: custom:thermostat-slider-card
entity: climate.living_room_thermostat
layout: one-line
slider_width: 60   # wider slider, less room for the name
```

`slider_width` is a number, clamped to 20–80; out-of-range or non-numeric values are corrected and logged to the console. The current temperature and alert icon are always fully visible — if the row is tight, the **room name** is what truncates with an ellipsis. Lower `slider_width` to give long names more room.

In `one-line` mode, alerts appear as a small icon next to the name (`mdi:snowflake` for freeze risk, `mdi:thermometer-alert` for struggling to heat) and the name turns red, instead of a full-width banner. **Tap the icon** to reveal a popover with the alert text.

An unknown `layout` value falls back to `full` and logs a warning to the browser console.

## Freeze threshold

The freeze threshold accepts either a static number or an entity ID for dynamic control:

```yaml
# Static value
freeze_threshold: 5

# Dynamic: reads value from an input_number entity
freeze_threshold: input_number.freeze_risk_threshold
```

When the current temperature drops below this threshold, a "Freeze risk" alert banner appears on the card.

## Heating-struggling alert

When both `timer` and `threshold` are configured:

- If the timer is `idle` AND the current temperature is at or below the threshold value, a "Struggling to heat" alert appears.

Useful for detecting zones where the heating system can't reach the setpoint.
