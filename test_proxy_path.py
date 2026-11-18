import unittest

from server import proxy_path_allowed as ok


class ProxyPathTest(unittest.TestCase):
    def test_legit(self):
        for p in ["/events/reinvent2026/sessions", "/events/reinvent2026/schedule",
                  "/events/reinvent2026/reservations", "/events/reinvent2026/reservations/ABC-123",
                  "/events/reinvent2026/favorites/abc%20x", "/events/reinvent2026/personal-time/9"]:
            self.assertTrue(ok(p), p)

    def test_rejected(self):
        for p in ["/events/../x", "/events/reinvent2026/../../x", "/events/%2e%2e/x",
                  "/events/%2E%2e/schedule", "/events//reinvent2026/sessions",
                  "/events/reinvent2026/sessions/%2e%2e", "/events\\x", "/events/a%5cb/sessions",
                  "/events/reinvent2026/reservations/a%2Fb", "/events/reinvent2026/sessions%00",
                  "/events/reinvent2026/sessions/%0a", "/eventsx", "/events", "/other",
                  "/events/reinvent2026/sessions/a%252e"]:
            self.assertFalse(ok(p), p)


if __name__ == "__main__":
    unittest.main()
