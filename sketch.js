// 1) Error overlay (keep)
window.addEventListener("error", (e) => {
  document.body.innerHTML =
    "<pre style='white-space:pre-wrap;color:#fff;background:#000;padding:16px;'>" +
    "JS Error:\n" + (e.message || e.error || e) +
    "\n\n" + (e.filename || "") + ":" + (e.lineno || "") +
    "</pre>";
});

// 2) Safari-safe replacement for depth test toggles
const DISABLE_DEPTH_TEST = 0;
const ENABLE_DEPTH_TEST  = 1;

// ★必ず function 宣言で
function hint(mode) {
  console.log("hint called", mode); // ←一時確認用
  const gl = drawingContext; // WEBGL context
  if (!gl || !gl.disable || !gl.enable) return;

  if (mode === DISABLE_DEPTH_TEST) gl.disable(gl.DEPTH_TEST);
  if (mode === ENABLE_DEPTH_TEST)  gl.enable(gl.DEPTH_TEST);
}


window.addEventListener("error", (e) => {
  document.body.innerHTML =
    "<pre style='white-space:pre-wrap;color:#fff;background:#000;padding:16px;'>" +
    "JS Error:\n" + (e.message || e.error || e) +
    "\n\n" + (e.filename || "") + ":" + (e.lineno || "") +
    "</pre>";
});

let uiMainEl = null;
let uiSubEl  = null;

function setUIText(main, sub) {
  if (!uiMainEl) uiMainEl = document.getElementById("uiMain");
  if (!uiSubEl)  uiSubEl  = document.getElementById("uiSub");
  if (!uiMainEl || !uiSubEl) return;

  uiMainEl.textContent = main || "";
  uiSubEl.textContent  = sub  || "";
}


/* =====================================================
   Interactive Bubble + ECG Intro (p5.js port)
   - WEBGL bubbles + 2D HUD overlays
   - p5.sound mic amplitude (requires user gesture)
   - Responsive: windowResized() rebuilds scene
   - Touch support: touchStarted() -> mousePressed()
===================================================== */

// ---------------------
// Sound (Mic reactive ECG)
// ---------------------
let micIn = null;
let micAmp = null;
let enableMic = true;
let micLevelSmoothed = 0; // 0..1

// ---------------------
// Globals
// ---------------------
let bubbles = [];
let avatarImages = [];

let selectedBubble = null;
let zoomProgress = 0;

let selectedRecord = null;
let musicDetailProgress = 0;

let phonePromptProgress = 0;

// Display modes
// -2: ECG (first)
// -1: Message
//  0: Bubble normal
//  1: Bubble zoom
//  2: Music detail
//  3: Phone prompt
let displayMode = -2;

// Stars
let stars = [];

// ECG data
let ecgPoints = [];
let ecgOffset = 0;
let introTimer = 0;

let ecgAmplitudeBase = 1.0;
let ecgWaveLengthBase = 520;
let ecgDrift = 0;

// Pulse circle
let pulseCircleSize = 0;
let pulsePhase = 0;

// Internal: audio start guard
let audioStarted = false;

// =====================================================
// Helpers: 2D drawing on WEBGL canvas
// =====================================================
function begin2D() {
  push();
  // WEBGL origin is center; shift so that (0,0) is top-left like Processing
  translate(-width / 2, -height / 2, 0);
}
function end2D() {
  pop();
}

// =====================================================
// Music info
// =====================================================
class MusicInfo {
  constructor() {
    const titles = ["Midnight Dreams", "Summer Breeze", "Electric Soul", "Neon Lights", "Ocean Waves", "City Pulse"];
    const artists = ["The Dreamers", "Soul Collective", "Digital Hearts", "Night Riders", "Wave Makers", "Urban Sound"];
    const albums = ["Night Sessions", "Golden Hour", "Future Sounds", "Endless Journey", "Deep Blue", "Metropolitan"];

    this.title = random(titles);
    this.artist = random(artists);
    this.album = random(albums);
    this.albumColor = color(random(100, 255), random(100, 255), random(100, 255));
  }
}

