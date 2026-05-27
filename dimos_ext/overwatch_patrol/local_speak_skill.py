"""LocalSpeakSkill — offline TTS for the agent.

Uses the OS's built-in voice synthesizer:
  macOS   → `say` (NSSpeechSynthesizer; ships with the OS)
  Linux   → `espeak-ng` or `espeak` if installed; `spd-say` as fallback
  Windows → PowerShell System.Speech.Synthesis.SpeechSynthesizer

Picked over dimos's stock `SpeakSkill` when no `OPENAI_API_KEY` is set
so the agent still has a `speak(...)` tool without paying for cloud TTS.

Zero Python-side dependencies. If no synthesizer is available on the
host, the skill returns an error string instead of crashing on start().
"""
from __future__ import annotations

import platform
import shutil
import subprocess
import threading
from typing import Any

import structlog

from dimos.agents.annotation import skill
from dimos.core.core import rpc
from dimos.core.module import Module, ModuleConfig

log = structlog.get_logger()


class LocalSpeakSkillConfig(ModuleConfig):
    pass


def _resolve_command(text: str) -> list[str] | None:
    """Return a subprocess argv that speaks `text` on this OS, or None."""
    system = platform.system()
    if system == "Darwin":
        # macOS — `say` is preinstalled.
        return ["say", text]
    if system == "Linux":
        for cmd in ("espeak-ng", "espeak"):
            if shutil.which(cmd):
                return [cmd, text]
        if shutil.which("spd-say"):
            return ["spd-say", text]
        return None
    if system == "Windows":
        ps_script = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.Speak('{text.replace(chr(39), chr(39) * 2)}')"
        )
        return ["powershell", "-NoProfile", "-Command", ps_script]
    return None


class LocalSpeakSkill(Module):
    """Offline TTS using the host OS's built-in voice synthesizer."""

    config: LocalSpeakSkillConfig

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._available = _resolve_command("probe") is not None

    @rpc
    def start(self) -> None:
        super().start()
        if self._available:
            log.info("local_speak.started", system=platform.system())
        else:
            log.warning(
                "local_speak.no_synth",
                note="install espeak-ng (Linux) or set OPENAI_API_KEY for SpeakSkill",
            )

    @rpc
    @skill
    def speak(self, text: str, blocking: bool = True) -> str:
        """Speak text out loud through the robot's speakers (offline TTS).

        Args:
            text: What to say.
            blocking: Wait for the synthesizer to finish before returning.
                Set False for fire-and-forget — useful when the agent
                wants to keep moving.
        """
        argv = _resolve_command(text)
        if argv is None:
            return "Error: no offline TTS available on this host"

        if blocking:
            try:
                subprocess.run(argv, check=False)
                return f"Spoke: {text}"
            except Exception as e:  # noqa: BLE001
                return f"Error: {e}"

        def _bg() -> None:
            try:
                subprocess.run(argv, check=False)
            except Exception as e:  # noqa: BLE001
                log.error("local_speak.bg_error", error=str(e))

        threading.Thread(target=_bg, daemon=True, name="local-speak-bg").start()
        return f"Speaking (non-blocking): {text}"
