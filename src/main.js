import planck from 'planck';
import './styles.css';

const pl = planck;
const Vec2 = pl.Vec2;

const canvas = document.querySelector('#scene');
const ctx = canvas.getContext('2d');
const controlsRoot = document.querySelector('#controls');
const statusNode = document.querySelector('#status');
const driveReadout = document.querySelector('#driveReadout');
const driveBar = document.querySelector('#driveBar');
const resetButton = document.querySelector('#resetButton');
const pauseButton = document.querySelector('#pauseButton');

const collision = {
  tank: -3,
};

const settings = {
  speed: 12,
  torque: 72,
  wheelFriction: 2.8,
  suspension: 7,
  damping: 0.72,
  treadLink: 18,
  chassisMass: 1.15,
  gravity: 18,
  armSpeed: 2.8,
  scoopSize: 0.7,
};

const sliderSpecs = [
  ['speed', 'Drive speed', 4, 24, 0.5],
  ['torque', 'Motor torque', 18, 160, 1],
  ['wheelFriction', 'Wheel friction', 0.5, 6, 0.1],
  ['suspension', 'Suspension', 1, 16, 0.25],
  ['damping', 'Damping', 0.05, 1, 0.01],
  ['treadLink', 'Tread stiffness', 2, 35, 0.5],
  ['chassisMass', 'Chassis mass', 0.45, 2.4, 0.05],
  ['gravity', 'Gravity', 8, 28, 0.5],
  ['armSpeed', 'Arm speed', 1.5, 9, 0.1],
  ['scoopSize', 'Scoop size', 0.2, 1.2, 0.05],
];

const keys = new Set();
let world;
let tank;
let props = [];
let camera = { x: 0, y: 3.5, zoom: 58 };
let desiredDrive = 0;
let sharedWheelSpeed = 0;
let lastTime = performance.now();
let accumulator = 0;
let paused = false;
let resetQueued = false;
let lastRightPointerAt = 0;

setupControls();
buildWorld();
resize();
requestAnimationFrame(frame);

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyA' || event.code === 'KeyD') {
    keys.add(event.code);
    event.preventDefault();
  }
  if (event.code === 'Space') {
    paused = !paused;
    updatePauseButton();
    event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 && event.button !== 2) return;
  event.preventDefault();
  const point = screenToWorld(event.clientX, event.clientY);
  if (event.button === 2) {
    lastRightPointerAt = performance.now();
    commandArm('dump', point);
  } else {
    commandArm('scoop', point);
  }
});
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (performance.now() - lastRightPointerAt > 250) {
    commandArm('dump', screenToWorld(event.clientX, event.clientY));
  }
});
resetButton.addEventListener('click', () => {
  resetQueued = true;
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  updatePauseButton();
});

function setupControls() {
  controlsRoot.replaceChildren();

  for (const [key, label, min, max, step] of sliderSpecs) {
    const row = document.createElement('label');
    row.className = 'control';
    row.innerHTML = `
      <span class="control__top">
        <span>${label}</span>
        <output>${formatSetting(key)}</output>
      </span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${settings[key]}" />
    `;
    const input = row.querySelector('input');
    const output = row.querySelector('output');
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      output.textContent = formatSetting(key);
      applyLiveSettings(key);
    });
    controlsRoot.append(row);
  }
}

function formatSetting(key) {
  const value = settings[key];
  if (key === 'damping' || key === 'chassisMass' || key === 'scoopSize') return value.toFixed(2);
  if (key === 'wheelFriction' || key === 'suspension' || key === 'gravity' || key === 'speed' || key === 'armSpeed') {
    return value.toFixed(1);
  }
  return Math.round(value).toString();
}

function buildWorld() {
  world = new pl.World(Vec2(0, -settings.gravity));
  world.setWarmStarting(true);
  world.setContinuousPhysics(true);
  sharedWheelSpeed = 0;

  createTerrain();
  createProps();
  tank = createTank(Vec2(-14, 4.6));
}

