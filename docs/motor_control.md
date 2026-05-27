# Motor control

How Overwatch Patrol moves the Go2 — from a key press in the dashboard
all the way to legs stepping on the floor. Written after a long debug
session, so it documents the **gotchas** as much as the happy path.

## Layers, top to bottom

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard ManualDrive (browser, 20 Hz keys/buttons)        │
│      Twist { linear_x, linear_y, angular_z }                │
└──────────┬──────────────────────────────────────────────────┘
           │  POST /api/surveillance/cmd_vel        (HTTPS / same origin)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  ov-api  (TypeScript, Hono)                                 │
│  routes/surveillance.ts → POST {bridge}/cmd_vel             │
└──────────┬──────────────────────────────────────────────────┘
           │  HTTP POST (host loopback)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  ov-bridge  (Python, aiohttp)                               │
│  bridge.CmdVelPublisher.publish(...)                        │
│  → LCM channel /cmd_vel#geometry_msgs.Twist                 │
└──────────┬──────────────────────────────────────────────────┘
           │  LCM multicast on lo0  (route to 239.255.76.67/32)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  dimos GO2Connection module (Python worker, mode="rage")    │
│  In[Twist] subscription → move(twist)                       │
│  → publish_without_callback(WIRELESS_CONTROLLER, {lx, ly,…})│
└──────────┬──────────────────────────────────────────────────┘
           │  WebRTC datachannel (over Wi-Fi or 4G relay)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  Unitree Go2 onboard controller                             │
│  Receives WIRELESS_CONTROLLER frames as joystick input.     │
│  Interpretation depends on the current motion-switcher mode │
│  (rage / default).                                          │
└─────────────────────────────────────────────────────────────┘
```

Patrol uses the same pipeline. The only difference is the source of the
Twist: while `make robot` runs and state is `PATROLLING`,
`SurveillanceModule._start_cmd_vel_patrol_thread` produces Twists from a
go-to-goal P-controller, publishing on the same `/cmd_vel` channel that
`GO2Connection` subscribes to.

## Modes — and why they matter

The Go2 has a **motion-switcher** state that decides how
`WIRELESS_CONTROLLER` (joystick) input is interpreted:

| Mode | What the left stick does | When you're in it |
|---|---|---|
| `BalanceStand` (default after StandUp) | Adjusts **body posture** — pushing the stick forward lifts/pitches the body, not the dog. | dimos's `GO2Connection.start()` does StandUp → BalanceStand and stops there if `mode != "rage"` |
| `rage` (the one we want) | Translates the stick to **walking velocity** — forward stick = walk forward. | When `GO2Connection` is composed with `mode="rage"` and its `start()` calls `enable_rage_mode()` |

The classic "I pressed W and the dog lifted its body" symptom is
*always* a sign that the dog is in BalanceStand and never made the
mode transition into rage.

## What rage mode actually does

`UnitreeWebRTCConnection.enable_rage_mode()` sends two sport-mode
requests in sequence over the WebRTC data channel:

```python
publish_request(SPORT_MOD, {"api_id": 2059, "parameter": {"data": True}})
time.sleep(2.0)
publish_request(SPORT_MOD, {"api_id": SPORT_CMD["SwitchJoystick"],  # 1027
                             "parameter": {"data": True}})
```

- **`api_id=2059, data=True`** — the rage toggle. Internally this
  uncaps the dog's max speed and enables the higher-performance gait.
- **`SwitchJoystick(1027), data=True`** — **the key one.** This flips
  the motion-switcher mode so the WIRELESS_CONTROLLER topic is
  interpreted as walking velocity rather than body posture. Without
  this, no amount of stick input will make the dog step.

`SwitchJoystick` on its own sometimes works (firmware-dependent), but
the rage toggle before it gives a reliable transition across
firmware versions.

## How we ensure rage mode is active

In the blueprint
(`dimos_ext/overwatch_patrol/blueprints/go2_overwatch.py`) we re-compose
`GO2Connection` with `mode="rage"`:

```python
go2_overwatch = autoconnect(
    _with_jpeglcm,
    GO2Connection.blueprint(mode="rage"),   # ← here
    SpatialMemoryStub.blueprint(),
    SurveillanceModule.blueprint(...),
    ...
)
```

dimos's `autoconnect` uses "later wins on module identity" for
deduplication, so this second `GO2Connection.blueprint(mode="rage")`
replaces the default-mode one carried by `_with_jpeglcm`. When the
worker spins up, `GO2Connection.start()` then runs the full sequence
on its own — no post-init primer needed.

## Joystick semantics — the `move()` mapping

In `dimos.robot.unitree.connection`:

```python
def move(self, twist: Twist, duration: float = 0.0) -> bool:
    x, y, yaw = twist.linear.x, twist.linear.y, twist.angular.z
    publish_without_callback(WIRELESS_CONTROLLER, {
        "lx": -y,   # joystick X = negate ROS-left
        "ly": x,    # joystick Y = ROS-forward
        "rx": -yaw, # joystick yaw = negate ROS-CCW
        "ry": 0,
    })
