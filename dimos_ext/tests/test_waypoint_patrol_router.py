from overwatch_patrol.waypoint_patrol_router import Pose, WaypointPatrolRouter


def test_loop_cycles():
    r = WaypointPatrolRouter.from_iter([Pose(0, 0, 0), Pose(1, 0, 0), Pose(1, 1, 0)])
    assert r.next_goal() == Pose(0, 0, 0)
    assert r.next_goal() == Pose(1, 0, 0)
    assert r.next_goal() == Pose(1, 1, 0)
    assert r.next_goal() == Pose(0, 0, 0)


def test_pingpong_bounces():
    r = WaypointPatrolRouter.from_iter(
        [Pose(0, 0, 0), Pose(1, 0, 0), Pose(2, 0, 0)], cycle_mode="pingpong"
    )
    goals = [r.next_goal() for _ in range(6)]
    assert goals == [
        Pose(0, 0, 0),
        Pose(1, 0, 0),
        Pose(2, 0, 0),
        Pose(1, 0, 0),
        Pose(0, 0, 0),
        Pose(1, 0, 0),
    ]


def test_reset_to():
    r = WaypointPatrolRouter.from_iter([Pose(0, 0, 0), Pose(1, 0, 0), Pose(2, 0, 0)])
    r.reset_to(2)
    assert r.next_goal() == Pose(2, 0, 0)


def test_empty_returns_none():
    r = WaypointPatrolRouter()
    assert r.next_goal() is None
