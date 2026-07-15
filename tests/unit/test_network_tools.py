import unittest

from core.tools.network import _ssh_target_host_port


class NetworkToolTests(unittest.TestCase):
    def test_ssh_target_host_port_accepts_plain_host_and_port_argument(self) -> None:
        self.assertEqual(("127.0.0.1", 2222), _ssh_target_host_port("127.0.0.1", 2222))

    def test_ssh_target_host_port_accepts_ssh_url(self) -> None:
        self.assertEqual(("127.0.0.1", 2222), _ssh_target_host_port("ssh://127.0.0.1:2222", 22))

    def test_ssh_target_host_port_rejects_non_ssh_scheme(self) -> None:
        with self.assertRaises(ValueError):
            _ssh_target_host_port("http://127.0.0.1:2222", 22)


if __name__ == "__main__":
    unittest.main()
