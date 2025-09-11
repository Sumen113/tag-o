const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.get("/", (req, res) => {
  res.send("Server is running");
});

const TICK_RATE = 60;
const GAME_DURATION = 180;
const JUMP_FORCE = -0.02;
let gravity = 0.0005;
const TAG_COOLDOWN = 500; // milliseconds

let portals = [];
const PORTAL_COOLDOWN = 20000; // 20 seconds


let players = {};

// 🆕 Special usernames and their secret passwords
const SPECIAL_USERNAMES = {
  "sumen": "9289867243",
  "donaldtrumpy": "67isgood",
  "IShowMonkey": "applepenus67",
  "Clip God": "reyrey",
  "Goten":"jbhifi"
};

const MAP_NAMES = ["Grass", "Moon"];
// Predefined maps
const MAPS = [
  // Map 1
  [
    { x: 0, y: 0.89, w: 2.0, h: 0.03, type: "static" },

    // Bottom left
    { x: 0.05, y: 0.82, w: 0.25, h: 0.03, type: "static" },
    { x: 0.25, y: 0.70, w: 0.25, h: 0.03, type: "static" },
  
    // Bottom mid-right
    { x: 1.25, y: 0.82, w: 0.35, h: 0.03, type: "static" },
    { x: 1.00, y: 0.70, w: 0.25, h: 0.03, type: "static" },
  
    // Bottom slope (left side)
  
    // Mid platforms
    { x: 0.10, y: 0.56, w: 0.25, h: 0.03, type: "static" },
    { x: 0.55, y: 0.56, w: 0.55, h: 0.03, type: "static" },
    { x: 1.40, y: 0.56, w: 0.25, h: 0.03, type: "static" },
  
    // Upper mids
    { x: 0.20, y: 0.40, w: 0.25, h: 0.03, type: "static" },
    { x: 0.65, y: 0.40, w: 0.55, h: 0.03, type: "static" },
  
    // Top right slant
    { x: 1.50, y: 0.36, w: 0.25, h: 0.03, type: "static", angle: 0.25 },
  
    // Higher single platforms
    { x: 0.40, y: 0.28, w: 0.25, h: 0.03, type: "static" },
    { x: 1.15, y: 0.28, w: 0.25, h: 0.03, type: "static" },
  
    // Very top center
    { x: 0.80, y: 0.18, w: 0.35, h: 0.03, type: "static" }
  ],
  // Map 2
  // Map 2 (fun version)
  [
    { x: 0, y: 0.89, w: 2.0, h: 0.03, type: "static" }, // ground

    // Bottom left
    { x: 0.05, y: 0.75, w: 0.25, h: 0.03, type: "static" },
    { x: 0.30, y: 0.62, w: 0.25, h: 0.03, type: "static" },

    // Bottom right
    { x: 1.40, y: 0.75, w: 0.25, h: 0.03, type: "static" },
    { x: 1.10, y: 0.62, w: 0.25, h: 0.03, type: "static" },

    // Mid-center
    { x: 0.55, y: 0.48, w: 0.45, h: 0.03, type: "static" },
    
    // Upper-left
    { x: 0.20, y: 0.35, w: 0.25, h: 0.03, type: "static" },

    // Upper-right slant
    { x: 1.30, y: 0.35, w: 0.25, h: 0.03, type: "static"},

    // Top-center
    { x: 0.75, y: 0.20, w: 0.35, h: 0.03, type: "static" }
  ]
];

// Default
let platforms = MAPS[0];

let jumpPads = [
  { x: -0.07, y: 0.87, w: 0.08, h: 0.02, power: -0.04 }, // left side
  { x: 1.94, y: 0.87, w: 0.08, h: 0.02, power: -0.04 }  // right side
];

let groundHeight = 0.1;

let gameRunning = false;
let countdown = 3;
let timer = GAME_DURATION;
let itPlayer = null;

let votes = {};
let voting = false;

function startVoting() {
  votes = {};
  voting = true;
  io.emit("mapVoteStart", { maps: MAPS.length, names: MAP_NAMES });

  setTimeout(finishVoting, 8000); // 8 seconds to vote
}