function createTerrain() {
  const ground = world.createBody();

  [
    [Vec2(-42, -2.2), Vec2(-8, -2.2), Vec2(-8, 0), Vec2(-42, 0)],
    [Vec2(-8, -2.2), Vec2(-4, -2.2), Vec2(-4, 1.45), Vec2(-8, 0)],
    [Vec2(-4, -2.2), Vec2(2.5, -2.2), Vec2(2.5, 1.45), Vec2(-4, 1.45)],
    [Vec2(2.5, -2.2), Vec2(6, -2.2), Vec2(6, 0.2), Vec2(2.5, 1.45)],
    [Vec2(6, -2.2), Vec2(12, -2.2), Vec2(12, 0.2), Vec2(6, 0.2)],
    [Vec2(12, -2.2), Vec2(15, -2.2), Vec2(15, 1.8), Vec2(12, 0.2)],
    [Vec2(15, -2.2), Vec2(18.5, -2.2), Vec2(18.5, 1.8), Vec2(15, 1.8)],
    [Vec2(18.5, -2.2), Vec2(21, -2.2), Vec2(21, 0), Vec2(18.5, 1.8)],
    [Vec2(21, -2.2), Vec2(42, -2.2), Vec2(42, 0), Vec2(21, 0)],
  ].forEach((vertices) => {
    ground.createFixture(pl.Polygon(vertices), {
      friction: 1.15,
      restitution: 0,
    });
  });

  const blocks = [
    { x: 24, y: 0.55, w: 3, h: 0.65, a: -0.2 },
    { x: 30, y: 1.0, w: 4.4, h: 0.45, a: 0.38 },
    { x: -25, y: 0.45, w: 3.2, h: 0.5, a: 0.12 },
  ];

  for (const block of blocks) {
    ground.createFixture(pl.Box(block.w * 0.5, block.h * 0.5, Vec2(block.x, block.y), block.a), {
      friction: 1.2,
      restitution: 0,
    });
  }
}

function createProps() {
  props = [];
  const crates = [
    { type: 'box', x: -1.8, y: 3.1, w: 0.9, h: 0.9, density: 0.6 },
    { type: 'box', x: -0.8, y: 3.1, w: 0.9, h: 0.9, density: 0.6 },
    { type: 'box', x: 0.2, y: 3.1, w: 0.9, h: 0.9, density: 0.6 },
    { type: 'box', x: 7.7, y: 1.4, w: 1.0, h: 0.75, density: 0.55 },
    { type: 'box', x: 8.8, y: 1.4, w: 1.0, h: 0.75, density: 0.55 },
    { type: 'box', x: 17.1, y: 3.2, w: 0.9, h: 0.9, density: 0.65 },
    { type: 'circle', x: 20.2, y: 2.0, r: 0.48, density: 0.8 },
    { type: 'circle', x: 22.0, y: 1.0, r: 0.42, density: 0.8 },
  ];

  for (const item of crates) {
    const body = world.createDynamicBody({
      position: Vec2(item.x, item.y),
      angle: item.a ?? 0,
      linearDamping: 0.03,
      angularDamping: 0.03,
    });

    if (item.type === 'circle') {
      body.createFixture(pl.Circle(item.r), {
        density: item.density,
        friction: 0.85,
        restitution: 0.05,
      });
    } else {
      body.createFixture(pl.Box(item.w * 0.5, item.h * 0.5), {
        density: item.density,
        friction: 0.75,
        restitution: 0.02,
      });
    }
    props.push({ body, ...item });
  }
}

function createTank(position) {
  const chassis = world.createDynamicBody({
    type: 'dynamic',
    position,
    angularDamping: 0.85,
    linearDamping: 0.12,
    bullet: true,
  });

  chassis.createFixture(pl.Polygon([
    Vec2(-2.7, -0.42),
    Vec2(-2.2, -0.78),
    Vec2(2.25, -0.78),
    Vec2(2.75, -0.42),
    Vec2(2.45, 0.62),
    Vec2(-2.45, 0.62),
  ]), {
    density: settings.chassisMass,
    friction: 0.7,
    restitution: 0,
    filterGroupIndex: collision.tank,
  });

  const localWheelPoints = makeTreadLoop();
  const wheels = [];
  const wheelJoints = [];
  const linkJoints = [];
  const radius = 0.38;

  for (const local of localWheelPoints) {
    const wheel = world.createDynamicBody({
      position: chassis.getWorldPoint(local),
      angularDamping: 0.12,
      linearDamping: 0.05,
      bullet: true,
    });
    wheel.createFixture(pl.Circle(radius), {
      density: 0.32,
      friction: settings.wheelFriction,
      restitution: 0,
      filterGroupIndex: collision.tank,
    });
    wheels.push({ body: wheel, local, radius });

    const joint = world.createJoint(pl.WheelJoint({
      enableMotor: true,
      motorSpeed: 0,
      maxMotorTorque: settings.torque,
      frequencyHz: settings.suspension,
      dampingRatio: settings.damping,
    }, chassis, wheel, wheel.getPosition(), Vec2(0, 1)));
    wheelJoints.push(joint);
  }

  for (let i = 0; i < wheels.length; i += 1) {
    const a = wheels[i].body;
    const b = wheels[(i + 1) % wheels.length].body;
    const length = Vec2.distance(a.getPosition(), b.getPosition());
    linkJoints.push(world.createJoint(pl.DistanceJoint({
      frequencyHz: settings.treadLink,
      dampingRatio: 0.85,
      collideConnected: false,
      length,
    }, a, b, a.getPosition(), b.getPosition())));
  }

  return {
    chassis,
    wheels,
    wheelJoints,
    linkJoints,
    arm: createExcavatorArm(),
    radius,
    drivePhase: 0,
  };
}

