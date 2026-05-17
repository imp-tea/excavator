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
    load: 0,
    state: 'ready',
    action: null,
    targetWorld: null,
    targetFlash: 0,
    restTipLocal: Vec2(6.4, 2.45),
    restHeadAbs: -0.65,
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

function commandArm(kind, targetWorld) {
  if (!tank?.arm) return;
  const arm = tank.arm;
  const action = kind === 'dump' ? createDumpAction(targetWorld) : createScoopAction(targetWorld);

  if (!isActionReachable(arm, action)) {
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
      { state: 'reach', world: offsetVec(targetWorld, -0.45, 1.35), headWorld: -0.62, jawAngle: jawOpenAngle, tolerance: 0.16, tipTolerance: 0.7 },
      { state: 'lower', world: offsetVec(targetWorld, -0.18, 0.42), headWorld: -0.7, jawAngle: jawOpenAngle, tolerance: 0.16, tipTolerance: 0.72 },
      { state: 'bite', world: offsetVec(targetWorld, 0.12, 0.28), headWorld: -0.5, jawAngle: jawClosedAngle, tolerance: 0.22, tipTolerance: 0.82, hold: 0.18, capture: true },
      { state: 'lift', world: offsetVec(targetWorld, -0.02, 1.42), headWorld: -0.42, jawAngle: jawClosedAngle, tolerance: 0.16, tipTolerance: 0.72 },
      { state: 'stow arm', restPose: 'stickCurl', tolerance: 0.14 },
    ],
  };
}

function createDumpAction(targetWorld) {
  return {
    kind: 'dump',
    index: 0,
    hold: 0,
    phases: [
      { state: 'carry', world: offsetVec(targetWorld, -0.05, 1.2), headWorld: -0.36, jawAngle: jawClosedAngle, tolerance: 0.16, tipTolerance: 0.72 },
      { state: 'place', world: offsetVec(targetWorld, 0.06, 0.62), headWorld: -0.42, jawAngle: jawClosedAngle, tolerance: 0.16, tipTolerance: 0.78 },
      { state: 'release', world: offsetVec(targetWorld, 0.06, 0.74), headWorld: -0.48, jawAngle: jawOpenAngle, tolerance: 0.18, tipTolerance: 0.8, hold: 0.28, release: true },
      { state: 'recover', world: offsetVec(targetWorld, -0.22, 1.36), headWorld: -0.64, jawAngle: jawOpenAngle, tolerance: 0.17, tipTolerance: 0.72 },
      { state: 'stow arm', restPose: 'stickCurl', tolerance: 0.14 },
    ],
  };
}