// =====================================================
// Star (stable projection)
// =====================================================
class Star {
  constructor() {
    this.x = random(-width * 2, width * 2);
    this.y = random(-height * 2, height * 2);
    this.z = random(200, 2400);
    this.brightness = random(100, 255);
    this.twinkleSpeed = random(0.01, 0.03);
    this.twinklePhase = random(TWO_PI);
  }
  update() {
    this.twinklePhase += this.twinkleSpeed;
  }
  display() {
    const f = min(width, height) * 0.9;
    const screenX = width / 2 + (this.x / this.z) * f;
    const screenY = height / 2 + (this.y / this.z) * f;

    const size = map(this.z, 200, 2400, 2.8, 0.6);
    const a = this.brightness * (0.7 + 0.3 * sin(this.twinklePhase));

    noStroke();
    fill(255, a);
    circle(screenX, screenY, size);
  }
}

// =====================================================
// Music Record
// =====================================================
class MusicRecord {
  constructor() {
    const angle = random(TWO_PI);
    const distance = random(40, 80);
    this.pos = createVector(cos(angle) * distance, sin(angle) * distance);
    this.vel = p5.Vector.random2D().mult(0.3);
    this.size = random(18, 30);
    this.rotation = random(TWO_PI);
    this.recordColor = color(random(40, 80), random(40, 80), random(40, 80));
    this.info = new MusicInfo();
  }
  update() {
    this.pos.add(this.vel);
    this.rotation += 0.02;

    const maxDist = 70;
    if (this.pos.mag() > maxDist) {
      const normal = this.pos.copy().normalize();
      const dotProduct = this.vel.dot(normal);
      this.vel.sub(p5.Vector.mult(normal, 2 * dotProduct));
      this.pos = normal.mult(maxDist);
    }
  }
  display(a01) {
    push();
    translate(this.pos.x, this.pos.y, 2);
    rotateZ(this.rotation);

    fill(red(this.recordColor), green(this.recordColor), blue(this.recordColor), a01 * 220);
    stroke(0, a01 * 120);
    strokeWeight(1.5);
    circle(0, 0, this.size);

    fill(100, a01 * 180);
    noStroke();
    circle(0, 0, this.size * 0.3);

    noFill();
    stroke(0, a01 * 60);
    strokeWeight(0.8);
    for (let i = 1; i < 5; i++) circle(0, 0, this.size * 0.4 + i * 2.5);

    pop();
  }
}

// =====================================================
// Bubble
// =====================================================
class Bubble {
  constructor(x, y, z_, s, interactive) {
    this.pos = createVector(x, y);
    this.z = z_;
    this.vel = p5.Vector.random2D().mult(random(0.15, 0.4));
    this.size = s;
    this.rotation = random(TWO_PI);
    this.rotSpeed = random(-0.005, 0.005);
    this.isInteractive = interactive;

    const colorType = int(random(8));
    switch (colorType) {
      case 0: this.bubbleColor = color(random(80, 150), random(150, 220), random(200, 255)); break;
      case 1: this.bubbleColor = color(random(180, 255), random(100, 180), random(200, 255)); break;
      case 2: this.bubbleColor = color(random(220, 255), random(150, 200), random(80, 140)); break;
      case 3: this.bubbleColor = color(random(100, 180), random(200, 255), random(150, 200)); break;
      case 4: this.bubbleColor = color(random(220, 255), random(100, 150), random(140, 200)); break;
      case 5: this.bubbleColor = color(random(80, 150), random(200, 255), random(200, 255)); break;
      case 6: this.bubbleColor = color(random(150, 200), random(100, 160), random(220, 255)); break;
      case 7: this.bubbleColor = color(random(180, 230), random(220, 255), random(100, 160)); break;
    }

    this.alpha = random(0.16, 0.30);
    this.pulsePhase = random(TWO_PI);

    this.avatarImage = null;
    this.records = null;

    if (this.isInteractive) {
      if (avatarImages && avatarImages.length > 0) {
        this.avatarImage = random(avatarImages);
      }
      this.records = [];
      for (let i = 0; i < 10; i++) this.records.push(new MusicRecord());
    }
  }

