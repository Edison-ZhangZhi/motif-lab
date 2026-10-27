(function () {
  'use strict';

  var stage = document.getElementById('instrument-stage');
  if (!stage || !window.THREE) return;

  var THREE = window.THREE;
  var root = document.documentElement;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var renderer;
  var scene;
  var camera;
  var canvas;
  var resizeObserver;
  var rafId = 0;
  var idleTimer = 0;
  var running = false;
  var needsRender = true;
  var lastFrame = 0;
  var lastInteraction = 0;
  var lastTick = 0;
  var activeView = 'reset';
  var frameCount = 0;
  var dragging = null;
  var baseDistance = 9.6;
  var moon;
  var guitar;
  var current = { yaw: 0, pitch: 0.055, distance: 9.6, tx: -0.15, ty: -0.05, tz: -0.25 };
  var target = { yaw: 0, pitch: 0.055, distance: 9.6, tx: -0.15, ty: -0.05, tz: -0.25 };
  var presets = {
    reset: { yaw: 0, pitch: 0.055, distance: 9.6, tx: -0.15, ty: -0.05, tz: -0.25 },
    guitar: { yaw: -0.16, pitch: 0.19, distance: 8.7, tx: -0.35, ty: -0.2, tz: 0.1 },
    moon: { yaw: 0.24, pitch: 0.12, distance: 6.4, tx: 1.25, ty: 1.1, tz: -1.75 }
  };

  function suspended() {
    return document.hidden || reducedMotion.matches || root.dataset.playing === 'true' || root.dataset.perfMode === 'true';
  }

  function material(color, metalness, roughness) {
    return new THREE.MeshStandardMaterial({ color: color, metalness: metalness, roughness: roughness });
  }

  function box(parent, size, position, mat) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    mesh.position.set(position[0], position[1], position[2]);
    parent.add(mesh);
    return mesh;
  }

  function frontDisc(parent, radius, depth, position, mat, segments) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, segments || 24), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(position[0], position[1], position[2]);
    parent.add(mesh);
    return mesh;
  }

  function rod(parent, start, end, radius, mat) {
    var a = new THREE.Vector3(start[0], start[1], start[2]);
    var b = new THREE.Vector3(end[0], end[1], end[2]);
    var direction = b.clone().sub(a);
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), mat);
    mesh.position.copy(a.add(b).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    parent.add(mesh);
    return mesh;
  }

  function bodyShape() {
    var shape = new THREE.Shape();
    shape.moveTo(0.68, 0.32);
    shape.bezierCurveTo(0.42, 0.58, 0.62, 0.94, 0.2, 1.12);
    shape.bezierCurveTo(-0.18, 1.29, -0.62, 1.0, -0.96, 0.84);
    shape.bezierCurveTo(-1.52, 1.13, -2.03, 0.73, -2.02, 0.17);
    shape.bezierCurveTo(-2.24, -0.4, -1.73, -1.13, -1.12, -0.98);
    shape.bezierCurveTo(-0.7, -1.08, -0.34, -0.8, -0.2, -0.52);
    shape.bezierCurveTo(0.02, -0.86, 0.64, -0.91, 0.82, -0.58);
    shape.bezierCurveTo(0.98, -0.28, 0.42, -0.13, 0.58, 0.05);
    shape.lineTo(0.68, 0.32);
    return shape;
  }

  function makePickguard(parent, mat) {
    var shape = new THREE.Shape();
    shape.moveTo(0.62, 0.25);
    shape.bezierCurveTo(0.23, 0.5, -0.1, 0.76, -0.58, 0.65);
    shape.bezierCurveTo(-1.03, 0.58, -1.3, 0.24, -1.18, -0.12);
    shape.bezierCurveTo(-1.02, -0.53, -0.58, -0.63, -0.26, -0.4);
    shape.lineTo(0.48, -0.18);
    shape.lineTo(0.62, 0.25);
    var guard = new THREE.Mesh(new THREE.ShapeGeometry(shape, 20), mat);
    guard.position.z = 0.405;
    parent.add(guard);
  }

  function makeGuitar() {
    var group = new THREE.Group();
    var silver = material(0xbfc2c7, 0.76, 0.27);
    var chrome = material(0xe5e7e9, 0.9, 0.18);
    var darkChrome = material(0x676a72, 0.82, 0.28);
    var black = material(0x15151b, 0.36, 0.36);
    var fretboard = material(0x24232a, 0.28, 0.43);
    var maple = material(0x8b8582, 0.32, 0.42);
    var pearl = material(0xe4e0df, 0.35, 0.3);

    var body = new THREE.Mesh(new THREE.ExtrudeGeometry(bodyShape(), {
      depth: 0.3,
      bevelEnabled: true,
      bevelThickness: 0.075,
      bevelSize: 0.075,
      bevelSegments: 5,
      curveSegments: 28,
      steps: 1
    }), [silver, darkChrome]);
    group.add(body);
    makePickguard(group, black);

    box(group, [2.65, 0.5, 0.2], [1.72, 0, 0.2], maple);
    box(group, [2.68, 0.47, 0.14], [1.7, 0, 0.35], fretboard);
    box(group, [0.065, 0.54, 0.08], [3.045, 0, 0.445], pearl);

    var headShape = new THREE.Shape();
    headShape.moveTo(3.04, -0.24);
    headShape.lineTo(3.86, -0.36);
    headShape.quadraticCurveTo(4.17, -0.31, 4.13, -0.05);
    headShape.lineTo(4.02, 0.42);
    headShape.quadraticCurveTo(3.72, 0.5, 3.05, 0.24);
    headShape.closePath();
    var head = new THREE.Mesh(new THREE.ExtrudeGeometry(headShape, {
      depth: 0.15, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 3
    }), silver);
    head.position.z = 0.18;
    group.add(head);

    box(group, [0.26, 0.75, 0.13], [-1.25, 0, 0.47], darkChrome);
    for (var saddle = 0; saddle < 6; saddle += 1) {
      box(group, [0.19, 0.07, 0.07], [-1.25, (saddle - 2.5) * 0.09, 0.56], chrome);
    }
    [-0.63, 0.02].forEach(function (x) {
      box(group, [0.25, 0.78, 0.13], [x, 0, 0.48], chrome);
      box(group, [0.17, 0.67, 0.135], [x, 0, 0.49], black);
      for (var pole = 0; pole < 6; pole += 1) {
        frontDisc(group, 0.025, 0.018, [x, (pole - 2.5) * 0.105, 0.57], chrome, 12);
      }
    });
    frontDisc(group, 0.13, 0.11, [-1.35, -0.57, 0.48], darkChrome, 32);
    frontDisc(group, 0.13, 0.11, [-0.92, -0.72, 0.48], darkChrome, 32);
    frontDisc(group, 0.095, 0.012, [-1.35, -0.57, 0.542], chrome, 32);
    frontDisc(group, 0.095, 0.012, [-0.92, -0.72, 0.542], chrome, 32);
    frontDisc(group, 0.065, 0.035, [-1.62, 0.47, 0.44], chrome, 24);

    var nut = 3.045;
    var scale = 4.295;
    var fretPositions = [];
    for (var fret = 1; fret <= 22; fret += 1) {
      var fretX = nut - scale * (1 - Math.pow(2, -fret / 12));
      fretPositions[fret] = fretX;
      box(group, [0.016, 0.49, 0.025], [fretX, 0, 0.438], chrome);
    }
    [3, 5, 7, 9, 12, 15, 17, 19, 21].forEach(function (fretNumber) {
      var previous = fretNumber === 1 ? nut : fretPositions[fretNumber - 1];
      var markerX = (previous + fretPositions[fretNumber]) / 2;
      if (fretNumber === 12) {
        frontDisc(group, 0.035, 0.01, [markerX, -0.12, 0.431], pearl, 16);
        frontDisc(group, 0.035, 0.01, [markerX, 0.12, 0.431], pearl, 16);
      } else {
        frontDisc(group, 0.035, 0.01, [markerX, 0, 0.431], pearl, 16);
      }
    });

    for (var tuner = 0; tuner < 6; tuner += 1) {
      var tunerX = 3.28 + (tuner % 3) * 0.27;
      var side = tuner < 3 ? 1 : -1;
      var tunerY = side * (tuner < 3 ? 0.25 : 0.29);
      frontDisc(group, 0.065, 0.11, [tunerX, tunerY, 0.39], chrome, 20);
      rod(group, [tunerX, tunerY, 0.31], [tunerX, tunerY + side * 0.19, 0.31], 0.025, darkChrome);
      box(group, [0.13, 0.1, 0.08], [tunerX, tunerY + side * 0.21, 0.31], chrome);
    }

    for (var string = 0; string < 6; string += 1) {
      var stringY = (string - 2.5) * 0.078;
      var tunerIndex = string < 3 ? string : 5 - string;
      var endX = 3.28 + (tunerIndex % 3) * 0.27;
      var endY = string < 3 ? 0.25 : -0.29;
      rod(group, [-1.35, stringY, 0.595], [3.05, stringY, 0.5], 0.005 + string * 0.0008, chrome);
      rod(group, [3.05, stringY, 0.5], [endX, endY, 0.47], 0.005 + string * 0.0008, chrome);
    }

    group.rotation.z = 0.17;
    group.rotation.x = -0.08;
    group.position.set(-0.25, -0.42, 0.2);
    return group;
  }

  function makeMoon(textureLoader) {
    var group = new THREE.Group();
    var moonMaterial = new THREE.MeshStandardMaterial({
      color: 0xb8b5bd,
      metalness: 0,
      roughness: 1,
      bumpScale: 0.13
    });
    textureLoader.load('assets/moon-surface.jpg', function (texture) {
      texture.encoding = THREE.sRGBEncoding;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      moonMaterial.map = texture;
      moonMaterial.bumpMap = texture;
      moonMaterial.needsUpdate = true;
      invalidate();
    }, undefined, function () {
      moonMaterial.color.setHex(0x77747d);
      invalidate();
    });
    var sphere = new THREE.Mesh(new THREE.SphereGeometry(1.42, 64, 48), moonMaterial);
    sphere.rotation.y = -1.1;
    sphere.rotation.z = 0.12;
    group.add(sphere);

    var ringMaterial = new THREE.LineBasicMaterial({ color: 0xaaa0bb, transparent: true, opacity: 0.28 });
    var paleRing = new THREE.LineBasicMaterial({ color: 0xe7e4dc, transparent: true, opacity: 0.12 });
    [[2.05, 0.65, 0.25, ringMaterial], [1.82, 0.57, -0.35, paleRing]].forEach(function (config) {
      var points = [];
      for (var i = 0; i < 160; i += 1) {
        var angle = i / 160 * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(angle) * config[0], Math.sin(angle) * config[1], 0));
      }
      var ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), config[3]);
      ring.rotation.x = 0.7;
      ring.rotation.z = config[2];
      group.add(ring);
    });
    group.position.set(1.45, 1.25, -2.35);
    return group;
  }

  function makeStars() {
    var positions = [];
    var seed = 19;
    function random() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }
    for (var i = 0; i < 70; i += 1) {
      positions.push((random() - 0.5) * 15, (random() - 0.5) * 7, -4 - random() * 3);
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xc5bfd1, size: 0.022, transparent: true, opacity: 0.52, sizeAttenuation: true
    }));
  }

  function updateCamera() {
    camera.position.set(
      current.tx + current.distance * Math.sin(current.yaw) * Math.cos(current.pitch),
      current.ty + current.distance * Math.sin(current.pitch),
      current.tz + current.distance * Math.cos(current.yaw) * Math.cos(current.pitch)
    );
    camera.lookAt(current.tx, current.ty, current.tz);
  }

  function render() {
    updateCamera();
    renderer.render(scene, camera);
    frameCount += 1;
    needsRender = false;
  }

  function invalidate() {
    needsRender = true;
    if (suspended()) {
      if (renderer && scene && camera) render();
      return;
    }
    start();
  }

  function resize() {
    if (!renderer) return;
    var width = Math.max(1, stage.clientWidth);
    var height = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    baseDistance = camera.aspect < 1.55 ? 1.55 / camera.aspect : 1;
    invalidate();
  }

  function tick(now) {
    rafId = 0;
    if (!running || suspended()) {
      stop();
      return;
    }
    var dt = Math.min(0.06, Math.max(0.001, (now - (lastTick || now - 16.67)) / 1000));
    lastTick = now;
    var idle = !dragging && now - lastInteraction > 2200;
    if (idle) target.yaw += dt * 0.026;

    var factor = 1 - Math.exp(-dt * 11);
    var moving = false;
    ['yaw', 'pitch', 'distance', 'tx', 'ty', 'tz'].forEach(function (key) {
      var destination = key === 'distance' ? target[key] * baseDistance : target[key];
      var difference = destination - current[key];
      if (Math.abs(difference) > 0.00008) {
        current[key] += difference * factor;
        moving = true;
      } else {
        current[key] = destination;
      }
    });
    if (moving || idle || needsRender) {
      if (moving || needsRender || now - lastFrame >= 33) {
        render();
        lastFrame = now;
      }
      rafId = requestAnimationFrame(tick);
    } else {
      idleTimer = window.setTimeout(function () {
        idleTimer = 0;
        start();
      }, Math.max(20, 2200 - (now - lastInteraction)));
    }
  }

  function start() {
    if (suspended() || !renderer) return;
    if (!running) {
      running = true;
      lastTick = 0;
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = 0;
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (idleTimer) clearTimeout(idleTimer);
    rafId = 0;
    idleTimer = 0;
  }

  function syncActivity() {
    if (suspended()) stop();
    else start();
  }

  function selectView(name) {
    if (!presets[name]) return;
    activeView = name;
    var preset = presets[name];
    Object.keys(preset).forEach(function (key) { target[key] = preset[key]; });
    if (name === 'reset') target.yaw += Math.round((current.yaw - target.yaw) / (Math.PI * 2)) * Math.PI * 2;
    lastInteraction = performance.now();
    stage.querySelectorAll('[data-studio-view]').forEach(function (button) {
      var selected = button.getAttribute('data-studio-view') === name;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (reducedMotion.matches) {
      Object.keys(current).forEach(function (key) {
        current[key] = key === 'distance' ? target[key] * baseDistance : target[key];
      });
    }
    invalidate();
  }

  function bindControls() {
    stage.querySelectorAll('[data-studio-view]').forEach(function (button) {
      button.addEventListener('click', function () { selectView(button.getAttribute('data-studio-view')); });
    });
    stage.addEventListener('dblclick', function (event) {
      if (!event.target.closest('button')) selectView('reset');
    });
    stage.addEventListener('keydown', function (event) {
      var handled = true;
      if (event.key === 'ArrowLeft') target.yaw -= 0.12;
      else if (event.key === 'ArrowRight') target.yaw += 0.12;
      else if (event.key === 'ArrowUp') target.pitch = Math.min(0.7, target.pitch + 0.09);
      else if (event.key === 'ArrowDown') target.pitch = Math.max(-0.55, target.pitch - 0.09);
      else if (event.key === '+' || event.key === '=') target.distance = Math.max(4.7, target.distance - 0.55);
      else if (event.key === '-' || event.key === '_') target.distance = Math.min(14, target.distance + 0.55);
      else handled = false;
      if (!handled) return;
      event.preventDefault();
      activeView = 'custom';
      lastInteraction = performance.now();
      stage.querySelectorAll('[data-studio-view]').forEach(function (button) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
      if (reducedMotion.matches) {
        current.yaw = target.yaw;
        current.pitch = target.pitch;
        current.distance = target.distance * baseDistance;
      }
      invalidate();
    });

    canvas.addEventListener('pointerdown', function (event) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, active: event.pointerType === 'mouse' };
      if (dragging.active) canvas.setPointerCapture(event.pointerId);
      stage.classList.add('is-dragging');
      lastInteraction = performance.now();
      start();
    });
    canvas.addEventListener('pointermove', function (event) {
      if (!dragging || dragging.id !== event.pointerId) return;
      var totalX = event.clientX - dragging.x;
      var totalY = event.clientY - dragging.y;
      if (!dragging.active) {
        if (Math.abs(totalX) < 7 || Math.abs(totalX) < Math.abs(totalY) * 1.15) return;
        dragging.active = true;
        canvas.setPointerCapture(event.pointerId);
      }
      target.yaw -= (event.clientX - dragging.lastX) * 0.006;
      target.pitch = Math.max(-0.55, Math.min(0.7, target.pitch + (event.clientY - dragging.lastY) * 0.005));
      dragging.lastX = event.clientX;
      dragging.lastY = event.clientY;
      activeView = 'custom';
      lastInteraction = performance.now();
      stage.querySelectorAll('[data-studio-view]').forEach(function (button) {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
      invalidate();
    });
    function endDrag(event) {
      if (!dragging || dragging.id !== event.pointerId) return;
      dragging = null;
      stage.classList.remove('is-dragging');
      lastInteraction = performance.now();
      start();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('wheel', function (event) {
      event.preventDefault();
      target.distance = Math.max(4.7, Math.min(14, target.distance + event.deltaY * 0.008));
      activeView = 'custom';
      lastInteraction = performance.now();
      invalidate();
    }, { passive: false });
  }

  function fail() {
    stop();
    stage.classList.remove('webgl-ready', 'is-dragging');
    stage.removeAttribute('data-webgl');
    if (canvas) canvas.hidden = true;
  }

  function init() {
    try {
      canvas = document.createElement('canvas');
      canvas.className = 'studio3d-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(35, 1, 0.1, 60);

      scene.add(new THREE.HemisphereLight(0xdcd8e4, 0x14111c, 0.68));
      var key = new THREE.DirectionalLight(0xf4f2ee, 2.15);
      key.position.set(-3.5, 5, 7);
      scene.add(key);
      var rim = new THREE.DirectionalLight(0x9c88c5, 1.65);
      rim.position.set(4, 2, -1.5);
      scene.add(rim);
      var lower = new THREE.DirectionalLight(0x777285, 0.42);
      lower.position.set(-2, -4, 3);
      scene.add(lower);

      scene.add(makeStars());
      moon = makeMoon(new THREE.TextureLoader());
      guitar = makeGuitar();
      scene.add(moon);
      scene.add(guitar);
      stage.insertBefore(canvas, stage.querySelector('.stage-caption'));
      stage.classList.add('webgl-ready');
      stage.setAttribute('data-webgl', 'ready');
      bindControls();
      resize();
      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(stage);
      } else {
        window.addEventListener('resize', resize, { passive: true });
      }
      document.addEventListener('visibilitychange', syncActivity);
      var observer = new MutationObserver(syncActivity);
      observer.observe(root, { attributes: true, attributeFilter: ['data-playing', 'data-perf-mode'] });
      if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncActivity);
      else reducedMotion.addListener(syncActivity);
      canvas.addEventListener('webglcontextlost', function (event) {
        event.preventDefault();
        fail();
      });
      canvas.addEventListener('webglcontextrestored', function () {
        canvas.hidden = false;
        stage.classList.add('webgl-ready');
        stage.setAttribute('data-webgl', 'ready');
        resize();
        syncActivity();
      });
      selectView('reset');
      render();
      syncActivity();
      window.MotifLabStudio3D = Object.freeze({
        getState: function () {
          return {
            webgl: stage.getAttribute('data-webgl') === 'ready',
            running: running,
            frames: frameCount,
            view: activeView,
            yaw: current.yaw,
            pitch: current.pitch,
            distance: current.distance,
            triangles: renderer.info.render.triangles,
            width: canvas.width,
            height: canvas.height,
            guitarParts: guitar.children.length,
            moonRadius: 1.42
          };
        }
      });
      stage.dispatchEvent(new CustomEvent('studio3d-ready'));
    } catch (error) {
      fail();
      if (window.console && console.warn) console.warn('Motif Lab 3D unavailable; using CSS fallback.', error);
    }
  }

  init();
}());
