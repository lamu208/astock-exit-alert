import unittest

import app


class ExitRuleTests(unittest.TestCase):
    def test_volume_and_trend_escalate_to_exit_with_shadow(self):
        quote = {
            "data_status": "demo",
            "price": 18.86,
            "volume": 8_600_000,
            "avg_volume_5": 25_000_000,
            "trend_line": 19.25,
            "candle": {"open": 19.10, "high": 20.42, "low": 18.70, "close": 18.86},
        }
        levels = {rule["level"] for rule in app.evaluate(quote, app.DEFAULT_SETTINGS)}
        self.assertEqual(levels, {"blue", "orange", "red"})

    def test_unavailable_data_does_not_trigger_alert(self):
        quote = {"data_status": "unavailable", "error": "offline"}
        self.assertEqual(app.evaluate(quote, app.DEFAULT_SETTINGS), [])


if __name__ == "__main__":
    unittest.main()