  update() {
    this.pos.add(this.vel);
    this.rotation += this.rotSpeed;
    this.pulsePhase += 0.02;

    if (this.isInteractive && this.records) {
      for (const r of this.records) r.update();
    }

    const boundary = width * 1.2;
    if (this.pos.x < -boundary || this.pos.x > boundary) {
      this.vel.x *= -1;
      this.pos.x = constrain(this.pos.x, -boundary, boundary);
    }
    if (this.pos.y < -height || this.pos.y > height) {
      this.vel.y *= -1;
      this.pos.y = constrain(this.pos.y, -height, height);
    }

    if (this.isInteractive) {
      for (const other of bubbles) {
        if (other !== this && other.isInteractive && abs(this.z - other.z) < 200) {
          const d = p5.Vector.dist(this.pos, other.pos);
          if (d < (this.size + other.size) / 2) {
            const pushDir = p5.Vector.sub(this.pos, other.pos).normalize();
            this.vel.add(pushDir.mult(0.1));
            this.vel.limit(0.6);
          }
        }
      }
    }
  }

  display() {
    push();
    translate(this.pos.x, this.pos.y, this.z);

    const depthScale = map(this.z, -1500, 500, 0.3, 1.2);
    const depthAlpha = map(this.z, -1500, 500, 0.25, 1.0);
    scale(depthScale);

    rotateY(this.rotation);
    rotateX(sin(this.pulsePhase) * 0.08);

    const pulse = 1 + sin(this.pulsePhase) * 0.04;
    const currentSize = this.size * pulse;

    this.drawSoapBubbleSphere(currentSize / 2, depthAlpha);

    pop();
  }

  drawSoapBubbleSphere(r, depthAlpha) {
    noStroke();

    // Material (avoid blowout)
    specularMaterial(80);
    shininess(10);

    let a = 255 * this.alpha * depthAlpha;
    a *= 0.85;

    // p5 WEBGL: use fill + ambientMaterial-ish; specularMaterial already set,
    // we keep fill alpha for the base tint.
    fill(red(this.bubbleColor), green(this.bubbleColor), blue(this.bubbleColor), a);

    const depthScale = map(this.z, -1500, 500, 0.3, 1.2);
    let detail = int(map(depthScale, 0.3, 1.2, 12, 32));
    detail = constrain(detail, 10, 34);
    sphere(r, 24, 16);

    // Softer rim (drawn as 2D ring in current transform plane)
    push();
    noFill();

    const rimA1 = 38 * depthAlpha;
    const rimA2 = 18 * depthAlpha;

    const hueT = (sin(frameCount * 0.008) * 0.5 + 0.5);
    const rimC1 = lerpColor(color(120, 220, 255), color(255, 180, 230), hueT);
    const rimC2 = lerpColor(color(150, 255, 150), color(255, 240, 150), 1 - hueT);

    stroke(rimC1);
    strokeWeight(1.6);
    stroke(red(rimC1), green(rimC1), blue(rimC1), rimA1);
    circle(0, 0, r * 2.02);

    stroke(rimC2);
    strokeWeight(2.6);
    stroke(red(rimC2), green(rimC2), blue(rimC2), rimA2);
    circle(0, 0, r * 2.07);

    pop();
  }

  displayMusicRecords() {
    if (!this.isInteractive || !this.records) return;

    push();
    translate(0, this.size * 0.15, 3);
    for (const r of this.records) {
      r.update();
      r.display(1.0);
    }
    pop();
  }

  isClicked(mx, my) {
    if (!this.isInteractive) return false;
    const depthScale = map(this.z, -1500, 500, 0.3, 1.2);
    const screenX = this.pos.x + width / 2;
    const screenY = this.pos.y + height / 2;
    const d = dist(mx, my, screenX, screenY);
    return d < (this.size * depthScale) / 2;
  }
}

// =====================================================
// preload / setup
// =====================================================
function preload() {
  // Avatars (place them next to index.html)
  // If missing, p5 will warn; bubbles still run but without avatars.
  avatarImages = [
    loadImage("avatar1.png", () => {}, () => {}),
    loadImage("avatar2.png", () => {}, () => {}),
    loadImage("avatar3.png", () => {}, () => {}),
  ].filter(img => img); // keep truthy
}