function createExcavatorArm() {
  return {
    baseLocal: Vec2(0.2, 0.72),
    boomLength: 2.45,
    stickLength: 2.1,
    bucketLength: 0.72,
    boomAngle: 0.92,
    stickAngle: -1.28,
    bucketAngle: -0.38,
    load: 0,
    state: 'ready',
    action: null,
    targetWorld: null,
    targetFlash: 0,
    restTipLocal: Vec2(2.18, 2.35),
    restBucketAbs: -0.62,
  };
}

function makeTreadLoop() {
  const points = [];
  const halfLength = 2.45;
  const topY = -0.34;
  const bottomY = -1.16;
  const endRadius = (topY - bottomY) * 0.5;
  const centerY = (topY + bottomY) * 0.5;

  for (let i = 0; i < 7; i += 1) {
    const t = i / 6;
    points.push(Vec2(-halfLength + t * halfLength * 2, bottomY));
  }

  for (let i = 1; i <= 4; i += 1) {
    const theta = -Math.PI / 2 + (i / 5) * Math.PI;
    points.push(Vec2(halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius));
  }

  for (let i = 1; i < 7; i += 1) {
    const t = i / 6;
    points.push(Vec2(halfLength - t * halfLength * 2, topY));
  }

  for (let i = 1; i <= 4; i += 1) {
    const theta = Math.PI / 2 + (i / 5) * Math.PI;
    points.push(Vec2(-halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius));
  }

  return points;
}

function applyLiveSettings(key) {
  if (!world || !tank) return;

  if (key === 'gravity') {
    world.setGravity(Vec2(0, -settings.gravity));
  }

  if (key === 'wheelFriction') {
    for (const wheel of tank.wheels) {
      for (let fixture = wheel.body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        fixture.setFriction(settings.wheelFriction);
      }
    }
  }

  if (key === 'torque') {
    for (const joint of tank.wheelJoints) joint.setMaxMotorTorque(settings.torque);
  }

  if (key === 'suspension' || key === 'damping') {
    for (const joint of tank.wheelJoints) {
      if (joint.setSpringFrequencyHz) joint.setSpringFrequencyHz(settings.suspension);
      if (joint.setSpringDampingRatio) joint.setSpringDampingRatio(settings.damping);
    }
  }

  if (key === 'treadLink') {
    for (const joint of tank.linkJoints) {
      if (joint.setFrequency) joint.setFrequency(settings.treadLink);
    }
  }

  if (key === 'chassisMass') {
    resetQueued = true;
  }
}

function commandArm(kind, targetWorld) {
  if (!tank?.arm) return;
  const arm = tank.arm;
  const targetLocal = tank.chassis.getLocalPoint(targetWorld);
  const action = kind === 'dump' ? createDumpAction(targetWorld) : createScoopAction(targetWorld);

  if (!isArmTargetReachable(arm, targetLocal) || !isActionReachable(arm, action)) {
    arm.action = null;
    arm.state = 'out of range';
    arm.targetWorld = targetWorld;
    arm.targetFlash = 1;
    updateHud();
    return;
  }

  arm.action = action;

  arm.targetWorld = targetWorld;
  arm.targetFlash = 1;
  arm.state = kind;
  updateHud();
}

function createScoopAction(targetWorld) {
  return {
    kind: 'scoop',
    index: 0,
    hold: 0,
    phases: [
      { state: 'reach', world: offsetVec(targetWorld, -0.3, 1.15), bucketWorld: -0.82, tolerance: 0.13 },
      { state: 'lower', world: offsetVec(targetWorld, -0.36, 0.18), bucketWorld: -1.18, tolerance: 0.11 },
      { state: 'scoop', world: offsetVec(targetWorld, 0.3, 0.1), bucketWorld: -0.22, tolerance: 0.1, hold: 0.2, capture: true },
      { state: 'lift', world: offsetVec(targetWorld, 0.12, 1.35), bucketWorld: -0.18, tolerance: 0.13 },
      { state: 'return', rest: true, tolerance: 0.12 },
    ],
  };
}