```

Twist values are treated as **joystick units in `[-1, +1]`**, not as
m/s in any absolute sense. They get clamped on the dog side. So
sending `linear.x = 1.0` is "full forward stick", not "1 m/s".

What the dog interprets that as in m/s depends on the gait + the
`SpeedLevel` setting + which mode it's in. In rage mode at full
stick, expect roughly 1–1.5 m/s on the real Go2.

## The walking deadzone

Below roughly **0.5 stick magnitude** the Go2 won't engage the
walking gait at all — the legs stay still. This is the second
classic failure mode: rage mode is enabled, the right `WIRELESS_CONTROLLER`
frames are flowing, but the stick magnitude is too small to clear
the deadzone, so the dog appears stationary.

This is why our manual drive and patrol have explicit floors:

```python
# ManualDrive (dashboard, indoor tuning)
LINEAR_SPEED = 0.6     # base
ANGULAR_SPEED = 0.7
SPRINT_MULT = 1.6      # held Shift bumps to ~0.96 / ~1.12

# Patrol controller
LINEAR_CRUISE = 0.65
LINEAR_FLOOR  = 0.55   # never go below this — always above deadzone
ANGULAR_MAX   = 0.7
ANGULAR_MIN   = 0.55   # rotation deadzone floor
```

If you tune anything below ~0.5 the dog will silently stop stepping.

## Frequency matters

`UnitreeWebRTCConnection` has a **`cmd_vel_timeout = 0.2 s`** watchdog.
If no new `move()` call arrives within 200 ms, the dog auto-stops.

The dashboard and patrol both run at **20 Hz** (50 ms tick), giving
4 in-flight commands per watchdog window. That's enough headroom for
the cellular relay to drop a packet without the dog stuttering to a
halt mid-stroke.

If you ever bump the tick rate down (e.g. for slower control loops),
make sure you stay under 200 ms or the dog will keep stopping.

## The patrol controller

`SurveillanceModule._start_cmd_vel_patrol_thread` is a basic
go-to-goal P-controller with two key shapes for smoothness:

```python
yaw_err = atan2(wp.y - pose.y, wp.x - pose.x) - pose.yaw

# Angular: P on heading error, clipped to deadzone-aware band
az = clamp(ANGULAR_GAIN * yaw_err, ±ANGULAR_MAX)
if |az| < ANGULAR_MIN: az = sign(az) * ANGULAR_MIN

# Linear: blended with heading alignment
if |yaw_err| > 40°:
    lx = 0                                      # rotate in place
else:
    lx = LINEAR_CRUISE * cos(yaw_err)           # arc smoothly
    if dist < APPROACH_RADIUS: lx *= dist / APPROACH_RADIUS
    lx = max(lx, LINEAR_FLOOR)                  # don't stall in deadzone

publish_cmd_vel(lx, 0, az)
```

The `cos(yaw_err)` blend is what makes the dog trace a smooth arc
toward the goal instead of snap-rotating and then driving. Within ~40°
of target, the dog drives *and* turns simultaneously. Beyond that,
it rotates in place. Within `APPROACH_RADIUS` the speed ramps down
for a gentle stop.

Knobs to tune (top of `_start_cmd_vel_patrol_thread`):

- `LINEAR_CRUISE` — patrol top speed
- `LINEAR_FLOOR` — never below this; deadzone-aware
- `ANGULAR_MAX` / `ANGULAR_GAIN` — rotation aggressiveness
- `HEADING_BLEND_RAD` — how aligned before we start driving forward
- `ARRIVAL_RADIUS_M` — how close to the waypoint counts as arrived
- `DWELL_S` — pause at each waypoint before the next leg

## Auto-recovery from falls

`SurveillanceModule._start_fall_recovery_watcher` reads the orientation
quaternion from `/odom` at 2 Hz and projects world-up into the body
frame:

```
body_up_z = 1 - 2 * (qx² + qy²)
```

Standing upright that's ~1.0; tipped over it drops past 0.6 (≈53°).
Sustained for >2 s it fires `RecoveryStand` then `BalanceStand` via
the sport-command bypass (see below). 10 s cooldown so it doesn't
double-trigger mid-recovery.

## Sport commands — the LCM bypass

The dashboard's SportPanel buttons (RECOVERY / BALANCE / STAND / SIT
/ STRETCH / HELLO) don't go through MCP. The dimos RPC backplane on
the 4G relay can hang for up to 120 s on `execute_sport_command`, so
clicks would silently time out. Instead:

```
dashboard SportPanel
    ↓ POST /api/surveillance/sport
