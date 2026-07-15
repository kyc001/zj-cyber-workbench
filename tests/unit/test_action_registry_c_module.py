from __future__ import annotations

import unittest

from core.action_registry import DEFAULT_ACTION_REGISTRY


class CModuleActionRegistryTests(unittest.TestCase):
    def test_c_module_initial_actions_are_registered(self) -> None:
        expected = {
            "host.local.diagnostic",
            "ssh.command",
            "ssh.shell",
            "ssh.sftp.list",
            "ssh.sftp.upload",
            "ssh.sftp.download",
            "linux.service.status",
            "linux.service.restart",
            "linux.log.tail",
            "linux.disk.summary",
            "linux.network.connections",
            "windows.service.status",
            "windows.service.restart",
            "windows.eventlog.query",
            "windows.file.backup",
            "windows.file.replace",
            "web.http.health",
            "web.http.headers",
            "web.tls.inspect",
            "network.dns.lookup",
            "network.ping",
            "network.port.probe",
            "web.port.probe",
            "tool.ffuf.run",
            "tool.httpx.run",
            "tool.dnsx.run",
            "tool.subfinder.run",
            "tool.nmap.ssh",
            "load.k6.run",
        }

        self.assertEqual(expected, {spec.action_type for spec in DEFAULT_ACTION_REGISTRY.all()})

    def test_write_actions_declare_safety_requirements(self) -> None:
        for action_type in ("ssh.sftp.upload", "windows.file.replace"):
            spec = DEFAULT_ACTION_REGISTRY.require(action_type)
            self.assertTrue(spec.requires_backup)
            self.assertTrue(spec.requires_verification)
            self.assertTrue(spec.requires_rollback)


if __name__ == "__main__":
    unittest.main()
