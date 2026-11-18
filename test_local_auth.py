import http.client
import threading
import unittest
from unittest import mock

import server

PORT = 8489


class LocalAuthTest(unittest.TestCase):
    def setUp(self):
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", PORT), server.Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        # Never reach AWS: stub the upstream call.
        patcher = mock.patch.object(server, "call_api", return_value=(200, b"{}", {}))
        patcher.start()
        self.addCleanup(patcher.stop)
        hosts = mock.patch.object(server, "ALLOWED_HOSTS", {"127.0.0.1:%d" % PORT})
        hosts.start()
        self.addCleanup(hosts.stop)

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    def req(self, method, path, headers=None):
        h = {"Host": "127.0.0.1:%d" % PORT}
        h.update(headers or {})
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=5)
        conn.request(method, path, headers=h)
        res = conn.getresponse()
        res.read()
        conn.close()
        return res

    def test_rejected_without_cookie(self):
        for path in ["/api/events/reinvent2026/sessions", "/auth/login", "/auth/status", "/local/calendar.json"]:
            self.assertEqual(self.req("GET", path).status, 401, path)
        for method in ["POST", "PUT", "DELETE"]:
            res = self.req(method, "/api/events/reinvent2026/reservations", {"X-Open-Seats": "1"})
            self.assertEqual(res.status, 401, method)
        self.assertEqual(self.req("POST", "/auth/logout", {"X-Open-Seats": "1"}).status, 401)

    def test_rejected_with_wrong_cookie(self):
        bad = {"Cookie": "open_seats_session=wrong"}
        self.assertEqual(self.req("GET", "/auth/status", bad).status, 401)

    def test_wrong_key_sets_no_cookie(self):
        res = self.req("GET", "/?k=wrong")
        self.assertIsNone(res.getheader("Set-Cookie"))

    def test_key_sets_cookie_and_cookie_grants_access(self):
        res = self.req("GET", "/?k=" + server.LOCAL_SECRET)
        self.assertEqual(res.status, 302)
        cookie = res.getheader("Set-Cookie").split(";")[0]
        self.assertTrue(cookie.startswith("open_seats_session="))
        auth = {"Cookie": cookie, "X-Open-Seats": "1"}
        self.assertEqual(self.req("GET", "/auth/status", auth).status, 200)
        self.assertEqual(self.req("GET", "/api/events/reinvent2026/sessions", auth).status, 200)
        csrf = auth
        self.assertEqual(self.req("POST", "/api/events/reinvent2026/reservations", csrf).status, 200)
        self.assertEqual(self.req("POST", "/auth/logout", csrf).status, 200)

    def test_static_pages_stay_open(self):
        self.assertEqual(self.req("GET", "/").status, 200)


if __name__ == "__main__":
    unittest.main()