function updateArm(dt) {
  const arm = tank.arm;
  arm.targetFlash = Math.max(0, arm.targetFlash - dt * 1.8);

  let targetLocal = arm.restTipLocal;
  let headLocal = arm.restHeadAbs;
  let jawLocal = arm.targetPose.jawAngle;
  const action = arm.action;
  let phase = null;

  if (action) {
    phase = action.phases[action.index];
    arm.state = phase.state;
    targetLocal = phase.rest ? arm.restTipLocal : phase.world ? tank.chassis.getLocalPoint(phase.world) : null;
    headLocal = phase.rest ? arm.restHeadAbs : phase.headWorld != null ? worldAngleToChassisLocal(phase.headWorld) : null;
    jawLocal = phase.jawAngle ?? jawLocal;

  } else {
    arm.state = arm.targetFlash > 0 ? arm.state : 'ready';
  }

  if (phase?.restPose) {
    arm.targetPose = getRestPoseTarget(arm, phase.restPose);
  } else if (!action) {
    arm.targetPose = getRestPoseTarget(arm, 'stickCurl');
  } else {
    const solved = findBestArmPose(arm, targetLocal, headLocal, {
      jawAngle: jawLocal,
      orientationSlack: action ? 0.22 : 0.35,
      orientationWeight: action ? 1.35 : 0.8,
    });

    if (solved) {
      arm.targetPose = solved;
    } else if (action) {
      arm.action = null;
      arm.state = 'out of range';
      driveArmJoints(arm, arm.targetPose);
      return;
    }
  }

  driveArmJoints(arm, arm.targetPose);

  if (!action) return;

  const currentTipError = phase.restPose ? 0 : Vec2.distance(getArmLocalPoints(arm).tip, targetLocal);
  const poseError = getPhasePoseError(arm, phase);

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

function getRestPoseTarget(arm, restPose) {
  const [, boomMax] = arm.limits.boomAngle;
  const [stickMin] = arm.limits.stickAngle;

  if (restPose === 'jawClose') {
    return { ...arm.targetPose, jawAngle: arm.jawClosedAngle };
  }

  if (restPose === 'boomRaise') {
    return { ...arm.targetPose, boomAngle: boomMax, headAngle: -0.46, jawAngle: arm.jawClosedAngle };
  }

  if (restPose === 'stickCurl') {
    return { boomAngle: Math.min(boomMax, 1.48), stickAngle: Math.max(stickMin, -1.76), headAngle: -0.44, jawAngle: arm.jawClosedAngle };
  }

  return arm.targetPose;
}

function getPhasePoseError(arm, phase) {
  const keys = phase.restPose
    ? getRestPoseKeys(phase.restPose)
    : ['boomAngle', 'stickAngle', 'headAngle', 'jawAngle'];
  return Math.max(...keys.map((key) => angleDelta(arm.joints[key].getJointAngle(), arm.targetPose[key])));
}

function getRestPoseKeys(restPose) {
  if (restPose === 'jawClose') return ['jawAngle'];
  if (restPose === 'boomRaise') return ['boomAngle', 'headAngle', 'jawAngle'];
  if (restPose === 'stickCurl') return ['boomAngle', 'stickAngle', 'headAngle', 'jawAngle'];
  return ['boomAngle', 'stickAngle', 'headAngle', 'jawAngle'];
}

function completeArmPhase(arm, phase) {
  if (phase.done) return;
  phase.done = true;
  const tipWorld = getArmWorldPoints(arm).tip;

  if (phase.capture) {
    arm.load = Math.max(arm.load, settings.scoopSize);
  }

  if (phase.release) {
    spawnSoil(tipWorld, arm.load || settings.scoopSize * 0.35);
    arm.load = 0;
  }
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

function findBestArmPose(arm, tipLocal, headLocal, options = {}) {
  const candidates = findArmIKCandidates(arm, tipLocal, headLocal, options);
  return candidates[0]?.pose ?? null;
}

function findArmIKCandidates(arm, tipLocal, headLocal, options = {}) {
  const offsets = makeOrientationOffsets(options.orientationSlack ?? 0.2);
  const current = getArmJointAngles(arm);
  const candidates = [];
  const jawAngle = clamp(options.jawAngle ?? current.jawAngle ?? arm.jawClosedAngle, arm.limits.jawAngle[0], arm.limits.jawAngle[1]);

  for (const orientationOffset of offsets) {
    const headAbs = normalizeAngle(headLocal + orientationOffset);
    const tipOffset = rotateVec(arm.headTipOffset, headAbs);
    const wristTarget = Vec2(tipLocal.x - tipOffset.x, tipLocal.y - tipOffset.y);
    const dx = wristTarget.x - arm.baseLocal.x;
    const dy = wristTarget.y - arm.baseLocal.y;
    const l1 = arm.boomLength;
    const l2 = arm.stickLength;
    const distance = Math.hypot(dx, dy);
    const minReach = Math.abs(l1 - l2) + 0.04;
    const maxReach = l1 + l2 - 0.04;
    if (distance < minReach || distance > maxReach) continue;

    const theta = Math.atan2(dy, dx);
    const elbowMagnitude = Math.acos(clamp((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
    for (const stickAngle of [elbowMagnitude, -elbowMagnitude]) {
      const boomAngle = normalizeAngle(theta - Math.atan2(l2 * Math.sin(stickAngle), l1 + l2 * Math.cos(stickAngle)));
      const headAngle = normalizeAngle(headAbs - boomAngle - stickAngle);
      const pose = { boomAngle, stickAngle: normalizeAngle(stickAngle), headAngle, jawAngle };
      if (!isArmPoseValid(arm, pose)) continue;
      candidates.push({
        pose,
        score: scoreArmCandidate(arm, pose, current, headLocal, options),
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function makeOrientationOffsets(slack) {
  if (slack <= 0.01) return [0];
  return [0, -slack * 0.45, slack * 0.45, -slack, slack];
}

function isArmPoseValid(arm, pose) {
  if (!isArmPoseWithinLimits(arm, pose, 0)) return false;
  const points = getArmLocalPointsForPose(arm, pose);
  if (points.wrist.x < -2.6 || points.tip.x < -2.8) return false;
  if (Vec2.distance(points.tip, points.base) < 0.5) return false;
  if (Vec2.distance(points.wrist, points.base) < 0.42) return false;
  return true;
}

function isArmPoseWithinLimits(arm, pose, margin = 0) {
  return Object.entries(arm.limits).every(([key, [min, max]]) => (
    pose[key] >= min + margin && pose[key] <= max - margin
  ));
}

function scoreArmCandidate(arm, pose, current, desiredHeadAbs, options) {
  const headAbs = normalizeAngle(pose.boomAngle + pose.stickAngle + pose.headAngle);
  const continuity =
    angleDelta(pose.boomAngle, current.boomAngle) * 1.1 +
    angleDelta(pose.stickAngle, current.stickAngle) * 0.85 +
    angleDelta(pose.headAngle, current.headAngle) * 0.42 +
    angleDelta(pose.jawAngle, current.jawAngle) * 0.18;
  const orientation = angleDelta(headAbs, desiredHeadAbs) * (options.orientationWeight ?? 1);
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

function worldAngleToChassisLocal(angle) {
  return normalizeAngle(angle - tank.chassis.getAngle());
}

function isArmTargetReachable(arm, targetLocal) {
  return [-0.95, -0.64, -0.32, 0.04].some((headLocal) => (
    findArmIKCandidates(arm, targetLocal, headLocal, { jawAngle: jawOpenAngle, orientationSlack: 0.4 }).length > 0
  ));
}

function isActionReachable(arm, action) {
  return action.phases.every((phase) => {
    if (phase.restPose) return true;
    const targetLocal = phase.rest ? arm.restTipLocal : tank.chassis.getLocalPoint(phase.world);
    const headLocal = phase.rest ? arm.restHeadAbs : worldAngleToChassisLocal(phase.headWorld);
    return findArmIKCandidates(arm, targetLocal, headLocal, {
      jawAngle: phase.jawAngle ?? arm.targetPose.jawAngle,
      orientationSlack: 0.28,
      orientationWeight: 1.2,
    }).length > 0;
  });
}

function sampleArmWorkspace(arm, step = 0.3) {
  const samples = [];
  const [boomMin, boomMax] = arm.limits.boomAngle;
  const [stickMin, stickMax] = arm.limits.stickAngle;
  const [headMin, headMax] = arm.limits.headAngle;

  for (let boomAngle = boomMin; boomAngle <= boomMax; boomAngle += step) {
    for (let stickAngle = stickMin; stickAngle <= stickMax; stickAngle += step) {
      for (let headAngle = headMin; headAngle <= headMax; headAngle += step) {
        const pose = { boomAngle, stickAngle, headAngle, jawAngle: arm.jawClosedAngle };
        if (isArmPoseValid(arm, pose)) {
          samples.push(getArmLocalPointsForPose(arm, pose).tip);
        }
      }
    }
  }

  return samples;
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
  drawJawLoad(getArmLocalPoints(tank.arm));
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

function drawJawLoad(points) {
  const arm = tank.arm;
  if (arm.load <= 0.02) return;

  const loadVerts = [
    Vec2(arm.headLength * 0.46, -0.32),
    Vec2(arm.headLength * 0.77, -0.34),
    Vec2(arm.headLength * 0.86, -0.72),
    Vec2(arm.headLength * 0.54, -0.84),
  ].map((point) => localPartPoint(points.wrist, points.headAbs, point));

  ctx.fillStyle = '#6d5131';
  traceLocalPolygon(loadVerts);
  ctx.fill();
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

function localPartPoint(origin, angle, point) {
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
