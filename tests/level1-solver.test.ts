import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { solveKnownProblem } from "../src/level1/solutions.js";
import type { CheetProblem } from "../src/level1/types.js";

describe("solveKnownProblem", () => {
  it("generates working code for representative known Level 1 problems", () => {
    const fixtures: CheetProblem[] = [
      {
        id: "p1",
        title: "Drum Beat Pattern Generator",
        tier: "easy",
        description: "",
        signature: "function getDrumForBeat(beatNumber)",
        starterCode: "function getDrumForBeat(beatNumber) {\n  \n}",
        testCases: [
          { args: [1], expected: "kick" },
          { args: [2], expected: "snare" },
          { args: [5], expected: "rest" }
        ]
      },
      {
        id: "p2",
        title: "Floodplain Retention Map",
        tier: "hard",
        description: "",
        signature: "function calculateTrappedWater(heightMap)",
        starterCode: "function calculateTrappedWater(heightMap) {\n  \n}",
        testCases: [
          {
            args: [
              [
                [1, 4, 3, 1, 3, 2],
                [3, 2, 1, 3, 2, 4],
                [2, 3, 3, 2, 3, 1]
              ]
            ],
            expected: 4
          }
        ]
      },
      {
        id: "p3",
        title: "Two Charts Become One",
        tier: "competitive",
        description: "",
        signature: "function twochartsbecomeone(input)",
        starterCode: "function twochartsbecomeone(input) {\n}",
        testCases: [
          {
            args: ["11 (10) (12 (13) (17) (28))\n11 (12 (17) (28) (13)) (10)"],
            expected: "Yes"
          },
          {
            args: ["11 ( 10 ) ( 12 )\n11(10(12))"],
            expected: "No"
          }
        ]
      },
      {
        id: "p4",
        title: "Which Warehouse?",
        tier: "competitive",
        description: "",
        signature: "function whichwarehouse(input)",
        starterCode: "function whichwarehouse(input) {\n}",
        testCases: [
          {
            args: ["2 1\n5\n10\n0 100\n1 0"],
            expected: "5"
          }
        ]
      },
      {
        id: "p5",
        title: "Stable Table",
        tier: "competitive",
        description: "",
        signature: "function stabletable(input)",
        starterCode: "function stabletable(input) {\n}",
        testCases: [
          {
            args: ["2 2\n1 2\n3 4"],
            expected: "4"
          }
        ]
      },
      {
        id: "p6",
        title: "A (Fast) Walk in the Woods",
        tier: "competitive",
        description: "",
        signature: "function walkinthewoods(input)",
        starterCode: "function walkinthewoods(input) {\n}",
        testCases: [
          {
            args: ["4 4\n0 0 0 10 10 10 10 0\n1 2 10\n2 3 10\n3 4 10\n1 4 10\n4 N"],
            expected: "10 0"
          },
          {
            args: [
              "9 12\n0 0 0 1 0 2 1 0 1 1 1 2 2 0 2 1 2 2\n1 2 1\n2 3 1\n4 1 1\n4 5 1\n5 2 1\n5 6 1\n6 3 1\n6 9 1\n9 8 1\n8 5 1\n8 7 1\n7 4 1\n8 N"
            ],
            expected: "1 0"
          }
        ]
      },
      {
        id: "p7",
        title: "Pearls",
        tier: "competitive",
        description: "",
        signature: "function pearls(input)",
        starterCode: "function pearls(input) {\n}",
        testCases: [
          {
            args: ["8 10 10\nB.BWBWB.\n2 10"],
            expected: "SSWWNNEE"
          },
          {
            args: ["16 5 6\nB.B.B.BW.WB..WB.\n3 1"],
            expected: "EENNEESSSSWWWWNN"
          },
          {
            args: ["6 5 5\nW..B.B\n3 3"],
            expected: "impossible"
          }
        ]
      },
      {
        id: "p8",
        title: "Quarterly Sales Trend Analyzer",
        tier: "medium",
        description: "",
        signature: "function countGrowthWindows(sales, minDays)",
        starterCode: "function countGrowthWindows(sales, minDays) {\n}",
        testCases: [
          { args: [[10, 20, 30, 40], 2], expected: 6 },
          { args: [[50, 40, 30], 2], expected: 0 }
        ]
      },
      {
        id: "p9",
        title: "Arcane Spell Combination",
        tier: "hard",
        description: "",
        signature: "function findOptimalSpell(runes, k, maxMana, requiredElements)",
        starterCode: "function findOptimalSpell(runes, k, maxMana, requiredElements) {\n}",
        testCases: [
          { args: [[{ element: "void", power: 100 }], 1, 50, ["void"]], expected: -1 },
          {
            args: [
              [
                { element: "fire", power: 10 },
                { element: "water", power: 15 },
                { element: "fire", power: 20 },
                { element: "earth", power: 12 }
              ],
              3,
              40,
              ["fire", "water"]
            ],
            expected: 37
          }
        ]
      },
      {
        id: "p10",
        title: "All in the Family",
        tier: "competitive",
        description: "",
        signature: "function allinthefamily(input)",
        starterCode: "function allinthefamily(input) {\n}",
        testCases: [
          {
            args: ["4 6\nA 4 B C D E\nH 3 I J K\nC 2 F G\nD 1 H\nG C\nH A\nF G\nF H\nF K\nB K"],
            expected:
              "G is the child of C\nH is the grandchild of A\nF and G are siblings\nF and H are 1st cousins\nF and K are 1st cousins, 1 time removed\nB and K are 0th cousins, 2 times removed"
          }
        ]
      },
      {
        id: "p11",
        title: "Over the Hill, Part 2",
        tier: "competitive",
        description: "",
        signature: "function overthehill2(input)",
        starterCode: "function overthehill2(input) {\n}",
        testCases: [
          { args: ["3\nABCABC\nJKLMNO"], expected: "No solution" },
          {
            args: ["3\nATTACK AT DAWN \nFPLSFA4SUK2W9K3"],
            expected: "30 1 9\n4 23 7\n5 9 13"
          }
        ]
      },
      {
        id: "p12",
        title: "Climate Pattern Recognition System",
        tier: "hard",
        description: "",
        signature: "function countStableWeatherPeriods(temps, threshold, minDays)",
        starterCode: "function countStableWeatherPeriods(temps, threshold, minDays) {\n}",
        testCases: [
          { args: [[70, 72, 71, 75, 80, 79], 5, 3], expected: 2 },
          { args: [[65, 66, 67, 68], 5, 2], expected: 6 }
        ]
      },
      {
        id: "p13",
        title: "Data Shard Rebalance",
        tier: "hard",
        description: "",
        signature: "function minimizeMaxLoad(shards, servers)",
        starterCode: "function minimizeMaxLoad(shards, servers) {\n}",
        testCases: [
          { args: [[10, 10, 10], 3], expected: 10 },
          { args: [[1, 2, 3, 4, 5], 2], expected: 9 }
        ]
      },
      {
        id: "p14",
        title: "Interstellar Fuel Optimization",
        tier: "hard",
        description: "",
        signature: "function minFuelCost(distances, prices, capacity, target)",
        starterCode: "function minFuelCost(distances, prices, capacity, target) {\n}",
        testCases: [
          { args: [[0, 50, 100], [0, 1, 2], 100, 100], expected: 50 },
          { args: [[0, 100, 200, 300], [0, 2, 1, 3], 150, 300], expected: 300 },
          { args: [[0, 40, 80], [5, 1, 9], 100, 80], expected: 240 }
        ]
      },
      {
        id: "p15",
        title: "Scholar's Lawn",
        tier: "competitive",
        description: "",
        signature: "function scholarslawn(input)",
        starterCode: "function scholarslawn(input) {\n}",
        testCases: [
          {
            args: ["3\n0 1 6 1\n0 1 10 0\n4 3 4 0\n0 1 1\n0 0 10 1 1"],
            expected: "5.02493781"
          },
          {
            args: ["7\n5 5 35 5\n35 0 15 20\n30 0 30 10\n30 10 35 10\n35 10 35 15\n35 15 30 15\n30 15 30 30\n30.0 0.0 1.0\n10 0 40 30 1.0"],
            expected: "17.67766953"
          }
        ]
      },
      {
        id: "p15b",
        title: "Rock Climbing Route Optimizer",
        tier: "hard",
        description: "",
        signature: "function minClimbingEnergy(holds, maxReach)",
        starterCode: "function minClimbingEnergy(holds, maxReach) {\n}",
        testCases: [
          {
            args: [
              [
                { energy: 0, height: 0 },
                { energy: 2, height: 3 },
                { energy: 4, height: 6 },
                { energy: 1, height: 10 }
              ],
              5
            ],
            expected: 7
          },
          {
            args: [
              [
                { energy: 2, height: 3 },
                { energy: 1, height: 7 }
              ],
              5
            ],
            expected: 3
          },
          {
            args: [
              [
                { energy: 5, height: 20 }
              ],
              10
            ],
            expected: -1
          }
        ]
      },
      {
        id: "p16",
        title: "Ancient Site Excavation",
        tier: "hard",
        description: "",
        signature: "function planExcavation(artifacts, dependencies, timeBudget)",
        starterCode: "function planExcavation(artifacts, dependencies, timeBudget) {\n}",
        testCases: [
          { args: [[{ difficulty: 10, fragile: false, id: 0, value: 20 }], [], 5], expected: 0 },
          {
            args: [
              [
                { difficulty: 2, fragile: false, id: 0, value: 5 },
                { difficulty: 3, fragile: false, id: 1, value: 7 },
                { difficulty: 4, fragile: true, id: 2, value: 9 }
              ],
              [
                [2, 0],
                [2, 1]
              ],
              10
            ],
            expected: 21
          }
        ]
      },
      {
        id: "p17",
        title: "Dragon's Lair Treasure Hunt",
        tier: "hard",
        description: "",
        signature: "function maxTreasureGold(dungeon, startHealth)",
        starterCode: "function maxTreasureGold(dungeon, startHealth) {\n}",
        testCases: [
          {
            args: [
              [
                [-5, -10],
                [-3, 100]
              ],
              10
            ],
            expected: 100
          },
          {
            args: [
              [
                [10, -5, 20],
                [-10, 30, -5],
                [5, -10, 40]
              ],
              20
            ],
            expected: 80
          }
        ]
      },
      {
        id: "p18",
        title: "Bio Trip",
        tier: "competitive",
        description: "",
        signature: "function biotrip(input)",
        starterCode: "function biotrip(input) {\n}",
        testCases: [
          {
            args: [
              "4 3 90 90\n3 2 3 45 3 2 0 4 2 315\n2 1 3 135 3 2 270\n3 1 2 180 2 2 90 4 2 225\n2 1 2 135 3 2 270"
            ],
            expected: "7"
          },
          {
            args: ["2 2 90 90\n1 2 10 0\n1 1 15 180"],
            expected: "impossible"
          },
          {
            args: ["2 2 1 180\n1 2 3 90\n1 1 3 270"],
            expected: "6"
          },
          {
            args: [
              "5 3 45 45\n3 2 1 90 5 1 180 3 7 315\n4 1 1 270 3 1 90 4 1 0 5 1 180\n3 2 1 270 4 1 90 1 7 45\n2 3 1 0 2 1 180\n2 2 1 0 1 1 180"
            ],
            expected: "6"
          }
        ]
      },
      {
        id: "p19",
        title: "Follow the Bouncing Ball",
        tier: "competitive",
        description: "",
        signature: "function followthebouncingball(input)",
        starterCode: "function followthebouncingball(input) {\n}",
        testCases: [
          {
            args: [
              "20 30 5 3 10 -1 1\n4 10 18 10 24 14 24 14 18 10\n3 5 23 1 25 5 27 7\n4 16 22 16 28 19 28 19 19 8"
            ],
            expected: "0 2 3"
          },
          {
            args: [
              "20 30 10 3 10.1 -1 1\n4 10 18 10 24 14 24 14 18 10\n3 5 23 1 25 5 27 7\n4 16 22 16 28 19 28 19 19 8"
            ],
            expected: "0 0 1"
          },
          {
            args: [
              "40 100 90 4 10 0 1\n3 5 10 5 20 35 20 100\n3 5 40 35 40 35 30 100\n3 5 50 5 60 35 60 100\n3 5 80 35 80 35 70 100"
            ],
            expected: "10 100 100 100"
          },
          {
            args: [
              "40 100 90 4 10 0 1\n3 5 10 5 20 35 20 18\n3 5 40 35 40 35 30 21\n3 5 50 5 60 35 60 100\n3 5 80 35 80 35 70 100"
            ],
            expected: "0 0 47 100"
          }
        ]
      },
      {
        id: "p20",
        title: "Solar Flare Prediction System",
        tier: "medium",
        description: "",
        signature: "function detectPreFlareWindows(readings, windowSize, threshold)",
        starterCode: "function detectPreFlareWindows(readings, windowSize, threshold) {\n}",
        testCases: [
          { args: [[5, 5, 5, 5], 2, 1], expected: 0 },
          { args: [[1, 100, 1, 100], 2, 49], expected: 3 }
        ]
      },
      {
        id: "p21",
        title: "Warp Lane Scheduler",
        tier: "hard",
        description: "",
        signature: "function minWarpLanes(routes)",
        starterCode: "function minWarpLanes(routes) {\n}",
        testCases: [
          { args: [[[1, 4], [2, 3], [3, 5]]], expected: 2 },
          { args: [[[0, 5], [5, 10], [10, 15]]], expected: 1 }
        ]
      },
      {
        id: "p22",
        title: "Ancient Calendar Alignment",
        tier: "hard",
        description: "",
        signature: "function findAlignment(cycles, startDay)",
        starterCode: "function findAlignment(cycles, startDay) {\n}",
        testCases: [
          { args: [[{ offset: 1, period: 3 }, { offset: 0, period: 6 }], 0], expected: -1 },
          { args: [[{ offset: 3, period: 8 }, { offset: 11, period: 12 }, { offset: 1, period: 5 }], 0], expected: 11 }
        ]
      },
      {
        id: "p23",
        title: "Ant Colony Foraging Optimization",
        tier: "hard",
        description: "",
        signature: "function optimizeAntForaging(graph, foodSources, startNode, timeLimit)",
        starterCode: "function optimizeAntForaging(graph, foodSources, startNode, timeLimit) {\n}",
        testCases: [
          { args: [[[0]], [], 0, 10], expected: 0 },
          {
            args: [
              [
                [0, 5, 10],
                [5, 0, 3],
                [10, 3, 0]
              ],
              [
                { node: 1, value: 20 },
                { node: 2, value: 30 }
              ],
              0,
              20
            ],
            expected: 50
          }
        ]
      },
      {
        id: "p24",
        title: "Build Order Counter",
        tier: "hard",
        description: "",
        signature: "function countBuildOrders(tasks, dependencies)",
        starterCode: "function countBuildOrders(tasks, dependencies) {\n}",
        testCases: [
          { args: [["A", "B", "C"], [["A", "B"]]], expected: 3 },
          { args: [["A", "B", "C", "D"], [["A", "B"], ["C", "D"]]], expected: 6 }
        ]
      },
      {
        id: "p25",
        title: "Ancient Temple Door Lock",
        tier: "medium",
        description: "",
        signature: "function unlockAncientDoor(sequence, pattern)",
        starterCode: "function unlockAncientDoor(sequence, pattern) {\n}",
        testCases: [
          { args: ["ABCCBA", "ABC"], expected: true },
          { args: ["ABCBA", "ABC"], expected: true },
          { args: ["ABCD", "ABC"], expected: false }
        ]
      },
      {
        id: "p26",
        title: "Historical Timeline Consistency Checker",
        tier: "medium",
        description: "",
        signature: "function detectTimelineParadoxes(events)",
        starterCode: "function detectTimelineParadoxes(events) {\n}",
        testCases: [
          { args: [[{ id: "X", before: ["Y"] }, { id: "Y", before: ["X"] }]], expected: true },
          { args: [[{ id: "A", before: ["B"] }, { id: "B", before: ["C"] }, { id: "C", before: [] }]], expected: false }
        ]
      },
      {
        id: "p27",
        title: "Dragon's Treasure Counter",
        tier: "easy",
        description: "",
        signature: "function countTreasure(gold, silver, copper)",
        starterCode: "function countTreasure(gold, silver, copper) {\n}",
        testCases: [{ args: [1, 2, 3], expected: 10203 }]
      },
      {
        id: "p28",
        title: "Ant Colony Tunnel Integrity Checker",
        tier: "medium",
        description: "",
        signature: "function validateTunnelStructure(blueprint)",
        starterCode: "function validateTunnelStructure(blueprint) {\n}",
        testCases: [
          { args: ["((()))"], expected: true },
          { args: ["[{]}"], expected: false }
        ]
      },
      {
        id: "p29",
        title: "Code Review Buddy System",
        tier: "hard",
        description: "",
        signature: "function maxReviewPairs(juniors, seniors, maxDiff)",
        starterCode: "function maxReviewPairs(juniors, seniors, maxDiff) {\n}",
        testCases: [
          { args: [[1, 2, 3], [3, 4, 5], 2], expected: 3 },
          { args: [[10], [1], 5], expected: 0 }
        ]
      },
      {
        id: "p30",
        title: "Cryptocurrency Price Surge Detector",
        tier: "medium",
        description: "",
        signature: "function countPriceSurges(prices, windowSize, threshold)",
        starterCode: "function countPriceSurges(prices, windowSize, threshold) {\n}",
        testCases: [
          { args: [[100, 120, 140], 2, 15], expected: 2 },
          { args: [[100, 101, 102], 2, 10], expected: 0 }
        ]
      },
      {
        id: "p31",
        title: "CSS Specificity Validator",
        tier: "medium",
        description: "",
        signature: "function calculateSpecificityWinner(selectors)",
        starterCode: "function calculateSpecificityWinner(selectors) {\n}",
        testCases: [
          { args: [["#main .content p", "div#app .title", ".nav ul li"]], expected: "#main .content p" },
          { args: [["body", "html body"]], expected: "html body" }
        ]
      },
      {
        id: "p32",
        title: "Forest Canopy Gaps",
        tier: "medium",
        description: "",
        signature: "function longestGap(heights, minHeight)",
        starterCode: "function longestGap(heights, minHeight) {\n}",
        testCases: [
          { args: [[15, 16], 10], expected: 0 },
          { args: [[4, 4, 4], 5], expected: 3 }
        ]
      }
    ];

    for (const problem of fixtures) {
      const solved = solveKnownProblem(problem);
      expect(solved.known, problem.title).toBe(true);
      assertPassesExamples(solved.code, problem);
    }
  });

  it("marks unknown problems without fabricating a solution", () => {
    const solved = solveKnownProblem({
      id: "unknown",
      title: "Mystery Problem",
      tier: "medium",
      description: "Unknown shape",
      signature: "function mystery(input)",
      starterCode: "function mystery(input) {\n}",
      testCases: [{ args: ["x"], expected: "y" }]
    });

    expect(solved.known).toBe(false);
    expect(solved.code).toContain("function mystery");
  });
});

function assertPassesExamples(code: string, problem: CheetProblem): void {
  const functionName = problem.signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
  expect(functionName).toBeTruthy();

  const context = vm.createContext({});
  vm.runInContext(`${code}; globalThis.__fn = ${functionName};`, context, { timeout: 1000 });
  const fn = context.__fn as (...args: unknown[]) => unknown;

  for (const testCase of problem.testCases) {
    expect(fn(...testCase.args), `${problem.title} ${JSON.stringify(testCase.args)}`).toEqual(testCase.expected);
  }
}
