from overwatch_patrol.state_machine import State, StateContext, may_open_incident


def test_default_state():
    ctx = StateContext()
    assert ctx.state is State.IDLE
    assert not may_open_incident(ctx.state)


def test_start_to_patrol():
    ctx = StateContext()
    prev, nxt = ctx.transition("start")
    assert prev is State.IDLE and nxt is State.PATROLLING
    assert may_open_incident(ctx.state)


def test_inspection_cycle():
    ctx = StateContext()
    ctx.transition("start")
    ctx.transition("target_lingered")
    assert ctx.state is State.INSPECTING
    ctx.transition("dwell_complete")
    assert ctx.state is State.COOLDOWN
    ctx.transition("cooldown_complete")
    assert ctx.state is State.PATROLLING


def test_manual_override_saves_cursor():
    ctx = StateContext()
    ctx.cursor_index = 2
    ctx.transition("start")
    ctx.transition("manual_command")
    assert ctx.state is State.MANUAL_OVERRIDE
    assert ctx.saved_cursor == 2
    ctx.cursor_index = 99
    ctx.transition("resume_patrol")
    assert ctx.state is State.PATROLLING
    assert ctx.cursor_index == 2


def test_stop_resets():
    ctx = StateContext()
    ctx.transition("start")
    ctx.transition("target_lingered")
    ctx.cursor_index = 5
    ctx.active_incident_id = "abc"
    ctx.transition("stop")
    assert ctx.state is State.IDLE
    assert ctx.cursor_index == 0
    assert ctx.active_incident_id is None


def test_manual_override_blocks_new_incidents():
    ctx = StateContext()
    ctx.transition("start")
    ctx.transition("manual_command")
    assert not may_open_incident(ctx.state)