ov-api
    ↓ POST {bridge}/sport
ov-bridge.SportPublisher
    ↓ LCM channel /ow/sport_request  (std_msgs.String JSON)
SurveillanceModule._start_sport_request_listener
    ↓ self._connection.publish_request(SPORT_MOD, {api_id, parameter})
GO2Connection
    ↓ WebRTC datachannel
Dog
```

The only cross-worker hop left is `SurveillanceModule → GO2Connection`
via the `_connection: GO2ConnectionSpec` Spec injection — dimos
resolves that locally, sub-millisecond. The auto-recovery watcher
uses the same `_fire_sport_command` helper.

Acrobatic commands (Backflip / Handstand / Bound / MoonWalk) are
intentionally **not** in the dashboard panel. Per spec §13 those
are confirmation-required; they go through the Telegram bot's
reply-`y`-to-confirm flow.

## When the dog won't move — diagnostic order

1. **Can you reach the dog at all?**
   ```
   ping 192.168.12.1
   nc -zv 192.168.12.1 9991        # signaling endpoint
   ```
2. **Does the low-level walk path work?**
   ```
   pkill -9 -f overwatch_patrol
   .venv/bin/python scripts/robot_ping.py 192.168.12.1 --walk
   ```
   Runs `StandUp → BalanceStand → RageMode(2059) → SwitchJoystick(1027)
   → forward burst for 2 s` directly over WebRTC. If this doesn't step
   the dog, the issue is on the dog side (firmware, battery, locked
   joystick) — nothing higher up the stack can help.
3. **Does the surveillance module see odom?**
   ```
   tail -f /tmp/overwatch_surveillance.log | grep -i odom_sample
   ```
   Look for `count=1 / 10 / 100` with real (x, y, yaw) values.
4. **Does the bridge see cmd_vel from the dashboard?**
   ```
   tail -f logs/ov-bridge.log | grep -i cmd_vel
   ```
   Hold W on the dashboard, expect a steady stream of `/cmd_vel` POSTs
   at 20 Hz.
5. **Is rage mode actually enabled?**
   Look in `make robot`'s console for `enable_rage_mode` and the
   `api_id 2059` / `SwitchJoystick` log lines from
   `UnitreeWebRTCConnection`. If you don't see them, the blueprint
   didn't compose `GO2Connection` with `mode="rage"`.

## Common pitfalls

- **`OV_SIM=1` left set in `.env`** — the blueprint will use
  MujocoConnection instead of WebRTC and the real dog will be
  ignored. Unset it for hardware runs.
- **Joystick speeds below 0.5** — silent stall, dog stays still.
- **WebRTC session held by a previous run** — `pkill -9 -f
  overwatch_patrol` first, wait 30 s for the dog to release the
  session slot, then retry. Power-cycle the dog if that doesn't
  clear it.
- **Multiple WebRTC clients** — only one allowed at a time. Close
  the Unitree app before running `make robot`.
- **LCM multicast not on `lo0`** — `sudo route -n add -net
  239.255.76.67 -interface lo0`. Without this the bridge can't see
  `cmd_vel` from `make robot` even though both processes are on the
  same Mac.
- **Cellular relay (`Go2 connection mode: 4G`)** — works but adds
  100–300 ms latency per `WIRELESS_CONTROLLER` frame. For lowest
  latency, join the dog to your home Wi-Fi via the Unitree app
  instead of the 4G relay.

## File pointers

| Concern | File |
|---|---|
| `mode="rage"` blueprint composition | `dimos_ext/overwatch_patrol/blueprints/go2_overwatch.py` |
| Patrol P-controller + dashboard cmd_vel publish loop tunings | `dimos_ext/overwatch_patrol/surveillance_module.py` |
| Manual drive UI + speed constants | `services/ov-dashboard/src/app/patrol/ManualDrive.tsx` |
| Bridge cmd_vel publisher (LCM Twist) | `services/ov-bridge/bridge/cmd_vel.py` |
| Bridge sport-command publisher (LCM bypass) | `services/ov-bridge/bridge/sport_pub.py` |
| Sport-command LCM subscriber + WebRTC publish | `surveillance_module._start_sport_request_listener` + `_fire_sport_command` |
| Fall-recovery watcher | `surveillance_module._start_fall_recovery_watcher` |
| Robot connection sanity check | `scripts/robot_ping.py` (run with `--walk` for full walking test) |
