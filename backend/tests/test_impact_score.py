"""
test_impact_score.py
────────────────────
Standalone unit tests for the FSF Impact Score formula.

⚠️  This test file is SELF-CONTAINED. It does NOT import from main.py and does
    NOT touch the database, FastAPI, or any existing code. It re-declares the
    exact formula (as documented in main.py) and validates its behaviour.

    Because it changes nothing in the app, it is 100% safe to add now.
    Later, when the scoring is moved into its own module, swap the two local
    functions below for an import (e.g. `from impact_score import impact_score,
    zip_pop`) and the tests stay identical.

Formula under test (impact score 0–100), from main.py:
    pop_pct     = min((ind / pop) / 0.05, 1.0) * 60             # 5% pop benchmark
    meals_score = min((meals / max(ind, 1)) / 5.0, 1.0) * 40    # 5 meals benchmark
    score       = round(pop_pct + meals_score, 1)

Run from the backend/ directory:
    python -m pytest tests/test_impact_score.py -v
"""

import pytest


# ─────────────────────────────────────────────────────────────────────────────
# The formula, copied verbatim from main.py's upload_fsf_csv().
# Keep these in sync with main.py until the logic is centralised.
# ─────────────────────────────────────────────────────────────────────────────
DEFAULT_ZIP_POP = 25000

# Subset of ZIP_POPULATION from main.py (enough for the tests)
ZIP_POPULATION = {
    "33054": 28000, "33127": 19000, "33311": 35000, "33409": 28000,
    "33050": 11000,
}


def zip_pop(zip_code):
    """Return the population for a ZIP code, or the default if it's unknown."""
    return ZIP_POPULATION.get(str(zip_code).strip().zfill(5), DEFAULT_ZIP_POP)


def impact_score(ind, meals, pop):
    """Impact score (0–100) from monthly-average individuals, meals, population."""
    pop_pct     = min((ind / pop) / 0.05, 1.0) * 60 if pop > 0 else 0.0
    meals_score = min((meals / max(ind, 1)) / 5.0, 1.0) * 40
    return round(pop_pct + meals_score, 1)


# ═══════════════════════════════════════════════════════════════════════════
#  1. Population-reach component (max 60 pts, 5% benchmark)
# ═══════════════════════════════════════════════════════════════════════════
class TestPopulationReach:
    """The population-reach half of the score: full 60 points when a county
    serves 5% of its population in an average month, scaling linearly and
    capping at 60 beyond that."""

    def test_zero_individuals_gives_zero_reach(self):
        """No people served and no meals should score exactly 0."""
        assert impact_score(0, 0, 20000) == 0.0

    def test_five_percent_reached_gives_full_60(self):
        """Serving exactly 5% of the population (1,000 of 20,000) earns the
        full 60 reach points; meals are 0 here to isolate the reach component."""
        assert impact_score(1000, 0, 20000) == 60.0

    def test_two_and_half_percent_gives_half_30(self):
        """Half the benchmark (2.5% = 500 of 20,000) earns half the reach
        points: 30."""
        assert impact_score(500, 0, 20000) == 30.0

    def test_ten_percent_is_capped_at_60(self):
        """Exceeding the benchmark (10% reached) must not exceed the 60-point
        cap — reach points saturate."""
        assert impact_score(2000, 0, 20000) == 60.0


# ═══════════════════════════════════════════════════════════════════════════
#  2. Meals-per-person component (max 40 pts, 5-meal benchmark)
# ═══════════════════════════════════════════════════════════════════════════
class TestMealsPerPerson:
    """The meals-per-person half of the score: full 40 points at 5 meals per
    person per month, scaling linearly and capping at 40 beyond that.
    A very large population is used to drive the reach component to ~0 so the
    meals component can be measured in isolation."""

    def test_zero_meals_gives_zero_meal_points(self):
        """With full reach but zero meals, only the 60 reach points remain."""
        assert impact_score(1000, 0, 20000) == 60.0

    def test_five_meals_per_person_gives_full_40(self):
        """5 meals per person (5,000 meals / 1,000 people) earns the full 40
        meal points; huge population zeroes out reach to isolate meals."""
        score = impact_score(1000, 5000, 100_000_000)
        assert score == pytest.approx(40.0, abs=0.1)

    def test_two_and_half_meals_gives_half_20(self):
        """Half the meal benchmark (2.5 meals/person) earns half the points: 20."""
        score = impact_score(1000, 2500, 100_000_000)
        assert score == pytest.approx(20.0, abs=0.1)

    def test_ten_meals_is_capped_at_40(self):
        """Exceeding the meal benchmark (10 meals/person) must not exceed the
        40-point cap — meal points saturate."""
        score = impact_score(1000, 10000, 100_000_000)
        assert score == pytest.approx(40.0, abs=0.1)


