const socket = io();
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

let joined = false;
let name = '';
let playerClass = '';
let players = {};
let platforms = [];
let itPlayer = null;
let countdown = null;
let timer = 0;

const abilityUI = document.getElementById("ability-ui");
const abilityName = document.getElementById("ability-name");
const abilityTimer = document.getElementById("ability-timer");
let abilityCooldown = 0;

// Player class images
const classImages = {
  ninja: new Image(),
  monkey: new Image()
};
classImages.ninja.src = "./images/ninja.png"; // make sure this file exists
classImages.monkey.src = "./images/monkey.png"; // make sure this file exists

// Camera
let camera = { x: 0.5, y: 0.5, zoom: 3 };
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Join UI
const joinScreen = document.getElementById('join-screen');
const joinBtn = document.getElementById('join-btn');
const nameInput = document.getElementById('name');
const classButtons = document.querySelectorAll('.class-option');
const overlay = document.getElementById('overlay-message');

classButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    classButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    playerClass = btn.dataset.class;
    validateJoin();
  });
});

nameInput.addEventListener('input', validateJoin);
function validateJoin() {
  name = nameInput.value.trim();
  joinBtn.disabled = !(name && playerClass && name.length <= 12);
}

joinBtn.addEventListener('click', () => {
  if (!name || !playerClass) return;

  socket.emit('join', { name, class: playerClass });  

  // Remove disabled immediately
  abilityUI.classList.remove("disabled"); 
  abilityUI.style.background = "rgba(0,123,255,0.8)";
  if (playerClass === "ninja") abilityName.innerText = "Invisibility";
  if (playerClass === "monkey") abilityName.innerText = "Grapple";  
  abilityTimer.innerText = "Ready";

  // fade out join screen
  joinScreen.classList.add('fade-out');

  setTimeout(() => document.body.classList.add('joined'), 300);
  setTimeout(() => joinScreen.style.display = 'none', 1000);

  joined = true;
});


// Input
const keys = {};
window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Ability activation with "E"
abilityUI.addEventListener("click", tryActivateAbility);
window.addEventListener("keydown", e => {
  if (e.code === "KeyE") tryActivateAbility();
});


function tryActivateAbility() {
  if (!joined) return;
  if (abilityCooldown > 0) return; 
  socket.emit('useAbility');
  abilityCooldown = 60; // seconds
  if (playerClass === "ninja") {
    startAbilityCooldownUI("Invisibility");
  }
  if (playerClass === "monkey") {
    startAbilityCooldownUI("Grapple");
  }  
} 

function startAbilityCooldownUI(name) {
  abilityUI.classList.add("disabled");
  abilityName.textContent = name;
  abilityCooldown = 40;
  abilityTimer.textContent = abilityCooldown;

  const cdInterval = setInterval(() => {
    abilityCooldown--;
    abilityTimer.textContent = abilityCooldown > 0 ? abilityCooldown : "Ready";

    if (abilityCooldown <= 0) {
      clearInterval(cdInterval);
      abilityUI.classList.remove("disabled");
    }
  }, 1000);
}

// Server updates
let portals = [];

let jumpPads = [];


socket.on('state', data => {
  players = data.players;
  platforms = data.platforms;
  portals = data.portals || [];
  jumpPads = data.jumpPads || [];
  itPlayer = data.itPlayer;
});

socket.on('countdown', cd => countdown = cd);
socket.on('timer', t => timer = t);
socket.on('loser', loserName => {
  overlay.innerText = `LOSER: ${loserName}`;
  overlay.style.opacity = 1;
  setTimeout(() => overlay.style.opacity = 0, 3000);
});

// Camera update (calculations only, no ctx.scale)
function updateCamera() {
  if (!players || Object.keys(players).length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let id in players) {
    const p = players[id];
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  // Target position (center of all players)
  const targetX = (minX + maxX) / 2;
  const targetY = (minY + maxY) / 2;

  // Calculate spread and zoom
  const spreadX = maxX - minX;
  const spreadY = maxY - minY;
  let targetZoom = 0.8 / Math.max(spreadX, spreadY, 0.2);
  targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));

  // Smooth follow
  camera.x += (targetX - camera.x) * 0.08; // slightly faster than before
  camera.y += (targetY - camera.y) * 0.08;
  camera.zoom += (targetZoom - camera.zoom) * 0.05;

  // Clamp inside world bounds
  const WORLD_WIDTH = 2.0;  // adjust based on your map
  const WORLD_HEIGHT = 1.0;
  const halfWidth = 0.5 / camera.zoom;
  const halfHeight = 0.5 / camera.zoom;

  if (camera.x - halfWidth < 0) camera.x = halfWidth;
  if (camera.x + halfWidth > WORLD_WIDTH) camera.x = WORLD_WIDTH - halfWidth;
  if (camera.y - halfHeight < 0) camera.y = halfHeight;
  if (camera.y + halfHeight > WORLD_HEIGHT) camera.y = WORLD_HEIGHT - halfHeight;
}