function createDumpAction(targetWorld) {
  return {
    kind: 'dump',
    index: 0,
    hold: 0,
    phases: [
      { state: 'carry', world: offsetVec(targetWorld, 0, 1.2), bucketWorld: -0.24, tolerance: 0.14 },
      { state: 'place', world: offsetVec(targetWorld, 0, 0.58), bucketWorld: -0.34, tolerance: 0.12 },
      { state: 'dump', world: offsetVec(targetWorld, 0, 0.78), bucketWorld: -1.92, tolerance: 0.1, hold: 0.28, release: true },
      { state: 'recover', world: offsetVec(targetWorld, -0.1, 1.35), bucketWorld: -1.08, tolerance: 0.15 },
      { state: 'return', rest: true, tolerance: 0.12 },
    ],
  };
}

function updateArm(dt) {
  const arm = tank.arm;
  arm.targetFlash = Math.max(0, arm.targetFlash - dt * 1.8);

  let targetLocal = arm.restTipLocal;
  let bucketLocal = arm.restBucketAbs;
  const action = arm.action;

  if (action) {
    const phase = action.phases[action.index];
    arm.state = phase.state;
    targetLocal = phase.rest ? arm.restTipLocal : tank.chassis.getLocalPoint(phase.world);
    bucketLocal = phase.rest ? arm.restBucketAbs : worldAngleToChassisLocal(phase.bucketWorld);

  } else {
    arm.state = arm.targetFlash > 0 ? arm.state : 'ready';
  }

  const solved = solveArmIK(arm, targetLocal, bucketLocal);
  const rate = settings.armSpeed * dt;
  arm.boomAngle = moveAngle(arm.boomAngle, solved.boomAngle, rate);
  arm.stickAngle = moveAngle(arm.stickAngle, solved.stickAngle, rate);
  arm.bucketAngle = moveAngle(arm.bucketAngle, solved.bucketAngle, rate * 1.35);

  if (!action) return;

  const phase = action.phases[action.index];
  const currentTipError = Vec2.distance(getArmLocalPoints(arm).tip, targetLocal);
  const poseError = Math.max(
    angleDelta(arm.boomAngle, solved.boomAngle),
    angleDelta(arm.stickAngle, solved.stickAngle),
    angleDelta(arm.bucketAngle, solved.bucketAngle),
  );

  if (poseError < (phase.tolerance ?? 0.12) && currentTipError < (phase.tipTolerance ?? 0.32)) {
    action.hold += dt;
    if (action.hold >= (phase.hold ?? 0)) {
      completeArmPhase(arm, phase);
      action.index += 1;
      action.hold = 0;
      if (action.index >= action.phases.length) {
        arm.action = null;
        arm.state = 'ready';
      }
    }
  } else {
    action.hold = 0;
  }
}

function completeArmPhase(arm, phase) {
  if (phase.done) return;
  phase.done = true;

  if (phase.capture) {
    arm.load = Math.max(arm.load, settings.scoopSize);
  }

  if (phase.release) {
    spawnSoil(phase.world, arm.load || settings.scoopSize * 0.35);
    arm.load = 0;
  }
}

function solveArmIK(arm, tipLocal, bucketLocal) {
  const wristTarget = Vec2(
    tipLocal.x - Math.cos(bucketLocal) * arm.bucketLength,
    tipLocal.y - Math.sin(bucketLocal) * arm.bucketLength,
  );
  const dx = wristTarget.x - arm.baseLocal.x;
  const dy = wristTarget.y - arm.baseLocal.y;
  const l1 = arm.boomLength;
  const l2 = arm.stickLength;
  const minReach = Math.abs(l1 - l2) + 0.04;
  const maxReach = l1 + l2 - 0.04;
  const rawDistance = Math.hypot(dx, dy) || maxReach;
  const distance = clamp(rawDistance, minReach, maxReach);
  const scale = distance / rawDistance;
  const sx = dx * scale;
  const sy = dy * scale;
  const theta = Math.atan2(sy, sx);
  const elbowMagnitude = Math.acos(clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  const candidates = [elbowMagnitude, -elbowMagnitude].map((stickAngle) => {
    const boomAngle = theta - Math.atan2(l2 * Math.sin(stickAngle), l1 + l2 * Math.cos(stickAngle));
    const bucketAngle = normalizeAngle(bucketLocal - boomAngle - stickAngle);
    return scoreArmPose(arm, { boomAngle, stickAngle, bucketAngle });
  });

  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0].pose;
  return {
    boomAngle: clamp(best.boomAngle, -0.2, 2.45),
    stickAngle: clamp(best.stickAngle, -2.85, 0.35),
    bucketAngle: clamp(best.bucketAngle, -2.35, 1.25),
  };
}

