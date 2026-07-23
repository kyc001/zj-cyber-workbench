import unittest

from scripts.export_schema import _patch_freeform_object_contracts


class ExportSchemaTests(unittest.TestCase):
    def test_freeform_object_is_explicit_for_typescript_generators(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "metadata": {"type": "object"},
                "nested": {
                    "type": "array",
                    "items": {"type": "object"},
                },
            },
        }

        _patch_freeform_object_contracts(schema)

        self.assertNotIn("additionalProperties", schema)
        self.assertIs(schema["properties"]["metadata"]["additionalProperties"], True)
        self.assertIs(schema["properties"]["nested"]["items"]["additionalProperties"], True)

    def test_explicit_object_contract_is_not_overwritten(self) -> None:
        schema = {"type": "object", "additionalProperties": False}

        _patch_freeform_object_contracts(schema)

        self.assertIs(schema["additionalProperties"], False)


if __name__ == "__main__":
    unittest.main()