// Convert world coords (0-1) to screen coords based on camera
function worldToScreen(wx, wy) {
  const screenX = (wx - camera.x) * camera.zoom * canvas.width + canvas.width / 2;
  const screenY = (wy - camera.y) * camera.zoom * canvas.height + canvas.height / 2;
  return { x: screenX, y: screenY };
}


function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  updateCamera();

  // Find the bottom platform (ground)
  const bottomPlatform = platforms.find(pl => pl.y >= 0.95);


  // Draw platforms with curved corners
  ctx.fillStyle = '#444';
  const cornerRadius = 5; // pixels, adjust as needed
  platforms.forEach(pl => {
    const topLeft = worldToScreen(pl.x, pl.y);
    const width = pl.w * camera.zoom * canvas.width;
    const height = pl.h * camera.zoom * canvas.height;

    // Using roundRect
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(topLeft.x, topLeft.y, width, height, cornerRadius);
      ctx.fill();
    } else {
      // fallback: manual rounded rectangle
      ctx.beginPath();
      ctx.moveTo(topLeft.x + cornerRadius, topLeft.y);
      ctx.lineTo(topLeft.x + width - cornerRadius, topLeft.y);
      ctx.quadraticCurveTo(topLeft.x + width, topLeft.y, topLeft.x + width, topLeft.y + cornerRadius);
      ctx.lineTo(topLeft.x + width, topLeft.y + height - cornerRadius);
      ctx.quadraticCurveTo(topLeft.x + width, topLeft.y + height, topLeft.x + width - cornerRadius, topLeft.y + height);
      ctx.lineTo(topLeft.x + cornerRadius, topLeft.y + height);
      ctx.quadraticCurveTo(topLeft.x, topLeft.y + height, topLeft.x, topLeft.y + height - cornerRadius);
      ctx.lineTo(topLeft.x, topLeft.y + cornerRadius);
      ctx.quadraticCurveTo(topLeft.x, topLeft.y, topLeft.x + cornerRadius, topLeft.y);
      ctx.fill();
    }
  });


  // Draw portals
  portals.forEach((portal, index) => {
    if (!portal.active) return; // skip inactive portals

    const pos = worldToScreen(portal.x, portal.y);
    const radius = 0.03 * camera.zoom * canvas.height; // size of portal

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    
    // Different color for each portal
    ctx.strokeStyle = index === 0 ? 'blue' : 'purple';
    ctx.lineWidth = 6;
    ctx.shadowColor = index === 0 ? 'blue' : 'purple';
    ctx.shadowBlur = 20;
    ctx.stroke();
    ctx.shadowBlur = 0; // reset for other drawings

    ctx.font = `${14 * camera.zoom}px Quicksand`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.strokeText(`Portal ${index + 1}`, pos.x, pos.y - radius - 10);
    ctx.fillText(`Portal ${index + 1}`, pos.x, pos.y - radius - 10);
  });

  // Draw jump pads
  jumpPads.forEach(jp => {
    const topLeft = worldToScreen(jp.x, jp.y);
    const width = jp.w * camera.zoom * canvas.width;
    const height = jp.h * camera.zoom * canvas.height;

    // Glow effect for visibility
    ctx.save();
    ctx.shadowColor = 'lime';
    ctx.shadowBlur = 20;

    ctx.fillStyle = 'limegreen';
    ctx.beginPath();
    ctx.roundRect(topLeft.x, topLeft.y, width, height, 5);
    ctx.fill();

    ctx.restore();

    // Optional text label
    ctx.font = `${14 * camera.zoom}px Quicksand`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.strokeText('JUMP', topLeft.x + width / 2, topLeft.y - 5);
    ctx.fillText('JUMP', topLeft.x + width / 2, topLeft.y - 5);
  });

  // Draw players
  // Draw players