function setup() {
  const c = createCanvas(windowWidth, windowHeight, WEBGL);
  c.parent("app");

  // Match Processing "smooth(4)" vibe
  pixelDensity(min(2, window.devicePixelRatio || 1));

  // Build scene
  rebuildScene();

  // We do NOT start mic here; browsers require a user gesture.
  // We'll start it on first tap/click.
}

function rebuildScene() {
  // ECG
  ecgPoints = [];
  generateECG(0.0);

  // Stars
  stars = [];
  for (let i = 0; i < 280; i++) stars.push(new Star());

  // Bubbles
  bubbles = [];
  const bubbleSize = min(width, height) / 2.5;

  for (let i = 0; i < 10; i++) {
    const angle = random(TWO_PI);
    const distance = random(width * 0.2, width * 0.6);
    const x = cos(angle) * distance;
    const y = sin(angle) * distance;
    const z = random(-300, 300);
    bubbles.push(new Bubble(x, y, z, bubbleSize, true));
  }

  for (let i = 0; i < 10; i++) {
    const angle = random(TWO_PI);
    const distance = random(width * 0.5, width * 1.5);
    const x = cos(angle) * distance;
    const y = sin(angle) * distance;
    const z = random(-1500, -600);
    bubbles.push(new Bubble(x, y, z, bubbleSize * random(0.8, 1.5), false));
  }
}

// =====================================================
// ECG generation
// =====================================================
function generateECG(micLevel01) {
  ecgPoints.length = 0;

  const amp = ecgAmplitudeBase * lerp(0.9, 1.45, micLevel01);
  const noiseAmt = lerp(0.6, 2.2, micLevel01);
  const waveLength = ecgWaveLengthBase * lerp(1.05, 0.85, micLevel01);

  for (let i = 0; i < width * 2; i += 3) {
    let y = height / 2 + 120;

    const drift = sin((i * 0.002) + ecgDrift) * 4.0;
    y += drift;

    y += random(-2.0, 2.0) * amp * noiseAmt;

    const spikePos = (i % waveLength);
    const spikeProgress = spikePos / waveLength;

    if (spikeProgress < 0.06) {
      y -= sin((spikeProgress / 0.06) * PI) * 10 * amp;
    } else if (spikeProgress > 0.17 && spikeProgress < 0.28) {
      const qrsProgress = (spikeProgress - 0.17) / 0.11;
      if (qrsProgress < 0.28) {
        y += sin((qrsProgress / 0.28) * PI) * 22 * amp;
      } else if (qrsProgress < 0.52) {
        y -= sin(((qrsProgress - 0.28) / 0.24) * PI) * 150 * amp;
      } else {
        y += sin(((qrsProgress - 0.52) / 0.48) * PI) * 40 * amp;
      }
    } else if (spikeProgress > 0.43 && spikeProgress < 0.54) {
      y -= sin(((spikeProgress - 0.43) / 0.11) * PI) * 18 * amp;
    }

    ecgPoints.push(createVector(i, y));
  }
}

// =====================================================
// Lighting for bubbles
// =====================================================
function setupBubbleLights() {
  // Reset lights per frame (simple + stable)
  ambientLight(18, 18, 24);
  directionalLight(55, 55, 65, -0.2, -0.6, -1);
  directionalLight(28, 32, 45, 0.8, 0.2, -1);
}

// =====================================================
// Avatars overlay (2D screen space)
// =====================================================
function drawAvatarsOverlayNormal() {
  hint(DISABLE_DEPTH_TEST);

  begin2D();
  imageMode(CENTER);

  for (const b of bubbles) {
    if (!b.isInteractive || !b.avatarImage) continue;

    const depthScale = map(b.z, -1500, 500, 0.3, 1.2);
    const depthAlpha = map(b.z, -1500, 500, 0.25, 1.0);

    const screenX = width / 2 + b.pos.x;
    const screenY = height / 2 + b.pos.y;

    const avatarSize = (b.size * 0.36) * depthScale;

    tint(255, 180 * depthAlpha);
    image(b.avatarImage, screenX, screenY, avatarSize, avatarSize);
  }

  noTint();
  end2D();

  hint(ENABLE_DEPTH_TEST);
}