function finishVoting() {
  voting = false;
  let tally = new Array(MAPS.length).fill(0);
  Object.values(votes).forEach(v => tally[v]++);

  let max = Math.max(...tally);
  let winners = tally.map((v, i) => v === max ? i : -1).filter(i => i >= 0);

  let chosen = winners[Math.floor(Math.random() * winners.length)];
  platforms = MAPS[chosen];
  gravity = chosen === 1 ? 0.0002 : 0.0005;
  io.emit("mapChosen", chosen);

  startGame();
}

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
  if (Object.keys(players).length >= 2) {
    // 🆕 Start a fresh vote instead of reusing the old map
    startVoting();
  } else {
    gameRunning = false;
    itPlayer = null;
    portals = [];
    // Reset to default map so next player doesn't get stuck on last map
    platforms = MAPS[0];
  }
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
    if (!p) continue;
    p.vy += gravity;
    p.y += p.vy;
    p.onGround = false;

    // Ground collision
    if (p.y + p.radius > 1 - groundHeight) {
      p.y = 1 - groundHeight - p.radius;
      p.vy = 0;
      p.onGround = true;
    }

    if (p.frozenUntil && Date.now() < p.frozenUntil) {
      p.vx = 0;
      p.vy = 0;
      continue; // skip movement while frozen
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

    // Horizontal bounds
    const FRICTION = 0.85; // tweak for slipperiness (0.85 is slightly slippery)

    p.x += p.vx;
    p.vx *= FRICTION;

    // Monkey grapple glide
    if (p.class === "monkey" && p.grappling && p.grappleTarget) {
      const dx = p.grappleTarget.x - p.x;
      const dy = p.grappleTarget.y - p.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      if (dist < 0.02) {
        // Arrived
        p.x = p.grappleTarget.x;
        p.y = p.grappleTarget.y;
        p.vx = 0;
        p.vy = 0;
        p.grappling = false;
        p.grappleTarget = null;
      } else {
        // Glide movement (smooth)
        const speed = 0.03; // glide speed
        p.x += (dx / dist) * speed;
        p.y += (dy / dist) * speed;
        p.vx = 0;
        p.vy = 0;
      }
    }

    // Keep player inside bounds
    const WORLD_WIDTH = 2.0;
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
  socket.on("join", ({ name, password, class: playerClass }) => {
  // 🆕 Check if password matches any special username
  let finalName = name;

  for (let special in SPECIAL_USERNAMES) {
    if (password === SPECIAL_USERNAMES[special]) {
      finalName = special; // assign the special username
      break;
    }
  }

  // 🆕 If they tried to directly type a reserved username without password, block it
  if (SPECIAL_USERNAMES[finalName] && password !== SPECIAL_USERNAMES[finalName]) {
    finalName = ""; // or "Guest" if you want to give them a fallback name
  }

  players[socket.id] = {
    name: finalName,
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

  // Send current game state immediately so they see the map
  socket.emit("state", { players, platforms, portals, jumpPads, gameRunning, itPlayer });

  // 🆕 Tell client to transition background even if no voting happened
  socket.emit("initGame");

    socket.on("voteMap", index => {
      if (voting && index >= 0 && index < MAPS.length) {
        votes[socket.id] = index;

        // send updated tally to everyone
        let tally = new Array(MAPS.length).fill(0);
        Object.values(votes).forEach(v => tally[v]++);
        io.emit("mapVoteUpdate", tally);        
      }
    });  

    if (Object.keys(players).length === 1) {
      socket.emit("waitingForPlayers");
    }    
    if (Object.keys(players).length >= 2 && !gameRunning && !voting) {
      startVoting();
    }    
  });

  const MOVE_ACCEL = 0.0007; // tweak for acceleration speed

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

  if (p.class === "ninja") {
    p.invisibleUntil = Date.now() + 5000; // 5s invisibility
  }

  if (p.class === "monkey") {
    const platform = platforms[Math.floor(Math.random() * platforms.length)];
    if (!platform) return;

    const targetX = platform.x + Math.random() * platform.w;
    const targetY = platform.y - p.radius - 0.01;
    p.grappleTarget = { x: targetX, y: targetY };
    p.grappling = true;
  }

  if (p.class === "clown") {
    // Tell ALL other players to show confetti for 5s
    socket.broadcast.emit("confetti", { duration: 5000 });
  }

  if (p.class === "snowman") {
  // Freeze ALL other players for 3s
    socket.broadcast.emit("freeze", { duration: 3000 });
  
    // Optionally mark them frozen server-side too
    for (let id in players) {
      if (id !== socket.id) {
        players[id].frozenUntil = Date.now() + 3000;
      }
    }
  }
});  

  socket.on("disconnect", () => {
  if (itPlayer === socket.id) {
    itPlayer = null; 
    pickRandomIt(); // pick a new one if possible
  }

  delete players[socket.id];

  if (Object.keys(players).length < 2) {
    gameRunning = false;

    // 🆕 if exactly one player remains, reload their page
    if (Object.keys(players).length === 1) {
      const remainingId = Object.keys(players)[0];
      io.to(remainingId).emit("reloadPage");
    }
  }
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));



