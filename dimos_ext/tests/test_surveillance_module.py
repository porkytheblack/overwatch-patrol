"""Integration tests for the surveillance module.

Drives `on_detections` with a synthetic detection stream and an injected
clock to verify the incident lifecycle, the INSPECTING gate, and the
suppressed-incident path.
"""
from __future__ import annotations

import uuid

from overwatch_patrol.state_machine import State
from overwatch_patrol.surveillance_module import (
    SurveillanceModule,
    SurveillanceModuleConfig,
    WaypointSpec,
)


def _make_module(now: float = 100.0) -> tuple[SurveillanceModule, list[tuple[str, dict]]]:
    """Construct a module that captures all LCM publishes for inspection."""
    events: list[tuple[str, dict]] = []
    m = SurveillanceModule(
        config=SurveillanceModuleConfig(
            patrol_grace_seconds=2.0,
            manual_override_idle_seconds=60.0,
            inspection_timeout_seconds=30.0,
            cooldown_seconds=3.0,
        ),
        clock=lambda: now,
    )
    m.publish_lcm = lambda topic, payload: events.append((topic, payload))
    return m, events


def _wp(name: str = "front", targets: list[str] | None = None, linger: float = 2.0) -> WaypointSpec:
    return WaypointSpec(
        id=str(uuid.uuid4()),
        name=name,
        pose_x=0.0,
        pose_y=0.0,
        pose_yaw=0.0,
        targets=list(targets or ["person"]),
        linger_threshold_seconds=linger,
    )


def _det(klass: str = "person", track_id: str = "t1", conf: float = 0.9) -> dict:
    return {
        "class": klass,
        "confidence": conf,
        "bbox": {"x": 0.0, "y": 0.0, "w": 10.0, "h": 10.0},
        "track_id": track_id,
    }


def test_linger_opens_incident_and_transitions_inspecting():
    m, events = _make_module()
    m.start_surveillance()
    wp = _wp(linger=2.0)
    m.on_detections(100.0, wp, [_det()])
    m.on_detections(101.0, wp, [_det()])
    m.on_detections(102.5, wp, [_det()])
    topics = [t for t, _ in events]
    assert "/ow/incident_opened" in topics
    assert m.ctx.state is State.INSPECTING


def test_same_track_does_not_duplicate_incident():
    m, events = _make_module()
    m.start_surveillance()
    wp = _wp(linger=2.0)
    for ts in (100.0, 101.0, 102.5, 103.0, 104.0):
        m.on_detections(ts, wp, [_det()])
    opens = [e for t, e in events if t == "/ow/incident_opened"]
    assert len(opens) == 1


def test_inspecting_blocks_other_track():
    """§8 invariant: INSPECTING blocks new incident creation for *other* targets."""
    m, events = _make_module()
    m.start_surveillance()
    wp = _wp(targets=["person"], linger=2.0)
    # Track t1 → opens incident
    m.on_detections(100.0, wp, [_det(track_id="t1")])
    m.on_detections(102.5, wp, [_det(track_id="t1")])
    assert m.ctx.state is State.INSPECTING
    # Track t2 lingers in INSPECTING → must NOT open a second incident.
    m.on_detections(110.0, wp, [_det(track_id="t2")])
    m.on_detections(113.0, wp, [_det(track_id="t2")])
    opens = [e for t, e in events if t == "/ow/incident_opened"]
    assert len(opens) == 1
    assert opens[0]["track_id"] == "t1"


def test_target_lost_emits_suppressed_close():
    """If the linger target disappears mid-inspection (grace exceeded), close suppressed."""
    m, events = _make_module()
    m.start_surveillance()
    wp = _wp(linger=2.0)
    m.on_detections(100.0, wp, [_det(track_id="t1")])
    m.on_detections(102.5, wp, [_det(track_id="t1")])
    # Now stop seeing it for > grace (2.0s) → next tick expires the track.
    m.on_detections(106.0, wp, [])
    closes = [e for t, e in events if t == "/ow/incident_closed"]
    assert len(closes) == 1
    assert closes[0]["status"] == "suppressed"
    assert m.ctx.state is State.COOLDOWN


def test_manual_override_publishes_detections_but_opens_nothing():
    m, events = _make_module()
    m.start_surveillance()
    m.pause_patrol()
    wp = _wp(linger=2.0)
    for ts in (100.0, 101.0, 102.5, 103.0):
        m.on_detections(ts, wp, [_det()])
    dets = [e for t, e in events if t == "/ow/detections"]
    opens = [e for t, e in events if t == "/ow/incident_opened"]
    assert len(dets) == 4
    assert len(opens) == 0


def test_set_targets_global_override():
    m, _events = _make_module()
    m.start_surveillance()
    wp = _wp(targets=["person"])
    m.set_targets(["vehicle"])
    # waypoint says 'person' but global override says 'vehicle' — person should be ignored.
    _, ev2 = _make_module()
    _ = wp  # silence
    # Use the module's resolution
    assert m._resolve_targets(wp) == ["vehicle"]


def test_delete_waypoint_publishes_delete_sync():
    m, events = _make_module()
    m.start_surveillance()
    m.add_waypoint("front")
    events.clear()
    r = m.delete_waypoint("front")
    assert '"ok": true' in r
    delete_evts = [e for t, e in events if t == "/ow/waypoint_sync" and e.get("action") == "delete"]
    assert len(delete_evts) == 1


def test_manual_idle_timeout_returns_to_patrol():
    times = {"t": 200.0}
    m, _events = _make_module()
    m.clock = lambda: times["t"]
    m.start_surveillance()
    m.pause_patrol()
    assert m.ctx.state is State.MANUAL_OVERRIDE
    # Advance the clock past the idle threshold and tick.
    times["t"] = 200.0 + m.config.manual_override_idle_seconds + 1.0
    m.tick()
    assert m.ctx.state is State.PATROLLING


def test_cooldown_completes_to_patrol():
    times = {"t": 300.0}
    m, _events = _make_module()
    m.clock = lambda: times["t"]
    m.start_surveillance()
    wp = _wp(linger=1.0)
    m.on_detections(300.0, wp, [_det()])
    m.on_detections(301.5, wp, [_det()])
    assert m.ctx.state is State.INSPECTING
    # Force a suppressed close.
    m.on_detections(305.0, wp, [])
    assert m.ctx.state is State.COOLDOWN
    times["t"] = 310.0  # beyond cooldown_seconds (3.0)
    m.tick()
    assert m.ctx.state is State.PATROLLING


def test_stop_surveillance_resets_tracker():
    m, _events = _make_module()
    m.start_surveillance()
    wp = _wp(linger=2.0)
    m.on_detections(100.0, wp, [_det()])
    m.stop_surveillance()
    assert m.ctx.state is State.IDLE
    assert m.tracker.get(wp.id, "t1") is None