function drawAvatarOverlayZoom(t) {
  if (!selectedBubble) return;
  if (!selectedBubble.isInteractive || !selectedBubble.avatarImage) return;

  const a = 220 * t;
  const avatarSize = (selectedBubble.size * 0.42) * lerp(1, 1.20, t);

  hint(DISABLE_DEPTH_TEST);

  begin2D();
  imageMode(CENTER);
  tint(255, a);
  image(selectedBubble.avatarImage, width / 2, height / 4, avatarSize, avatarSize);
  noTint();
  end2D();

  hint(ENABLE_DEPTH_TEST);
}

// =====================================================
// Main draw
// =====================================================
function draw() {
  // --- UI text (HTML overlay) ---
  if (displayMode === -2) {
  setUIText(
    "Touch the screen with your smartphone.",
    "discver new music"
  );
} else if (displayMode === -1) {
  setUIText(
    "Let's discover songs you don't know from others' perspectives.",
    "Tap to skip"
  );
} else if (displayMode === 1) {
  setUIText(
    "",
    "Tap the record to play the song"
  );
} else if (displayMode === 2) {
  setUIText(
    "",
    "If you like it, tap the record"
  );
} else if (displayMode === 3) {
  setUIText(
    "Hold your smartphone on the screen.",
    "Tap the black area to return"
  );
} else {
  setUIText("", "");
}


  // --- ここから下は、今までの draw() のまま ---
  background(5, 10, 20);

  // Mic sampling
  let micNow = 0;
  if (enableMic && micAmp) {
    micNow = constrain(micAmp.getLevel() * 7.0, 0, 1);
  }
  micLevelSmoothed = lerp(micLevelSmoothed, micNow, 0.08);

  if (displayMode === -2) {
    drawECGScreen(micLevelSmoothed);
  } else if (displayMode === -1) {
    drawMessageScreen();
  } else if (displayMode === 3) {
    if (phonePromptProgress < 1) phonePromptProgress += 0.03;
    drawPhonePrompt();
  } else if (displayMode === 2) {
    if (musicDetailProgress < 1) musicDetailProgress += 0.05;
    if (phonePromptProgress > 0) phonePromptProgress -= 0.1;
    drawMusicDetail();
  } else if (displayMode === 1) {
    if (zoomProgress < 1) zoomProgress += 0.05;
    if (musicDetailProgress > 0) musicDetailProgress -= 0.1;
    if (phonePromptProgress > 0) phonePromptProgress -= 0.1;
    drawZoomedBubble();
  } else {
    if (zoomProgress > 0) zoomProgress -= 0.05;
    if (musicDetailProgress > 0) musicDetailProgress -= 0.1;
    if (phonePromptProgress > 0) phonePromptProgress -= 0.1;

    // Stars (2D)
    hint(DISABLE_DEPTH_TEST);
    begin2D();
    for (const s of stars) { s.update(); s.display(); }
    end2D();
    hint(ENABLE_DEPTH_TEST);

    // Bubble scene (3D)
    push();
    translate(0, 0, 0); // origin already center in WEBGL

    bubbles.sort((a, b) => a.z - b.z); // far -> near

    hint(DISABLE_DEPTH_TEST);
    setupBubbleLights();

    for (const b of bubbles) {
      b.update();
      b.display();
    }

    hint(ENABLE_DEPTH_TEST);
    pop();

    drawAvatarsOverlayNormal();
  }
}

