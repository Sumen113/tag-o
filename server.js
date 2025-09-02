const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const TICK_RATE = 60;
const GAME_DURATION = 180;
const JUMP_FORCE = -0.02;
const GRAVITY = 0.0005;
const TAG_COOLDOWN = 500; // milliseconds

let portals = [];
const PORTAL_COOLDOWN = 20000; // 20 seconds


let players = {};
let platforms = [
  // Ground (long, bottom)
  { x: 0, y: 0.89, w: 3.0, h: 0.03, type: "static" },

  // Left side
  { x: 0.2, y: 0.72, w: 0.3, h: 0.03, type: "static" },
  { x: 0.5, y: 0.55, w: 0.25, h: 0.03, type: "static" },

  // Middle section
  { x: 1.0, y: 0.62, w: 0.4, h: 0.03, type: "static" },
  { x: 1.5, y: 0.62, w: 0.4, h: 0.03, type: "static" },

  // Right side
  { x: 2.0, y: 0.75, w: 0.3, h: 0.03, type: "static" },
  { x: 2.3, y: 0.55, w: 0.3, h: 0.03, type: "static" },

  // Upper layers
  { x: 0.8, y: 0.38, w: 0.4, h: 0.03, type: "static" },
  { x: 1.8, y: 0.38, w: 0.4, h: 0.03, type: "static" },

  // High platforms
  { x: 0.5, y: 0.18, w: 0.35, h: 0.03, type: "static" },
  { x: 2.2, y: 0.18, w: 0.35, h: 0.03, type: "static" }
];


let jumpPads = [
  { x: -0.07, y: 0.87, w: 0.08, h: 0.02, power: -0.04 }, // left side
  { x: 0.94, y: 0.87, w: 0.08, h: 0.02, power: -0.04 }  // right side
];




let groundHeight = 0.1;

let gameRunning = false;
let countdown = 3;
let timer = GAME_DURATION;
let itPlayer = null;

function startGame() {
  gameRunning = false;
  countdown = 4;
  timer = GAME_DURATION;
  pickRandomIt();
  spawnPortals();

  const cdInterval = setInterval(() => {
    countdown--;
    io.emit("countdown", countdown);
    if (countdown <= 0) {
      clearInterval(cdInterval);
      gameRunning = true;
      startTimer();
    }
  }, 1000);
}

function startTimer() {
  const timerInterval = setInterval(() => {
    if (!gameRunning) {
      clearInterval(timerInterval);
      return;
    }
    timer--;
    io.emit("timer", timer);
    if (timer <= 0) {
      gameRunning = false;
      if (itPlayer) io.emit("loser", players[itPlayer]?.name || "Someone");
      resetGame();
      clearInterval(timerInterval);
    }
  }, 1000);
}

function resetGame() {
  if (Object.keys(players).length >= 2) startGame();
}

function spawnPortals() {
  if (platforms.length < 2) return;

  // Randomly pick two different platforms
  let firstIndex = Math.floor(Math.random() * platforms.length);
  let secondIndex;
  do {
    secondIndex = Math.floor(Math.random() * platforms.length);
  } while (secondIndex === firstIndex);

  const platformA = platforms[firstIndex];
  const platformB = platforms[secondIndex];

  portals = [
    {
      x: Math.random() * (platformA.x + platformA.w - platformA.x) + platformA.x, // center of platform
      y: platformA.y - 0.04,            // slightly above platform
      active: true
    },
    {
      x: Math.random() * (platformB.x + platformB.w - platformB.x) + platformB.x,
      y: platformB.y - 0.04,
      active: true
    }
  ];
}



function pickRandomIt() {
  const keys = Object.keys(players);
  if (keys.length > 0) {
    itPlayer = keys[Math.floor(Math.random() * keys.length)];
    for (let id of keys) players[id].isIt = false;
    players[itPlayer].isIt = true;
    players[itPlayer].lastTagged = Date.now();
  }
}

function movePlatforms() {
  platforms.forEach(pl => {
    if (pl.type === "moving") {
      if (pl.direction === "horizontal") {
        pl.x += pl.speed;
        if (Math.abs(pl.x - pl.originX) > pl.range) {
          pl.speed *= -1; // reverse direction
        }
      } else if (pl.direction === "vertical") {
        pl.y += pl.speed;
        if (Math.abs(pl.y - pl.originY) > pl.range) {
          pl.speed *= -1; // reverse direction
        }
      }
    }
  });
}

