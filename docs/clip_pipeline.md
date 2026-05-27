# Clip pipeline

From camera frame to MP4 on disk.

## Layers

```
┌──────────────────────────────────────────────────────────────┐
│  Go2 camera (real) or Mujoco sensor (sim)                    │
└──────────────┬───────────────────────────────────────────────┘
               │  /color_image#sensor_msgs.Image (JPEG payload)
               ▼  LCM multicast on lo0 (route 239.255.76.67/32)
┌──────────────────────────────────────────────────────────────┐
│  ClipRecorderModule  (dimos worker process)                  │
│  ├─ _run_image_listener — decode JPEG → bgr24 → core.on_frame│
│  ├─ _run_event_listener — /ow/incident_opened / _closed      │
│  └─ _run_tick           — drives post_roll close             │
└──────────────┬───────────────────────────────────────────────┘
               │  spawn one ffmpeg subprocess per incident
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ffmpeg  (rawvideo bgr24 → libx264 mp4 + faststart)          │
│  data/clips/{incident_id}.mp4 + .jpg poster                  │
└──────────────┬───────────────────────────────────────────────┘
               │  publish /ow/clip_ready  (std_msgs.String JSON)
               ▼
┌──────────────────────────────────────────────────────────────┐
│  ov-bridge  → SQLite incidents.clip_path / clip_status='ready│
│             → WS /events broadcast → dashboard + telegram    │
└──────────────────────────────────────────────────────────────┘
```

## Diagnostic order — "clip stays pending"

Tail the file log:

```
tail -f /tmp/overwatch_surveillance.log | grep -i clip_recorder
```

Expected lines on a healthy boot:

```
clip_recorder.module_init_done output_dir=… ffmpeg=…
clip_recorder.module_started …
clip_recorder.threads_started
clip_recorder.image_listener_alive width=… height=…
clip_recorder.image_lcm_subscribed url=…
clip_recorder.event_lcm_subscribed topics=…
clip_recorder.tick_thread_alive
clip_recorder.frame_heartbeat frames_in_window=N active_clips=0       # repeats every 5s
```

When an incident fires:

```
clip_recorder.incident_opened_received incident_id=… buffered_frames=…
clip_recorder.opening incident_id=… out=…
clip_recorder.ffmpeg_start incident_id=… bin=/opt/homebrew/bin/ffmpeg …
clip_recorder.incident_closed_received incident_id=…
clip_recorder.closing incident_id=… frames=… post_roll_s=10.0
clip_recorder.finalising incident_id=… frames=N
clip_recorder.ffmpeg_exited incident_id=… rc=0 frames=N
clip_recorder.publishing_ready incident_id=… clip=… poster=…
clip_recorder.published topic=/ow/clip_ready type=clip.ready
```

And in the bridge log:

```
clip_ready.applied incident_id=… rows_updated=1
```

If you see `rows_updated=0`, the bridge restarted between
`incident_opened` and `clip.ready` and missed the original INSERT. Most
common cause: the bridge container restarted while the dimos worker
process kept running.

If you see `clip_recorder.ffmpeg_stderr msg=…`, ffmpeg is reporting a
real error (missing codec, unsupported pix_fmt, bad path) — that's
your diagnostic.

If you see `clip_recorder.waiting_for_frames ticks=25`, no `/color_image`
packets have arrived in ~5 seconds. Verify the lo0 multicast route is
installed:

```
sudo route -n add -net 239.255.76.67 -interface lo0
```

## Deferred — FrameStream refactor (v2)

Today each consumer of `/color_image` decodes the JPEG independently:

  - `ClipRecorderModule._run_image_listener`
  - `SurveillanceModule._start_detector_thread`
  - `ov-bridge.LcmListener` (for the MJPEG endpoint)

Three independent `cv2.imdecode` calls per frame at ~14 Hz is fine on a
single robot but wasteful. The intended v2 shape is a single in-process
`FrameStream` (rx-style Subject) owned by whichever module decodes
first; downstream consumers subscribe to the decoded ndarray rather
than re-decode the JPEG.

The wire stays the same (`/color_image` LCM); only the in-process fan-out
changes. Migration sketch:

  1. Introduce `overwatch_patrol.frame_stream.FrameStream` — a thread-safe
     ring buffer of `(ts, ndarray)` + `subscribe(callback)`.
  2. The dimos worker that hosts `_with_jpeglcm` (currently
     `GO2Connection`) decodes once and publishes into the stream.
  3. `ClipRecorderModule` and `SurveillanceModule` swap their own
     `_run_image_listener` for `FrameStream.subscribe(self.core.on_frame)`.

Not in v1 — would touch three modules and complicate the dimos blueprint.
The minimum-fix path (this commit) keeps each module's listener but
instruments them so silent failures become visible.