function scoreArmPose(arm, pose) {
  const limits = {
    boomAngle: [-0.2, 2.45],
    stickAngle: [-2.85, 0.35],
    bucketAngle: [-2.35, 1.25],
  };
  let limitPenalty = 0;
  for (const [key, [min, max]] of Object.entries(limits)) {
    if (pose[key] < min) limitPenalty += (min - pose[key]) * 80;
    if (pose[key] > max) limitPenalty += (pose[key] - max) * 80;
  }

  const continuity =
    angleDelta(pose.boomAngle, arm.boomAngle) +
    angleDelta(pose.stickAngle, arm.stickAngle) * 0.7 +
    angleDelta(pose.bucketAngle, arm.bucketAngle) * 0.35;

  return {
    pose,
    score: limitPenalty + continuity,
  };
}

function worldAngleToChassisLocal(angle) {
  return normalizeAngle(angle - tank.chassis.getAngle());
}

function isArmTargetReachable(arm, targetLocal) {
  const dx = targetLocal.x - arm.baseLocal.x;
  const dy = targetLocal.y - arm.baseLocal.y;
  const distance = Math.hypot(dx, dy);
  return distance < arm.boomLength + arm.stickLength + arm.bucketLength - 0.15 && distance > 0.55 && targetLocal.x > -2.5;
}

function isActionReachable(arm, action) {
  return action.phases.every((phase) => {
    if (phase.rest) return true;
    const targetLocal = tank.chassis.getLocalPoint(phase.world);
    const bucketLocal = worldAngleToChassisLocal(phase.bucketWorld);
    return isWristTargetReachable(arm, targetLocal, bucketLocal);
  });
}

function isWristTargetReachable(arm, tipLocal, bucketLocal) {
  const wristTarget = Vec2(
    tipLocal.x - Math.cos(bucketLocal) * arm.bucketLength,
    tipLocal.y - Math.sin(bucketLocal) * arm.bucketLength,
  );
  const dx = wristTarget.x - arm.baseLocal.x;
  const dy = wristTarget.y - arm.baseLocal.y;
  const distance = Math.hypot(dx, dy);
  const minReach = Math.abs(arm.boomLength - arm.stickLength) + 0.08;
  const maxReach = arm.boomLength + arm.stickLength - 0.08;
  return distance >= minReach && distance <= maxReach && wristTarget.x > -2.6;
}

function spawnSoil(targetWorld, amount) {
  const count = clamp(Math.round(amount * 10), 3, 13);
  for (let i = 0; i < count; i += 1) {
    const body = world.createDynamicBody({
      position: Vec2(
        targetWorld.x + (Math.random() - 0.5) * 0.62,
        targetWorld.y + 0.2 + Math.random() * 0.5,
      ),
      linearVelocity: Vec2((Math.random() - 0.5) * 1.8, -0.5 - Math.random() * 1.2),
      angularVelocity: (Math.random() - 0.5) * 4,
    });
    body.setUserData({ kind: 'soil' });
    body.createFixture(pl.Circle(0.08 + Math.random() * 0.07), {
      density: 0.45,
      friction: 0.9,
      restitution: 0.02,
    });
  }
}

function offsetVec(v, x, y) {
  return Vec2(v.x + x, v.y + y);
}