for (let id in players) {
  const p = players[id];
  if (id !== socket.id && p.invisible) continue; // skip drawing invisible players (but not yourself)  
  const pos = worldToScreen(p.x, p.y);
  let radius = p.radius * camera.zoom * canvas.height;

  if (p.class === "monkey") {
    radius *= 1.37;
  }

  
  if (id === socket.id && p.invisible) {
    ctx.fillStyle = "rgba(255, 255, 0, 0.3)"; // transparent yellow for yourself
  } else {
    ctx.fillStyle = "yellow";
  }
  const img = classImages[p.class];
  if (img && img.complete) {
    const size = radius * 2;
    const corner = size * 0.15; // 10% rounded corners

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(pos.x - radius, pos.y - radius, size, size, corner);
    ctx.clip();
    
    if (id === socket.id && p.invisible) {
      ctx.globalAlpha = 0.3; // 👈 semi-transparent only for yourself
    }
    
    ctx.drawImage(img, pos.x - radius, pos.y - radius, size, size);
    
    ctx.restore();
    ctx.globalAlpha = 1.0; // reset alpha after drawing    
  } else {
    // fallback if image not ready
    ctx.beginPath();
    ctx.roundRect(pos.x - radius, pos.y - radius, radius * 2, radius * 2, radius * 0.15);
    ctx.fillStyle = "gray";
    ctx.fill();
  }
  if (p.isIt) {
    // --- triangle animation (bobbing) ---
    const time = performance.now() / 200; // speed of bobbing
    const bobOffset = Math.sin(time) * 5; // 5 pixels up/down
  
    // --- placement: ABOVE the name tag ---
    const fontSize = 14 * camera.zoom;               
    const nameBaselineY = pos.y - radius - 10;       
    const nameTopY = nameBaselineY - fontSize;       
    const gap = 6;                                   
    const tipY = nameTopY - gap + bobOffset;         // triangle tip bobs
  
    // --- triangle size ---
    const w = 44;               
    const h = 24;               
    const r = 6;                
  
    const leftTop  = { x: pos.x - w / 2, y: tipY - h };
    const rightTop = { x: pos.x + w / 2, y: tipY - h };
    const tip      = { x: pos.x,          y: tipY     };
  
    const pointAlong = (A, B, dist) => {
      const vx = B.x - A.x, vy = B.y - A.y;
      const L = Math.hypot(vx, vy) || 1;
      return { x: A.x + (vx * dist) / L, y: A.y + (vy * dist) / L };
    };
  
    const start        = { x: leftTop.x + r,  y: leftTop.y };   
    const end          = { x: rightTop.x - r, y: rightTop.y };  
    const leftIn       = pointAlong(leftTop, tip, r);
    const rightIn      = pointAlong(rightTop, tip, r);
    const leftNearTip  = pointAlong(tip, leftTop, r);
    const rightNearTip = pointAlong(tip, rightTop, r);
  
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.quadraticCurveTo(rightTop.x, rightTop.y, rightIn.x, rightIn.y);
    ctx.lineTo(rightNearTip.x, rightNearTip.y);
    ctx.quadraticCurveTo(tip.x, tip.y, leftNearTip.x, leftNearTip.y);
    ctx.lineTo(leftIn.x, leftIn.y);
    ctx.quadraticCurveTo(leftTop.x, leftTop.y, start.x, start.y);
    ctx.closePath();
    ctx.fillStyle = 'red';
    ctx.fill();
  }    
    
    ctx.font = `${14 * camera.zoom}px Quicksand`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.strokeText(p.name, pos.x, pos.y - radius - 10);
    ctx.fillText(p.name, pos.x, pos.y - radius - 10);
  }

  // HUD (fixed)
  ctx.fillStyle = 'white';
  ctx.font = '22px Quicksand';
  ctx.textAlign = 'left';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  if (itPlayer && players[itPlayer]) {
    ctx.strokeText(`${players[itPlayer].name} Is selling`, 20, 60);
    ctx.fillText(`${players[itPlayer].name} Is selling`, 20, 60); 
    ctx.strokeText(`Time: ${timer}`, 20, 90);
    ctx.fillText(`Time: ${timer}`, 20, 90);
  }
  
  

  if (countdown && countdown > 0) {
    ctx.font = '100px Quicksand';
    ctx.textAlign = 'center';
    ctx.strokeText(countdown > 0 ? countdown : 'GO!', canvas.width / 2, canvas.height / 2);
    ctx.fillText(countdown > 0 ? countdown : 'GO!', canvas.width / 2, canvas.height / 2);
  }

  // Movement
  if (joined) {
    if (keys['ArrowLeft'] || keys['KeyA']) socket.emit('move', 'left');
    if (keys['ArrowRight'] || keys['KeyD']) socket.emit('move', 'right');
    if ((keys['ArrowUp'] || keys['KeyW']) && players[socket.id]?.onGround) socket.emit('move', 'jump');
  }

  requestAnimationFrame(gameLoop);
}

gameLoop();
