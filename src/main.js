import planck from 'planck';
import './styles.css';
import boomSvg from '../excavator_images/boom.svg?raw';
import chassisSvg from '../excavator_images/chassis.svg?raw';
import headTopSvg from '../excavator_images/head_top.svg?raw';
import jawBottomSvg from '../excavator_images/jaw_bottom.svg?raw';
import stickSvg from '../excavator_images/stick.svg?raw';
import tailSvg from '../excavator_images/tail.svg?raw';

const pl = planck;
const Vec2 = pl.Vec2;

const excavatorSvgSources = {
  boom: boomSvg,
  chassis: chassisSvg,
  headTop: headTopSvg,
  jawBottom: jawBottomSvg,
  stick: stickSvg,
  tail: tailSvg,
};

const excavatorSvg = {
  chassis: {
    viewBox: { width: 426.82097, height: 340.82208 },
    pivot: Vec2(236.6112, 57.62656),
  },
  boom: {
    viewBox: { width: 333.5395, height: 96.427896 },
    pivot: Vec2(45.4245129294211, 58.82864074727431),
    end: Vec2(297.2951131711393, 59.348611535867065),
  },
  stick: {
    viewBox: { width: 306.4821, height: 93.074541 },
    pivot: Vec2(39.42127534470046, 40.65460805369406),
    end: Vec2(282.2326913485542, 39.58668016199704),
  },
  headTop: {
    viewBox: { width: 364.81359, height: 189.71103 },
    pivot: Vec2(32.98793999999998, 137.32751000000002),
  },
  jawBottom: {
    viewBox: { width: 369.43248, height: 170.07074 },
    pivot: Vec2(32.16271999999998, 42.527180000000016),
  },
  tail: {
    viewBox: { width: 703.45694, height: 272.80054 },
    pivot: Vec2(688.4090006070649, 144.29343079847774),
  },
};

const excavatorArtScale = 0.0118;
const headJawArtScale = excavatorArtScale;
const jawOpenAngle = -0.48;
const jawClosedAngle = 0.2;

const excavatorImages = createExcavatorImages();

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
  chassisMass: 2,
  gravity: 18,
  armSpeed: 1.5,
};

const gamepadDeadzone = 0.14;
const directTargetSpeed = 4.1;
const directHeadTurnSpeed = 1.35;

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
];

const keys = new Set();
const pointerControl = {
  active: false,
  lastX: 0,
  lastY: 0,
  deltaLocal: Vec2(0, 0),
  lastInputAt: 0,
};
const joypad = {
  supported: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
  connected: false,
  index: null,
  id: '',
  drive: 0,
  armX: 0,
  armY: 0,
  headTurn: 0,
  jawOpen: false,
  lastAButton: false,
  active: false,
  lastInputAt: 0,
};
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

setupControls();
buildWorld();
resize();
requestAnimationFrame(frame);

window.addEventListener('resize', resize);
window.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  if (event.code === 'KeyA' || event.code === 'KeyD' || event.code === 'KeyQ' || event.code === 'KeyE' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
    keys.add(event.code);
    event.preventDefault();
  }
  if (event.code === 'Space') {
    joypad.jawOpen = !joypad.jawOpen;
    event.preventDefault();
  }
  if (event.code === 'KeyP') {
    paused = !paused;
    updatePauseButton();
    event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => {
  keys.delete(event.code);
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button === 0) {
    joypad.jawOpen = !joypad.jawOpen;
    event.preventDefault();
    return;
  }

  if (event.button !== 2) return;
  pointerControl.active = true;
  pointerControl.lastX = event.clientX;
  pointerControl.lastY = event.clientY;
  pointerControl.lastInputAt = performance.now();
  canvas.setPointerCapture?.(event.pointerId);
  event.preventDefault();
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointerControl.active) return;
  const dx = event.clientX - pointerControl.lastX;
  const dy = event.clientY - pointerControl.lastY;
  pointerControl.lastX = event.clientX;
  pointerControl.lastY = event.clientY;

  const precision = isPrecisionMode() ? 0.35 : 1;
  const worldDelta = Vec2((dx / camera.zoom) * precision, (-dy / camera.zoom) * precision);
  const localDelta = rotateVec(worldDelta, -tank.chassis.getAngle());
  pointerControl.deltaLocal = Vec2(
    pointerControl.deltaLocal.x + localDelta.x,
    pointerControl.deltaLocal.y + localDelta.y,
  );
  pointerControl.lastInputAt = performance.now();
  event.preventDefault();
});
canvas.addEventListener('pointerup', endPointerControl);
canvas.addEventListener('pointercancel', endPointerControl);
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