// =====================================================
// ECG Screen (2D)
// =====================================================
function drawECGScreen(micLevel01) {
  background(10, 15, 25);

  ecgOffset -= 2.0;
  if (ecgOffset < -width) ecgOffset = 0;

  ecgDrift += 0.015;

  const regenInterval = int(lerp(16, 8, micLevel01));
  if (frameCount % regenInterval === 0) {
    generateECG(micLevel01);
  }

  hint(DISABLE_DEPTH_TEST);
  begin2D();

  // glow layers
  noFill();
  stroke(255, 40);
  strokeWeight(10);
  beginShape();
  for (let i = 0; i < ecgPoints.length - 1; i++) {
    const p = ecgPoints[i];
    const x = p.x + ecgOffset;
    const y = p.y;
    if (x > -50 && x < width + 50) vertex(x, y, 0);
  }
  endShape();

  stroke(255, 70);
  strokeWeight(6);
  beginShape();
  for (let i = 0; i < ecgPoints.length - 1; i++) {
    const p = ecgPoints[i];
    const x = p.x + ecgOffset;
    const y = p.y;
    if (x > -50 && x < width + 50) vertex(x, y, 0);
  }
  endShape();

  stroke(255, 220);
  strokeWeight(3);
  beginShape();
  for (let i = 0; i < ecgPoints.length - 1; i++) {
    const p = ecgPoints[i];
    const x = p.x + ecgOffset;
    const y = p.y;
    if (x > -50 && x < width + 50) vertex(x, y, 0);
  }
  endShape();

  // pulse circle
  pulsePhase += 0.05;
  const audioBoost = lerp(1.0, 1.6, micLevel01);
  pulseCircleSize = (100 + 50 * sin(pulsePhase)) * audioBoost;
  const circleAlpha = (150 + 105 * sin(pulsePhase)) * lerp(0.9, 1.3, micLevel01);

  push();
  translate(width / 2, height / 2 + 100);

  for (let i = 3; i > 0; i--) {
    noFill();
    stroke(255, circleAlpha / (i + 1));
    strokeWeight(i * 3);
    circle(0, 0, pulseCircleSize + i * 30);
  }

  noFill();
  stroke(255, circleAlpha);
  strokeWeight(4);
  circle(0, 0, pulseCircleSize);

  pop();

  fill(255, 230);
  noStroke();
  textAlign(CENTER);
  textSize(32);
  text("Hold your smartphone on the screen.", width / 2, height / 2 + 250);

  textSize(18);
  fill(255, 180);
  text("Tap the screen to continue", width / 2, height - 50);

  end2D();
  hint(ENABLE_DEPTH_TEST);
}

// =====================================================
// Message Screen
// =====================================================
function drawMessageScreen() {
  background(5, 10, 20);

  introTimer += deltaTime / 1000;
  const textAlpha = min(255, introTimer * 100);

  hint(DISABLE_DEPTH_TEST);
  begin2D();

  fill(255, textAlpha);
  noStroke();
  textAlign(CENTER);

  textSize(28);
  text("Let's discover songs you don't know from others' perspectives.", width / 2, height / 2);

  textSize(18);
  fill(255, textAlpha * 0.75);
  text("Tap to skip", width / 2, height - 50);

  end2D();
  hint(ENABLE_DEPTH_TEST);

  if (introTimer > 3) {
    displayMode = 0;
    introTimer = 0;
  }
}

// =====================================================
// Zoomed Bubble
// =====================================================
function drawZoomedBubble() {
  const t = easeInOutCubic(zoomProgress);

  hint(DISABLE_DEPTH_TEST);
  begin2D();
  noStroke();
  fill(5, 10, 20, 200 * t);
  rect(0, 0, width, height);
  end2D();
  hint(ENABLE_DEPTH_TEST);

  push();

  const bubbleScale = lerp(1, 1.8, t);
  scale(bubbleScale);

  if (selectedBubble) {
    hint(DISABLE_DEPTH_TEST);
    setupBubbleLights();
    // draw in center (WEBGL origin already center)
    selectedBubble.drawSoapBubbleSphere(selectedBubble.size * 0.5, 1.0);
    hint(ENABLE_DEPTH_TEST);
  }

  if (t > 0.8 && selectedBubble) {
    selectedBubble.displayMusicRecords();
  }

  pop();

  if (t > 0.05) drawAvatarOverlayZoom(t);

  if (t > 0.9) {
    hint(DISABLE_DEPTH_TEST);
    begin2D();
    fill(255, 200);
    noStroke();
    textAlign(CENTER);
    textSize(20);
    text("Tap the record to play the song", width / 2, height - 80);
    end2D();
    hint(ENABLE_DEPTH_TEST);
  }
}