function moveAngle(current, target, maxStep) {
  const delta = normalizeAngle(target - current);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

function angleDelta(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function frame(now) {
  const elapsed = Math.min((now - lastTime) / 1000, 0.06);
  lastTime = now;

  if (resetQueued) {
    resetQueued = false;
    buildWorld();
  }

  if (!paused) {
    accumulator += elapsed;
    const step = 1 / 60;
    let guard = 0;
    while (accumulator >= step && guard < 4) {
      update(step);
      world.step(step, 8, 3);
      accumulator -= step;
      guard += 1;
    }
  }

  updateCamera(elapsed);
  render();
  requestAnimationFrame(frame);
}

function update(dt) {
  desiredDrive = 0;
  if (keys.has('KeyA')) desiredDrive += 1;
  if (keys.has('KeyD')) desiredDrive -= 1;

  const targetSpeed = desiredDrive * settings.speed;
  const driveSign = Math.sign(targetSpeed);

  if (driveSign === 0) {
    sharedWheelSpeed *= Math.pow(0.025, dt);
  } else {
    sharedWheelSpeed += (targetSpeed - sharedWheelSpeed) * Math.min(1, dt * 3.8);
    const signedSpeeds = tank.wheels.map((wheel) => wheel.body.getAngularVelocity() * driveSign);
    const slowest = Math.min(...signedSpeeds);
    const lockedLimit = Math.max(0, slowest + 2.2);
    const signedTarget = Math.abs(sharedWheelSpeed);
    if (signedTarget > lockedLimit) {
      sharedWheelSpeed = driveSign * lockedLimit;
    }
  }

  for (const joint of tank.wheelJoints) {
    joint.setMotorSpeed(sharedWheelSpeed);
    joint.setMaxMotorTorque(settings.torque);
  }

  const averageSpin = tank.wheels.reduce((sum, wheel) => sum + wheel.body.getAngularVelocity(), 0) / tank.wheels.length;
  tank.drivePhase += averageSpin * tank.radius * dt * 1.15;
  updateArm(dt);

  const tankPosition = tank.chassis.getPosition();
  if (tankPosition.y < -8 || Math.abs(tankPosition.x) > 65) {
    resetQueued = true;
  }

  updateHud();
}

function updateHud() {
  const pct = Math.round(Math.abs(sharedWheelSpeed / Math.max(settings.speed, 1)) * 100);
  driveReadout.textContent = `${Math.min(100, pct)}%`;
  driveBar.style.transform = `scaleX(${Math.min(1, pct / 100)})`;
  const driveText = desiredDrive > 0 ? 'reverse' : desiredDrive < 0 ? 'forward' : 'idle';
  const armText = tank?.arm?.state && tank.arm.state !== 'ready' ? tank.arm.state : driveText;
  statusNode.textContent = paused ? 'paused' : armText;
}

function updatePauseButton() {
  pauseButton.textContent = paused ? 'Run' : 'Pause';
  pauseButton.title = paused ? 'Run simulation' : 'Pause simulation';
  pauseButton.setAttribute('aria-label', paused ? 'Run simulation' : 'Pause simulation');
  updateHud();
}

function updateCamera(dt) {
  const p = tank.chassis.getPosition();
  const targetX = p.x + 2.4;
  const targetY = Math.max(2.8, p.y - 0.35);
  const follow = 1 - Math.pow(0.001, dt);
  camera.x += (targetX - camera.x) * follow;
  camera.y += (targetY - camera.y) * follow;

  const narrow = window.innerWidth < 760;
  camera.zoom += ((narrow ? 43 : 58) - camera.zoom) * follow;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(v) {
  const sidebarOffset = window.innerWidth > 860 ? -128 : 0;
  return {
    x: (v.x - camera.x) * camera.zoom + canvas.clientWidth * 0.5 + sidebarOffset,
    y: (camera.y - v.y) * camera.zoom + canvas.clientHeight * 0.52,
  };
}

function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const sidebarOffset = window.innerWidth > 860 ? -128 : 0;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return Vec2(
    (x - canvas.clientWidth * 0.5 - sidebarOffset) / camera.zoom + camera.x,
    camera.y - (y - canvas.clientHeight * 0.52) / camera.zoom,
  );
}

function render() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  drawSky();
  drawGrid();
  drawFixtures();
  drawTank();
  drawForeground();
}

function drawSky() {
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
  gradient.addColorStop(0, '#a8c5d4');
  gradient.addColorStop(0.52, '#d7ddcc');
  gradient.addColorStop(1, '#e4dfcf');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
}

function drawGrid() {
  const step = camera.zoom;
  const origin = worldToScreen(Vec2(0, 0));
  ctx.save();
  ctx.strokeStyle = 'rgba(30, 43, 45, 0.08)';
  ctx.lineWidth = 1;
  for (let x = origin.x % step; x < canvas.clientWidth; x += step) {
    line(x, 0, x, canvas.clientHeight);
  }
  for (let y = origin.y % step; y < canvas.clientHeight; y += step) {
    line(0, y, canvas.clientWidth, y);
  }
  ctx.restore();
}

function drawFixtures() {
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    if (body === tank.chassis || tank.wheels.some((wheel) => wheel.body === body)) continue;

    for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
      const shape = fixture.getShape();
      const type = shape.getType();
      const dynamic = body.isDynamic();
      const kind = body.getUserData?.()?.kind;
      ctx.save();
      ctx.fillStyle = kind === 'soil' ? '#6d5131' : dynamic ? '#9c5f35' : '#5f7044';
      ctx.strokeStyle = kind === 'soil' ? '#49341f' : dynamic ? '#5b331f' : '#26341f';
      ctx.lineWidth = dynamic ? 2 : 3;

      if (type === 'edge') {
        const a = worldToScreen(body.getWorldPoint(shape.m_vertex1));
        const b = worldToScreen(body.getWorldPoint(shape.m_vertex2));
        ctx.strokeStyle = '#34402a';
        ctx.lineWidth = 5;
        line(a.x, a.y, b.x, b.y);
      } else if (type === 'polygon') {
        drawPolygon(body, shape);
        ctx.fill();
        ctx.stroke();
      } else if (type === 'circle') {
        drawCircle(body, shape);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

function drawTank() {
  drawTreadBelt();
  drawWheels();
  drawChassis();
  drawExcavatorArm();
  drawArmTarget();
}

function drawTreadBelt() {
  const points = tank.wheels.map((wheel) => worldToScreen(wheel.body.getPosition()));
  if (points.length < 3) return;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#171d20';
  ctx.lineWidth = tank.radius * camera.zoom * 1.72;
  traceClosed(points);
  ctx.stroke();

  ctx.strokeStyle = '#3a4241';
  ctx.lineWidth = tank.radius * camera.zoom * 0.78;
  traceClosed(points);
  ctx.stroke();

  const phase = ((tank.drivePhase * camera.zoom) % 24 + 24) % 24;
  ctx.strokeStyle = 'rgba(223, 218, 187, 0.75)';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 14]);
  ctx.lineDashOffset = -phase;
  traceClosed(points);
  ctx.stroke();
  ctx.restore();
}

function drawWheels() {
  ctx.save();
  for (const wheel of tank.wheels) {
    const center = worldToScreen(wheel.body.getPosition());
    const radius = wheel.radius * camera.zoom;
    ctx.fillStyle = '#323937';
    ctx.strokeStyle = '#111719';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#d8c886';
    ctx.lineWidth = 2;
    const angle = -wheel.body.getAngle();
    line(center.x, center.y, center.x + Math.cos(angle) * radius * 0.72, center.y + Math.sin(angle) * radius * 0.72);
  }
  ctx.restore();
}

function drawChassis() {
  const fixture = tank.chassis.getFixtureList();
  ctx.save();
  ctx.fillStyle = '#b94935';
  ctx.strokeStyle = '#2f241f';
  ctx.lineWidth = 3;
  drawPolygon(tank.chassis, fixture.getShape());
  ctx.fill();
  ctx.stroke();

  drawExcavatorCab();
  ctx.restore();
}

function drawExcavatorCab() {
  const rear = worldToScreen(tank.chassis.getWorldPoint(Vec2(-0.72, 0.58)));
  const front = worldToScreen(tank.chassis.getWorldPoint(Vec2(0.62, 0.58)));
  const roof = worldToScreen(tank.chassis.getWorldPoint(Vec2(0.38, 1.34)));
  const backRoof = worldToScreen(tank.chassis.getWorldPoint(Vec2(-0.8, 1.22)));
  ctx.save();
  ctx.fillStyle = '#a94632';
  ctx.strokeStyle = '#2f241f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rear.x, rear.y);
  ctx.lineTo(front.x, front.y);
  ctx.lineTo(roof.x, roof.y);
  ctx.lineTo(backRoof.x, backRoof.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const glassA = worldToScreen(tank.chassis.getWorldPoint(Vec2(-0.18, 0.72)));
  const glassB = worldToScreen(tank.chassis.getWorldPoint(Vec2(0.4, 0.72)));
  const glassC = worldToScreen(tank.chassis.getWorldPoint(Vec2(0.24, 1.13)));
  const glassD = worldToScreen(tank.chassis.getWorldPoint(Vec2(-0.28, 1.09)));
  ctx.fillStyle = '#91b0b7';
  ctx.beginPath();
  ctx.moveTo(glassA.x, glassA.y);
  ctx.lineTo(glassB.x, glassB.y);
  ctx.lineTo(glassC.x, glassC.y);
  ctx.lineTo(glassD.x, glassD.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawExcavatorArm() {
  const arm = tank.arm;
  const points = getArmLocalPoints(arm);
  ctx.save();
  drawHydraulics(points);
  drawLink(points.base, points.elbow, 0.28, '#d3952c', '#3b2a19');
  drawLink(points.elbow, points.wrist, 0.22, '#d3952c', '#3b2a19');
  drawJoint(points.base, 0.22);
  drawJoint(points.elbow, 0.18);
  drawJoint(points.wrist, 0.15);
  drawBucket(points);
  ctx.restore();
}

function getArmLocalPoints(arm) {
  const boomAbs = arm.boomAngle;
  const stickAbs = arm.boomAngle + arm.stickAngle;
  const bucketAbs = stickAbs + arm.bucketAngle;
  const base = arm.baseLocal;
  const elbow = Vec2(
    base.x + Math.cos(boomAbs) * arm.boomLength,
    base.y + Math.sin(boomAbs) * arm.boomLength,
  );
  const wrist = Vec2(
    elbow.x + Math.cos(stickAbs) * arm.stickLength,
    elbow.y + Math.sin(stickAbs) * arm.stickLength,
  );
  const tip = Vec2(
    wrist.x + Math.cos(bucketAbs) * arm.bucketLength,
    wrist.y + Math.sin(bucketAbs) * arm.bucketLength,
  );
  return { base, elbow, wrist, tip, bucketAbs, stickAbs };
}

function drawHydraulics(points) {
  ctx.save();
  ctx.strokeStyle = '#343733';
  ctx.lineWidth = 5;
  drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15));
  drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12));
  ctx.strokeStyle = '#c7b16e';
  ctx.lineWidth = 2;
  drawLocalLine(offsetLocal(points.base, -0.2, -0.08), offsetLocal(points.elbow, -0.45, -0.15));
  drawLocalLine(offsetLocal(points.elbow, 0.2, -0.2), offsetLocal(points.wrist, -0.28, -0.12));
  ctx.restore();
}