# ═══════════════════════════════════════════════════════════════════════════
#  3. Combined score (0–100)
# ═══════════════════════════════════════════════════════════════════════════
class TestCombinedScore:
    """The full score = reach (max 60) + meals (max 40), verifying the two
    components combine correctly and stay within 0–100."""

    def test_perfect_score_is_100(self):
        """Both benchmarks met simultaneously (5% reach AND 5 meals/person)
        yields the maximum score of 100."""
        assert impact_score(1000, 5000, 20000) == 100.0

    def test_all_zeros_is_0(self):
        """No service at all yields the minimum score of 0."""
        assert impact_score(0, 0, 20000) == 0.0

    def test_score_never_exceeds_100(self):
        """Absurdly high inputs must still cap at 100 (both components saturate)."""
        assert impact_score(999999, 9999999, 10000) == 100.0

    def test_score_never_below_0(self):
        """The score can never go negative."""
        assert impact_score(0, 0, 10000) == 0.0

    def test_result_rounded_to_one_decimal(self):
        """Scores are rounded to one decimal place to match production output."""
        s = impact_score(317, 1071, 27000)
        assert s == round(s, 1)

    def test_documented_miami_dade_example(self):
        """Reproduces the worked example from the app's docs:
        avg_ind=320, meals=1071, pop=27000 → reach ≈14.2 + meals ≈26.8 ≈ 41.0."""
        assert impact_score(320, 1071, 27000) == pytest.approx(41.0, abs=0.1)

    def test_components_add_up(self):
        """Reach and meals points are additive: 2.5% reach (30) + 2.5 meals
        per person (20) = 50."""
        assert impact_score(500, 1250, 20000) == 50.0


# ═══════════════════════════════════════════════════════════════════════════
#  4. Monthly averaging (yearly totals ÷ months → monthly rate)
# ═══════════════════════════════════════════════════════════════════════════
class TestMonthlyAveraging:
    """The score is a monthly rate. When a full or partial year is uploaded,
    the totals must be divided by the number of months before scoring, so the
    result reflects a typical month."""

    def test_full_year_divided_to_monthly(self):
        """12 months of 1,000 ind / 5,000 meals each → after ÷12 the monthly
        figures hit both benchmarks → score 100."""
        total_ind, total_meals, months = 12000, 60000, 12
        score = impact_score(total_ind / months, total_meals / months, 20000)
        assert score == 100.0

    def test_six_months_averaged(self):
        """6 months totalling 3,000 ind and 15,000 meals → 500 ind and 2,500
        meals per month. Reach 500/20,000 = 2.5% → 30 pts; meals 2,500/500 = 5
        per person → full 40 pts; total = 70."""
        total_ind, total_meals, months = 3000, 15000, 6
        score = impact_score(total_ind / months, total_meals / months, 20000)
        assert score == 70.0


# ═══════════════════════════════════════════════════════════════════════════
#  5. Edge cases / guards
# ═══════════════════════════════════════════════════════════════════════════
class TestEdgeCases:
    """Defensive checks: the formula must never crash on degenerate inputs and
    must fall back sensibly for unknown ZIP codes."""

    def test_zero_population_does_not_crash(self):
        """A ZIP population of 0 must not raise a divide-by-zero; reach
        contributes 0 and the function still returns a finite score."""
        score = impact_score(500, 2500, 0)
        assert score >= 0.0

    def test_zero_individuals_no_divide_by_zero(self):
        """Zero individuals served must not raise when computing meals per
        person (the max(ind, 1) guard handles it)."""
        score = impact_score(0, 100, 20000)
        assert score >= 0.0

    def test_unknown_zip_uses_default_population(self):
        """A ZIP not in the lookup table falls back to the default population."""
        assert zip_pop("99999") == DEFAULT_ZIP_POP

    def test_known_zip_population(self):
        """A known ZIP returns its mapped population."""
        assert zip_pop("33054") == 28000

    def test_zip_zero_padding(self):
        """Integer-style ZIP input is normalised to a 5-digit string and still
        resolves to the correct population."""
        assert zip_pop(33054) == 28000


# ═══════════════════════════════════════════════════════════════════════════
#  6. Real ZIP scenarios (uses the ZIP population table)
# ═══════════════════════════════════════════════════════════════════════════
class TestRealZipScenarios:
    """Sanity checks using real ZIP populations: a smaller ZIP is easier to
    score highly (same people = larger share of population) than a larger one."""

    def test_small_zip_easier_to_score_high(self):
        """ZIP 33050 (pop 11,000): serving 550 people = 5% reach → 60 pts, plus
        2,750 meals / 550 = 5 meals/person → 40 pts → perfect 100."""
        score = impact_score(550, 2750, zip_pop("33050"))
        assert score == 100.0

    def test_large_zip_harder_to_score_high(self):
        """ZIP 33311 (pop 35,000): the same 550 people is only ~1.57% reach, so
        the score is below 100 but still above 40 (meals component is full)."""
        score = impact_score(550, 2750, zip_pop("33311"))
        assert score < 100.0
        assert score > 40.0
