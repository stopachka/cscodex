import { adminDb } from "../src/lib/adminDb";
import { id } from "@instantdb/admin";

const names = [
  "Aztec Spires",
  "Dustline Bazaar",
  "Mirage Vault",
  "Nuke Horizon",
  "Inferno Runoff",
  "Trainyard Eclipse",
  "Vertigo Prism",
  "Cobble Keep",
  "Canals Ember",
  "Overpass Circuit",
];

function sampleFive() {
  const picks = new Set<string>();
  while (picks.size < 5) {
    picks.add(names[Math.floor(Math.random() * names.length)]);
  }
  return Array.from(picks);
}

async function seed() {
  const mapNames = sampleFive();
  console.log("Seeding maps:", mapNames);
  const txs = mapNames.map((name) =>
    adminDb.tx.maps[id()].create({
      name,
      createdAt: Date.now(),
    }),
  );
  await adminDb.transact(txs);
  console.log("Done.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
