"""Cooperative cancel flag for long inbox import streams."""

from __future__ import annotations

_cancel_requested = False


def request_cancel() -> None:
    global _cancel_requested
    _cancel_requested = True


def clear_cancel() -> None:
    global _cancel_requested
    _cancel_requested = False


def is_cancelled() -> bool:
    return _cancel_requested