function applyPhysics() {
  const now = Date.now();
  
  for (let id in players) {

    let p = players[id];
    p.vy += GRAVITY;
    p.y += p.vy;
    p.onGround = false;

    // Ground collision
    if (p.y + p.radius > 1 - groundHeight) {
      p.y = 1 - groundHeight - p.radius;
      p.vy = 0;
      p.onGround = true;
    }

    // Platform collisions
    // Platform collisions
    platforms.forEach(pl => {
      if (p.x + p.radius > pl.x && p.x - p.radius < pl.x + pl.w) {
        // Landing on platform (from above)
        if (p.y + p.radius > pl.y && p.y + p.radius < pl.y + pl.h + 0.01 && p.vy >= 0) {
          p.y = pl.y - p.radius;
          p.vy = 0;
          p.onGround = true;
        
          // If platform is moving horizontally, move player with it
          if (pl.type === "moving" && pl.direction === "horizontal") {
            p.x += pl.speed;
          }
        }        
        // Hitting head on platform (from below)
        else if (p.y - p.radius < pl.y + pl.h && p.y - p.radius > pl.y && p.vy < 0) {
          p.y = pl.y + pl.h + p.radius;
          p.vy = 0;
        }
      }
    });

    // Jump pad collisions
    jumpPads.forEach(jp => {
      if (
        p.x + p.radius > jp.x &&
        p.x - p.radius < jp.x + jp.w &&
        p.y + p.radius > jp.y &&
        p.y + p.radius < jp.y + jp.h + 0.01 &&
        p.vy >= 0
      ) {
        p.vy = jp.power; // apply strong jump force
      }
    });

    app.get('/', (req, res) => {
      res.send('Server is running');
    });

    // Horizontal bounds
    const FRICTION = 0.85; // tweak for slipperiness (0.85 is slightly slippery)

    p.x += p.vx;
    p.vx *= FRICTION;

    // Keep player inside bounds
    const WORLD_WIDTH = 3.0;
    p.x = Math.max(p.radius, Math.min(WORLD_WIDTH - p.radius, p.x));
    

    // Check portal collisions
    if (portals.length === 2 && portals[0].active && portals[1].active) {
      const [p1, p2] = portals;
      const TELEPORT_RADIUS = 0.03;

      // If player touches portal 1
      if (Math.abs(p.x - p1.x) < TELEPORT_RADIUS && Math.abs(p.y - p1.y) < TELEPORT_RADIUS) {
        p.x = p2.x;
        p.y = p2.y - 0.05; // Offset so they don't instantly collide
        portals[0].active = false;
        portals[1].active = false;
        setTimeout(spawnPortals, PORTAL_COOLDOWN);
      }

      // If player touches portal 2
      else if (Math.abs(p.x - p2.x) < TELEPORT_RADIUS && Math.abs(p.y - p2.y) < TELEPORT_RADIUS) {
        p.x = p1.x;
        p.y = p1.y - 0.05;
        portals[0].active = false;
        portals[1].active = false;
        setTimeout(spawnPortals, PORTAL_COOLDOWN);
      }
    }


  }

  for (let id in players) {
    const p = players[id];
    if (p.invisibleUntil && Date.now() < p.invisibleUntil) {
      p.invisible = true;
    } else {
      p.invisible = false;
    }
  }

  // Tag logic with cooldown
  if (itPlayer && gameRunning) {
    const it = players[itPlayer];
    for (let id in players) {
      if (id === itPlayer) continue;
      const p = players[id]; 
      const dx = it.x - p.x;
      const dy = it.y - p.y;
      const distance = Math.sqrt(dx*dx + dy*dy);

      if (distance < it.hitRadius + p.hitRadius && now - (it.lastTagged || 0) > TAG_COOLDOWN) {
        // Transfer 'It'
        it.isIt = false;
        it.lastTagged = now;
        itPlayer = id;
        players[itPlayer].isIt = true;
        players[itPlayer].lastTagged = now;
        break;
      }
    }
  }
}

setInterval(() => {
  if (gameRunning) {
    movePlatforms();
    applyPhysics();
    io.emit("state", { players, platforms, portals, jumpPads, gameRunning, itPlayer });
  }
}, 1000 / TICK_RATE);


io.on("connection", socket => {
  socket.on("join", ({ name, class: playerClass }) => {
    players[socket.id] = {
      name,
      class: playerClass,
      x: 0.5,
      y: 0.5,
      vx: 0,
      vy: 0,
      radius: 0.02, 
      hitRadius: 0.01, 
      onGround: false,
      isIt: false,
      lastTagged: 0
    };    

    if (Object.keys(players).length >= 2 && !gameRunning) startGame();
  });

  const MOVE_ACCEL = 0.0005; // tweak for acceleration speed

  socket.on("move", dir => {
    const p = players[socket.id];
    if (!p) return;

    if (dir === "left") p.vx -= MOVE_ACCEL;
    if (dir === "right") p.vx += MOVE_ACCEL;
    if (dir === "jump" && p.onGround) {
      p.vy = JUMP_FORCE;
      p.onGround = false;
    }
  });

  socket.on("useAbility", () => {
    const p = players[socket.id];
    if (!p) return;
  
    // Check class
    if (p.class === "ninja") {
      p.invisibleUntil = Date.now() + 5000; // 5 seconds invisibility
    }
  });  

  socket.on("disconnect", () => {
    delete players[socket.id];
    if (Object.keys(players).length < 2) gameRunning = false;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));



