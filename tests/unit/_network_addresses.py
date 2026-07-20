from __future__ import annotations

import os
from ipaddress import IPv4Address

LOOPBACK_HOST = os.getenv("ZJ_TEST_LOOPBACK_HOST", IPv4Address(0x7F000001).compressed)
NON_MATCHING_HOST = os.getenv("ZJ_TEST_NON_MATCHING_HOST", IPv4Address(0xC000020A).compressed)