function drawLink(a, b, width, fill, stroke) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const nx = (-dy / length) * width * 0.5;
  const ny = (dx / length) * width * 0.5;
  const points = [
    Vec2(a.x + nx, a.y + ny),
    Vec2(b.x + nx, b.y + ny),
    Vec2(b.x - nx, b.y - ny),
    Vec2(a.x - nx, a.y - ny),
  ].map(localToScreen);

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawJoint(local, radius) {
  const p = localToScreen(local);
  ctx.fillStyle = '#383b36';
  ctx.strokeStyle = '#191d1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius * camera.zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawBucket(points) {
  const arm = tank.arm;
  const verts = [
    Vec2(0.02, 0.22),
    Vec2(0.48, 0.15),
    Vec2(0.72, -0.18),
    Vec2(0.28, -0.42),
    Vec2(-0.12, -0.18),
  ].map((point) => localBucketPoint(points.wrist, points.bucketAbs, point));

  ctx.fillStyle = '#5d5f59';
  ctx.strokeStyle = '#20231f';
  ctx.lineWidth = 3;
  traceLocalPolygon(verts);
  ctx.fill();
  ctx.stroke();

  if (arm.load > 0.02) {
    const loadVerts = [
      Vec2(0.12, 0.02),
      Vec2(0.46, -0.04),
      Vec2(0.42, -0.22),
      Vec2(0.06, -0.16),
    ].map((point) => localBucketPoint(points.wrist, points.bucketAbs, point));
    ctx.fillStyle = '#6d5131';
    traceLocalPolygon(loadVerts);
    ctx.fill();
  }
}