window.addEventListener('gamepadconnected', (event) => {
  joypad.index = event.gamepad.index;
  joypad.id = event.gamepad.id || 'Gamepad';
  joypad.connected = true;
  updateHud();
});
window.addEventListener('gamepaddisconnected', (event) => {
  if (joypad.index === event.gamepad.index) {
    joypad.connected = false;
    joypad.index = null;
    joypad.id = '';
    joypad.drive = 0;
    joypad.armX = 0;
    joypad.armY = 0;
    joypad.headTurn = 0;
    joypad.active = false;
    joypad.lastAButton = false;
    updateHud();
  }
});
resetButton.addEventListener('click', () => {
  resetQueued = true;
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  updatePauseButton();
});

function createExcavatorImages() {
  return Object.fromEntries(Object.entries(excavatorSvgSources).map(([key, svg]) => {
    const image = new Image();
    const asset = {
      image,
      loaded: false,
    };
    image.onload = () => {
      asset.loaded = true;
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(hideSvgPivotMarkers(svg))}`;
    return [key, asset];
  }));
}

function hideSvgPivotMarkers(svg) {
  return svg.replace(/<circle\b[^>]*inkscape:label="[^"]*pivot-point"[^>]*\/?>/g, (tag) => {
    if (tag.includes('style=')) return tag.replace(/style="[^"]*"/, 'style="display:none"');
    return tag.replace(/\/?>$/, ' style="display:none" />');
  });
}

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
  if (key === 'damping' || key === 'chassisMass') return value.toFixed(2);
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
    Vec2(-2.72, -0.5),
    Vec2(-2.24, -0.82),
    Vec2(2.36, -0.82),
    Vec2(2.82, -0.5),
    Vec2(2.58, 0.58),
    Vec2(-2.52, 0.64),
  ]), {
    density: settings.chassisMass,
    friction: 0.7,
    restitution: 0,
    filterGroupIndex: collision.tank,
  });
  chassis.createFixture(pl.Polygon([
    Vec2(-2.1, 0.52),
    Vec2(2.25, 0.5),
    Vec2(2.38, 1.18),
    Vec2(1.2, 2.74),
    Vec2(-0.8, 3.16),
    Vec2(-2.06, 1.46),
  ]), {
    density: settings.chassisMass * 0.16,
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
    arm: createExcavatorArm(chassis),
    tail: createExcavatorTail(chassis),
    chassisArtPivotLocal: Vec2(0.52, 2.78),
    radius,
    drivePhase: 0,
  };
}

function createExcavatorArm(chassis) {
  const boomLength = svgDistance(excavatorSvg.boom.pivot, excavatorSvg.boom.end) * excavatorArtScale;
  const stickLength = svgDistance(excavatorSvg.stick.pivot, excavatorSvg.stick.end) * excavatorArtScale;
  const headLength = (excavatorSvg.headTop.viewBox.width - excavatorSvg.headTop.pivot.x - 18) * headJawArtScale;
  const targetPose = {
    boomAngle: 1.05,
    stickAngle: -1.22,
    headAngle: -0.5,
    jawAngle: jawClosedAngle,
  };
  const arm = {
    chassis,
    baseLocal: Vec2(0.97, 2.33),
    boomLength,
    stickLength,
    headLength,
    headTipOffset: Vec2(headLength * 0.9, -0.56),
    boomWidth: 0.42,
    stickWidth: 0.4,
    jawOpenAngle,
    jawClosedAngle,
    limits: {
      boomAngle: [-0.65, 2.05],
      stickAngle: [-2.72, 1.42],
      headAngle: [-1.45, 1.05],
      jawAngle: [-0.58, 0.28],
    },
    motorTorque: {
      boomAngle: 640,
      stickAngle: 520,
      headAngle: 260,
      jawAngle: 180,
    },
    state: joypad.supported ? 'connect pad' : 'keyboard',
    targetWorld: null,
    directTargetLocal: null,
    desiredHeadAbs: null,
    directLimit: false,
    targetPose,
  };

  const initialPoints = getArmLocalPointsForPose(arm, arm.targetPose);
  const boomBody = createArmSegmentBody(
    chassis,
    segmentCenter(initialPoints.base, initialPoints.elbow),
    arm.targetPose.boomAngle,
    arm.boomLength,
    arm.boomWidth,
    0.18,
    'boom',
  );
  const stickBody = createArmSegmentBody(
    chassis,
    segmentCenter(initialPoints.elbow, initialPoints.wrist),
    initialPoints.stickAbs,
    arm.stickLength,
    arm.stickWidth,
    0.16,
    'stick',
  );
  const headTopBody = createHeadBody(chassis, initialPoints.wrist, initialPoints.headAbs);
  const jawBottomBody = createJawBody(chassis, initialPoints.wrist, initialPoints.headAbs + arm.targetPose.jawAngle);

  arm.bodies = {
    boom: boomBody,
    stick: stickBody,
    headTop: headTopBody,
    jawBottom: jawBottomBody,
  };

  arm.joints = {
    boomAngle: createArmJoint(chassis, boomBody, chassis.getWorldPoint(initialPoints.base), arm.limits.boomAngle, arm.motorTorque.boomAngle),
    stickAngle: createArmJoint(boomBody, stickBody, chassis.getWorldPoint(initialPoints.elbow), arm.limits.stickAngle, arm.motorTorque.stickAngle),
    headAngle: createArmJoint(stickBody, headTopBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.headAngle, arm.motorTorque.headAngle),
    jawAngle: createArmJoint(headTopBody, jawBottomBody, chassis.getWorldPoint(initialPoints.wrist), arm.limits.jawAngle, arm.motorTorque.jawAngle),
  };

  arm.workspaceSample = sampleArmWorkspace(arm, 0.05);
  arm.workspaceBounds = getWorkspaceBounds(arm.workspaceSample);
  arm.directTargetLocal = Vec2(initialPoints.wrist.x, initialPoints.wrist.y);
  arm.desiredHeadAbs = initialPoints.headAbs;
  arm.targetWorld = chassis.getWorldPoint(arm.directTargetLocal);

  return arm;
}

function createExcavatorTail(chassis) {
  return {
    chassis,
    localPivot: Vec2(-1.84, 0.72),
    baseAngle: -Math.PI / 4,
    offset: 0,
    velocity: 0,
  };
}

function createArmSegmentBody(chassis, centerLocal, angleLocal, length, width, density, part) {
  const body = world.createDynamicBody({
    position: chassis.getWorldPoint(centerLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 1.8,
    linearDamping: 0.35,
    bullet: true,
  });
  body.setUserData({ kind: 'arm', part });
  body.createFixture(pl.Box(length * 0.5, width * 0.5), {
    density,
    friction: 0.85,
    restitution: 0,
    filterGroupIndex: collision.tank,
  });
  return body;
}

function createHeadBody(chassis, wristLocal, angleLocal) {
  const body = world.createDynamicBody({
    position: chassis.getWorldPoint(wristLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 5.2,
    linearDamping: 0.82,
    bullet: true,
  });
  body.setUserData({ kind: 'arm', part: 'headTop' });
  body.createFixture(pl.Polygon(getHeadTopLocalVertices()), {
    density: 0.06,
    friction: 0.92,
    restitution: 0.01,
    filterGroupIndex: collision.tank,
  });
  return body;
}

function createJawBody(chassis, wristLocal, angleLocal) {
  const body = world.createDynamicBody({
    position: chassis.getWorldPoint(wristLocal),
    angle: chassis.getAngle() + angleLocal,
    angularDamping: 5.8,
    linearDamping: 0.88,
    bullet: true,
  });
  body.setUserData({ kind: 'arm', part: 'jawBottom' });
  body.createFixture(pl.Polygon(getJawBottomLocalVertices()), {
    density: 0.054,
    friction: 0.95,
    restitution: 0.01,
    filterGroupIndex: collision.tank,
  });
  return body;
}

function getHeadTopLocalVertices() {
  const length = tank?.arm?.headLength ?? (excavatorSvg.headTop.viewBox.width - excavatorSvg.headTop.pivot.x - 18) * headJawArtScale;
  return [
    Vec2(-0.06, -0.24),
    Vec2(0.38, 0.92),
    Vec2(length * 0.58, 1.18),
    Vec2(length, 0.44),
    Vec2(length * 0.95, -0.22),
    Vec2(0.42, -0.44),
  ];
}

function getJawBottomLocalVertices() {
  const length = tank?.arm?.headLength ?? (excavatorSvg.headTop.viewBox.width - excavatorSvg.headTop.pivot.x - 18) * headJawArtScale;
  return [
    Vec2(-0.05, 0.12),
    Vec2(0.58, 0.22),
    Vec2(length, -0.42),
    Vec2(length * 0.92, -1.3),
    Vec2(0.48, -1.12),
    Vec2(-0.08, -0.16),
  ];
}

function createArmJoint(parent, child, anchorWorld, limits, maxMotorTorque) {
  return world.createJoint(pl.RevoluteJoint({
    // With zero reference angle, Planck's joint angle is the child link's local angle relative to its parent link.
    referenceAngle: 0,
    enableLimit: true,
    lowerAngle: limits[0],
    upperAngle: limits[1],
    enableMotor: true,
    motorSpeed: 0,
    maxMotorTorque,
    collideConnected: false,
  }, parent, child, anchorWorld));
}

function segmentCenter(a, b) {
  return Vec2((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
}

function svgDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function svgPivotAngle(a, b) {
  return Math.atan2(-(b.y - a.y), b.x - a.x);
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

  for (let i = 2; i <= 4; i += 2) {
    const theta = -Math.PI / 2 + (i / 5) * Math.PI;
    points.push(Vec2(halfLength + Math.cos(theta) * endRadius, centerY + Math.sin(theta) * endRadius));
  }

  for (let i = 1; i < 7; i += 1) {
    const t = i / 6;
    points.push(Vec2(halfLength - t * halfLength * 2, topY));
  }

  for (let i = 2; i <= 4; i += 2) {
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

function updateArm(dt) {
  const arm = tank.arm;
  ensureDirectArmTarget(arm);
  clampDesiredHeadAbsToCurrentPose(arm);
  updateDirectHeadTarget(arm, dt);

  const jawAngle = joypad.jawOpen ? arm.jawOpenAngle : arm.jawClosedAngle;
  const blockedByInput = moveDirectArmTarget(arm, dt, jawAngle);

  const solved = solveDirectArmPose(arm, arm.directTargetLocal, jawAngle);
  if (solved) {
    arm.targetPose = solved;
    clampDesiredHeadAbsToPose(arm, arm.targetPose);
    arm.directLimit = blockedByInput;
  } else {
    arm.targetPose = { ...arm.targetPose, jawAngle };
    clampDesiredHeadAbsToCurrentPose(arm);
    arm.directLimit = true;
  }

  driveArmJoints(arm, arm.targetPose);
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
  arm.state = getDirectArmState(arm);
}

function ensureDirectArmTarget(arm) {
  if (arm.directTargetLocal && arm.desiredHeadAbs != null) return;

  const points = getArmLocalPoints(arm);
  arm.directTargetLocal = Vec2(points.wrist.x, points.wrist.y);
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, points.headAbs, getArmJointAngles(arm));
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
}

function updateDirectHeadTarget(arm, dt) {
  const headTurn = getCombinedHeadTurn();
  if (!headTurn) return;
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(
    arm,
    normalizeAngle(arm.desiredHeadAbs + headTurn * directHeadTurnSpeed * getPrecisionScale() * dt),
    getArmJointAngles(arm),
  );
}

function moveDirectArmTarget(arm, dt, jawAngle) {
  const stickMagnitude = Math.hypot(joypad.armX, joypad.armY);
  const pointerDelta = pointerControl.deltaLocal;
  pointerControl.deltaLocal = Vec2(0, 0);

  if (stickMagnitude <= 0 && Math.hypot(pointerDelta.x, pointerDelta.y) <= 0) return false;

  const scale = Math.min(1, stickMagnitude);
  const worldDelta = Vec2(
    stickMagnitude > 0 ? (joypad.armX / stickMagnitude) * scale * directTargetSpeed * getPrecisionScale() * dt : 0,
    stickMagnitude > 0 ? (joypad.armY / stickMagnitude) * scale * directTargetSpeed * getPrecisionScale() * dt : 0,
  );
  const stickDelta = rotateVec(worldDelta, -tank.chassis.getAngle());
  const dx = stickDelta.x + pointerDelta.x;
  const dy = stickDelta.y + pointerDelta.y;
  const current = arm.directTargetLocal;
  const fullMove = Vec2(current.x + dx, current.y + dy);

  if (trySetDirectArmTarget(arm, fullMove, jawAngle)) return false;

  const xOnly = Vec2(current.x + dx, current.y);
  const yOnly = Vec2(current.x, current.y + dy);
  const first = Math.abs(dx) >= Math.abs(dy) ? xOnly : yOnly;
  const second = first === xOnly ? yOnly : xOnly;

  if (trySetDirectArmTarget(arm, first, jawAngle)) return false;
  if (trySetDirectArmTarget(arm, second, jawAngle)) return false;

  return true;
}

function trySetDirectArmTarget(arm, targetLocal, jawAngle) {
  const clamped = clampArmTargetToWorkspace(arm, targetLocal);
  const solved = solveDirectArmPose(arm, clamped, jawAngle);
  if (!solved) return false;
  arm.directTargetLocal = clamped;
  arm.targetPose = solved;
  clampDesiredHeadAbsToPose(arm, solved);
  arm.directLimit = false;
  return true;
}

function clampDesiredHeadAbsToCurrentPose(arm) {
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, getArmJointAngles(arm));
}

function clampDesiredHeadAbsToPose(arm, pose) {
  arm.desiredHeadAbs = clampHeadAbsToPoseLimits(arm, arm.desiredHeadAbs, pose);
}

function clampHeadAbsToPoseLimits(arm, targetHeadAbs, pose) {
  const stickAbs = normalizeAngle(pose.boomAngle + pose.stickAngle);
  const [headMin, headMax] = arm.limits.headAngle;
  const localHead = clamp(normalizeAngle(targetHeadAbs - stickAbs), headMin, headMax);
  return normalizeAngle(stickAbs + localHead);
}

function clampArmTargetToWorkspace(arm, targetLocal) {
  const bounds = arm.workspaceBounds;
  if (!bounds) return targetLocal;
  return Vec2(
    clamp(targetLocal.x, bounds.minX, bounds.maxX),
    clamp(targetLocal.y, bounds.minY, bounds.maxY),
  );
}

function solveDirectArmPose(arm, targetLocal, jawAngle) {
  return findBestArmPose(arm, targetLocal, {
    headAbs: arm.desiredHeadAbs,
    jawAngle,
  });
}

function getDirectArmState(arm) {
  if (arm.directLimit) return 'arm limit';
  if (pointerControl.active || wasPointerRecentlyActive()) return 'mouse';
  if (isKeyboardArmActive()) return 'keyboard';
  if (joypad.connected && joypad.active) return 'joypad';
  if (joypad.jawOpen) return 'jaw open';
  return joypad.connected ? 'pad ready' : 'direct';
}

function getCombinedHeadTurn() {
  return joypad.headTurn + (keys.has('KeyQ') ? 1 : 0) + (keys.has('KeyE') ? -1 : 0);
}

function getPrecisionScale() {
  return isPrecisionMode() ? 0.35 : 1;
}

function isPrecisionMode() {
  return keys.has('ShiftLeft') || keys.has('ShiftRight');
}

function isKeyboardArmActive() {
  return keys.has('KeyQ') || keys.has('KeyE');
}

function wasPointerRecentlyActive() {
  return performance.now() - pointerControl.lastInputAt < 350;
}

function driveArmJoints(arm, pose) {
  driveArmJoint(arm, 'boomAngle', pose.boomAngle, 1);
  driveArmJoint(arm, 'stickAngle', pose.stickAngle, 1.08);
  driveArmJoint(arm, 'headAngle', pose.headAngle, 1.28);
  driveArmJoint(arm, 'jawAngle', pose.jawAngle, 1.65);
}

function driveArmJoint(arm, key, target, speedScale) {
  const joint = arm.joints[key];
  const error = normalizeAngle(target - joint.getJointAngle());
  const damping = joint.getJointSpeed() * 0.22;
  const maxSpeed = settings.armSpeed * speedScale;
  const motorSpeed = clamp(error * settings.armSpeed * 3.2 - damping, -maxSpeed, maxSpeed);
  joint.setMaxMotorTorque(arm.motorTorque[key]);
  joint.setMotorSpeed(Math.abs(error) < 0.01 ? 0 : motorSpeed);
}

function findBestArmPose(arm, wristLocal, options = {}) {
  const candidates = findArmIKCandidates(arm, wristLocal, options);
  return candidates[0]?.pose ?? null;
}

function findArmIKCandidates(arm, wristLocal, options = {}) {
  const current = getArmJointAngles(arm);
  const candidates = [];
  const desiredHeadAbs = options.headAbs ?? normalizeAngle(current.boomAngle + current.stickAngle + current.headAngle);
  const jawAngle = clamp(options.jawAngle ?? current.jawAngle ?? arm.jawClosedAngle, arm.limits.jawAngle[0], arm.limits.jawAngle[1]);
  const dx = wristLocal.x - arm.baseLocal.x;
  const dy = wristLocal.y - arm.baseLocal.y;
  const l1 = arm.boomLength;
  const l2 = arm.stickLength;
  const distance = Math.hypot(dx, dy);
  const minReach = Math.abs(l1 - l2) + 0.04;
  const maxReach = l1 + l2 - 0.04;
  if (distance < minReach || distance > maxReach) return candidates;

  const theta = Math.atan2(dy, dx);
  const elbowMagnitude = Math.acos(clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  for (const stickAngle of [elbowMagnitude, -elbowMagnitude]) {
    const boomAngle = normalizeAngle(theta - Math.atan2(l2 * Math.sin(stickAngle), l1 + l2 * Math.cos(stickAngle)));
    const stickAngleLocal = normalizeAngle(stickAngle);
    const idealHeadAngle = normalizeAngle(desiredHeadAbs - boomAngle - stickAngleLocal);
    const headAngle = clamp(idealHeadAngle, arm.limits.headAngle[0], arm.limits.headAngle[1]);
    const pose = { boomAngle, stickAngle: stickAngleLocal, headAngle, jawAngle };
    if (!isArmPoseValid(arm, pose)) continue;
    candidates.push({
      pose,
      score: scoreArmCandidate(arm, pose, current, desiredHeadAbs),
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function isArmPoseValid(arm, pose) {
  if (!isArmPoseWithinLimits(arm, pose, 0)) return false;
  const points = getArmLocalPointsForPose(arm, pose);
  if (points.wrist.x < -2.6 || points.tip.x < -2.8) return false;
  if (Vec2.distance(points.wrist, points.base) < 0.42) return false;
  return true;
}

function isArmPoseWithinLimits(arm, pose, margin = 0) {
  return Object.entries(arm.limits).every(([key, [min, max]]) => (
    pose[key] >= min + margin && pose[key] <= max - margin
  ));
}

function scoreArmCandidate(arm, pose, current, desiredHeadAbs) {
  const headAbs = normalizeAngle(pose.boomAngle + pose.stickAngle + pose.headAngle);
  const continuity =
    angleDelta(pose.boomAngle, current.boomAngle) * 1.1 +
    angleDelta(pose.stickAngle, current.stickAngle) * 0.85 +
    angleDelta(pose.headAngle, current.headAngle) * 0.42 +
    angleDelta(pose.jawAngle, current.jawAngle) * 0.18;
  const orientation = angleDelta(headAbs, desiredHeadAbs) * 0.9;
  const speed =
    Math.abs(arm.joints.boomAngle.getJointSpeed()) * 0.018 +
    Math.abs(arm.joints.stickAngle.getJointSpeed()) * 0.014 +
    Math.abs(arm.joints.headAngle.getJointSpeed()) * 0.008 +
    Math.abs(arm.joints.jawAngle.getJointSpeed()) * 0.006;
  const limitPenalty = Object.entries(arm.limits).reduce((sum, [key, [min, max]]) => {
    const clearance = Math.min(pose[key] - min, max - pose[key]);
    return sum + Math.max(0, 0.18 - clearance) * 1.8;
  }, 0);

  return continuity + orientation + speed + limitPenalty;
}

function sampleArmWorkspace(arm, step = 0.3) {
  const samples = [];
  const [boomMin, boomMax] = arm.limits.boomAngle;
  const [stickMin, stickMax] = arm.limits.stickAngle;

  for (let boomAngle = boomMin; boomAngle <= boomMax; boomAngle += step) {
    for (let stickAngle = stickMin; stickAngle <= stickMax; stickAngle += step) {
      const pose = { boomAngle, stickAngle, headAngle: arm.targetPose.headAngle, jawAngle: arm.jawClosedAngle };
      if (isArmPoseValid(arm, pose)) {
        samples.push(getArmLocalPointsForPose(arm, pose).wrist);
      }
    }
  }

  return samples;
}

function getWorkspaceBounds(samples) {
  if (!samples.length) return null;
  return samples.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    maxX: Math.max(bounds.maxX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function rotateVec(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Vec2(v.x * c - v.y * s, v.x * s + v.y * c);
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

function pollJoypad() {
  if (!joypad.supported) {
    joypad.active = false;
    return;
  }

  const gamepad = getActiveGamepad();
  if (!gamepad) {
    joypad.connected = false;
    joypad.index = null;
    joypad.id = '';
    joypad.drive = 0;
    joypad.armX = 0;
    joypad.armY = 0;
    joypad.headTurn = 0;
    joypad.active = false;
    joypad.lastAButton = false;
    return;
  }

  joypad.connected = true;
  joypad.index = gamepad.index;
  joypad.id = gamepad.id || 'Gamepad';

  const leftX = applyStickDeadzone(gamepad.axes[0] ?? 0);
  const rightX = applyStickDeadzone(gamepad.axes[2] ?? 0);
  const rightY = applyStickDeadzone(gamepad.axes[3] ?? 0);
  const aPressed = isGamepadButtonPressed(gamepad.buttons[0]);
  const leftBumper = isGamepadButtonPressed(gamepad.buttons[4]);
  const rightBumper = isGamepadButtonPressed(gamepad.buttons[5]);

  if (aPressed && !joypad.lastAButton) {
    joypad.jawOpen = !joypad.jawOpen;
  }

  joypad.lastAButton = aPressed;
  joypad.drive = -leftX;
  joypad.armX = rightX;
  joypad.armY = -rightY;
  joypad.headTurn = (leftBumper ? 1 : 0) + (rightBumper ? -1 : 0);
  joypad.active = (
    Math.abs(leftX) > 0 ||
    Math.abs(rightX) > 0 ||
    Math.abs(rightY) > 0 ||
    aPressed ||
    leftBumper ||
    rightBumper
  );

  if (joypad.active) joypad.lastInputAt = performance.now();
}

function endPointerControl(event) {
  if (!pointerControl.active) return;
  pointerControl.active = false;
  pointerControl.lastInputAt = performance.now();
  if (event?.pointerId != null) {
    canvas.releasePointerCapture?.(event.pointerId);
  }
  event?.preventDefault();
}

function getActiveGamepad() {
  const gamepads = navigator.getGamepads?.();
  if (!gamepads) return null;

  if (joypad.index != null && gamepads[joypad.index]?.connected) {
    return gamepads[joypad.index];
  }

  return Array.from(gamepads).find((gamepad) => gamepad?.connected) ?? null;
}

function isGamepadButtonPressed(button) {
  return Boolean(button && (button.pressed || button.value > 0.5));
}

function applyStickDeadzone(value) {
  const magnitude = Math.abs(value);
  if (magnitude < gamepadDeadzone) return 0;
  return Math.sign(value) * ((magnitude - gamepadDeadzone) / (1 - gamepadDeadzone));
}

function update(dt) {
  pollJoypad();

  let keyboardDrive = 0;
  if (keys.has('KeyA')) keyboardDrive += 1;
  if (keys.has('KeyD')) keyboardDrive -= 1;
  desiredDrive = Math.abs(joypad.drive) > 0 ? joypad.drive : keyboardDrive;

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
  updateTail(dt);

  const tankPosition = tank.chassis.getPosition();
  if (tankPosition.y < -8 || Math.abs(tankPosition.x) > 65) {
    resetQueued = true;
  }

  updateHud();
}

function updateTail(dt) {
  const tail = tank.tail;
  const driveTarget = clamp(-sharedWheelSpeed * 0.012 - tank.chassis.getAngularVelocity() * 0.035, -0.18, 0.18);
  const spring = (driveTarget - tail.offset) * 42;
  const damping = tail.velocity * 8.5;
  tail.velocity += (spring - damping) * dt;
  tail.offset = clamp(tail.offset + tail.velocity * dt, -0.26, 0.26);
}

function updateHud() {
  const pct = Math.round(Math.abs(sharedWheelSpeed / Math.max(settings.speed, 1)) * 100);
  driveReadout.textContent = `${Math.min(100, pct)}%`;
  driveBar.style.transform = `scaleX(${Math.min(1, pct / 100)})`;
  const driveText = desiredDrive > 0 ? 'reverse' : desiredDrive < 0 ? 'forward' : 'idle';
  const armText = tank?.arm?.state ?? (joypad.supported ? 'connect pad' : 'keyboard');

  if (paused) {
    statusNode.textContent = 'paused';
  } else if (armText === 'arm limit') {
    statusNode.textContent = armText;
  } else if (armText !== 'direct' || joypad.connected) {
    statusNode.textContent = armText;
  } else if (driveText !== 'idle') {
    statusNode.textContent = driveText;
  } else {
    statusNode.textContent = armText;
  }
}

function updatePauseButton() {
  pauseButton.textContent = paused ? 'Run' : 'Pause';
  pauseButton.title = paused ? 'Run simulation' : 'Pause simulation';
  pauseButton.setAttribute('aria-label', paused ? 'Run simulation' : 'Pause simulation');
  updateHud();
}

function updateCamera(dt) {
  const p = tank.chassis.getPosition();
  const targetX = p.x + 1.25;
  const targetY = Math.max(3.4, p.y + 0.15);
  const follow = 1 - Math.pow(0.001, dt);
  camera.x += (targetX - camera.x) * follow;
  camera.y += (targetY - camera.y) * follow;

  const narrow = window.innerWidth < 760;
  camera.zoom += ((narrow ? 38 : 52) - camera.zoom) * follow;
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
    if (body.getUserData?.()?.kind === 'arm') continue;

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
  drawExcavatorTail();
  drawExcavatorStick();
  drawExcavatorBoom();
  drawChassis();
  drawExcavatorHeadTop();
  drawExcavatorJawBottom();
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
  ctx.save();
  drawSvgAtAnchor(
    excavatorImages.chassis,
    tank.chassis.getWorldPoint(tank.chassisArtPivotLocal),
    tank.chassis.getAngle(),
    excavatorSvg.chassis.pivot,
    excavatorArtScale,
  );
  ctx.restore();
}

function drawExcavatorTail() {
  const tail = tank.tail;
  drawSvgAtAnchor(
    excavatorImages.tail,
    tank.chassis.getWorldPoint(tail.localPivot),
    tank.chassis.getAngle() + tail.baseAngle + tail.offset,
    excavatorSvg.tail.pivot,
    excavatorArtScale,
  );
}

function drawExcavatorBoom() {
  const arm = tank.arm;
  const points = getArmLocalPoints(arm);
  ctx.save();
  drawHydraulics(points);
  drawSvgBodyBetweenPivots(arm.bodies.boom, excavatorImages.boom, excavatorSvg.boom);
  ctx.restore();
}

function drawExcavatorStick() {
  const arm = tank.arm;
  ctx.save();
  drawSvgBodyBetweenPivots(arm.bodies.stick, excavatorImages.stick, excavatorSvg.stick);
  ctx.restore();
}

function drawExcavatorHeadTop() {
  const arm = tank.arm;
  ctx.save();
  drawSvgBodyAtPivot(arm.bodies.headTop, excavatorImages.headTop, excavatorSvg.headTop, headJawArtScale);
  ctx.restore();
}

function drawExcavatorJawBottom() {
  const arm = tank.arm;
  ctx.save();
  drawSvgBodyAtPivot(arm.bodies.jawBottom, excavatorImages.jawBottom, excavatorSvg.jawBottom, headJawArtScale);
  ctx.restore();
}

function getArmLocalPoints(arm) {
  if (!arm.bodies) return getArmLocalPointsForPose(arm, arm.targetPose);
  const points = getArmWorldPoints(arm);
  return {
    base: tank.chassis.getLocalPoint(points.base),
    elbow: tank.chassis.getLocalPoint(points.elbow),
    wrist: tank.chassis.getLocalPoint(points.wrist),
    tip: tank.chassis.getLocalPoint(points.tip),
    headAbs: normalizeAngle(arm.bodies.headTop.getAngle() - tank.chassis.getAngle()),
    jawAbs: normalizeAngle(arm.bodies.jawBottom.getAngle() - tank.chassis.getAngle()),
    jawAngle: arm.joints.jawAngle.getJointAngle(),
    stickAbs: normalizeAngle(arm.bodies.stick.getAngle() - tank.chassis.getAngle()),
  };
}

function getArmWorldPoints(arm) {
  return {
    base: arm.chassis.getWorldPoint(arm.baseLocal),
    elbow: arm.bodies.boom.getWorldPoint(Vec2(arm.boomLength * 0.5, 0)),
    wrist: arm.bodies.stick.getWorldPoint(Vec2(arm.stickLength * 0.5, 0)),
    tip: arm.bodies.headTop.getWorldPoint(arm.headTipOffset),
  };
}

function getArmLocalPointsForPose(arm, pose) {
  const boomAbs = pose.boomAngle;
  const stickAbs = pose.boomAngle + pose.stickAngle;
  const headAbs = stickAbs + pose.headAngle;
  const base = Vec2(arm.baseLocal.x, arm.baseLocal.y);
  const elbow = Vec2(
    base.x + Math.cos(boomAbs) * arm.boomLength,
    base.y + Math.sin(boomAbs) * arm.boomLength,
  );
  const wrist = Vec2(
    elbow.x + Math.cos(stickAbs) * arm.stickLength,
    elbow.y + Math.sin(stickAbs) * arm.stickLength,
  );
  const tipOffset = rotateVec(arm.headTipOffset, headAbs);
  const tip = Vec2(
    wrist.x + tipOffset.x,
    wrist.y + tipOffset.y,
  );
  return { base, elbow, wrist, tip, headAbs, jawAbs: headAbs + pose.jawAngle, stickAbs };
}

function getArmJointAngles(arm) {
  if (!arm.joints) return arm.targetPose;
  return {
    boomAngle: arm.joints.boomAngle.getJointAngle(),
    stickAngle: arm.joints.stickAngle.getJointAngle(),
    headAngle: arm.joints.headAngle.getJointAngle(),
    jawAngle: arm.joints.jawAngle.getJointAngle(),
  };
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

function drawSvgBodyBetweenPivots(body, imageAsset, svg) {
  const anchor = segmentCenter(svg.pivot, svg.end);
  const angle = body.getAngle() - svgPivotAngle(svg.pivot, svg.end);
  drawSvgAtAnchor(imageAsset, body.getPosition(), angle, anchor, excavatorArtScale);
}

function drawSvgBodyAtPivot(body, imageAsset, svg, scale = excavatorArtScale) {
  drawSvgAtAnchor(imageAsset, body.getPosition(), body.getAngle(), svg.pivot, scale);
}

function drawSvgAtAnchor(imageAsset, anchorWorld, angle, anchorSvg, scale) {
  if (!imageAsset.loaded) return;

  const anchor = worldToScreen(anchorWorld);
  ctx.save();
  ctx.translate(anchor.x, anchor.y);
  ctx.rotate(-angle);
  ctx.scale(camera.zoom * scale, camera.zoom * scale);
  ctx.drawImage(imageAsset.image, -anchorSvg.x, -anchorSvg.y);
  ctx.restore();
}

function drawArmTarget() {
  const arm = tank.arm;
  if (!arm.directTargetLocal) return;
  arm.targetWorld = arm.chassis.getWorldPoint(arm.directTargetLocal);
  const point = worldToScreen(arm.targetWorld);
  const radius = 0.2 * camera.zoom;
  ctx.save();
  ctx.strokeStyle = arm.directLimit ? '#bb2f2f' : '#d3952c';
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
