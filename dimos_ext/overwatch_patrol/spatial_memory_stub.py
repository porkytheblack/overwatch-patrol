"""SpatialMemoryStub — a no-op stand-in for `dimos.perception.SpatialMemory`.

Dimos's `NavigationSkillContainer` requires a module that satisfies
`SpatialMemorySpec` (`tag_location`, `query_tagged_location`,
`query_by_text`). The real `SpatialMemory` pulls in CLIP embeddings via
`ImageEmbeddingProvider` and a ChromaDB persistent client — both CUDA
/ heavyweight setups that don't play nicely on Mac without GPU.

For v1 surveillance we don't need scene-level semantic memory: our
`SurveillanceModule` keeps its own waypoint list. This stub satisfies
the protocol structurally so `NavigationSkillContainer` can boot, and
its methods return sane defaults (tag succeeds in-memory, queries
return None / empty list).

Future: replace with the real `SpatialMemory` once we want
"go find the kitchen"-style natural language navigation.
"""
from __future__ import annotations

from typing import Any

import structlog

from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig
from dimos.types.robot_location import RobotLocation

log = structlog.get_logger()


class SpatialMemoryStubConfig(ModuleConfig):
    pass


class SpatialMemoryStub(Module):
    """No-op SpatialMemorySpec implementor. In-memory only."""

    config: SpatialMemoryStubConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._tagged: dict[str, RobotLocation] = {}

    @rpc
    def start(self) -> None:
        super().start()
        log.info("spatial_memory_stub.started", note="CLIP/ChromaDB disabled")

    # ---- SpatialMemorySpec ----------------------------------------------

    @rpc
    def tag_location(self, robot_location: RobotLocation) -> bool:
        """Store a robot location in the in-memory tag map. Always succeeds."""
        # RobotLocation has a `name` field per dimos.types.robot_location
        name = getattr(robot_location, "name", None) or getattr(robot_location, "id", "")
        if name:
            self._tagged[name] = robot_location
        return True

    @rpc
    def query_tagged_location(self, query: str) -> RobotLocation | None:
        """Exact-name lookup in the in-memory tag map. Returns None if missing."""
        return self._tagged.get(query)

    @rpc
    def query_by_text(self, text: str, limit: int = 5) -> list[dict]:  # type: ignore[type-arg]
        """Semantic queries aren't supported in the stub — returns [].

        Real SpatialMemory uses CLIP to embed the text and compare against
        stored frames; the stub has no embedding provider.
        """
        return []
