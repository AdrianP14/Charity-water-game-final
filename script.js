(() => {
  "use strict";

  const DROP_POINTS = 10;
  const TRASH_PENALTY = 5;
  const PLAYER_X = 0.13;
  const MODES = {
    easy: { duration: 40, target: 60, lives: 4, spawnInterval: 1.2, speedMultiplier: 0.9 },
    normal: { duration: 30, target: 100, lives: 3, spawnInterval: 1.05, speedMultiplier: 1 },
    hard: { duration: 24, target: 120, lives: 2, spawnInterval: 0.82, speedMultiplier: 1.2 }
  };
  const MILESTONES = [
    { progress: 0.25, message: "A strong start!" },
    { progress: 0.5, message: "Halfway there!" },
    { progress: 0.75, message: "Almost to the goal!" }
  ];
  const player = document.getElementById("player");
  const area = document.getElementById("game-area");
  const entityLayer = document.getElementById("entity-layer");
  const scoreDisplay = document.getElementById("score");
  const timeDisplay = document.getElementById("time");
  const goalDisplay = document.getElementById("goal");
  const heartsDisplay = document.getElementById("hearts");
  const meter = document.getElementById("meter");
  const meterFill = document.getElementById("meter-fill");
  const meterValue = document.getElementById("meter-value");
  const startScreen = document.getElementById("start-screen");
  const endScreen = document.getElementById("end-screen");
  const resetButton = document.getElementById("reset-button");
  const celebration = document.getElementById("celebration");
  const toast = document.getElementById("toast");
  const changeDifficultyButton = document.getElementById("change-difficulty-button");

  let running = false;
  let animationFrame = 0;
  let lastFrameTime = 0;
  let elapsed = 0;
  let score = 0;
  let dropsCollected = 0;
  let currentMode = MODES.normal;
  let lives = currentMode.lives;
  let cleanliness = 0;
  let playerY = 0.5;
  let verticalSpeed = 0;
  let spawnElapsed = 0;
  let powerElapsed = 0;
  let invulnerableUntil = 0;
  let toastTimeout = 0;
  let audioContext;
  let milestonesReached = new Set();
  let entities = [];
  let nextEntityId = 0;

  function playTone(startFrequency, endFrequency, duration, startAt, waveform = "sine", volume = 0.06) {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(startFrequency, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.01);
  }

  function playSound(type) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!audioContext) audioContext = new AudioContext();
      if (audioContext.state === "suspended") void audioContext.resume();
    } catch {
      return;
    }

    const now = audioContext.currentTime;
    if (type === "click") {
      playTone(560, 420, 0.055, now, "triangle", 0.035);
    } else if (type === "collect") {
      playTone(660, 880, 0.12, now);
      playTone(880, 1120, 0.14, now + 0.07);
    } else if (type === "miss") {
      playTone(320, 170, 0.2, now, "triangle", 0.045);
    } else if (type === "win") {
      [523, 659, 784, 1047].forEach((frequency, index) => {
        playTone(frequency, frequency * 1.04, 0.18, now + index * 0.11, "sine", 0.07);
      });
    }
  }

  function updateHud() {
    scoreDisplay.textContent = String(score);
    timeDisplay.textContent = String(Math.max(0, Math.ceil(currentMode.duration - elapsed)));
    goalDisplay.textContent = String(currentMode.target);
    heartsDisplay.textContent = Array.from({ length: currentMode.lives }, (_, index) => index < lives ? "♥" : "♡").join(" ");
    heartsDisplay.setAttribute("aria-label", `${lives} ${lives === 1 ? "life" : "lives"} remaining`);
    meterFill.style.width = `${cleanliness}%`;
    meterValue.textContent = `${cleanliness}%`;
    meter.setAttribute("aria-valuenow", String(cleanliness));
    area.style.setProperty("--river-clear", String(cleanliness / 100));
  }

  function clearEntities() {
    entities = [];
    entityLayer.replaceChildren();
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimeout);
    toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 1050);
  }

  function addEntity(type, x, y) {
    const element = document.createElement("div");
    element.className = `entity entity-${type}`;
    element.textContent = type === "drop" ? "💧" : type === "trash" ? "🗑️" : "✦";
    element.setAttribute("aria-hidden", "true");
    entityLayer.append(element);
    const entity = {
      id: nextEntityId++,
      type,
      x,
      y,
      element,
      width: type === "drop" ? 50 : 34,
      height: type === "drop" ? 54 : 34,
      speed: (type === "drop" ? 195 : type === "trash" ? 175 : 165) * currentMode.speedMultiplier,
      hit: false
    };
    entities.push(entity);
    placeEntity(entity);
  }

  function placeEntity(entity) {
    entity.element.style.left = `${entity.x}px`;
    entity.element.style.top = `${entity.y}px`;
  }

  function spawn(type) {
    const height = area.clientHeight;
    const safeMargin = 38;
    addEntity(type, area.clientWidth + 30, safeMargin + Math.random() * Math.max(1, height - safeMargin * 2));
  }

  function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return Math.abs(ax - bx) < (aw + bw) / 2 && Math.abs(ay - by) < (ah + bh) / 2;
  }

  function collect(entity) {
    if (entity.type === "drop") {
      const previousScore = score;
      score += DROP_POINTS;
      dropsCollected += 1;
      cleanliness = Math.min(100, cleanliness + 10);
      updateHud();
      showToast("+10 · Water drop collected!");
      announceMilestones(previousScore);
    } else if (entity.type === "power") {
      const trash = entities.filter((item) => item.type === "trash");
      for (const item of trash) item.element.remove();
      entities = entities.filter((item) => item.type !== "trash");
      showToast("Current cleared!");
    }
    playSound("collect");
    entity.element.remove();
    entities = entities.filter((item) => item.id !== entity.id);
  }

  function announceMilestones(previousScore) {
    for (const [index, milestone] of MILESTONES.entries()) {
      const threshold = Math.ceil(currentMode.target * milestone.progress / DROP_POINTS) * DROP_POINTS;
      if (milestonesReached.has(index) || previousScore >= threshold || score < threshold) continue;
      milestonesReached.add(index);
      showToast(milestone.message);
    }
  }

  function hitTrash(entity, now) {
    if (entity.hit || now < invulnerableUntil) return;
    entity.hit = true;
    invulnerableUntil = now + 950;
    lives -= 1;
    score = Math.max(0, score - TRASH_PENALTY);
    player.classList.remove("hit");
    void player.offsetWidth;
    player.classList.add("hit");
    window.setTimeout(() => player.classList.remove("hit"), 950);
    updateHud();
    showToast("-5 · Watch out!");
    if (lives <= 0) endGame(false);
  }

  function swimUp() {
    if (!running) return;
    verticalSpeed = -420;
  }

  function finishCelebration() {
    celebration.replaceChildren();
    const colors = ["#ffd447", "#45c5dc", "#ffffff", "#4dbb87", "#f18a73"];
    for (let i = 0; i < 75; i += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.backgroundColor = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 1.1}s`;
      piece.style.transform = `rotate(${Math.random() * 360}deg)`;
      celebration.append(piece);
    }
  }

  function endGame(won) {
    if (!running) return;
    running = false;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    resetButton.hidden = true;
    document.getElementById("final-score").textContent = String(score);
    document.getElementById("final-goal").textContent = String(currentMode.target);
    document.getElementById("final-drops").textContent = String(dropsCollected);
    document.getElementById("end-title").textContent = won ? "You made it!" : lives <= 0 ? "The current got you." : "Goal not reached yet.";
    document.getElementById("end-eyebrow").textContent = won ? "RIVER RESCUE COMPLETE" : lives <= 0 ? "RIVER REPORT" : "TIME IS UP";
    document.getElementById("end-icon").textContent = won ? "🎉" : "💧";
    endScreen.hidden = false;
    if (won) {
      playSound("win");
      finishCelebration();
    } else celebration.replaceChildren();
  }

  function startGame() {
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    running = false;
    clearEntities();
    celebration.replaceChildren();
    window.clearTimeout(toastTimeout);
    toast.classList.remove("show");
    player.classList.remove("hit");
    score = 0;
    dropsCollected = 0;
    milestonesReached = new Set();
    currentMode = MODES[document.querySelector('input[name="difficulty"]:checked').value];
    lives = currentMode.lives;
    cleanliness = 0;
    playerY = area.clientHeight / 2;
    verticalSpeed = 0;
    elapsed = 0;
    spawnElapsed = 0;
    powerElapsed = 0;
    invulnerableUntil = 0;
    lastFrameTime = 0;
    player.style.top = `${playerY}px`;
    updateHud();
    startScreen.hidden = true;
    endScreen.hidden = true;
    resetButton.hidden = false;
    running = true;
    animationFrame = window.requestAnimationFrame(gameFrame);
  }

  function gameFrame(timestamp) {
    if (!running) return;
    const frameTime = lastFrameTime ? (timestamp - lastFrameTime) / 1000 : 0;
    const delta = Math.min(frameTime, 0.05);
    lastFrameTime = timestamp;
    elapsed += frameTime;

    const height = area.clientHeight;
    const width = area.clientWidth;
    verticalSpeed += 680 * delta;
    playerY = Math.max(38, Math.min(height - 38, playerY + verticalSpeed * delta));
    if (playerY <= 38 || playerY >= height - 38) verticalSpeed = 0;
    player.style.top = `${playerY}px`;

    spawnElapsed += delta;
    powerElapsed += delta;
    if (spawnElapsed >= currentMode.spawnInterval) {
      spawnElapsed = 0;
      spawn(Math.random() < 0.48 ? "drop" : "trash");
    }
    if (powerElapsed >= 9.5) {
      powerElapsed = 0;
      spawn("power");
    }

    const now = performance.now();
    const playerX = width * PLAYER_X;
    for (const entity of [...entities]) {
      if (!entities.some((item) => item.id === entity.id)) continue;
      entity.x -= entity.speed * delta;
      placeEntity(entity);
      if (entity.type === "trash" && rectsOverlap(playerX, playerY, 40, 38, entity.x, entity.y, entity.width, entity.height)) {
        hitTrash(entity, now);
        if (!running) return;
      } else if (entity.type !== "trash" && rectsOverlap(playerX, playerY, 40, 38, entity.x, entity.y, entity.width, entity.height)) {
        collect(entity);
      }
      if (entity.x < -40) {
        if (entity.type !== "trash") playSound("miss");
        entity.element.remove();
        entities = entities.filter((item) => item.id !== entity.id);
      }
    }

    updateHud();
    if (elapsed >= currentMode.duration) {
      elapsed = currentMode.duration;
      updateHud();
      endGame(score >= currentMode.target);
      return;
    }
    animationFrame = window.requestAnimationFrame(gameFrame);
  }

  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("button")) playSound("click");
  }, true);
  document.getElementById("play-button").addEventListener("click", startGame);
  document.getElementById("play-again-button").addEventListener("click", startGame);
  changeDifficultyButton.addEventListener("click", () => {
    endScreen.hidden = true;
    startScreen.hidden = false;
    elapsed = 0;
    score = 0;
    dropsCollected = 0;
    cleanliness = 0;
    updateHud();
  });
  resetButton.addEventListener("click", startGame);
  area.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, a")) return;
    swimUp();
  });
  window.addEventListener("keydown", (event) => {
    if (event.code === "Space" && running) {
      event.preventDefault();
      swimUp();
    }
  });
  window.addEventListener("resize", () => {
    if (!running) return;
    playerY = Math.max(38, Math.min(area.clientHeight - 38, playerY));
    player.style.top = `${playerY}px`;
    for (const entity of entities) placeEntity(entity);
  });

  updateHud();
})();