// =====================================================
// Music Detail
// =====================================================
function drawMusicDetail() {
  const t = easeInOutCubic(musicDetailProgress);

  hint(DISABLE_DEPTH_TEST);
  begin2D();
  noStroke();
  fill(5, 10, 20, 240 * t);
  rect(0, 0, width, height);
  end2D();
  hint(ENABLE_DEPTH_TEST);

  // Big record in the center (2D-ish draw on WEBGL plane)
  push();
  translate(0, -50, 10);

  if (selectedRecord) {
    push();
    const recordScale = lerp(1, 12, t);
    scale(recordScale);
    rotateZ(selectedRecord.rotation + frameCount * 0.01);

    fill(selectedRecord.recordColor);
    stroke(0, 150);
    strokeWeight(2 / recordScale);
    circle(0, 0, selectedRecord.size);

    fill(100);
    noStroke();
    circle(0, 0, selectedRecord.size * 0.3);

    noFill();
    stroke(0, 100);
    strokeWeight(1 / recordScale);
    for (let i = 1; i < 8; i++) circle(0, 0, selectedRecord.size * 0.4 + i * 3);

    fill(255, 60);
    noStroke();
    arc(0, 0, selectedRecord.size * 0.8, selectedRecord.size * 0.8, -PI / 3, PI / 3);

    pop();
  }

  pop();

  if (t > 0.5) drawMusicPlayer(t);

  if (t > 0.7) {
    hint(DISABLE_DEPTH_TEST);
    begin2D();
    fill(255, 200 * (t - 0.7) / 0.3);
    noStroke();
    textAlign(CENTER);
    textSize(18);
    text("if you like it, lets tap the record", width / 2, height - 60);
    end2D();
    hint(ENABLE_DEPTH_TEST);
  }
}

// =====================================================
// Music Player panel (2D)
// =====================================================
function drawMusicPlayer(t) {
  const alpha = map(t, 0.5, 1, 0, 255);

  const panelW = width * 0.62;
  const panelH = 210;
  const radius = 18;

  const cx = width / 2;
  const cy = height * 0.78;

  const info = selectedRecord ? selectedRecord.info : null;

  hint(DISABLE_DEPTH_TEST);
  begin2D();

  push();
  translate(cx, cy);

  fill(20, 25, 35, alpha);
  noStroke();
  rectMode(CENTER);
  rect(0, 0, panelW, panelH, radius);

  const topY = -60;
  const titleY = topY;
  const artistY = topY + 28;
  const albumY = topY + 52;

  fill(255, alpha);
  textAlign(CENTER);

  textSize(24);
  text(info ? info.title : "—", 0, titleY);

  textSize(18);
  fill(210, alpha);
  text(info ? info.artist : "", 0, artistY);

  textSize(15);
  fill(170, alpha);
  text(info ? info.album : "", 0, albumY);

  // Play button
  const btnY = 62;
  const btnR = 64;

  fill(255, alpha);
  noStroke();
  circle(0, btnY, btnR);

  fill(20, 25, 35, alpha);
  triangle(-10, btnY - 12, -10, btnY + 12, 16, btnY);

  pop();

  end2D();
  hint(ENABLE_DEPTH_TEST);
}

