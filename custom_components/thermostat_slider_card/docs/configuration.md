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
| `min` | `14` | Minimum slider value |
| `max` | `21` | Maximum slider value |
| `step` | `0.5` | Slider increment |
| `freeze_threshold` | `5` | Temperature (or entity) below which the freeze risk alert shows |
| `timer` | none | Timer entity for the heating-struggling alert |
| `threshold` | none | Threshold entity for the heating-struggling alert |

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
