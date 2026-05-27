"""SurveillanceModule — dimos `Module` wrapper around `SurveillanceCore`.

The pure logic lives in `surveillance_core.SurveillanceCore` so it can be
unit-tested without dimos. This file is the dimos-coupled adapter: it
inherits from `dimos.core.module.Module`, declares typed In/Out streams,
exposes @rpc + @skill methods, and is composable via `Module.blueprint()`
+ `autoconnect()`.

Skills exposed (spec §7.1):
  start_surveillance, stop_surveillance, pause_patrol, resume_patrol,
  add_waypoint, delete_waypoint, list_waypoints, go_to_waypoint,
  set_targets, force_inspect, get_robot_state.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
from collections.abc import AsyncGenerator
from typing import Any, Optional

import structlog

from dimos.agents.annotation import skill
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.core.stream import In, Out
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.navigation.replanning_a_star.module_spec import (
    ReplanningAStarPlannerSpec,
)
from dimos.robot.unitree.go2.connection_spec import GO2ConnectionSpec
from dimos_lcm.std_msgs import Bool


# Sport commands we expose via the LCM bypass path. Keys match the
# dashboard's SportPanel labels and the Telegram bot's
# `execute_sport_command(command_name=…)` argument verbatim.
_SPORT_COMMANDS: dict[str, int] = {
    "Damp": 1001,
    "BalanceStand": 1002,
    "StopMove": 1003,
    "StandUp": 1004,
    "StandDown": 1005,
    "RecoveryStand": 1006,
    "Move": 1008,
    "Sit": 1009,
    "RiseSit": 1010,
    "Hello": 1016,
    "Stretch": 1017,
    # SwitchJoystick is what actually enables walking via the
    # WIRELESS_CONTROLLER channel. Without it the dog interprets stick
    # inputs as body posture (W lifts body, S lowers). Send with
    # parameter={"data": True}.
    "SwitchJoystick": 1027,
    "FreeWalk": 1045,
}
_SPORT_MOD_TOPIC = "rt/api/sport/request"  # RTC_TOPIC["SPORT_MOD"] value

from .state_machine import State
from .surveillance_core import (
    SurveillanceCore,
    SurveillanceCoreConfig,
    WaypointSpec,
)

log = structlog.get_logger()


_FILE_LOG_PATH = "/tmp/overwatch_surveillance.log"
_file_log_configured = False


def _setup_file_log() -> None:
    """Mirror everything from this module's stdlib logger to a known file.

    The dimos worker process's stderr can be hard to reach in practice
    (the sim runs in the operator's terminal, behind a multiprocessing
    forkserver). A dedicated file gives us a deterministic trail for
    diagnosing why patrol isn't moving.
    """
    global _file_log_configured
    if _file_log_configured:
        return
    import logging

    handler = logging.FileHandler(_FILE_LOG_PATH, mode="a")
    handler.setFormatter(
        logging.Formatter("%(asctime)s [%(name)s] %(message)s"),
    )
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    _file_log_configured = True


class SurveillanceModuleConfig(ModuleConfig):
    """Dimos-compatible config (spec §7.1).

    `camera_info` is intentionally typed `Any` — the dimos `CameraInfo`
    is supplied by the blueprint at compose time.
    """

    camera_info: Any = None
    detector_period_s: float = 0.2
    patrol_grace_seconds: float = 5.0
    manual_override_idle_seconds: float = 60.0
    inspection_timeout_seconds: float = 30.0
    cooldown_seconds: float = 3.0


class SurveillanceModule(Module):
    """dimos Module: the brain."""

    config: SurveillanceModuleConfig

    # Wired by dimos autoconnect to ReplanningAStarPlanner in the
    # unitree_go2 blueprint. `goal_request` publishes a PoseStamped on
    # the planner's input stream; `goal_reached` is its arrival
    # broadcast. The spec field lets us call cancel_goal / replanning
    # toggles directly when the operator pauses or stops patrol.
    goal_request: Out[PoseStamped]
    goal_reached: In[Bool]
    _planner_spec: ReplanningAStarPlannerSpec
    # GO2 WebRTC connection — same Spec UnitreeSkillContainer uses.
    # Lets us fire sport commands (FreeWalk, Hello, RecoveryStand,
    # etc.) without going through the MCP RPC backplane, which on the
    # 4G cellular relay path can hang for 120s. The LCM bypass path
    # (sport_request subscriber → publish_request) is what powers the
    # dashboard's SportPanel and the auto-recovery watcher.
    _connection: GO2ConnectionSpec

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # Latest (x, y, yaw) sampled from /odom; `current_pose` reads
        # this so `add_waypoint` captures a real robot location rather
        # than the (0, 0, 0) default.
        self._pose: tuple[float, float, float] = (0.0, 0.0, 0.0)
        # Full orientation quaternion (x, y, z, w) of the robot body
        # from /odom — needed for fall detection (computing pitch / roll
        # / tilt-from-vertical).
        self._quat: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
        self._odom_thread: Optional[Any] = None
        # Last-seen YOLO track ID per class, used to stabilise
        # detections when the tracker briefly drops a target. See
        # _start_detector_thread.
        self._track_id_by_class: dict[int, str] = {}
        # Set in main(); used by handle_goal_reached + the patrol loop.
        self._goal_reached_event: Optional[asyncio.Event] = None
        self._supervisor_task: Optional[asyncio.Task[None]] = None
        self._patrol_thread: Optional[Any] = None
        self.core = SurveillanceCore(
            config=SurveillanceCoreConfig(
                detector_period_s=self.config.detector_period_s,
                patrol_grace_seconds=self.config.patrol_grace_seconds,
                manual_override_idle_seconds=self.config.manual_override_idle_seconds,
                inspection_timeout_seconds=self.config.inspection_timeout_seconds,
                cooldown_seconds=self.config.cooldown_seconds,
            ),
            publish=self._publish_event,
            current_pose=lambda: self._pose,
        )
        # Open a file-based diagnostic log so we can see what's
        # happening inside the dimos worker process even if the sim
        # console output is buried. structlog goes to stderr which
        # might be redirected; this is belt-and-braces.
        _setup_file_log()
        log.info("surveillance.module_init_done")
        # Waypoints survive sim restarts in SQLite (via the bridge),
        # but the in-memory list does not. Bootstrap from disk so a
        # post-restart START PATROL cycles the waypoints the operator
        # already set up.
        self._load_waypoints_from_sqlite()
        self._start_odom_listener()
        self._start_cmd_vel_patrol_thread()
        self._start_detector_thread()
        self._start_core_tick_thread()
        self._start_fall_recovery_watcher()
        self._start_sport_request_listener()
        self._start_walk_mode_primer()

    def _start_fall_recovery_watcher(self) -> None:
        """Detect a fallen robot and call RecoveryStand automatically.

        Approach: derive the world-frame "up" vector projected into the
        robot body's local Z by rotating (0, 0, 1) through the inverse
        of the body quaternion. When the robot stands upright that
        component is ~1.0; when it tips over it drops toward 0 and goes
        negative if the robot is fully upside-down. We treat <0.6
        (≈53° tilt) sustained for >2s as a fall, and trigger
        `execute_sport_command("RecoveryStand")` followed by
        `BalanceStand` to re-engage active stance.

        A 10s cooldown prevents back-to-back recovery attempts while
        the robot's still standing back up.
        """
        import threading
        import time

        FALL_TILT_THRESHOLD = 0.6  # cos(angle) below this = tipped
        FALL_DWELL_S = 2.0
        RECOVERY_COOLDOWN_S = 10.0

        def _run() -> None:
            tilted_since: Optional[float] = None
            last_recovery_at = 0.0

            log.info("surveillance.fall_watcher_alive")
            while True:
                time.sleep(0.5)
                # Up vector in body frame: R⁻¹ @ (0, 0, 1).
                # For unit quaternion (x, y, z, w):
                # body_up_z = 1 - 2*(x² + y²)
                qx, qy, qz, qw = self._quat
                if (qx, qy, qz, qw) == (0.0, 0.0, 0.0, 1.0):
                    # Odom hasn't fired yet, or robot is exactly identity
                    # (Mujoco may publish yaw-only odom). Skip.
                    continue
                body_up_z = 1.0 - 2.0 * (qx * qx + qy * qy)

                now = time.time()
                if body_up_z < FALL_TILT_THRESHOLD:
                    if tilted_since is None:
                        tilted_since = now
                        log.info(
                            "surveillance.tilt_detected",
                            body_up_z=round(body_up_z, 3),
                        )
                    elif (
                        now - tilted_since >= FALL_DWELL_S
                        and now - last_recovery_at >= RECOVERY_COOLDOWN_S
                    ):
                        log.warning(
                            "surveillance.fall_detected",
                            body_up_z=round(body_up_z, 3),
                            dwell_s=round(now - tilted_since, 2),
                        )
                        last_recovery_at = now
                        tilted_since = None
                        self._fire_sport_command("RecoveryStand")
                        time.sleep(2.0)
                        self._fire_sport_command("BalanceStand")
                        log.info("surveillance.recovery_complete")
                else:
                    tilted_since = None

        threading.Thread(
            target=_run, daemon=True, name="surveillance-fall-recovery",
        ).start()

    # ------------------------------------------------------------------
    # Sport-command bypass path.
    #
    # MCP `tools/call execute_sport_command(...)` works in principle but
    # the dimos RPC backplane on the 4G relay can hang the dispatch for
    # 120s. The dashboard's SportPanel and the auto-recovery watcher
    # need millisecond response, so we route sport commands over LCM
    # instead:
    #
    #   dashboard → ov-api → bridge → LCM `/ow/sport_request` (String JSON)
    #     → SurveillanceModule (here) → self._connection.publish_request
    #     → GO2Connection → WebRTC → robot.
    #
    # The slow MCP hops disappear; the only cross-worker call left is
    # SurveillanceModule → GO2Connection via the GO2ConnectionSpec Spec
    # injection, which dimos resolves locally.
    # ------------------------------------------------------------------

    def _fire_sport_command(
        self,
        command: str,
        parameter: Optional[dict[str, Any]] = None,
    ) -> bool:
        """Send a Go2 sport command via the WebRTC channel.

        Some commands need a `parameter` payload — most notably
        `SwitchJoystick(data=True)` which actually enables walking via
        WIRELESS_CONTROLLER. Without parameters, sends just the api_id.

        Returns True on success — failures get logged and swallowed.
        """
        api_id = _SPORT_COMMANDS.get(command)
        if api_id is None:
            log.warning("surveillance.sport_unknown", command=command)
            return False
        return self._fire_sport_api_id(api_id, parameter, label=command)

    def _fire_sport_api_id(
        self,
        api_id: int,
        parameter: Optional[dict[str, Any]] = None,
        label: str = "",
    ) -> bool:
        """Lower-level variant for sport api_ids that aren't in our
        `_SPORT_COMMANDS` map — e.g. the rage-mode toggle (2059) which
        doesn't have a stable string name in the dimos constants but
        is required to enable joystick walking.
        """
        request: dict[str, Any] = {"api_id": api_id}
        if parameter is not None:
            request["parameter"] = parameter
        try:
            self._connection.publish_request(_SPORT_MOD_TOPIC, request)
            log.info(
                "surveillance.sport_sent",
                command=label or str(api_id),
                api_id=api_id,
                parameter=parameter,
            )
            return True
        except Exception as e:  # noqa: BLE001
            log.warning(
                "surveillance.sport_fail",
                command=label or str(api_id),
                error=str(e),
            )
            return False

    def _start_sport_request_listener(self) -> None:
        """Subscribe to `/ow/sport_request` LCM events and fire them
        as sport commands. Payload: `{"command": "Hello"}` (or
        FreeWalk / BalanceStand / RecoveryStand / etc.).
        """
        import threading

        def _run() -> None:
            try:
                import lcm  # type: ignore
                from dimos_lcm.std_msgs.String import String  # type: ignore
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.sport_lcm_missing", error=str(e))
                return

            lc = lcm.LCM(
                os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            )

            def _handler(_ch: str, data: bytes) -> None:
                try:
                    msg = String.lcm_decode(data)
                    payload = json.loads(msg.data)
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.sport_decode_fail", error=str(e))
                    return
                cmd = str(payload.get("command", "")).strip()
                if cmd:
                    self._fire_sport_command(cmd)

            lc.subscribe("/ow/sport_request", _handler)
            log.info("surveillance.sport_request_subscribed")
            while True:
                try:
                    lc.handle_timeout(200)
                except Exception:  # noqa: BLE001
                    return

        threading.Thread(
            target=_run, daemon=True, name="surveillance-sport-listener",
        ).start()

    def _start_walk_mode_primer(self) -> None:
        """After startup, put the Go2 into a state where the
        WIRELESS_CONTROLLER joystick (driven by our cmd_vel pipeline)
        actually walks the dog instead of adjusting body posture.

        The full sequence comes from reading dimos's `enable_rage_mode`
        in unitree/connection.py — the bit that makes joystick walking
        work isn't FreeWalk, it's `SwitchJoystick(data=True)` (sport
        api_id 1027). Without it the dog stays in posture-control mode
        on the left stick (W lifts the body, S lowers it).

        Sequence:
          1. BalanceStand (1002) — ensures the dog is standing/active.
          2. FreeWalk (1045) — locomotion mode (walk vs trot).
          3. SwitchJoystick(data=True) (1027) — the actual "stick →
             walking" toggle. THIS is the missing piece.

        Real-world symptom this fixes: operator presses W on the
        dashboard, robot's body lifts up but legs don't step.
        """
        import threading
        import time

        def _run() -> None:
            # Wait for dimos's own init to settle. GO2Connection.start
            # does StandUp + BalanceStand at ~T+3s; we want to be
            # comfortably after that so our sport commands don't race.
            time.sleep(8)
            # Mirror exactly what dimos's enable_rage_mode does — the
            # only documented sequence in dimos that actually makes the
            # joystick walk the dog:
            #   1. api_id 2059 (rage mode toggle)   → uncaps motion
            #   2. SwitchJoystick(data=True) 1027   → joystick = walking
            # Without (1), (2) on its own sometimes works but is
            # inconsistent across firmware versions.
            self._fire_sport_command("BalanceStand")
            time.sleep(1.5)
            self._fire_sport_api_id(
                2059, parameter={"data": True}, label="RageMode",
            )
            time.sleep(2.0)
            self._fire_sport_command(
                "SwitchJoystick", parameter={"data": True},
            )
            log.info("surveillance.walk_mode_primed")

        threading.Thread(
            target=_run, daemon=True, name="surveillance-walk-primer",
        ).start()

    def _start_core_tick_thread(self) -> None:
        """Drive `core.tick()` at 2Hz.

        SurveillanceCore relies on a periodic tick to expire timers —
        inspection_timeout_seconds, cooldown_seconds, manual_override
        idle. Without this loop the state machine gets stuck the first
        time it enters INSPECTING / COOLDOWN / MANUAL_OVERRIDE.
        """
        import threading
        import time

        def _run() -> None:
            while True:
                try:
                    self.core.tick()
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.tick_fail", error=str(e))
                time.sleep(0.5)

        threading.Thread(
            target=_run, daemon=True, name="surveillance-core-tick",
        ).start()

    # ------------------------------------------------------------------
    # Detector
    # ------------------------------------------------------------------

    DETECTOR_ACTIVE_RADIUS_M = 2.5

    def _active_waypoint(self) -> Optional["WaypointSpec"]:
        """Return the waypoint detections should be attributed to.

        Spec §8 invariant: only PATROLLING and INSPECTING may open
        incidents. Outside that, no waypoint is "active" and the
        detector still publishes frames but skips incident gating.

        The active waypoint is the nearest one within
        DETECTOR_ACTIVE_RADIUS_M of the current pose — that captures
        both "dwelling at a waypoint" (cursor case) and "near a
        waypoint that isn't currently the cursor" (which still ought
        to flag intruders).
        """
        if self.core.ctx.state not in (State.PATROLLING, State.INSPECTING):
            return None
        if not self.core.waypoints:
            return None
        x, y, _ = self._pose
        best = None
        best_d2 = self.DETECTOR_ACTIVE_RADIUS_M ** 2
        for w in self.core.waypoints:
            d2 = (w.pose_x - x) ** 2 + (w.pose_y - y) ** 2
            if d2 < best_d2:
                best, best_d2 = w, d2
        return best

    def _start_detector_thread(self) -> None:
        """Run YOLO at `config.detector_period_s` on /color_image frames.

        Output detections feed `core.on_detections(ts, waypoint, ...)`,
        which handles the linger tracker + incident open / suppress
        logic that already exists in SurveillanceCore. Detections only
        run when an active waypoint resolves; otherwise we burn no
        cycles on a YOLO pass that nothing would consume.
        """
        import threading

        def _run() -> None:
            import time

            try:
                import lcm  # type: ignore
                import numpy as np  # type: ignore
                import cv2  # type: ignore
                from dimos_lcm.sensor_msgs.Image import Image as LCMImage  # type: ignore
                from ultralytics import YOLO  # type: ignore
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.detector_imports_failed", error=str(e))
                return

            # Cache the latest JPEG frame from a dedicated LCM client +
            # pump thread, decoupled from any other subscribers in
            # this process.
            latest_jpeg: dict[str, Optional[bytes]] = {"data": None}

            def _img_handler(_ch: str, data: bytes) -> None:
                try:
                    msg = LCMImage.lcm_decode(data)
                    if getattr(msg, "encoding", "") == "jpeg":
                        latest_jpeg["data"] = bytes(msg.data[: msg.data_length])
                except Exception:  # noqa: BLE001
                    pass

            lc = lcm.LCM(
                os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            )
            lc.subscribe(r"^/color_image(#.*)?$", _img_handler)
            log.info("surveillance.detector_lcm_subscribed")

            def _pump() -> None:
                while True:
                    try:
                        lc.handle_timeout(200)
                    except Exception:  # noqa: BLE001
                        return

            threading.Thread(target=_pump, daemon=True, name="surveillance-detector-lcm").start()

            # Load YOLO. First run downloads yolov8n.pt (~6MB).
            log.info("surveillance.yolo_loading")
            try:
                model = YOLO("yolov8n.pt")
            except Exception as e:  # noqa: BLE001
                log.error("surveillance.yolo_load_fail", error=str(e))
                return
            log.info("surveillance.yolo_ready", classes=len(model.names))

            period = max(0.05, float(self.config.detector_period_s))
            ticks = 0
            while True:
                time.sleep(period)
                ticks += 1
                jpeg = latest_jpeg["data"]
                if jpeg is None:
                    if ticks in (10, 100):
                        log.info("surveillance.detector_waiting_for_frame", ticks=ticks)
                    continue

                wp = self._active_waypoint()
                if wp is None:
                    continue  # nothing to attribute detections to

                try:
                    arr = cv2.imdecode(
                        np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR,
                    )
                    if arr is None:
                        continue
                    # `track` keeps stable IDs across frames so the
                    # linger tracker can accumulate per-target time.
                    # classes=[0] = COCO "person" — cheap filter that
                    # skips bbox extraction for everything else.
                    results = model.track(
                        arr, persist=True, classes=[0], verbose=False,
                    )
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.yolo_inference_fail", error=str(e))
                    continue

                detections: list[dict[str, Any]] = []
                for r in results:
                    boxes = getattr(r, "boxes", None)
                    if boxes is None:
                        continue
                    for box in boxes:
                        try:
                            xywh = box.xywh[0].tolist()
                            conf = float(box.conf[0])
                            cls_id = int(box.cls[0])
                            track_id_raw = getattr(box, "id", None)
                            if track_id_raw is not None:
                                track_id = f"t{int(track_id_raw[0])}"
                                # Cache last-seen ID per class so a
                                # frame where YOLO drops the tracker
                                # (returns None) doesn't fork into a
                                # second LingerTracker entry — that
                                # was making linger time unreliable
                                # and causing premature suppression.
                                self._track_id_by_class[cls_id] = track_id
                            else:
                                track_id = self._track_id_by_class.get(cls_id)
                        except Exception:  # noqa: BLE001
                            continue
                        cx, cy, w_, h_ = xywh
                        detections.append(
                            {
                                "class": model.names.get(cls_id, str(cls_id)),
                                "confidence": conf,
                                # Spec §6 bbox is top-left + w + h.
                                "bbox": {
                                    "x": float(cx - w_ / 2),
                                    "y": float(cy - h_ / 2),
                                    "w": float(w_),
                                    "h": float(h_),
                                },
                                "track_id": track_id,
                            },
                        )

                if detections:
                    log.info(
                        "surveillance.detections",
                        n=len(detections),
                        waypoint=wp.name,
                        track_ids=[d.get("track_id") for d in detections],
                    )
                ts = time.time()
                try:
                    self.core.on_detections(ts, wp, detections)
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.on_detections_fail", error=str(e))

        threading.Thread(
            target=_run, daemon=True, name="surveillance-detector",
        ).start()

    def _load_waypoints_from_sqlite(self) -> None:
        sqlite_path = os.environ.get("SQLITE_PATH") or ""
        if not sqlite_path:
            log.info("surveillance.waypoints_load_skipped", reason="no SQLITE_PATH")
            return
        try:
            import sqlite3

            uri = f"file:{sqlite_path}?mode=ro"
            conn = sqlite3.connect(uri, uri=True, timeout=2.0)
            try:
                rows = conn.execute(
                    "SELECT id, name, pose_x, pose_y, pose_yaw, targets, "
                    "linger_threshold_seconds, inspection_dwell_seconds, "
                    "min_standoff_m, enabled "
                    "FROM waypoints WHERE enabled=1 ORDER BY order_index ASC"
                ).fetchall()
            finally:
                conn.close()
        except Exception as e:  # noqa: BLE001
            log.warning("surveillance.waypoints_load_fail", error=str(e))
            return

        loaded = []
        for r in rows:
            try:
                targets = json.loads(r[5]) if r[5] else []
            except Exception:  # noqa: BLE001
                targets = []
            # Bring legacy rows (stored with targets='[]' by older
            # bridge versions) up to the current default so the demo
            # works without per-waypoint editing.
            if not targets:
                targets = ["person"]
            loaded.append(
                WaypointSpec(
                    id=str(r[0]),
                    name=str(r[1]),
                    pose_x=float(r[2]),
                    pose_y=float(r[3]),
                    pose_yaw=float(r[4]),
                    targets=list(targets),
                    linger_threshold_seconds=float(r[6]),
                    inspection_dwell_seconds=float(r[7]),
                    min_standoff_m=float(r[8]),
                    enabled=bool(r[9]),
                ),
            )
        self.core.waypoints = loaded
        log.info(
            "surveillance.waypoints_loaded",
            count=len(loaded),
            names=[w.name for w in loaded],
        )

    # ------------------------------------------------------------------
    # Event publishing.
    #
    # SurveillanceCore emits `/ow/*` events (waypoint_sync, robot_state,
    # incident_opened/closed, detections). The bridge subscribes to those
    # raw LCM channels (services/ov-bridge/bridge/lcm_listener.py) and
    # writes to SQLite. We serialise payloads as JSON-encoded
    # `dimos_lcm.std_msgs.String` messages so the bridge can decode
    # without any schema coupling.
    #
    # We use a raw `lcm.LCM(...)` handle rather than dimos's typed
    # transport because the bridge isn't a dimos module — keeping the
    # wire format wire-simple decouples the planes.
    # ------------------------------------------------------------------

    _lc: Optional[Any] = None

    def _start_odom_listener(self) -> None:
        """Subscribe to `/odom#geometry_msgs.PoseStamped` in a daemon
        thread so `add_waypoint` captures the live pose.

        We use raw LCM here for the same reason as the publish path —
        keeping this module decoupled from dimos's typed transport
        bookkeeping. The pose message carries quaternion orientation; we
        convert the yaw component on the fly.
        """
        import threading

        def _run() -> None:
            try:
                import lcm  # type: ignore
                from dimos_lcm.geometry_msgs.PoseStamped import (  # type: ignore
                    PoseStamped,
                )
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.odom_unavailable", error=str(e))
                return

            lc = lcm.LCM(
                os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            )

            samples = {"n": 0}

            def _handler(_channel: str, data: bytes) -> None:
                try:
                    msg = PoseStamped.lcm_decode(data)
                    p = msg.pose.position
                    q = msg.pose.orientation
                    # yaw from quaternion (Z-up). Matches the ROS REP-103
                    # convention used elsewhere in dimos.
                    import math

                    siny_cosp = 2.0 * (q.w * q.z + q.x * q.y)
                    cosy_cosp = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
                    yaw = math.atan2(siny_cosp, cosy_cosp)
                    self._pose = (float(p.x), float(p.y), float(yaw))
                    self._quat = (
                        float(q.x), float(q.y), float(q.z), float(q.w),
                    )
                    samples["n"] += 1
                    if samples["n"] in (1, 10, 100):
                        log.info(
                            "surveillance.odom_sample",
                            count=samples["n"],
                            x=round(self._pose[0], 3),
                            y=round(self._pose[1], 3),
                            yaw=round(self._pose[2], 3),
                        )
                except Exception as e:  # noqa: BLE001
                    log.warning("surveillance.odom_decode_fail", error=str(e))

            # Match both `/odom` and `/odom#geometry_msgs.PoseStamped`
            # — dimos's LCMPubSubBase appends the type suffix when
            # publishing, but other tools use bare channel names.
            lc.subscribe(r"^/odom(#.*)?$", _handler)
            log.info("surveillance.odom_subscribed")
            while True:
                try:
                    lc.handle_timeout(200)
                except Exception:  # noqa: BLE001
                    return

        self._odom_thread = threading.Thread(
            target=_run, daemon=True, name="surveillance-odom",
        )
        self._odom_thread.start()

    def _start_cmd_vel_patrol_thread(self) -> None:
        """Thread that drives the robot through waypoints via /cmd_vel.

        Bypasses dimos's planner entirely — we publish Twist messages
        on the same LCM channel the Go2 connection subscribes to
        (`/cmd_vel#geometry_msgs.Twist`). No obstacle avoidance, no
        replanning — but it actually moves the robot, which is what
        the operator needs first. Upgrade path: switch to set_goal
        once we've debugged the planner-stream wiring.
        """
        import threading

        def _run() -> None:
            import math
            import time

            try:
                import lcm  # type: ignore
                from dimos_lcm.geometry_msgs.Twist import Twist  # type: ignore
                from dimos_lcm.geometry_msgs.Vector3 import Vector3  # type: ignore
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.cmd_vel_lcm_missing", error=str(e))
                return

            lc = lcm.LCM(
                os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
            )

            def publish_vel(lx: float, ly: float, az: float) -> None:
                t = Twist()
                t.linear = Vector3()
                t.linear.x = float(lx)
                t.linear.y = float(ly)
                t.linear.z = 0.0
                t.angular = Vector3()
                t.angular.x = 0.0
                t.angular.y = 0.0
                t.angular.z = float(az)
                lc.publish("/cmd_vel#geometry_msgs.Twist", t.lcm_encode())

            def norm_angle(a: float) -> float:
                return (a + math.pi) % (2 * math.pi) - math.pi

            ARRIVAL_RADIUS_M = 0.4
            DWELL_S = 1.0
            TIMEOUT_S = 90.0
            LINEAR_SPEED = 0.5
            ANGULAR_SPEED = 0.9
            ALIGN_TOL_RAD = 0.25

            log.info("surveillance.patrol_thread_alive")
            last_state = None
            ticks = 0
            while True:
                ticks += 1
                if ticks % 100 == 0:
                    # Heartbeat every ~10s so we know the thread is
                    # alive even when state is IDLE.
                    log.info(
                        "surveillance.patrol_thread_tick",
                        state=self.core.ctx.state.value,
                        waypoints=len(self.core.waypoints),
                        pose=tuple(round(v, 2) for v in self._pose),
                    )

                state = self.core.ctx.state
                if state != last_state:
                    log.info("surveillance.patrol_state", state=state.value)
                    last_state = state

                if state != State.PATROLLING:
                    time.sleep(0.1)
                    continue

                waypoints = list(self.core.waypoints)
                if not waypoints:
                    time.sleep(0.5)
                    continue

                cursor = self.core.ctx.cursor_index % len(waypoints)
                wp = waypoints[cursor]
                log.info(
                    "surveillance.patrol_goto",
                    index=cursor,
                    name=wp.name,
                    goal=(round(wp.pose_x, 2), round(wp.pose_y, 2)),
                    start_pose=tuple(round(v, 2) for v in self._pose),
                )

                start_t = time.time()
                arrived = False
                while self.core.ctx.state == State.PATROLLING:
                    if time.time() - start_t > TIMEOUT_S:
                        log.warning(
                            "surveillance.patrol_timeout",
                            waypoint=wp.name,
                            final_pose=tuple(round(v, 2) for v in self._pose),
                        )
                        break

                    x, y, yaw = self._pose
                    dx = wp.pose_x - x
                    dy = wp.pose_y - y
                    dist = math.hypot(dx, dy)
                    if dist < ARRIVAL_RADIUS_M:
                        arrived = True
                        break

                    desired_yaw = math.atan2(dy, dx)
                    yaw_err = norm_angle(desired_yaw - yaw)
                    if abs(yaw_err) > ALIGN_TOL_RAD:
                        az = max(-ANGULAR_SPEED, min(ANGULAR_SPEED, 1.4 * yaw_err))
                        publish_vel(0.0, 0.0, az)
                    else:
                        speed = min(LINEAR_SPEED, max(0.15, dist * 0.8))
                        az = max(-0.5, min(0.5, 1.0 * yaw_err))
                        publish_vel(speed, 0.0, az)

                    time.sleep(0.1)

                publish_vel(0.0, 0.0, 0.0)

                if arrived and self.core.ctx.state == State.PATROLLING:
                    log.info(
                        "surveillance.patrol_arrived",
                        waypoint=wp.name,
                        final_pose=tuple(round(v, 2) for v in self._pose),
                    )
                    time.sleep(DWELL_S)
                    self.core.ctx.cursor_index = (cursor + 1) % len(waypoints)
                elif not arrived:
                    # Timed out — advance anyway rather than loop on
                    # an unreachable target forever.
                    self.core.ctx.cursor_index = (cursor + 1) % len(waypoints)

        self._patrol_thread = threading.Thread(
            target=_run, daemon=True, name="surveillance-patrol-cmd-vel",
        )
        self._patrol_thread.start()

    # ------------------------------------------------------------------
    # Patrol loop — drives the robot through `core.waypoints` whenever
    # state == PATROLLING by feeding goals to the ReplanningAStarPlanner.
    #
    # The planner does the actual driving (cmd_vel output, replanning,
    # costmap awareness). We just publish a PoseStamped on `goal_request`
    # and await `handle_goal_reached`. `pause_patrol` and
    # `stop_surveillance` flip the state machine; the supervisor task
    # observes that and cancels the in-flight leg, calling
    # `_planner_spec.cancel_goal()` so the planner's own driver halts.
    # ------------------------------------------------------------------

    DWELL_AT_WAYPOINT_S = 1.0
    PER_LEG_TIMEOUT_S = 60.0
    NO_WAYPOINTS_SLEEP_S = 1.0

    async def main(self) -> AsyncGenerator[None, None]:
        """Lifecycle hook. The actual patrol drive lives in
        `_start_cmd_vel_patrol_thread` (started in __init__) because
        the planner-stream path silently drops goals on our worker
        layout; once that's resolved we'll move the loop back into
        async territory.
        """
        log.info("surveillance.main_started")
        yield

    async def handle_goal_reached(self, _msg: Bool) -> None:
        """Planner says we arrived. Wake the current leg."""
        if self._goal_reached_event is not None:
            self._goal_reached_event.set()

    async def _patrol_supervisor(self) -> None:
        """Spawn / cancel the leg-runner as `state` flips in/out of PATROLLING.

        Single long-lived task → simple cancellation semantics. We
        poll state at 10 Hz which is plenty: the state machine only
        transitions on explicit operator action or a couple of
        SurveillanceCore timeouts.
        """
        leg_task: Optional[asyncio.Task[None]] = None
        last_state = None
        try:
            while True:
                state = self.core.ctx.state
                if state != last_state:
                    log.info("surveillance.patrol_state", state=state.value)
                    last_state = state

                if state == State.PATROLLING and (leg_task is None or leg_task.done()):
                    leg_task = asyncio.create_task(self._patrol_leg_runner())
                elif state != State.PATROLLING and leg_task is not None and not leg_task.done():
                    leg_task.cancel()
                    try:
                        await leg_task
                    except asyncio.CancelledError:
                        pass
                    leg_task = None
                    # Make sure the planner stops driving when we leave
                    # PATROLLING (pause / stop / inspect transition).
                    try:
                        self._planner_spec.cancel_goal()
                    except Exception as e:  # noqa: BLE001
                        log.warning("surveillance.cancel_goal_fail", error=str(e))

                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            if leg_task is not None and not leg_task.done():
                leg_task.cancel()
            raise

    async def _patrol_leg_runner(self) -> None:
        """Cycle waypoints in order while state stays PATROLLING.

        Goal handoff uses two paths defensively:
          1. `_planner_spec.set_goal(pose)` — the synchronous RPC.
             Always works when the planner module is composed (dimos
             auto-injects the Spec field), independent of stream
             transport wiring.
          2. `self.goal_request.publish(goal)` — the in-process stream,
             same path PatrollingModule uses. Tried opportunistically.

        Arrival uses two paths defensively too:
          1. `handle_goal_reached` setting `_goal_reached_event` — the
             stream-based path.
          2. Polling `_planner_spec.is_goal_reached()` — catches the
             case where the stream isn't actually delivering.

        Cancellation: the supervisor cancels this when state leaves
        PATROLLING. The in-flight wait raises, we re-raise so cleanup
        happens in the supervisor.
        """
        while self.core.ctx.state == State.PATROLLING:
            waypoints = list(self.core.waypoints)
            if not waypoints:
                await asyncio.sleep(self.NO_WAYPOINTS_SLEEP_S)
                continue

            cursor = self.core.ctx.cursor_index % len(waypoints)
            wp = waypoints[cursor]
            goal = _pose_stamped_from_waypoint(wp)

            log.info(
                "surveillance.patrol_goto",
                index=cursor,
                name=wp.name,
                goal=(round(wp.pose_x, 2), round(wp.pose_y, 2)),
            )

            assert self._goal_reached_event is not None
            self._goal_reached_event.clear()

            # Set the goal via the spec RPC. This is the path that
            # works reliably across dimos's worker boundaries.
            set_ok = False
            try:
                set_ok = bool(self._planner_spec.set_goal(goal))
                log.info("surveillance.set_goal_ok", accepted=set_ok)
            except Exception as e:  # noqa: BLE001
                log.warning("surveillance.set_goal_fail", error=str(e))

            # Best-effort stream publish too — matches PatrollingModule's
            # pattern in case the spec call routes oddly.
            try:
                self.goal_request.publish(goal)
            except Exception as e:  # noqa: BLE001
                log.debug("surveillance.goal_publish_skip", error=str(e))

            if not set_ok:
                # Planner didn't accept the goal — log + skip rather
                # than spin on an impossible target.
                log.warning("surveillance.goal_rejected", waypoint=wp.name)
                self.core.ctx.cursor_index = (cursor + 1) % len(waypoints)
                await asyncio.sleep(0.5)
                continue

            arrived = await self._await_arrival()
            if arrived:
                log.info("surveillance.patrol_arrived", waypoint=wp.name)
                await asyncio.sleep(self.DWELL_AT_WAYPOINT_S)
            else:
                log.warning("surveillance.patrol_timeout", waypoint=wp.name)
                try:
                    self._planner_spec.cancel_goal()
                except Exception:  # noqa: BLE001
                    pass

            # Advance whether we arrived or timed out (avoids livelocking
            # on a permanently unreachable waypoint).
            self.core.ctx.cursor_index = (cursor + 1) % len(waypoints)

    async def _await_arrival(self) -> bool:
        """Wait up to PER_LEG_TIMEOUT_S for the planner to arrive.

        Returns True on arrival, False on timeout. Watches both the
        goal_reached stream and the spec's is_goal_reached poll so we
        succeed even if one of them isn't actually delivering.
        """
        assert self._goal_reached_event is not None
        deadline = asyncio.get_event_loop().time() + self.PER_LEG_TIMEOUT_S
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                return False
            try:
                await asyncio.wait_for(
                    self._goal_reached_event.wait(), timeout=min(0.5, remaining),
                )
                return True
            except asyncio.TimeoutError:
                # Stream hasn't fired yet; check the spec as a fallback.
                try:
                    if self._planner_spec.is_goal_reached():
                        return True
                except Exception:  # noqa: BLE001
                    pass

    def _publish_event(self, topic: str, payload: dict) -> None:
        log.debug("surveillance.event", topic=topic, type=payload.get("type"))
        try:
            if self._lc is None:
                import lcm  # type: ignore

                self._lc = lcm.LCM(
                    os.environ.get("LCM_URL", "udpm://239.255.76.67:7667?ttl=1"),
                )
            from dimos_lcm.std_msgs.String import String  # type: ignore

            msg = String(data=json.dumps(payload, separators=(",", ":")))
            self._lc.publish(topic, msg.lcm_encode())
        except Exception as e:  # noqa: BLE001
            log.warning(
                "surveillance.publish_fail",
                topic=topic,
                error=str(e),
            )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @rpc
    def start(self) -> None:
        super().start()
        log.info("surveillance.module.started")

    @rpc
    def stop(self) -> None:
        log.info("surveillance.module.stopped")
        super().stop()

    # ------------------------------------------------------------------
    # Skills — exposed via dimos MCP server.
    # ------------------------------------------------------------------

    @rpc
    @skill
    def start_surveillance(self) -> str:
        """Start the patrol loop. State IDLE → PATROLLING."""
        return self.core.start_surveillance()

    @rpc
    @skill
    def stop_surveillance(self) -> str:
        """Stop surveillance entirely. Resets cursor and any active incident."""
        return self.core.stop_surveillance()

    @rpc
    @skill
    def pause_patrol(self) -> str:
        """Hold position. Patrol cursor saved; resume_patrol resumes."""
        return self.core.pause_patrol()

    @rpc
    @skill
    def resume_patrol(self) -> str:
        """Resume patrol from the saved cursor."""
        return self.core.resume_patrol()

    @rpc
    @skill
    def add_waypoint(self, name: str) -> str:
        """Capture the robot's current pose as a named waypoint."""
        return self.core.add_waypoint(name)

    @rpc
    @skill
    def delete_waypoint(self, name: str) -> str:
        """Remove a waypoint by name."""
        return self.core.delete_waypoint(name)

    @rpc
    @skill
    def list_waypoints(self) -> str:
        """Return all known waypoints with poses and targets, as JSON."""
        return self.core.list_waypoints()

    @rpc
    @skill
    def go_to_waypoint(self, name: str) -> str:
        """Navigate to a named waypoint. Patrol pauses, MANUAL_OVERRIDE."""
        return self.core.go_to_waypoint(name)

    @rpc
    @skill
    def set_targets(self, classes: list[str]) -> str:
        """Globally override the detection class list for every waypoint."""
        return self.core.set_targets(classes)

    @rpc
    @skill
    def force_inspect(self, query: str) -> str:
        """Run a VLM describe at the current pose for the given query."""
        return self.core.force_inspect(query)

    @rpc
    @skill
    def get_robot_state(self) -> str:
        """Return current state, cursor, active incident, and pose, as JSON."""
        return self.core.get_robot_state()


def _pose_stamped_from_waypoint(wp: WaypointSpec) -> PoseStamped:
    """Convert our stored (x, y, yaw) waypoint into the dimos PoseStamped
    the planner expects on its `goal_request` input.

    Yaw → quaternion is Z-axis rotation only (ground robot), matching the
    REP-103 convention used by the rest of dimos.
    """
    half_yaw = wp.pose_yaw / 2.0
    return PoseStamped(
        frame_id="map",
        position=[wp.pose_x, wp.pose_y, 0.0],
        orientation=[0.0, 0.0, math.sin(half_yaw), math.cos(half_yaw)],
    )