// =====================================================
// Phone Prompt
// =====================================================
function drawPhonePrompt() {
  const t = easeInOutCubic(phonePromptProgress);

  hint(DISABLE_DEPTH_TEST);
  begin2D();

  noStroke();
  fill(5, 10, 20, 250);
  rect(0, 0, width, height);

  push();
  translate(width / 2, height / 2);

  fill(255, 255 * t);
  textAlign(CENTER);
  textSize(32);
  text("Hold your smartphone on the screen.", 0, -200);

  const blinkAlpha = 150 + 105 * sin(frameCount * 0.05);

  fill(255, blinkAlpha * t);
  rectMode(CENTER);
  rect(0, 50, 180, 320, 20);

  fill(200, 220, 255, blinkAlpha * 0.6 * t);
  rect(0, 40, 160, 280, 10);

  fill(255, blinkAlpha * t);
  circle(0, 190, 40);

  fill(50, blinkAlpha * t);
  circle(0, -140, 12);

  for (let i = 1; i <= 3; i++) {
    noFill();
    stroke(255, (blinkAlpha * 0.3 * t) / i);
    strokeWeight(i * 4);
    rect(0, 50, 180 + i * 20, 320 + i * 20, 20 + i * 5);
  }

  pop();

  fill(255, 150 * t);
  noStroke();
  textAlign(CENTER);
  textSize(16);
  text("Tap the black area to return to the previous screen.", width / 2, height - 40);

  end2D();
  hint(ENABLE_DEPTH_TEST);
}

// =====================================================
// Easing
// =====================================================
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2;
}

// =====================================================
// Audio start (must be called from user gesture)
// =====================================================
async function ensureAudioStarted() {
  if (audioStarted) return;
  audioStarted = true;

  try {
    // Required on iOS / modern browsers
    await userStartAudio();

    micIn = new p5.AudioIn();
    micIn.start();

    micAmp = new p5.Amplitude();
    micAmp.setInput(micIn);
    enableMic = true;
  } catch (e) {
    enableMic = false;
    micIn = null;
    micAmp = null;
  }
}

// =====================================================
// Interaction (mouse + touch)
// =====================================================
function mousePressed() {
  // Start audio on first interaction (safe to call repeatedly)
  ensureAudioStarted();

  if (displayMode === -2) {
    displayMode = -1;
    introTimer = 0;
    return;
  }

  if (displayMode === -1) {
    displayMode = 0;
    introTimer = 0;
    return;
  }

  if (displayMode === 3) {
    displayMode = 2;
    phonePromptProgress = 0;
    return;
  }

  if (displayMode === 2) {
    // top-left coords; mouseX/mouseY are already top-left even in WEBGL
    const distFromCenter = dist(mouseX, mouseY, width / 2, height / 2 - 50);
    if (distFromCenter < 100) {
      displayMode = 3;
      phonePromptProgress = 0;
    } else if (distFromCenter > 200) {
      displayMode = 1;
      selectedRecord = null;
      musicDetailProgress = 0;
    }
    return;
  }

  if (displayMode === 1) {
    let recordClicked = false;

    if (selectedBubble && zoomProgress > 0.8 && selectedBubble.records) {
      const bubbleScale = lerp(1, 1.8, easeInOutCubic(zoomProgress));

      for (const r of selectedBubble.records) {
        const screenX = width / 2 + r.pos.x * bubbleScale;
        const screenY = height / 2 + r.pos.y * bubbleScale + selectedBubble.size * 0.15 * bubbleScale;
        const d = dist(mouseX, mouseY, screenX, screenY);

        if (d < (r.size * bubbleScale) / 2) {
          selectedRecord = r;
          displayMode = 2;
          musicDetailProgress = 0;
          recordClicked = true;
          break;
        }
      }
    }

    if (!recordClicked) {
      const distFromCenter = dist(mouseX, mouseY, width / 2, height / 2);
      if (distFromCenter > 400) {
        displayMode = 0;
        selectedBubble = null;
        selectedRecord = null;
        zoomProgress = 0;
      }
    }

    return;
  }

  if (displayMode === 0) {
    for (const b of bubbles) {
      if (b.isClicked(mouseX, mouseY)) {
        selectedBubble = b;
        displayMode = 1;
        zoomProgress = 0;
        break;
      }
    }
  }
}

function touchStarted() {
  // Prevent page scroll/zoom
  mousePressed();
  return false;
}

// =====================================================
// Responsive
// =====================================================
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  pixelDensity(min(2, window.devicePixelRatio || 1));

  // Rebuild scene to fit new viewport
  rebuildScene();

  // Keep the current mode; if you prefer to reset to mode 0, uncomment:
  // displayMode = 0;
}
