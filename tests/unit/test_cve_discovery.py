import unittest

import httpx

from schema.work_project.cve import CveDiscoveryMode, CveDiscoveryRequest, CveMatchConfidence
from service.work_project.cve import cvss_v3_base_score, discover_cves


class CveDiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_nvd_version_range_is_enriched_with_epss_and_kev(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "services.nvd.nist.gov":
                return httpx.Response(200, json={
                    "totalResults": 1,
                    "vulnerabilities": [{"cve": {
                        "id": "CVE-2026-12345",
                        "descriptions": [{"lang": "en", "value": "Example nginx memory corruption. Details."}],
                        "metrics": {"cvssMetricV31": [{"type": "Primary", "cvssData": {
                            "baseScore": 9.8,
                            "baseSeverity": "CRITICAL",
                            "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                        }}]},
                        "configurations": [{"nodes": [{"cpeMatch": [{
                            "vulnerable": True,
                            "criteria": "cpe:2.3:a:f5:nginx:*:*:*:*:*:*:*:*",
                            "versionStartIncluding": "1.20.0",
                            "versionEndExcluding": "1.25.0",
                        }]}]}],
                    }}],
                })
            if request.url.host == "api.first.org":
                return httpx.Response(200, json={"data": [
                    {"cve": "CVE-2026-12345", "epss": "0.81", "percentile": "0.97"},
                ]})
            return httpx.Response(200, json={"vulnerabilities": [{
                "cveID": "CVE-2026-12345",
                "dueDate": "2026-07-31",
                "knownRansomwareCampaignUse": "Known",
            }]})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await discover_cves(CveDiscoveryRequest(
                mode=CveDiscoveryMode.SERVICE,
                vendor="F5",
                product="nginx",
                version="1.24.0",
            ), client=client)

        candidate = result.items[0]
        self.assertEqual(CveMatchConfidence.HIGH, candidate.match_confidence)
        self.assertEqual(0.81, candidate.epss_score)
        self.assertTrue(candidate.known_exploited)
        self.assertEqual("2026-07-31", candidate.kev_due_date)

    async def test_osv_exact_package_query_exposes_fixed_version(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            if request.url.host == "api.osv.dev":
                return httpx.Response(200, json={"vulns": [{
                    "id": "GHSA-test-test-test",
                    "aliases": ["CVE-2025-9999"],
                    "summary": "Package issue",
                    "severity": [{
                        "type": "CVSS_V3",
                        "score": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
                    }],
                    "affected": [{"ranges": [{"events": [{"introduced": "0"}, {"fixed": "2.1.4"}]}]}],
                }]})
            if request.url.host == "api.first.org":
                return httpx.Response(200, json={"data": []})
            return httpx.Response(200, json={"vulnerabilities": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await discover_cves(CveDiscoveryRequest(
                mode=CveDiscoveryMode.PACKAGE,
                ecosystem="PyPI",
                package_name="example",
                version="2.0.0",
            ), client=client)

        candidate = result.items[0]
        self.assertEqual("CVE-2025-9999", candidate.cve_id)
        self.assertEqual(CveMatchConfidence.EXACT, candidate.match_confidence)
        self.assertEqual(["2.1.4"], candidate.fixed_versions)
        self.assertEqual(9.8, candidate.cvss_score)

    def test_cvss_v3_rejects_incomplete_vector(self) -> None:
        self.assertEqual(
            9.8,
            cvss_v3_base_score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"),
        )
        self.assertIsNone(cvss_v3_base_score("CVSS:3.1/AV:N"))


if __name__ == "__main__":
    unittest.main()
