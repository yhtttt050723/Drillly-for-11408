def _normalize_spelling(s: str) -> str:
    return "".join((s or "").strip().lower().split())


def grade_answer(q_type: str, content: dict, answer: dict) -> tuple[float, bool]:
    if q_type == "word_dictation":
        expected = str(content.get("word") or (content.get("answer") or [""])[0] if content.get("answer") else "").strip()
        if not expected and content.get("answer"):
            ans = content.get("answer")
            if isinstance(ans, list) and ans:
                expected = str(ans[0]).strip()
        got = answer.get("value") or answer.get("spelling") or ""
        if answer.get("self_mark") == "correct":
            return 1.0, True
        if answer.get("self_mark") == "wrong":
            return 0.0, False
        ok = bool(expected) and _normalize_spelling(str(got)) == _normalize_spelling(expected)
        return (1.0 if ok else 0.0), ok

    if q_type == "wrong_review":
        mark = answer.get("self_mark")
        if mark == "correct":
            return 1.0, True
        if mark == "wrong":
            return 0.0, False
        return 0.0, False

    if q_type in ("coding", "subjective"):
        return 0.0, False

    expected = sorted(str(x).upper() for x in (content.get("answer") or []))
    if q_type == "single_choice":
        got = answer.get("value") or answer.get("keys") or answer.get("selected")
        if isinstance(got, list):
            got_keys = sorted(str(x).upper() for x in got)
        else:
            got_keys = [str(got).upper()] if got is not None else []
        ok = got_keys == expected[:1] if expected else False
        return (1.0 if ok else 0.0), ok

    if q_type == "multiple_choice":
        got = answer.get("value") or answer.get("keys") or answer.get("selected") or []
        if not isinstance(got, list):
            got = [got]
        got_keys = sorted(str(x).upper() for x in got)
        ok = got_keys == expected
        return (1.0 if ok else 0.0), ok

    return 0.0, False
