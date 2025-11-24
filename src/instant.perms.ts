// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from "@instantdb/react";

const rules = {
  maps: {
    allow: {
      view: "true",
      create: "false",
      update: "false",
      delete: "false",
    },
  },
} satisfies InstantRules;

export default rules;
