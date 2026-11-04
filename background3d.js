(function () {
  'use strict';

  var canvas = document.getElementById('starfield');
  if (!canvas || !window.THREE) return;

  var THREE = window.THREE;
  var root = document.documentElement;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var lite = window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  var renderer;
  var scene;
  var camera;
  var galaxy;
  var starsFar;
  var starsNear;
  var rafId = 0;
  var lastFrame = 0;
  var frames = 0;
  var pointer = { x: 0, y: 0 };

  function randomPointCloud(count, factory) {
    var positions = new Float32Array(count * 3);
    var colors = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      var point = factory(i);
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
      colors[i * 3] = point.color[0];
      colors[i * 3 + 1] = point.color[1];
      colors[i * 3 + 2] = point.color[2];
    }
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  }

  function makeStars(count, near) {
    var geometry = randomPointCloud(count, function () {
      var tone = Math.random();
      return {
        x: (Math.random() - 0.5) * 44,
        y: (Math.random() - 0.5) * 30,
        z: near ? -5 + Math.random() * 8 : -24 + Math.random() * 13,
        color: tone < 0.62 ? [0.68, 0.62, 0.48] : tone < 0.84 ? [0.52, 0.49, 0.61] : [0.82, 0.81, 0.77]
      };
    });
    var material = new THREE.PointsMaterial({
      size: near ? 0.055 : 0.038,
      vertexColors: true,
      transparent: true,
      opacity: near ? 0.58 : 0.42,
      depthWrite: false,
      sizeAttenuation: true
    });
    return new THREE.Points(geometry, material);
  }

  function makeGalaxy(count) {
    var geometry = randomPointCloud(count, function () {
      var t = Math.random() * 2 - 1;
      var spread = (Math.random() + Math.random() + Math.random() - 1.5) * 1.5;
      var tone = Math.random();
      return {
        x: t * 17 + spread * 0.8,
        y: -t * 6.5 + spread * 1.25,
        z: -12 + Math.random() * 7 + Math.sin(t * 3.2) * 1.8,
        color: tone < 0.58 ? [0.72, 0.69, 0.61] : tone < 0.82 ? [0.51, 0.48, 0.62] : [0.64, 0.54, 0.35]
      };
    });
    var material = new THREE.PointsMaterial({
      size: 0.068,
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    var points = new THREE.Points(geometry, material);
    points.rotation.z = -0.24;
    points.rotation.y = -0.12;
    return points;
  }

  function resize() {
    if (!renderer) return;
    var width = window.innerWidth;
    var height = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function animate(now) {
    rafId = 0;
    if (document.hidden || reducedMotion.matches || root.dataset.playing === 'true' || root.dataset.perfMode === 'true') {
      rafId = requestAnimationFrame(animate);
      return;
    }
    if (now - lastFrame < (lite ? 66 : 40)) {
      rafId = requestAnimationFrame(animate);
      return;
    }
    lastFrame = now;
    var t = now * 0.0001;
    galaxy.rotation.y = -0.12 + Math.sin(t * 0.12) * 0.055;
    galaxy.rotation.z = -0.24 + Math.sin(t * 0.08) * 0.018;
    starsFar.rotation.z += 0.00008;
    starsNear.rotation.z -= 0.00013;
    camera.position.x += ((pointer.x * 0.65) - camera.position.x) * 0.018;
    camera.position.y += ((-pointer.y * 0.42) - camera.position.y) * 0.018;
    camera.lookAt(0, 0, -5);
    renderer.render(scene, camera);
    frames++;
    rafId = requestAnimationFrame(animate);
  }

  function init() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: !lite, powerPreference: lite ? 'low-power' : 'high-performance' });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x0b0b0c, 0.025);
      camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
      camera.position.set(0, 0, 18);
      scene.add(new THREE.AmbientLight(0xb8b1c0, 0.55));
      var key = new THREE.DirectionalLight(0xffe4b0, 1.45);
      key.position.set(-5, 7, 9);
      scene.add(key);
      var rim = new THREE.DirectionalLight(0x8d96c5, 0.65);
      rim.position.set(6, -2, 3);
      scene.add(rim);

      starsFar = makeStars(lite ? 180 : 420, false);
      starsNear = makeStars(lite ? 70 : 150, true);
      galaxy = makeGalaxy(lite ? 520 : 1150);
      scene.add(starsFar);
      scene.add(starsNear);
      scene.add(galaxy);

      resize();
      window.addEventListener('resize', resize, { passive: true });
      window.addEventListener('mousemove', function (event) {
        pointer.x = event.clientX / window.innerWidth - 0.5;
        pointer.y = event.clientY / window.innerHeight - 0.5;
      }, { passive: true });
      rafId = requestAnimationFrame(animate);
      window.MotifLabBackground3D = Object.freeze({
        getState: function () {
          return { webgl: true, frames: frames, galaxyPoints: galaxy.geometry.attributes.position.count, lite: lite };
        }
      });
    } catch (error) {
      if (rafId) cancelAnimationFrame(rafId);
      canvas.hidden = true;
    }
  }

  init();
})();
