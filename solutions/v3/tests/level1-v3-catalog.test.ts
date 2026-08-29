import { describe, expect, it } from "vitest";

import { solveKnownProblem } from "../src/level1/solutions.js";

const V3_LEVEL1_FUNCTIONS = [
  "calculateBlocks",
  "getBatteryPercentage",
  "romanToNumber",
  "is4KScreen",
  "calculateMaterialCost",
  "calculateOxygen",
  "calculateFuel",
  "maxPortfolioReturn",
  "canHarmonizeIngredients",
  "optimizeSeating",
  "countGrowthWindows",
  "countViralPeriods",
  "detectPreFlareWindows",
  "countVolatileWindows",
  "minimizeMaxLoad",
  "hilbertshedgemaze",
  "calculateTrappedWater",
  "maxOnTimeInvoices",
  "findAnomalyWindow",
  "shortestLogMerge",
  "abridgedreading",
  "stabletable",
  "tombhater",
  "twochartsbecomeone",
  "whichwarehouse"
] as const;

const FRESH_FAKE_BATCH_FUNCTIONS = [
  "calculateSwimDistance",
  "calculateTaxiFare",
  "isSetComplete",
  "estimateTreeAge",
  "calculateLoadTime",
  "convertSignalStrength",
  "calculateSpellPower",
  "maxOnTimeTasks",
  "detectTimelineParadoxes",
  "maxTreasureGold",
  "countStableWeatherPeriods",
  "unlockAncientDoor",
  "validateTunnelStructure",
  "minClimbingEnergy",
  "optimizeMarsSupplyFlow",
  "minNoteDeletions",
  "shortestPortalPath",
  "maxProjectProfit",
  "maxRevenueWindow",
  "calculateTerraceWater",
  "pearls",
  "walkinthewoods",
  "balancingart",
  "fencesmakegoodneighbors",
  "marchingorders"
] as const;

describe("CheetCode v3 Level 1 catalog", () => {
  it("has a deterministic specialist for every observed v3 task", () => {
    for (const functionName of [...V3_LEVEL1_FUNCTIONS, ...FRESH_FAKE_BATCH_FUNCTIONS]) {
      const solved = solveKnownProblem({
        id: functionName,
        title: functionName,
        tier: "v3",
        description: "",
        signature: `function ${functionName}()`,
        starterCode: `function ${functionName}() {}`,
        testCases: []
      });

      expect(solved.known, functionName).toBe(true);
      expect(solved.source, functionName).toBe("catalog");
      expect(solved.code, functionName).toContain(`function ${functionName}`);
    }
  });
});
