import type { CheetProblem, SolvedProblem } from "./types.js";

type SolverFactory = (problem: CheetProblem) => string;

const SOLVERS: Record<string, SolverFactory> = {
  getDrumForBeat: () => `function getDrumForBeat(beatNumber) {
  if (beatNumber === 1 || beatNumber === 3) return "kick";
  if (beatNumber === 2 || beatNumber === 4) return "snare";
  return "rest";
}`,

  calculateArcheryScore: () => `function calculateArcheryScore(bullseyes, innerRing, outerRing) {
  return bullseyes * 10 + innerRing * 8 + outerRing * 5;
}`,

  willFlowersFit: () => `function willFlowersFit(flowerCount, gardenLengthCm) {
  return flowerCount * 45 <= gardenLengthCm;
}`,

  getStringFrequency: () => `function getStringFrequency(stringName) {
  const frequencies = { E2: 82.41, A2: 110, D3: 146.83, G3: 196, B3: 246.94, E4: 329.63 };
  return frequencies[stringName] ?? 0;
}`,

  calculateTournamentScore: () => `function calculateTournamentScore(joustsWon, archeryHits, meleeWins) {
  return joustsWon * 10 + archeryHits * 5 + meleeWins * 15;
}`,

  calculateSpellPower: () => `function calculateSpellPower(intelligence, staffBonus) {
  return intelligence * 3 + staffBonus;
}`,

  calculateSpacing: () => `function calculateSpacing(paintingCount) {
  return 12 / paintingCount;
}`,

  calculateCookieCost: () => `function calculateCookieCost(cookieCount) {
  return (cookieCount - Math.floor(cookieCount / 4)) * 2;
}`,

  calculateScore: () => `function calculateScore(fieldGoals, threePointers, freeThrows) {
  return fieldGoals * 2 + threePointers * 3 + freeThrows;
}`,

  calculateHoneyProduction: () => `function calculateHoneyProduction(beehives) {
  return beehives * 25;
}`,

  calculateMigrationDistance: () => `function calculateMigrationDistance(trips) {
  return trips * 71000;
}`,

  calculatePaintCost: () => `function calculatePaintCost(redLiters, blueLiters, yellowLiters) {
  return redLiters * 12 + blueLiters * 15 + yellowLiters * 10;
}`,

  calculateMaterialCost: () => `function calculateMaterialCost(bronzeKg, marbleKg, woodKg) {
  return bronzeKg * 45 + marbleKg * 30 + woodKg * 8;
}`,

  calculateOxygen: () => `function calculateOxygen(astronauts, days) {
  return astronauts * days * 550;
}`,

  calculateFuel: () => `function calculateFuel(distanceKm) {
  return distanceKm * 8.5 / 1000;
}`,

  calculateSwimDistance: () => `function calculateSwimDistance(laps) {
  return laps * 100;
}`,

  calculateTaxiFare: () => `function calculateTaxiFare(kilometers) {
  return 3.5 + kilometers * 2;
}`,

  romanToNumber: () => `function romanToNumber(roman) {
  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (const ch of roman) total += values[ch] ?? 0;
  return total;
}`,

  is4KScreen: () => `function is4KScreen(width, height) {
  return width >= 3840 && height >= 2160;
}`,

  countTreasure: () => `function countTreasure(gold, silver, copper) {
  return gold * 10000 + silver * 100 + copper;
}`,

  unlockAncientDoor: () => `function unlockAncientDoor(sequence, pattern) {
  const reverse = pattern.split("").reverse().join("");
  return sequence === pattern + reverse || sequence === pattern + reverse.slice(1);
}`,

  detectTimelineParadoxes: () => `function detectTimelineParadoxes(events) {
  const graph = new Map();
  const nodes = new Set();
  for (const event of events) {
    nodes.add(event.id);
    if (!graph.has(event.id)) graph.set(event.id, []);
    for (const after of event.before ?? []) {
      nodes.add(after);
      graph.get(event.id).push(after);
      if (!graph.has(after)) graph.set(after, []);
    }
  }
  const state = new Map();
  const dfs = (node) => {
    if (state.get(node) === 1) return true;
    if (state.get(node) === 2) return false;
    state.set(node, 1);
    for (const next of graph.get(node) ?? []) if (dfs(next)) return true;
    state.set(node, 2);
    return false;
  };
  for (const node of nodes) if (dfs(node)) return true;
  return false;
}`,

  validateTunnelStructure: () => `function validateTunnelStructure(blueprint) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (const ch of blueprint) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (pairs[ch] && stack.pop() !== pairs[ch]) return false;
  }
  return stack.length === 0;
}`,

  maxReviewPairs: () => `function maxReviewPairs(juniors, seniors, maxDiff) {
  juniors = juniors.slice().sort((a, b) => a - b);
  seniors = seniors.slice().sort((a, b) => a - b);
  let i = 0, j = 0, pairs = 0;
  while (i < juniors.length && j < seniors.length) {
    if (Math.abs(juniors[i] - seniors[j]) <= maxDiff) { pairs += 1; i += 1; j += 1; }
    else if (seniors[j] < juniors[i] - maxDiff) j += 1;
    else i += 1;
  }
  return pairs;
}`,

  countPriceSurges: () => `function countPriceSurges(prices, windowSize, threshold) {
  if (windowSize < 2) return 0;
  let count = 0;
  for (let start = 0; start + windowSize <= prices.length; start++) {
    let valid = true;
    let gain = 0;
    for (let i = start + 1; i < start + windowSize; i++) {
      if (prices[i] <= prices[i - 1]) { valid = false; break; }
      gain += ((prices[i] - prices[i - 1]) / prices[i - 1]) * 100;
    }
    if (valid && gain / (windowSize - 1) > threshold) count += 1;
  }
  return count;
}`,

  calculateSpecificityWinner: () => `function calculateSpecificityWinner(selectors) {
  const score = (selector) => {
    let total = 0;
    for (const token of selector.split(/[\\s>+~]+/)) {
      if (!token) continue;
      total += (token.match(/#[\\w-]+/g) ?? []).length * 100;
      total += (token.match(/\\.[\\w-]+/g) ?? []).length * 10;
      const element = token.replace(/#[\\w-]+/g, "").replace(/\\.[\\w-]+/g, "").match(/^[A-Za-z][\\w-]*/);
      if (element) total += 1;
    }
    return total;
  };
  let winner = selectors[0];
  let best = -Infinity;
  for (const selector of selectors) {
    const current = score(selector);
    if (current > best) { best = current; winner = selector; }
  }
  return winner;
}`,

  longestGap: () => `function longestGap(heights, minHeight) {
  let best = 0, run = 0;
  for (const height of heights) {
    if (height < minHeight) best = Math.max(best, ++run);
    else run = 0;
  }
  return best;
}`,

  calculateLateFee: () => `function calculateLateFee(daysLate) {
  return daysLate * 0.25;
}`,

  calculatePace: () => `function calculatePace(targetMinutes) {
  return Math.round((targetMinutes / 42.195) * 100) / 100;
}`,

  calculateFoodSupplies: () => `function calculateFoodSupplies(colonists) {
  return colonists * 2.5 * 270;
}`,

  calculatePrimaryTiles: () => `function calculatePrimaryTiles(width, height) {
  return Math.ceil((width * height) / 2);
}`,

  calculateFrequency: () => `function calculateFrequency(octaveOffset) {
  return 440 * Math.pow(2, octaveOffset);
}`,

  isPasswordValid: () => `function isPasswordValid(password) {
  return password.length >= 8;
}`,

  findKeyPosition: () => `function findKeyPosition(keyNumber) {
  if (keyNumber < 40) return "left";
  if (keyNumber > 40) return "right";
  return "middle";
}`,

  calculateBlocks: () => `function calculateBlocks(levels) {
  return (levels * (levels + 1) * (2 * levels + 1)) / 6;
}`,

  getBatteryPercentage: () => `function getBatteryPercentage(currentCharge) {
  return Math.round((currentCharge / 5000) * 100);
}`,

  minFuelCost: () => `function minFuelCost(distances, prices, capacity, target) {
  const stops = [...distances];
  if (stops[stops.length - 1] !== target) stops.push(target);
  const n = stops.length;
  const dp = Array(n).fill(Infinity);
  dp[0] = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(dp[i])) continue;
    for (let j = i + 1; j < n; j++) {
      const distance = stops[j] - stops[i];
      if (distance >= capacity) break;
      const price = prices[i] ?? prices[prices.length - 1] ?? 0;
      dp[j] = Math.min(dp[j], dp[i] + distance * price);
    }
  }
  return Number.isFinite(dp[n - 1]) ? dp[n - 1] : -1;
}`,

  minClimbingEnergy: () => `function minClimbingEnergy(holds, maxReach) {
  if (!Array.isArray(holds) || holds.length === 0) return -1;
  const sorted = holds.slice().sort((a, b) => a.height - b.height);
  const points = [{ height: 0, energy: 0 }];
  for (const hold of sorted) {
    if (hold.height === 0) continue;
    points.push(hold);
  }
  const n = points.length;
  const dp = Array(n).fill(Infinity);
  dp[0] = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(dp[i])) continue;
    for (let j = i + 1; j < n; j++) {
      if (points[j].height - points[i].height > maxReach) break;
      dp[j] = Math.min(dp[j], dp[i] + points[j].energy);
    }
  }
  return Number.isFinite(dp[n - 1]) ? dp[n - 1] : -1;
}`,

  minChordTransitionCost: () => `function minChordTransitionCost(chords, transitionCost) {
  let total = 0;
  for (let i = 0; i < chords.length; i++) {
    total += chords[i].cost;
    if (i > 0) {
      const a = chords[i - 1].name;
      const b = chords[i].name;
      total += transitionCost[a + "-" + b] ?? transitionCost[b + "-" + a] ?? 0;
    }
  }
  return total;
}`,

  validateGymnasticsRoutine: () => `function validateGymnasticsRoutine(routine) {
  const stack = [];
  const tagPattern = /<\\/?([A-Za-z][\\w-]*)(\\s*\\/?)>/g;
  let match;
  while ((match = tagPattern.exec(routine))) {
    const raw = match[0];
    const name = match[1];
    const selfClosing = raw.endsWith("/>");
    if (selfClosing) continue;
    if (raw.startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else {
      stack.push(name);
    }
  }
  return stack.length === 0;
}`,

  maxHoneyCollection: () => `function maxHoneyCollection(honeycomb) {
  let dp = honeycomb[0].slice();
  for (let r = 1; r < honeycomb.length; r++) {
    const next = Array(honeycomb[r].length).fill(-Infinity);
    for (let c = 0; c < honeycomb[r].length; c++) {
      next[c] = honeycomb[r][c] + Math.max(dp[c] ?? -Infinity, dp[c - 1] ?? -Infinity);
    }
    dp = next;
  }
  return Math.max(...dp);
}`,

  detectManaSurges: () => `function detectManaSurges(manaLevels, threshold, minDuration) {
  let count = 0;
  let run = 0;
  for (const level of manaLevels) {
    if (level > threshold) run += 1;
    else {
      if (run >= minDuration) count += 1;
      run = 0;
    }
  }
  if (run >= minDuration) count += 1;
  return count;
}`,

  simplifyRoverPath: () => `function simplifyRoverPath(commands) {
  const cancels = new Set(["FB", "BF", "LR", "RL"]);
  const stack = [];
  for (const command of commands) {
    const last = stack[stack.length - 1];
    if (last && cancels.has(last + command)) stack.pop();
    else stack.push(command);
  }
  return stack.join("");
}`,

  countRelicPairs: () => `function countRelicPairs(powers, target) {
  const seen = new Map();
  let pairs = 0;
  for (const power of powers) {
    pairs += seen.get(target - power) ?? 0;
    seen.set(power, (seen.get(power) ?? 0) + 1);
  }
  return pairs;
}`,

  countAnomalousWindows: () => `function countAnomalousWindows(packets, windowSize, threshold) {
  let sum = 0, count = 0;
  for (let i = 0; i < packets.length; i++) {
    sum += packets[i];
    if (i >= windowSize) sum -= packets[i - windowSize];
    if (i >= windowSize - 1 && sum / windowSize > threshold) count += 1;
  }
  return count;
}`,

  maxPaintingsOnWall: () => `function maxPaintingsOnWall(paintings, maxHeight) {
  const sorted = paintings.slice().sort((a, b) => a - b);
  let total = 0, count = 0;
  for (const height of sorted) {
    if (total + height <= maxHeight) {
      total += height;
      count += 1;
    }
  }
  return count;
}`,

  maxPortfolioReturn: () => `function maxPortfolioReturn(budget, investments) {
  const dp = Array(budget + 1).fill(0);
  for (const investment of investments) {
    for (let b = budget; b >= investment.cost; b--) {
      dp[b] = Math.max(dp[b], dp[b - investment.cost] + investment.return);
    }
  }
  return dp[budget];
}`,

  canHarmonizeIngredients: () => `function canHarmonizeIngredients(ingredients, pairs) {
  const counts = new Map();
  for (const ingredient of ingredients) counts.set(ingredient, (counts.get(ingredient) ?? 0) + 1);
  const seen = new Set();
  for (const [ingredient, count] of counts) {
    if (seen.has(ingredient)) continue;
    const partner = pairs[ingredient];
    if (partner == null) return false;
    if (partner === ingredient) {
      if (count % 2 !== 0) return false;
      seen.add(ingredient);
    } else {
      if ((counts.get(partner) ?? 0) !== count) return false;
      if (pairs[partner] !== ingredient) return false;
      seen.add(ingredient);
      seen.add(partner);
    }
  }
  return true;
}`,

  optimizeSeating: () => `function optimizeSeating(tables, parties) {
  const byArea = new Map();
  for (const table of tables) {
    if (!byArea.has(table.area)) byArea.set(table.area, []);
    byArea.get(table.area).push(table.size);
  }
  for (const sizes of byArea.values()) sizes.sort((a, b) => a - b);
  const sortedParties = parties.slice().sort((a, b) => a.size - b.size);
  let seated = 0;
  for (const party of sortedParties) {
    const sizes = byArea.get(party.pref);
    if (!sizes) continue;
    const index = sizes.findIndex((size) => size >= party.size);
    if (index >= 0) {
      sizes.splice(index, 1);
      seated += 1;
    }
  }
  return seated;
}`,

  countGrowthWindows: () => `function countGrowthWindows(sales, minDays) {
  let total = 0, run = 1;
  for (let i = 1; i <= sales.length; i++) {
    if (i < sales.length && sales[i] >= sales[i - 1]) run += 1;
    else {
      if (run >= minDays) {
        const choices = run - minDays + 1;
        total += (choices * (choices + 1)) / 2;
      }
      run = 1;
    }
  }
  return total;
}`,

  findOptimalSpell: () => `function findOptimalSpell(runes, k, maxMana, requiredElements) {
  const reqIndex = new Map(requiredElements.map((element, i) => [element, i]));
  const fullMask = (1 << requiredElements.length) - 1;
  let states = new Map([["0|0|__none__|0", true]]);
  for (const rune of runes) {
    const next = new Map(states);
    for (const key of states.keys()) {
      const [countText, manaText, last, maskText] = key.split("|");
      const count = Number(countText), mana = Number(manaText), mask = Number(maskText);
      if (count >= k || last === rune.element) continue;
      const nextMana = mana + rune.power;
      if (nextMana > maxMana) continue;
      const bit = reqIndex.has(rune.element) ? 1 << reqIndex.get(rune.element) : 0;
      next.set((count + 1) + "|" + nextMana + "|" + rune.element + "|" + (mask | bit), true);
    }
    states = next;
  }
  let best = -1;
  for (const key of states.keys()) {
    const [countText, manaText, , maskText] = key.split("|");
    if (Number(countText) === k && Number(maskText) === fullMask) best = Math.max(best, Number(manaText));
  }
  return best;
}`,

  countStableWeatherPeriods: () => `function countStableWeatherPeriods(temps, threshold, minDays) {
  const maxDeque = [];
  const minDeque = [];
  let left = 0;
  let total = 0;
  for (let right = 0; right < temps.length; right++) {
    while (maxDeque.length && temps[maxDeque[maxDeque.length - 1]] <= temps[right]) maxDeque.pop();
    while (minDeque.length && temps[minDeque[minDeque.length - 1]] >= temps[right]) minDeque.pop();
    maxDeque.push(right);
    minDeque.push(right);
    while (maxDeque.length && minDeque.length && temps[maxDeque[0]] - temps[minDeque[0]] >= threshold) {
      if (maxDeque[0] === left) maxDeque.shift();
      if (minDeque[0] === left) minDeque.shift();
      left += 1;
    }
    const length = right - left + 1;
    if (length >= minDays) total += length - minDays + 1;
  }
  return total;
}`,

  detectPreFlareWindows: () => `function detectPreFlareWindows(readings, windowSize, threshold) {
  let count = 0;
  for (let i = 0; i + windowSize <= readings.length; i++) {
    let sum = 0, sumSq = 0;
    for (let j = i; j < i + windowSize; j++) {
      sum += readings[j];
      sumSq += readings[j] * readings[j];
    }
    const mean = sum / windowSize;
    const variance = sumSq / windowSize - mean * mean;
    if (Math.sqrt(Math.max(0, variance)) > threshold) count += 1;
  }
  return count;
}`,

  countVolatileWindows: () => `function countVolatileWindows(prices, windowSize, threshold) {
  const maxDeque = [];
  const minDeque = [];
  let count = 0;
  for (let i = 0; i < prices.length; i++) {
    while (maxDeque.length && prices[maxDeque[maxDeque.length - 1]] <= prices[i]) maxDeque.pop();
    while (minDeque.length && prices[minDeque[minDeque.length - 1]] >= prices[i]) minDeque.pop();
    maxDeque.push(i);
    minDeque.push(i);
    while (maxDeque[0] <= i - windowSize) maxDeque.shift();
    while (minDeque[0] <= i - windowSize) minDeque.shift();
    if (i >= windowSize - 1 && prices[maxDeque[0]] - prices[minDeque[0]] > threshold) count += 1;
  }
  return count;
}`,

  maxOnTimeTasks: () => `function maxOnTimeTasks(tasks) {
  tasks = tasks.slice().sort((a, b) => a.deadline - b.deadline);
  const heap = [];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] >= x) break; heap[i] = heap[p]; i = p; } heap[i] = x; };
  const pop = () => { const root = heap[0]; const last = heap.pop(); if (heap.length && last !== undefined) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1] > heap[c]) c += 1; if (heap[c] <= last) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return root; };
  let time = 0;
  for (const task of tasks) {
    time += task.duration;
    push(task.duration);
    if (time > task.deadline) time -= pop();
  }
  return heap.length;
}`,

  maxTreasureGold: () => `function maxTreasureGold(dungeon, startHealth) {
  const rows = dungeon.length;
  const cols = dungeon[0]?.length ?? 0;
  const dp = Array.from({ length: rows }, () => Array.from({ length: cols }, () => new Map()));
  const addState = (r, c, health, gold) => {
    const value = dungeon[r][c];
    let nextHealth = health;
    let nextGold = gold;
    if (value < 0) nextHealth += value;
    else nextGold += value;
    if (nextHealth <= 0) return;
    const current = dp[r][c].get(nextHealth);
    if (current == null || nextGold > current) dp[r][c].set(nextHealth, nextGold);
  };
  addState(0, 0, startHealth, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (const [health, gold] of dp[r][c]) {
        if (r + 1 < rows) addState(r + 1, c, health, gold);
        if (c + 1 < cols) addState(r, c + 1, health, gold);
      }
    }
  }
  let best = 0;
  for (const gold of dp[rows - 1][cols - 1].values()) best = Math.max(best, gold);
  return best;
}`,

  planExcavation: () => `function planExcavation(artifacts, dependencies, timeBudget) {
  const n = artifacts.length;
  const index = new Map(artifacts.map((artifact, i) => [artifact.id, i]));
  const prereq = Array(n).fill(0);
  for (const [artifactId, requiredId] of dependencies) {
    const a = index.get(artifactId);
    const b = index.get(requiredId);
    if (a != null && b != null) prereq[a] |= 1 << b;
  }
  if (n <= 24) {
    let best = 0;
    const totalMasks = 1 << n;
    for (let mask = 0; mask < totalMasks; mask++) {
      let cost = 0, value = 0, ok = true;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) {
        if ((mask & prereq[i]) !== prereq[i]) { ok = false; break; }
        cost += artifacts[i].difficulty;
        if (cost > timeBudget) { ok = false; break; }
        value += artifacts[i].value;
      }
      if (ok && value > best) best = value;
    }
    return best;
  }
  const order = artifacts.map((_, i) => i).sort((a, b) => artifacts[b].value / artifacts[b].difficulty - artifacts[a].value / artifacts[a].difficulty);
  let best = 0;
  const dfs = (pos, mask, cost, value) => {
    if (cost > timeBudget) return;
    best = Math.max(best, value);
    if (pos === order.length) return;
    const i = order[pos];
    dfs(pos + 1, mask, cost, value);
    if ((mask & prereq[i]) === prereq[i]) dfs(pos + 1, mask | (1 << i), cost + artifacts[i].difficulty, value + artifacts[i].value);
  };
  dfs(0, 0, 0, 0);
  return best;
}`,

  biotrip: () => `function biotrip(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const n = nums[at++], destination = nums[at++] - 1, leftLimit = nums[at++], rightLimit = nums[at++];
  const graph = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const m = nums[at++];
    for (let j = 0; j < m; j++) {
      graph[i].push({ to: nums[at++] - 1, time: nums[at++], angle: nums[at++] });
    }
  }
  const incomingHeadingAt = (node, from, fallback) => {
    const reverse = graph[node].find(edge => edge.to === from);
    return ((reverse?.angle ?? fallback) + 180) % 360;
  };
  const allowed = (incoming, outgoing) => {
    const left = (outgoing - incoming + 360) % 360;
    const right = (incoming - outgoing + 360) % 360;
    return left <= leftLimit || right <= rightLimit;
  };
  const heap = [[0, 0, -1, false]];
  const best = new Map([["0|-1|0", 0]]);
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const root = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return root;
  };
  while (heap.length) {
    const [cost, node, incoming, visited] = pop();
    const stateKey = node + "|" + incoming + "|" + (visited ? 1 : 0);
    if (cost !== best.get(stateKey)) continue;
    if (node === 0 && visited) return String(cost);
    for (const edge of graph[node]) {
      if (node !== 0 && incoming >= 0 && !allowed(incoming, edge.angle)) continue;
      const nextVisited = visited || edge.to === destination;
      const nextCost = cost + edge.time;
      const nextIncoming = incomingHeadingAt(edge.to, node, edge.angle);
      const nextKey = edge.to + "|" + nextIncoming + "|" + (nextVisited ? 1 : 0);
      if (nextCost < (best.get(nextKey) ?? Infinity)) {
        best.set(nextKey, nextCost);
        push([nextCost, edge.to, nextIncoming, nextVisited]);
      }
    }
  }
  return "impossible";
}`,

  followthebouncingball: () => `function followthebouncingball(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const width = nums[at++], height = nums[at++], ballCount = nums[at++], objectCount = nums[at++];
  const gunX = nums[at++], dirX = nums[at++], dirY = nums[at++];
  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    const p = nums[at++];
    const points = [];
    for (let j = 0; j < p; j++) points.push({ x: nums[at++], y: nums[at++] });
    objects.push({ points, value: nums[at++], removed: false });
  }
  const EPS = 1e-9;
  const GROUP_EPS = 1e-7;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const add = (a, b, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
  const reflect = (v, edge) => {
    const len2 = dot(edge, edge);
    const projectionScale = dot(v, edge) / len2;
    return { x: 2 * projectionScale * edge.x - v.x, y: 2 * projectionScale * edge.y - v.y };
  };
  const initialLen = Math.hypot(dirX, dirY);
  const initialVelocity = { x: dirX / initialLen, y: dirY / initialLen };
  const balls = Array.from({ length: ballCount }, (_, id) => ({
    id,
    alive: true,
    version: 0,
    time: id,
    p: { x: gunX, y: 0 },
    v: { ...initialVelocity }
  }));
  const heap = [];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].time <= item.time) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const root = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1].time < heap[c].time) c++;
        if (heap[c].time >= last.time) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return root;
  };
  const raySegment = (p, v, a, b) => {
    const s = sub(b, a);
    const den = cross(v, s);
    if (Math.abs(den) < EPS) return null;
    const ap = sub(a, p);
    const t = cross(ap, s) / den;
    const u = cross(ap, v) / den;
    if (t <= EPS || u < -1e-8 || u > 1 + 1e-8) return null;
    return { t, edge: s };
  };
  const schedule = (ball) => {
    if (!ball.alive) return;
    const p = ball.p, v = ball.v;
    let best = { t: Infinity, type: "exit" };
    const considerBoundary = (t, type) => {
      if (t > EPS && t < best.t) best = { t, type };
    };
    if (v.x < -EPS) considerBoundary((0 - p.x) / v.x, "wallX");
    if (v.x > EPS) considerBoundary((width - p.x) / v.x, "wallX");
    if (v.y > EPS) considerBoundary((height - p.y) / v.y, "wallY");
    if (v.y < -EPS) considerBoundary((0 - p.y) / v.y, "exit");
    for (let objectId = 0; objectId < objects.length; objectId++) {
      const object = objects[objectId];
      if (object.removed || object.value <= 0) continue;
      for (let i = 0; i < object.points.length; i++) {
        const a = object.points[i];
        const b = object.points[(i + 1) % object.points.length];
        const hit = raySegment(p, v, a, b);
        if (hit && hit.t < best.t - EPS) {
          best = { t: hit.t, type: "object", objectId, edge: hit.edge };
        }
      }
    }
    if (!Number.isFinite(best.t)) return;
    push({
      ...best,
      time: ball.time + best.t,
      ballId: ball.id,
      version: ball.version,
      point: add(ball.p, ball.v, best.t)
    });
  };
  for (const ball of balls) schedule(ball);
  const valid = (event) => {
    const ball = balls[event.ballId];
    return ball.alive && ball.version === event.version;
  };
  while (heap.length) {
    const event = pop();
    if (!valid(event)) continue;
    const ball = balls[event.ballId];
    if (event.type === "exit") {
      ball.alive = false;
      continue;
    }
    if (event.type === "wallX" || event.type === "wallY") {
      ball.time = event.time;
      ball.p = event.point;
      ball.v = event.type === "wallX" ? { x: -ball.v.x, y: ball.v.y } : { x: ball.v.x, y: -ball.v.y };
      ball.version += 1;
      schedule(ball);
      continue;
    }
    const object = objects[event.objectId];
    if (object.removed || object.value <= 0) {
      ball.time = event.time;
      ball.p = event.point;
      ball.version += 1;
      schedule(ball);
      continue;
    }
    const group = [event];
    const stash = [];
    while (heap.length && heap[0].time <= event.time + GROUP_EPS) {
      const next = pop();
      if (!valid(next)) continue;
      if (next.type === "object" && next.objectId === event.objectId) group.push(next);
      else stash.push(next);
    }
    for (const item of stash) push(item);
    object.value -= group.length;
    const removedNow = object.value <= 0;
    if (removedNow) object.removed = true;
    for (const hit of group) {
      const hitBall = balls[hit.ballId];
      hitBall.time = hit.time;
      hitBall.p = hit.point;
      if (!removedNow) hitBall.v = reflect(hitBall.v, hit.edge);
      hitBall.version += 1;
      schedule(hitBall);
    }
  }
  return objects.map(object => String(Math.max(0, object.value))).join(" ");
}`,

  minWarpLanes: () => `function minWarpLanes(routes) {
  const events = [];
  for (const [start, end] of routes) {
    events.push([start, 1]);
    events.push([end, -1]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, best = 0;
  for (const [, delta] of events) {
    active += delta;
    best = Math.max(best, active);
  }
  return best;
}`,

  findAlignment: () => `function findAlignment(cycles, startDay) {
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; };
  const egcd = (a, b) => b === 0 ? [a, 1, 0] : (([g, x, y]) => [g, y, x - Math.floor(a / b) * y])(egcd(b, a % b));
  let answer = 0, mod = 1;
  for (const cycle of cycles) {
    const nextMod = cycle.period;
    const nextAnswer = ((cycle.offset % nextMod) + nextMod) % nextMod;
    const g = gcd(mod, nextMod);
    if ((nextAnswer - answer) % g !== 0) return -1;
    const [, inv] = egcd(mod / g, nextMod / g);
    const step = ((((nextAnswer - answer) / g) * inv) % (nextMod / g) + (nextMod / g)) % (nextMod / g);
    answer += mod * step;
    mod = (mod / g) * nextMod;
    answer = ((answer % mod) + mod) % mod;
  }
  if (answer < startDay) answer += Math.ceil((startDay - answer) / mod) * mod;
  return answer;
}`,

  optimizeAntForaging: () => `function optimizeAntForaging(graph, foodSources, startNode, timeLimit) {
  const n = graph.length;
  const dist = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (i === j) return 0;
    const value = graph[i][j];
    return value == null || value < 0 ? Infinity : value;
  }));
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
  }
  const m = foodSources.length;
  if (m === 0) return 0;
  const size = 1 << m;
  const dp = Array.from({ length: size }, () => Array(m).fill(Infinity));
  for (let i = 0; i < m; i++) dp[1 << i][i] = dist[startNode][foodSources[i].node];
  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < m; last++) {
      const current = dp[mask][last];
      if (!Number.isFinite(current)) continue;
      for (let next = 0; next < m; next++) if (!(mask & (1 << next))) {
        const candidate = current + dist[foodSources[last].node][foodSources[next].node];
        const nextMask = mask | (1 << next);
        if (candidate < dp[nextMask][next]) dp[nextMask][next] = candidate;
      }
    }
  }
  const values = Array(size).fill(0);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    const i = Math.log2(bit);
    values[mask] = values[mask ^ bit] + foodSources[i].value;
  }
  let best = 0;
  for (let mask = 1; mask < size; mask++) {
    for (let last = 0; last < m; last++) {
      if (!(mask & (1 << last))) continue;
      const totalTime = dp[mask][last] + dist[foodSources[last].node][startNode];
      if (totalTime <= timeLimit) best = Math.max(best, values[mask]);
    }
  }
  return best;
}`,

  countBuildOrders: () => `function countBuildOrders(tasks, dependencies) {
  const n = tasks.length;
  const index = new Map(tasks.map((task, i) => [task, i]));
  const prereq = Array(n).fill(0);
  for (const [before, after] of dependencies) prereq[index.get(after)] |= 1 << index.get(before);
  const full = (1 << n) - 1;
  const memo = new Map([[full, 1]]);
  const dfs = (mask) => {
    if (memo.has(mask)) return memo.get(mask);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const bit = 1 << i;
      if ((mask & bit) === 0 && (prereq[i] & mask) === prereq[i]) total += dfs(mask | bit);
    }
    memo.set(mask, total);
    return total;
  };
  return dfs(0);
}`,

  minimizeMaxLoad: () => `function minimizeMaxLoad(shards, servers) {
  if (shards.length === 0) return 0;
  let low = Math.max(...shards);
  let high = shards.reduce((sum, value) => sum + value, 0);
  const needed = (limit) => {
    let groups = 1;
    let current = 0;
    for (const shard of shards) {
      if (current + shard <= limit) current += shard;
      else { groups += 1; current = shard; }
    }
    return groups;
  };
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (needed(mid) <= servers) high = mid;
    else low = mid + 1;
  }
  return low;
}`,

  countViralPeriods: () => `function countViralPeriods(engagement, baseline, minDuration) {
  let count = 0, run = 0;
  for (const value of engagement) {
    if (value > baseline) run += 1;
    else {
      if (run >= minDuration) count += 1;
      run = 0;
    }
  }
  if (run >= minDuration) count += 1;
  return count;
}`,

  calculateTrappedWater: () => `function calculateTrappedWater(heightMap) {
  const rows = heightMap.length;
  const cols = heightMap[0]?.length ?? 0;
  if (rows < 3 || cols < 3) return 0;
  const heap = [];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  };
  const pop = () => {
    const root = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c += 1;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c];
        i = c;
      }
      heap[i] = last;
    }
    return root;
  };
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (const c of [0, cols - 1]) {
      if (!seen[r][c]) {
        seen[r][c] = true;
        push([heightMap[r][c], r, c]);
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    for (const r of [0, rows - 1]) {
      if (!seen[r][c]) {
        seen[r][c] = true;
        push([heightMap[r][c], r, c]);
      }
    }
  }
  let water = 0;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (heap.length) {
    const [height, r, c] = pop();
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || seen[nr][nc]) continue;
      seen[nr][nc] = true;
      water += Math.max(0, height - heightMap[nr][nc]);
      push([Math.max(height, heightMap[nr][nc]), nr, nc]);
    }
  }
  return water;
}`,

  maxOnTimeInvoices: () => `function maxOnTimeInvoices(invoices) {
  invoices = invoices.slice().sort((a, b) => a.deadline - b.deadline);
  const heap = [];
  const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p] >= x) break; heap[i] = heap[p]; i = p; } heap[i] = x; };
  const pop = () => { const root = heap[0]; const last = heap.pop(); if (heap.length && last !== undefined) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1] > heap[c]) c += 1; if (heap[c] <= last) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return root; };
  let time = 0;
  for (const invoice of invoices) {
    time += invoice.time;
    push(invoice.time);
    if (time > invoice.deadline) time -= pop();
  }
  return heap.length;
}`,

  findAnomalyWindow: () => `function findAnomalyWindow(log, required) {
  const need = new Map(Object.entries(required));
  let missing = 0;
  for (const value of need.values()) missing += value;
  const have = new Map();
  let left = 0;
  let best = "";
  for (let right = 0; right < log.length; right++) {
    const ch = log[right];
    if (need.has(ch)) {
      const next = (have.get(ch) ?? 0) + 1;
      have.set(ch, next);
      if (next <= need.get(ch)) missing -= 1;
    }
    while (missing === 0) {
      const candidate = log.slice(left, right + 1);
      if (!best || candidate.length < best.length) best = candidate;
      const drop = log[left++];
      if (need.has(drop)) {
        const next = (have.get(drop) ?? 0) - 1;
        have.set(drop, next);
        if (next < need.get(drop)) missing += 1;
      }
    }
  }
  return best;
}`,

  shortestLogMerge: () => `function shortestLogMerge(fragments) {
  fragments = [...new Set(fragments)].sort();
  fragments = fragments.filter((fragment, i) => !fragments.some((other, j) => i !== j && other.includes(fragment)));
  const n = fragments.length;
  if (n === 0) return "";
  const overlap = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    const max = Math.min(fragments[i].length, fragments[j].length);
    for (let k = max; k >= 0; k--) {
      if (fragments[i].endsWith(fragments[j].slice(0, k))) { overlap[i][j] = k; break; }
    }
  }
  const dp = Array.from({ length: 1 << n }, () => Array(n).fill(null));
  for (let i = 0; i < n; i++) dp[1 << i][i] = fragments[i];
  const better = (a, b) => b == null || a.length < b.length || (a.length === b.length && a < b);
  for (let mask = 1; mask < (1 << n); mask++) {
    for (let last = 0; last < n; last++) {
      const cur = dp[mask][last];
      if (cur == null) continue;
      for (let next = 0; next < n; next++) {
        if (mask & (1 << next)) continue;
        const candidate = cur + fragments[next].slice(overlap[last][next]);
        const nextMask = mask | (1 << next);
        if (better(candidate, dp[nextMask][next])) dp[nextMask][next] = candidate;
      }
    }
  }
  return dp[(1 << n) - 1].filter(Boolean).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}`,

  optimizeMarsSupplyFlow: () => `function optimizeMarsSupplyFlow(depots, routes, habitat) {
  const ids = new Set([habitat]);
  for (const depot of depots) ids.add(depot.id);
  for (const [a, b] of routes) { ids.add(a); ids.add(b); }
  const source = "__source__";
  ids.add(source);
  const nodes = [...ids];
  const index = new Map(nodes.map((id, i) => [id, i]));
  const graph = Array.from({ length: nodes.length }, () => []);
  const add = (u, v, cap) => {
    const a = { to: v, rev: graph[v].length, cap };
    const b = { to: u, rev: graph[u].length, cap: 0 };
    graph[u].push(a); graph[v].push(b);
  };
  const s = index.get(source), t = index.get(habitat);
  for (const depot of depots) add(s, index.get(depot.id), depot.capacity);
  for (const [a, b, cap] of routes) add(index.get(a), index.get(b), cap);
  let flow = 0;
  while (true) {
    const parent = Array(nodes.length).fill(null);
    const q = [s];
    parent[s] = [-1, -1];
    for (let qi = 0; qi < q.length && parent[t] == null; qi++) {
      const u = q[qi];
      for (let ei = 0; ei < graph[u].length; ei++) {
        const e = graph[u][ei];
        if (e.cap > 0 && parent[e.to] == null) {
          parent[e.to] = [u, ei];
          q.push(e.to);
        }
      }
    }
    if (parent[t] == null) break;
    let addFlow = Infinity;
    for (let v = t; v !== s;) {
      const [u, ei] = parent[v];
      addFlow = Math.min(addFlow, graph[u][ei].cap);
      v = u;
    }
    for (let v = t; v !== s;) {
      const [u, ei] = parent[v];
      const e = graph[u][ei];
      e.cap -= addFlow;
      graph[v][e.rev].cap += addFlow;
      v = u;
    }
    flow += addFlow;
  }
  return flow;
}`,

  minNoteDeletions: () => `function minNoteDeletions(notes) {
  const n = notes.length;
  const dp = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    dp[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      dp[i][j] = notes[i] === notes[j] ? dp[i + 1][j - 1] + 2 : Math.max(dp[i + 1][j], dp[i][j - 1]);
    }
  }
  return n - (n ? dp[0][n - 1] : 0);
}`,

  shortestPortalPath: () => `function shortestPortalPath(grid) {
  const rows = grid.length, cols = grid[0].length;
  const portals = new Map();
  let start, end;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = grid[r][c];
    if (ch === "S") start = [r, c];
    else if (ch === "E") end = [r, c];
    else if (/[A-Z]/.test(ch)) {
      if (!portals.has(ch)) portals.set(ch, []);
      portals.get(ch).push([r, c]);
    }
  }
  const q = [[start[0], start[1], 0]];
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  seen[start[0]][start[1]] = true;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let qi = 0; qi < q.length; qi++) {
    const [r, c, d] = q[qi];
    if (r === end[0] && c === end[1]) return d;
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === "#" || seen[nr][nc]) continue;
      const ch = grid[nr][nc];
      if (/[A-Z]/.test(ch) && ch !== "S" && ch !== "E") {
        const pair = portals.get(ch);
        if (pair && pair.length === 2) {
          const other = pair[0][0] === nr && pair[0][1] === nc ? pair[1] : pair[0];
          nr = other[0]; nc = other[1];
        }
      }
      if (!seen[nr][nc]) {
        seen[nr][nc] = true;
        q.push([nr, nc, d + 1]);
      }
    }
  }
  return -1;
}`,

  maxProjectProfit: () => `function maxProjectProfit(projects, k) {
  projects = projects.slice().sort((a, b) => a.end - b.end || a.start - b.start);
  const n = projects.length;
  const ends = projects.map((project) => project.end);
  const prev = Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let lo = 0, hi = i - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ends[mid] <= projects[i].start) { ans = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    prev[i] = ans;
  }
  const dp = Array.from({ length: n + 1 }, () => Array(k + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    const project = projects[i - 1];
    for (let used = 1; used <= k; used++) {
      dp[i][used] = Math.max(dp[i - 1][used], dp[prev[i - 1] + 1][used - 1] + project.profit);
    }
  }
  return dp[n][k];
}`,

  maxRevenueWindow: () => `function maxRevenueWindow(revenues, minLen, maxLen) {
  const prefix = [0];
  for (const value of revenues) prefix.push(prefix[prefix.length - 1] + value);
  const deque = [];
  let best = -Infinity;
  for (let right = minLen; right < prefix.length; right++) {
    const add = right - minLen;
    while (deque.length && prefix[deque[deque.length - 1]] >= prefix[add]) deque.pop();
    deque.push(add);
    const minAllowed = right - maxLen;
    while (deque.length && deque[0] < minAllowed) deque.shift();
    best = Math.max(best, prefix[right] - prefix[deque[0]]);
  }
  return best;
}`,

  calculateTerraceWater: () => `function calculateTerraceWater(heights) {
  let left = 0, right = heights.length - 1, leftMax = 0, rightMax = 0, water = 0;
  while (left < right) {
    if (heights[left] < heights[right]) {
      leftMax = Math.max(leftMax, heights[left]);
      water += leftMax - heights[left];
      left += 1;
    } else {
      rightMax = Math.max(rightMax, heights[right]);
      water += rightMax - heights[right];
      right -= 1;
    }
  }
  return water;
}`,

  minTollCost: () => `function minTollCost(n, edges, k, start, end) {
  const graph = Array.from({ length: n }, () => []);
  for (const [a, b, cost] of edges) graph[a].push([b, cost]);
  const dist = Array.from({ length: n }, () => Array(k + 1).fill(Infinity));
  const heap = [[0, start, 0]];
  dist[start][0] = 0;
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const root = heap[0]; const last = heap.pop(); if (heap.length && last) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return root; };
  while (heap.length) {
    const [cost, node, used] = pop();
    if (cost !== dist[node][used]) continue;
    if (node === end) return cost;
    for (const [next, toll] of graph[node]) {
      if (cost + toll < dist[next][used]) { dist[next][used] = cost + toll; push([cost + toll, next, used]); }
      if (used < k && cost < dist[next][used + 1]) { dist[next][used + 1] = cost; push([cost, next, used + 1]); }
    }
  }
  return -1;
}`,

  planMetroJourney: () => `function planMetroJourney(network, start, destination, blacklist, transferPenalty) {
  const blocked = new Set(blacklist);
  if (blocked.has(start) || blocked.has(destination)) return -1;
  const heap = [[0, 0, start, null, 0]];
  const best = new Map();
  const key = (station, line, transfers) => station + "|" + line + "|" + transfers;
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const root = heap[0]; const last = heap.pop(); if (heap.length && last) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return root; };
  while (heap.length) {
    const [score, time, station, line, transfers] = pop();
    const stateKey = key(station, line, transfers);
    if ((best.get(stateKey) ?? Infinity) < time) continue;
    if (station === destination) return score;
    for (const [next, travelTime, nextLine] of network[station] ?? []) {
      if (blocked.has(next)) continue;
      const nextTransfers = line == null || line === nextLine ? transfers : transfers + 1;
      const nextTime = time + travelTime;
      const nextScore = nextTime + transferPenalty * nextTransfers * nextTransfers;
      const nextKey = key(next, nextLine, nextTransfers);
      if (nextTime < (best.get(nextKey) ?? Infinity)) {
        best.set(nextKey, nextTime);
        push([nextScore, nextTime, next, nextLine, nextTransfers]);
      }
    }
  }
  return -1;
}`,

  abridgedreading: () => `function abridgedreading(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const n = nums[at++], m = nums[at++];
  const pages = [0];
  for (let i = 0; i < n; i++) pages.push(nums[at++]);
  const parent = Array(n + 1).fill(0);
  const out = Array(n + 1).fill(0);
  for (let i = 0; i < m; i++) {
    const a = nums[at++], b = nums[at++];
    parent[b] = a;
    out[a] += 1;
  }
  const sinks = [];
  for (let i = 1; i <= n; i++) if (out[i] === 0) sinks.push(i);
  const chains = new Map();
  const chainFor = (x) => {
    if (chains.has(x)) return chains.get(x);
    const set = new Set();
    let cur = x;
    while (cur) { set.add(cur); cur = parent[cur]; }
    chains.set(x, set);
    return set;
  };
  let best = Infinity;
  for (let i = 0; i < sinks.length; i++) {
    for (let j = i + 1; j < sinks.length; j++) {
      const union = new Set([...chainFor(sinks[i]), ...chainFor(sinks[j])]);
      let total = 0;
      for (const chapter of union) total += pages[chapter];
      best = Math.min(best, total);
    }
  }
  return String(best);
}`,

  stabletable: () => `function stabletable(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const h = nums[at++], w = nums[at++];
  const grid = Array.from({ length: h }, () => Array(w));
  const pieces = new Set();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { grid[r][c] = nums[at++]; pieces.add(grid[r][c]); }
  const ids = [...pieces];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const top = [...new Set(grid[0])];
  const floor = [...new Set(grid[h - 1])];
  const n = ids.length;
  const adj = Array.from({ length: n }, () => new Set());
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w; c++) {
      const upper = grid[r][c], lower = grid[r + 1][c];
      if (upper !== lower) adj[idx.get(lower)].add(idx.get(upper));
    }
  }
  const distFrom = (sources) => {
    const dist = Array(n).fill(Infinity);
    const q = [];
    for (const id of sources) { const i = idx.get(id); dist[i] = 1; q.push(i); }
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (const v of adj[u]) if (dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; q.push(v); }
    }
    return dist;
  };
  const reverse = Array.from({ length: n }, () => new Set());
  for (let u = 0; u < n; u++) for (const v of adj[u]) reverse[v].add(u);
  const distTo = (targetId) => {
    const target = idx.get(targetId);
    const dist = Array(n).fill(Infinity);
    const q = [target]; dist[target] = 1;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi];
      for (const v of reverse[u]) if (dist[v] > dist[u] + 1) { dist[v] = dist[u] + 1; q.push(v); }
    }
    return dist;
  };
  if (top.length === 1) return String(distFrom(floor)[idx.get(top[0])]);
  const sdist = distFrom(floor);
  const d1 = distTo(top[0]), d2 = distTo(top[1]);
  let best = sdist[idx.get(top[0])] + sdist[idx.get(top[1])];
  for (let b = 0; b < n; b++) {
    if (Number.isFinite(sdist[b]) && Number.isFinite(d1[b]) && Number.isFinite(d2[b])) {
      best = Math.min(best, sdist[b] + d1[b] + d2[b] - 2);
    }
  }
  return String(best);
}`,

  tombhater: () => `function tombhater(input) {
  const lines = input.trim().split(/\\n/).map(line => line.trim()).filter(Boolean);
  const [r, c, w] = lines[0].split(/\\s+/).map(Number);
  const grid = [];
  for (let i = 0; i < r; i++) grid.push(lines[1 + i].split(/\\s+/));
  const words = lines.slice(1 + r, 1 + r + w);
  const nodes = [{ next: Object.create(null), end: false }];
  for (const word of words) {
    let node = 0;
    for (const ch of word) {
      if (nodes[node].next[ch] == null) { nodes[node].next[ch] = nodes.length; nodes.push({ next: Object.create(null), end: false }); }
      node = nodes[node].next[ch];
    }
    nodes[node].end = true;
  }
  const id = (row, col) => row * c + col;
  const q = [];
  for (let col = 0; col < c; col++) {
    const node = nodes[0].next[grid[0][col]];
    if (node != null) q.push([0, col, node, 1n << BigInt(id(0, col)), 1]);
  }
  const seen = new Set();
  const dirs = [[1,0],[0,-1],[0,1]];
  for (let qi = 0; qi < q.length; qi++) {
    const [row, col, node, mask, len] = q[qi];
    if (row === r - 1 && nodes[node].end) return String(len);
    const key = row + "," + col + "," + node + "," + mask;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const [dr, dc] of dirs) {
      const nr = row + dr, nc = col + dc;
      if (nr < 0 || nr >= r || nc < 0 || nc >= c) continue;
      const bit = 1n << BigInt(id(nr, nc));
      if (mask & bit) continue;
      const ch = grid[nr][nc];
      const nexts = [];
      if (nodes[node].next[ch] != null) nexts.push(nodes[node].next[ch]);
      if (nodes[node].end && nodes[0].next[ch] != null) nexts.push(nodes[0].next[ch]);
      for (const next of nexts) q.push([nr, nc, next, mask | bit, len + 1]);
    }
  }
  return "impossible";
}`,

  walkinthewoods: () => `function walkinthewoods(input) {
  const tokens = input.trim().split(/\\s+/);
  let at = 0;
  const n = Number(tokens[at++]), m = Number(tokens[at++]);
  const points = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
  for (let i = 0; i < n; i++) points[i] = { x: Number(tokens[at++]), y: Number(tokens[at++]) };
  const edges = [];
  const adj = Array.from({ length: n }, () => []);
  const dirBetween = (a, b) => {
    if (points[b].x > points[a].x) return "E";
    if (points[b].x < points[a].x) return "W";
    if (points[b].y > points[a].y) return "N";
    return "S";
  };
  for (let id = 0; id < m; id++) {
    const a = Number(tokens[at++]) - 1, b = Number(tokens[at++]) - 1, rem = Number(tokens[at++]);
    const edge = { a, b, rem };
    edges.push(edge);
    adj[a].push({ to: b, id, dir: dirBetween(a, b) });
    adj[b].push({ to: a, id, dir: dirBetween(b, a) });
  }
  let current = Number(tokens[at++]) - 1;
  let heading = tokens[at++];
  const first = adj[current].find(e => e.dir === heading && edges[e.id].rem > 0);
  let incoming = -1;
  const take = (move) => {
    const edge = edges[move.id];
    edge.rem -= 1;
    const removed = edge.rem === 0;
    current = move.to;
    heading = move.dir;
    incoming = move.id;
    return removed;
  };
  take(first);
  const relRank = (dir) => {
    const leftOf = { N: "W", W: "S", S: "E", E: "N" };
    const rightOf = { N: "E", E: "S", S: "W", W: "N" };
    if (dir === leftOf[heading]) return 3;
    if (dir === heading) return 2;
    if (dir === rightOf[heading]) return 1;
    return 0;
  };
  let history = [];
  let seen = new Map();
  while (true) {
    const state = current + "|" + incoming + "|" + heading;
    if (seen.has(state)) {
      const start = seen.get(state);
      const counts = new Map();
      for (let i = start; i < history.length; i++) counts.set(history[i], (counts.get(history[i]) ?? 0) + 1);
      let skip = Infinity;
      for (const [id, count] of counts) skip = Math.min(skip, Math.floor(edges[id].rem / count));
      if (Number.isFinite(skip) && skip > 0) {
        for (const [id, count] of counts) edges[id].rem -= count * skip;
        history = [];
        seen = new Map();
        continue;
      }
    } else {
      seen.set(state, history.length);
    }
    const options = adj[current].filter(e => e.id !== incoming && edges[e.id].rem > 0);
    if (options.length === 0) return points[current].x + " " + points[current].y;
    options.sort((a, b) => relRank(b.dir) - relRank(a.dir));
    const move = options.length === 3 ? options[1] : options[0];
    history.push(move.id);
    if (take(move)) {
      history = [];
      seen = new Map();
    }
  }
}`,

  pearls: () => `function pearls(input) {
  const lines = input.trim().split(/\\n/).map(line => line.trim()).filter(Boolean);
  const [k, rows, cols] = lines[0].split(/\\s+/).map(Number);
  const necklace = lines[1];
  const [startR, startC] = lines[2].split(/\\s+/).map(Number);
  const order = [
    ["E", 0, 1],
    ["N", -1, 0],
    ["S", 1, 0],
    ["W", 0, -1]
  ];
  const cells = [{ r: startR, c: startC }];
  const dirs = [];
  const used = new Set([startR + "," + startC]);
  const isCorner = (i) => dirs[(i - 1 + k) % k] !== dirs[i];
  const validPearl = (i) => {
    const ch = necklace[i];
    if (ch === ".") return true;
    const corner = isCorner(i);
    const before = isCorner((i - 1 + k) % k);
    const after = isCorner((i + 1) % k);
    if (ch === "B") return corner && !before && !after;
    return !corner && (before || after);
  };
  const canClose = (r, c, remaining) => {
    const distance = Math.abs(r - startR) + Math.abs(c - startC);
    return distance <= remaining && (remaining - distance) % 2 === 0;
  };
  const dfs = (step) => {
    const here = cells[step];
    if (!canClose(here.r, here.c, k - step)) return null;
    if (step >= 3 && !validPearl(step - 2)) return null;
    if (step === k) {
      if (here.r !== startR || here.c !== startC) return null;
      for (let i = 0; i < k; i++) if (!validPearl(i)) return null;
      return dirs.join("");
    }
    for (const [ch, dr, dc] of order) {
      const nr = here.r + dr, nc = here.c + dc;
      const key = nr + "," + nc;
      const finalMove = step === k - 1;
      if (nr < 1 || nr > rows || nc < 1 || nc > cols) continue;
      if (finalMove) {
        if (nr !== startR || nc !== startC) continue;
      } else if (used.has(key)) {
        continue;
      }
      dirs[step] = ch;
      cells[step + 1] = { r: nr, c: nc };
      if (!finalMove) used.add(key);
      const result = dfs(step + 1);
      if (result != null) return result;
      if (!finalMove) used.delete(key);
      dirs.pop();
      cells.pop();
    }
    return null;
  };
  return dfs(0) ?? "impossible";
}`,

  allinthefamily: () => `function allinthefamily(input) {
  const lines = input.trim().split(/\\n/).map(line => line.trim()).filter(Boolean);
  const [n, q] = lines[0].split(/\\s+/).map(Number);
  const parent = new Map();
  const people = new Set();
  for (let i = 1; i <= n; i++) {
    const parts = lines[i].split(/\\s+/);
    const p = parts[0];
    const count = Number(parts[1]);
    people.add(p);
    for (let j = 0; j < count; j++) {
      const child = parts[2 + j];
      parent.set(child, p);
      people.add(child);
    }
  }
  const ordinal = (x) => {
    const mod100 = x % 100;
    if (mod100 >= 11 && mod100 <= 13) return x + "th";
    if (x % 10 === 1) return x + "st";
    if (x % 10 === 2) return x + "nd";
    if (x % 10 === 3) return x + "rd";
    return x + "th";
  };
  const descendant = (name, ancestor, generations) => {
    if (generations === 1) return name + " is the child of " + ancestor;
    if (generations === 2) return name + " is the grandchild of " + ancestor;
    return name + " is the " + "great ".repeat(generations - 2) + "grandchild of " + ancestor;
  };
  const relationship = (aName, bName) => {
    const aAncestors = new Map();
    let cur = aName, dist = 0;
    while (cur != null) {
      aAncestors.set(cur, dist++);
      cur = parent.get(cur);
    }
    cur = bName;
    let bDist = 0;
    while (cur != null && !aAncestors.has(cur)) {
      cur = parent.get(cur);
      bDist++;
    }
    const aDist = aAncestors.get(cur);
    if (aDist === 0 && bDist === 0) return aName + " and " + bName + " are siblings";
    if (aDist === 0) return descendant(bName, aName, bDist);
    if (bDist === 0) return descendant(aName, bName, aDist);
    if (aDist === 1 && bDist === 1) return aName + " and " + bName + " are siblings";
    const cousin = Math.min(aDist, bDist) - 1;
    const removed = Math.abs(aDist - bDist);
    let result = aName + " and " + bName + " are " + ordinal(cousin) + " cousins";
    if (removed > 0) result += ", " + removed + " " + (removed === 1 ? "time" : "times") + " removed";
    return result;
  };
  const out = [];
  for (let i = n + 1; i <= n + q; i++) {
    const [a, b] = lines[i].split(/\\s+/);
    out.push(relationship(a, b));
  }
  return out.join("\\n");
}`,

  overthehill2: () => `function overthehill2(input) {
  const lines = input.replace(/\\r/g, "").split("\\n");
  const n = Number(lines[0].trim());
  const plain = lines[1] ?? "";
  const cipher = lines[2] ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
  const value = (ch) => alphabet.indexOf(ch);
  if (plain.length !== cipher.length || plain.length % n !== 0) return "No solution";
  const blocks = plain.length / n;
  const a = [];
  for (let b = 0; b < blocks; b++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      const v = value(plain[b * n + j]);
      if (v < 0) return "No solution";
      row.push(v);
    }
    a.push(row);
  }
  const modPow = (x, e) => {
    let result = 1;
    x = ((x % 37) + 37) % 37;
    while (e > 0) {
      if (e & 1) result = (result * x) % 37;
      x = (x * x) % 37;
      e >>= 1;
    }
    return result;
  };
  const solveRow = (rhs) => {
    const mat = a.map((row, i) => [...row, rhs[i]]);
    const where = Array(n).fill(-1);
    let rank = 0;
    for (let col = 0; col < n && rank < blocks; col++) {
      let pivot = rank;
      while (pivot < blocks && mat[pivot][col] % 37 === 0) pivot++;
      if (pivot === blocks) continue;
      [mat[rank], mat[pivot]] = [mat[pivot], mat[rank]];
      const inv = modPow(mat[rank][col], 35);
      for (let j = col; j <= n; j++) mat[rank][j] = (mat[rank][j] * inv) % 37;
      for (let i = 0; i < blocks; i++) {
        if (i === rank || mat[i][col] % 37 === 0) continue;
        const factor = mat[i][col] % 37;
        for (let j = col; j <= n; j++) mat[i][j] = ((mat[i][j] - factor * mat[rank][j]) % 37 + 37) % 37;
      }
      where[col] = rank++;
    }
    for (let i = 0; i < blocks; i++) {
      let allZero = true;
      for (let j = 0; j < n; j++) if (mat[i][j] % 37 !== 0) allZero = false;
      if (allZero && mat[i][n] % 37 !== 0) return { status: "none" };
    }
    if (where.some(x => x < 0)) return { status: "many" };
    const solution = Array(n).fill(0);
    for (let j = 0; j < n; j++) solution[j] = mat[where[j]][n] % 37;
    return { status: "one", solution };
  };
  const rows = [];
  let many = false;
  for (let r = 0; r < n; r++) {
    const rhs = [];
    for (let b = 0; b < blocks; b++) {
      const v = value(cipher[b * n + r]);
      if (v < 0) return "No solution";
      rhs.push(v);
    }
    const solved = solveRow(rhs);
    if (solved.status === "none") return "No solution";
    if (solved.status === "many") many = true;
    rows.push(solved.solution);
  }
  if (many) return "Too many solutions";
  return rows.map(row => row.join(" ")).join("\\n");
}`,

  scholarslawn: () => `function scholarslawn(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const n = nums[at++];
  const segs = [];
  for (let i = 0; i < n; i++) segs.push({ a: { x: nums[at++], y: nums[at++] }, b: { x: nums[at++], y: nums[at++] }, pts: [] });
  const student = { x: nums[at++], y: nums[at++], v: nums[at++] };
  const fellow = { a: { x: nums[at++], y: nums[at++] }, b: { x: nums[at++], y: nums[at++] }, v: nums[at++] };
  const eps = 1e-8;
  const sub = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });
  const cross = (p, q) => p.x * q.y - p.y * q.x;
  const dot = (p, q) => p.x * q.x + p.y * q.y;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const onSegment = (p, s) => Math.abs(cross(sub(s.b, s.a), sub(p, s.a))) < 1e-7 &&
    dot(sub(p, s.a), sub(p, s.b)) <= 1e-7;
  const intersection = (s1, s2) => {
    const p = s1.a, r = sub(s1.b, s1.a), q = s2.a, sv = sub(s2.b, s2.a);
    const den = cross(r, sv);
    if (Math.abs(den) < eps) return null;
    const qp = sub(q, p);
    const t = cross(qp, sv) / den;
    const u = cross(qp, r) / den;
    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
    return { x: p.x + r.x * t, y: p.y + r.y * t };
  };
  const nodes = [];
  const ids = new Map();
  const key = (p) => p.x.toFixed(8) + "," + p.y.toFixed(8);
  const idFor = (p) => {
    const k = key(p);
    if (!ids.has(k)) ids.set(k, nodes.push({ x: p.x, y: p.y }) - 1);
    return ids.get(k);
  };
  const addToSeg = (i, p) => {
    const id = idFor(p);
    if (!segs[i].pts.includes(id)) segs[i].pts.push(id);
    return id;
  };
  let studentId = idFor(student);
  const fellowSeg = { a: fellow.a, b: fellow.b };
  const fellowNodes = new Set();
  for (let i = 0; i < n; i++) {
    addToSeg(i, segs[i].a);
    addToSeg(i, segs[i].b);
    if (onSegment(student, segs[i])) {
      studentId = addToSeg(i, student);
    }
    const p = intersection(segs[i], fellowSeg);
    if (p) fellowNodes.add(addToSeg(i, p));
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const p = intersection(segs[i], segs[j]);
      if (p) {
        addToSeg(i, p);
        addToSeg(j, p);
      }
    }
  }
  const graph = Array.from({ length: nodes.length }, () => []);
  for (const seg of segs) {
    const direction = sub(seg.b, seg.a);
    seg.pts.sort((u, v) => dot(sub(nodes[u], seg.a), direction) - dot(sub(nodes[v], seg.a), direction));
    for (let i = 1; i < seg.pts.length; i++) {
      const a = seg.pts[i - 1], b = seg.pts[i];
      const w = dist(nodes[a], nodes[b]);
      graph[a].push([b, w]);
      graph[b].push([a, w]);
    }
  }
  const heap = [[0, studentId]];
  const best = Array(nodes.length).fill(Infinity);
  best[studentId] = 0;
  const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; } heap[i] = item; };
  const pop = () => { const root = heap[0]; const last = heap.pop(); if (heap.length && last) { let i = 0; while (true) { let c = i * 2 + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= last[0]) break; heap[i] = heap[c]; i = c; } heap[i] = last; } return root; };
  while (heap.length) {
    const [d, u] = pop();
    if (d > best[u] + eps) continue;
    for (const [v, w] of graph[u]) {
      if (d + w + eps < best[v]) {
        best[v] = d + w;
        push([best[v], v]);
      }
    }
  }
  let answer = Infinity;
  for (const id of fellowNodes) {
    const p = nodes[id];
    const fellowTime = dist(fellow.a, p) / fellow.v;
    if (best[id] / student.v <= fellowTime + 1e-7) answer = Math.min(answer, fellowTime);
  }
  return Number.isFinite(answer) ? answer.toFixed(8) : "Impossible";
}`,

  twochartsbecomeone: () => `function twochartsbecomeone(input) {
  const lines = input.trim().split(/\\n/).map(line => line.trim()).filter(Boolean);
  const parse = (s) => {
    let i = 0;
    const skip = () => { while (/\\s/.test(s[i] ?? "")) i++; };
    const node = () => {
      skip();
      let num = "";
      while (/\\d/.test(s[i] ?? "")) num += s[i++];
      const children = [];
      skip();
      while (s[i] === "(") {
        i++;
        children.push(node());
        skip();
        if (s[i] === ")") i++;
        skip();
      }
      children.sort();
      return num + "(" + children.join("") + ")";
    };
    return node();
  };
  return parse(lines[0]) === parse(lines[1]) ? "Yes" : "No";
}`,

  whichwarehouse: () => `function whichwarehouse(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const n = nums[at++], p = nums[at++];
  const amount = Array.from({ length: n }, () => Array(p));
  for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) amount[i][j] = nums[at++];
  const dist = Array.from({ length: n }, () => Array(n));
  for (let to = 0; to < n; to++) for (let from = 0; from < n; from++) {
    const v = nums[at++];
    dist[from][to] = v < 0 ? Infinity : v;
  }
  for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];
  }
  const cost = Array.from({ length: p }, () => Array(n).fill(0));
  for (let prod = 0; prod < p; prod++) for (let wh = 0; wh < n; wh++) {
    for (let from = 0; from < n; from++) cost[prod][wh] += amount[from][prod] * dist[from][wh];
  }
  const rows = p, cols = n;
  const u = Array(rows + 1).fill(0);
  const v = Array(cols + 1).fill(0);
  const matchCol = Array(cols + 1).fill(0);
  const way = Array(cols + 1).fill(0);
  for (let i = 1; i <= rows; i++) {
    matchCol[0] = i;
    let j0 = 0;
    const minv = Array(cols + 1).fill(Infinity);
    const used = Array(cols + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = matchCol[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= cols; j++) if (!used[j]) {
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) { u[matchCol[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (matchCol[j0] !== 0);
    do {
      const j1 = way[j0];
      matchCol[j0] = matchCol[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  let answer = 0;
  for (let j = 1; j <= cols; j++) {
    const prod = matchCol[j];
    if (prod > 0) answer += cost[prod - 1][j - 1];
  }
  return String(answer);
}`,

  balancingart: () => `function balancingart(input) {
  const nums = input.trim().split(/\\s+/).map(Number);
  let at = 0;
  const n = nums[at++], m = nums[at++];
  const edges = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const a = nums[at++] - 1, b = nums[at++] - 1, w = nums[at++];
    edges.push([a, b, w]);
    total += w;
  }
  const feasible = (balance) => {
    const source = n + m, sink = source + 1;
    const graph = Array.from({ length: sink + 1 }, () => []);
    const add = (u, v, cap) => { const a = { to: v, rev: graph[v].length, cap }; const b = { to: u, rev: graph[u].length, cap: 0 }; graph[u].push(a); graph[v].push(b); };
    for (let i = 0; i < m; i++) {
      const node = n + i;
      const [a, b, w] = edges[i];
      add(source, node, w);
      add(node, a, w);
      add(node, b, w);
    }
    for (let i = 0; i < n; i++) add(i, sink, balance);
    let flow = 0;
    while (true) {
      const parent = Array(sink + 1).fill(null);
      const q = [source];
      parent[source] = [-1, -1];
      for (let qi = 0; qi < q.length && parent[sink] == null; qi++) {
        const u = q[qi];
        for (let ei = 0; ei < graph[u].length; ei++) {
          const e = graph[u][ei];
          if (e.cap > 0 && parent[e.to] == null) { parent[e.to] = [u, ei]; q.push(e.to); }
        }
      }
      if (parent[sink] == null) break;
      let aug = Infinity;
      for (let v = sink; v !== source;) { const [u, ei] = parent[v]; aug = Math.min(aug, graph[u][ei].cap); v = u; }
      for (let v = sink; v !== source;) { const [u, ei] = parent[v]; const e = graph[u][ei]; e.cap -= aug; graph[v][e.rev].cap += aug; v = u; }
      flow += aug;
    }
    return flow === balance * n;
  };
  let lo = 0, hi = Math.floor(total / n), best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (feasible(mid)) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return String(total - best * n);
}`,

  marchingorders: () => `function marchingorders(input) {
  const [nLine, orderLine] = input.trim().split(/\\s+/);
  const n = Number(nLine);
  const order = orderLine.trim();
  const remaining = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  let a = 0n, mod = 1n;
  const egcd = (x, y) => y === 0n ? [x, 1n, 0n] : (([g, s, t]) => [g, t, s - (x / y) * t])(egcd(y, x % y));
  const crt = (r, m) => {
    const [g, x] = egcd(mod, m);
    const diff = r - a;
    if (diff % g !== 0n) return false;
    const lcm = (mod / g) * m;
    const step = (((diff / g) * x) % (m / g) + (m / g)) % (m / g);
    a = (a + mod * step) % lcm;
    if (a < 0n) a += lcm;
    mod = lcm;
    return true;
  };
  for (const ch of order) {
    const k = BigInt(remaining.length);
    const index = remaining.indexOf(ch);
    if (index < 0 || !crt(BigInt(index), k)) return "NO";
    remaining.splice(index, 1);
  }
  return "YES\\n" + a.toString();
}`
};

export function solveKnownProblem(problem: CheetProblem): SolvedProblem {
  const functionName = extractFunctionName(problem.signature);
  const factory = functionName ? SOLVERS[functionName] : undefined;
  const code = factory ? factory(problem) : problem.starterCode;

  return {
    problemId: problem.id,
    title: problem.title,
    signature: problem.signature,
    known: Boolean(factory),
    source: factory ? "catalog" : "starter",
    code
  };
}

export function extractFunctionName(signature: string): string | undefined {
  return signature.match(/function\s+([A-Za-z_$][\w$]*)/)?.[1];
}