function drawArmTarget() {
  const arm = tank.arm;
  if (!arm.targetWorld || arm.targetFlash <= 0) return;
  const point = worldToScreen(arm.targetWorld);
  const radius = (0.22 + arm.targetFlash * 0.2) * camera.zoom;
  ctx.save();
  ctx.strokeStyle = arm.state === 'out of range' ? '#bb2f2f' : '#d3952c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  line(point.x - radius * 0.6, point.y, point.x + radius * 0.6, point.y);
  line(point.x, point.y - radius * 0.6, point.x, point.y + radius * 0.6);
  ctx.restore();
}

function localToScreen(local) {
  return worldToScreen(tank.chassis.getWorldPoint(local));
}

function offsetLocal(point, x, y) {
  return Vec2(point.x + x, point.y + y);
}

function localBucketPoint(origin, angle, point) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Vec2(
    origin.x + point.x * c - point.y * s,
    origin.y + point.x * s + point.y * c,
  );
}

function traceLocalPolygon(vertices) {
  ctx.beginPath();
  vertices.forEach((vertex, index) => {
    const point = localToScreen(vertex);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function drawLocalLine(a, b) {
  const start = localToScreen(a);
  const end = localToScreen(b);
  line(start.x, start.y, end.x, end.y);
}

function drawForeground() {
  const y = worldToScreen(Vec2(0, -2.2)).y;
  ctx.fillStyle = '#33402a';
  ctx.fillRect(0, y, canvas.clientWidth, canvas.clientHeight - y);
}

function drawPolygon(body, shape) {
  const vertices = shape.m_vertices;
  ctx.beginPath();
  for (let i = 0; i < vertices.length; i += 1) {
    const point = worldToScreen(body.getWorldPoint(vertices[i]));
    if (i === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function drawCircle(body, shape) {
  const point = worldToScreen(body.getWorldPoint(shape.m_p));
  const radius = shape.m_radius * camera.zoom;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
}

function traceClosed(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
}

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
