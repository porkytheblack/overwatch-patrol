from overwatch_patrol.linger_tracker import LingerTracker


def test_observe_creates_track():
    t = LingerTracker()
    s = t.observe("wp1", "trk1", 100.0)
    assert s.first_seen == 100.0
    assert s.last_seen == 100.0


def test_linger_accumulates():
    t = LingerTracker()
    t.observe("wp1", "trk1", 100.0)
    t.observe("wp1", "trk1", 105.0)
    assert t.linger_seconds("wp1", "trk1", 105.0) == 5.0


def test_expire_drops_stale():
    t = LingerTracker(grace_seconds=2.0)
    t.observe("wp1", "trk1", 100.0)
    expired = t.expire(now=103.0)
    assert len(expired) == 1
    assert t.get("wp1", "trk1") is None


def test_reacquire_under_same_track_is_idempotent():
    t = LingerTracker()
    t.observe("wp1", "trk1", 100.0)
    t.mark_opened("wp1", "trk1", "incident-1")
    s = t.observe("wp1", "trk1", 110.0)
    assert s.incident_opened is True
    assert s.incident_id == "incident-1"
