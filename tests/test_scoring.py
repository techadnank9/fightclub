from harness.scoring import score


def test_perfect_run_small_diff():
    assert score(10, 10, [], 20) == 100


def test_failing_tests_dominate():
    s = score(0, 10, [], 20)
    assert s == 40  # 0 pass-rate points, full review + economy points


def test_findings_penalize():
    clean = score(10, 10, [], 20)
    dirty = score(10, 10, [{"severity": "high"}, {"severity": "medium"}], 20)
    assert dirty < clean
    assert dirty == 100 - round(25 * 0.75)


def test_huge_diff_penalized():
    assert score(10, 10, [], 500) == 85


def test_zero_total_tests_is_zero_pass_rate():
    assert score(0, 0, [], 10) == 40
