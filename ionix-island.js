/* ===========================================================
   IONIX — Toon cargo port diorama (homepage hero)
   Requires three.js r128 (global THREE) and ionix.js.

   A floating slab of port runs on a loop: a ship sails in, two quay cranes
   unload it onto yard trucks, gantry cranes stack the boxes (each one pops a
   coin), the ship sails off and the next one comes in.

   Performance: static scenery is merged into one mesh + one outline mesh;
   containers and trucks are instanced. Rendering pauses off screen, touch
   devices cap at 30 fps, and pixel ratio steps down if frames run slow.
=========================================================== */

(function () {

    var host = document.getElementById('ix-world');
    if (!host || typeof THREE === 'undefined') return;

    var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var INK = 0x2F2545;

    // Phones/tablets: no MSAA, smaller shadow map, lower pixel ratio, 30 fps
    var LOW_POWER = window.matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 600;

    var renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: !LOW_POWER, alpha: true });
    } catch (e) { return; }

    var MAX_DPR = Math.min(window.devicePixelRatio || 1, LOW_POWER ? 1.5 : 2);
    var dpr = MAX_DPR;
    renderer.setPixelRatio(dpr);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = LOW_POWER ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(24, 1, 1, 150);

    // Matrix is updated by hand each frame so the clip planes can follow it
    var world = new THREE.Group();
    world.matrixAutoUpdate = false;
    scene.add(world);

    /* ---------- Lighting ---------- */

    world.add(new THREE.HemisphereLight(0xEAF6FF, 0xF6D9B0, 0.62));

    var sun = new THREE.DirectionalLight(0xFFF1D6, 0.95);
    sun.position.set(9, 15, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(LOW_POWER ? 1024 : 2048, LOW_POWER ? 1024 : 2048);
    var sc = sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 2; sc.far = 42;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    world.add(sun);
    world.add(sun.target);

    var fill = new THREE.DirectionalLight(0xB8C8FF, 0.25);
    fill.position.set(-8, 4, -6);
    world.add(fill);

    /* ---------- Palette ---------- */

    var C = {
        concrete: 0xDCD8E8, concrete2: 0xC6C0D8, asphalt: 0x5A5672, line: 0xFFFFFF, yellow: 0xFFC83D, orange: 0xF59A3B,
        grass: 0x72D163, grassDark: 0x56B550, dirt: 0xDB9A62, rock1: 0xC77E57, rock2: 0xA9664A, rock3: 0x8E5341,
        water: 0x5CC6EA, waterDeep: 0x3B9FD0, white: 0xF7F7FB, navy: 0x34385C, red: 0xE8564A, violet: 0x8A6FD1,
        berry: 0xFF7A93, gold: 0xFFC24A, dark: 0x3B3852, glass: 0x7FD3F0, leaf: 0x62C25A, leafLight: 0x8BD873,
        pine: 0x3A9F6A, wood: 0x9C6A3A, ballast: 0xBBAA94, steel: 0x8C8AA3, deck: 0x9AA0B5, warm: 0xFFE08A
    };

    var BOX_COLORS = [0xE8564A, 0xF59A3B, 0xFFC83D, 0x4DB86A, 0x2FB5AE, 0x3D7DD8, 0x8A6FD1, 0xFF7A93, 0xEDEFF5, 0x2D4A8A];

    function rng(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    var rand = rng(11);
    function boxColor() { return BOX_COLORS[Math.floor(rand() * BOX_COLORS.length)]; }

    /* ---------- Materials ---------- */

    var ramp = new THREE.DataTexture(new Uint8Array([130, 200, 255]), 3, 1, THREE.LuminanceFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;

    // The ship, tug and train sail in and out through the slab's front and back
    // edges. These planes (moved into world space every frame) hide anything past them.
    var CLIP_LOCAL = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 4), new THREE.Plane(new THREE.Vector3(0, 0, 1), 4)];
    var CLIP = [CLIP_LOCAL[0].clone(), CLIP_LOCAL[1].clone()];

    function toonMat(clip, opts) {
        opts.gradientMap = ramp;
        if (clip) { opts.clippingPlanes = CLIP; opts.clipShadows = true; }
        return new THREE.MeshToonMaterial(opts);
    }

    var MAT = {
        toon: toonMat(false, { vertexColors: true }),
        toonClip: toonMat(true, { vertexColors: true }),
        ink: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
        inkClip: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, clippingPlanes: CLIP })
    };

    /* ---------- Kit: collects parts, merges them into one mesh + one outline ---------- */

    var GEO = {
        box: new THREE.BoxGeometry(1, 1, 1),
        cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
        cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 18),
        ico: new THREE.IcosahedronGeometry(0.5, 1),
        cone: new THREE.ConeGeometry(0.5, 1, 7)
    };

    var UP = new THREE.Vector3(0, 1, 0);
    var tmpObj = new THREE.Object3D();
    var tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpV3 = new THREE.Vector3();
    var tmpC = new THREE.Color();
    var tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4(), tmpN = new THREE.Matrix3();

    var niCache = {};
    function nonIndexed(geo, flat) {
        var key = geo.uuid + (flat ? 'f' : '');
        if (!niCache[key]) {
            var g = geo.index ? geo.toNonIndexed() : geo.clone();
            if (flat) g.computeVertexNormals(); // non-indexed: per-face normals
            g.computeBoundingBox();
            niCache[key] = g;
        }
        return niCache[key];
    }

    function Kit() { this.parts = []; }

    // o: rx, ry, rz | q (quaternion), t (outline thickness, 0 = none), flat
    Kit.prototype.add = function (geo, color, x, y, z, sx, sy, sz, o) {
        o = o || {};
        tmpObj.position.set(x, y, z);
        tmpObj.rotation.set(o.rx || 0, o.ry || 0, o.rz || 0);
        if (o.q) tmpObj.quaternion.copy(o.q);
        tmpObj.scale.set(sx, sy, sz);
        tmpObj.updateMatrix();
        this.parts.push({ geo: geo, color: color, m: tmpObj.matrix.clone(), s: [sx, sy, sz], t: o.t === undefined ? 0.03 : o.t, flat: !!o.flat });
        return this;
    };

    Kit.prototype.box = function (w, h, d, color, x, y, z, o) { return this.add(GEO.box, color, x, y, z, w, h, d, o); };

    Kit.prototype.cyl = function (r, h, color, x, y, z, o) { return this.add(o && o.round ? GEO.cyl16 : GEO.cyl, color, x, y, z, r * 2, h, r * 2, o); };

    // Square strut between two points (crane stays, A-frames)
    Kit.prototype.beam = function (x1, y1, z1, x2, y2, z2, th, color, t) {
        tmpV3.set(x2 - x1, y2 - y1, z2 - z1);
        var len = tmpV3.length();
        var q = new THREE.Quaternion().setFromUnitVectors(UP, tmpV3.normalize());
        return this.add(GEO.box, color, (x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2, th, len, th, { q: q, t: t === undefined ? 0.02 : t });
    };

    Kit.prototype.merge = function () {
        var nV = 0, nH = 0, i, p, v;
        for (i = 0; i < this.parts.length; i++) {
            p = this.parts[i];
            p.g = nonIndexed(p.geo, p.flat);
            nV += p.g.attributes.position.count;
            if (p.t) nH += p.g.attributes.position.count;
        }
        var pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), col = new Float32Array(nV * 3), hp = new Float32Array(nH * 3);
        var o = 0, h = 0, size = new THREE.Vector3(), ctr = new THREE.Vector3();
        for (i = 0; i < this.parts.length; i++) {
            p = this.parts[i];
            var src = p.g.attributes.position.array, sn = p.g.attributes.normal.array, cnt = src.length / 3;
            tmpN.getNormalMatrix(p.m);
            tmpC.setHex(p.color);
            for (v = 0; v < cnt; v++, o++) {
                tmpV.set(src[v * 3], src[v * 3 + 1], src[v * 3 + 2]).applyMatrix4(p.m);
                pos[o * 3] = tmpV.x; pos[o * 3 + 1] = tmpV.y; pos[o * 3 + 2] = tmpV.z;
                tmpV.set(sn[v * 3], sn[v * 3 + 1], sn[v * 3 + 2]).applyMatrix3(tmpN).normalize();
                nor[o * 3] = tmpV.x; nor[o * 3 + 1] = tmpV.y; nor[o * 3 + 2] = tmpV.z;
                col[o * 3] = tmpC.r; col[o * 3 + 1] = tmpC.g; col[o * 3 + 2] = tmpC.b;
            }
            if (!p.t) continue;
            // Outline shell: grow the part about its centre so the rim is p.t thick in world units
            p.g.boundingBox.getSize(size);
            p.g.boundingBox.getCenter(ctr);
            var kx = 1 + 2 * p.t / Math.max(size.x * Math.abs(p.s[0]), 1e-3);
            var ky = 1 + 2 * p.t / Math.max(size.y * Math.abs(p.s[1]), 1e-3);
            var kz = 1 + 2 * p.t / Math.max(size.z * Math.abs(p.s[2]), 1e-3);
            tmpM.makeTranslation(ctr.x, ctr.y, ctr.z);
            tmpM.multiply(tmpM2.makeScale(kx, ky, kz));
            tmpM.multiply(tmpM2.makeTranslation(-ctr.x, -ctr.y, -ctr.z));
            tmpM.premultiply(p.m);
            for (v = 0; v < cnt; v++, h++) {
                tmpV.set(src[v * 3], src[v * 3 + 1], src[v * 3 + 2]).applyMatrix4(tmpM);
                hp[h * 3] = tmpV.x; hp[h * 3 + 1] = tmpV.y; hp[h * 3 + 2] = tmpV.z;
            }
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        var hull = null;
        if (nH) {
            hull = new THREE.BufferGeometry();
            hull.setAttribute('position', new THREE.BufferAttribute(hp, 3));
        }
        return { geo: geo, hull: hull };
    };

    Kit.prototype.build = function (clip, noShadow) {
        var m = this.merge(), g = new THREE.Group();
        var mesh = new THREE.Mesh(m.geo, clip ? MAT.toonClip : MAT.toon);
        mesh.castShadow = !noShadow;
        mesh.receiveShadow = true;
        g.add(mesh);
        if (m.hull) g.add(new THREE.Mesh(m.hull, clip ? MAT.inkClip : MAT.ink));
        return g;
    };

    /* ---------- Containers (instanced, corrugated) ---------- */

    var CW = 0.24, CH = 0.24, CL = 0.5, CSTEP = 0.245;

    var ribTex = (function () {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 16;
        var x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, 64, 16);
        x.fillStyle = 'rgba(0,0,0,0.14)';
        for (var i = 2; i < 64; i += 4) x.fillRect(i, 0, 2, 16);
        x.fillStyle = 'rgba(0,0,0,0.2)';
        x.fillRect(0, 0, 64, 1); x.fillRect(0, 15, 64, 1); x.fillRect(0, 0, 1, 16); x.fillRect(63, 0, 1, 16);
        return new THREE.CanvasTexture(c);
    })();

    var contGeo = new THREE.BoxGeometry(CW, CH, CL);
    var contInkGeo = new THREE.BoxGeometry(CW + 0.04, CH + 0.04, CL + 0.04);
    var contMat = toonMat(false, { map: ribTex });
    var contMatClip = toonMat(true, { map: ribTex });

    function Containers(n, clip, parent) {
        this.body = new THREE.InstancedMesh(contGeo, clip ? contMatClip : contMat, n);
        this.ink = new THREE.InstancedMesh(contInkGeo, clip ? MAT.inkClip : MAT.ink, n);
        this.body.castShadow = true;
        this.body.receiveShadow = true;
        // r128 culls instanced meshes by the first instance's bounds only
        this.body.frustumCulled = this.ink.frustumCulled = false;
        for (var i = 0; i < n; i++) this.hide(i);
        parent.add(this.body);
        parent.add(this.ink);
    }

    Containers.prototype.set = function (i, x, y, z, ry, s, color) {
        tmpObj.position.set(x, y, z);
        tmpObj.rotation.set(0, ry, 0);
        tmpObj.scale.setScalar(s);
        tmpObj.updateMatrix();
        this.body.setMatrixAt(i, tmpObj.matrix);
        this.ink.setMatrixAt(i, tmpObj.matrix);
        if (color !== undefined) {
            this.body.setColorAt(i, tmpC.setHex(color));
            this.body.instanceColor.needsUpdate = true;
        }
        this.dirty = true;
    };

    Containers.prototype.hide = function (i) {
        tmpM.makeScale(0, 0, 0);
        this.body.setMatrixAt(i, tmpM);
        this.ink.setMatrixAt(i, tmpM);
        this.dirty = true;
    };

    Containers.prototype.flush = function () {
        if (!this.dirty) return;
        this.body.instanceMatrix.needsUpdate = this.ink.instanceMatrix.needsUpdate = true;
        this.dirty = false;
    };

    /* ---------- Layout constants (slab-local units) ---------- */

    var X0 = -6, X1 = 5, Z0 = -4, Z1 = 4;    // slab footprint
    var QX = 1.6;                            // quay edge, sea beyond
    var WATER_Y = -0.3;
    var ROAD_Y = 0.016;
    var LANE_X = 0.95;                       // quay truck lane (under the cranes)
    var YARD_X = -1.2;                       // yard truck lane (under the gantries)
    var SHIP_X = 2.45, DECK_Y = 0.35;
    var BAYS = [-2.4, -1.85, -1.3, -0.75, 0, 0.75, 1.3, 1.85, 2.4];
    var ROWS = [-0.405, -0.135, 0.135, 0.405];
    var YROWS = [-1.6, -1.88, -2.16, -2.44, -2.72, -3.0];
    var TRUCK_C_Y = ROAD_Y + 0.245;          // centre of a box riding on a truck
    var HANG = 0.145;                        // spreader centre to hanging box centre
    var CREST = 1.5, RREST = 1.02;           // spreader rest heights: quay crane, yard gantry
    var CRANE_TROLLEY_Y = 1.93, RTG_TROLLEY_Y = 1.21;

    /* ---------- Static scenery ---------- */

    var S = new Kit();

    // Slab: concrete port + grass strip on top, dirt and rock below, sea block at the front
    S.box(QX + 4.2, 0.12, 8, C.concrete, (QX - 4.2) / 2, -0.06, 0, { t: 0.05 });
    S.box(1.8, 0.12, 8, C.grass, -5.1, -0.06, 0, { t: 0.05 });
    S.box(7.35, 0.58, 8, C.dirt, -2.325, -0.41, 0, { t: 0.05 });
    S.box(0.25, 0.88, 8, C.concrete2, 1.475, -0.56, 0, { t: 0.04 });
    S.box(7.35, 0.3, 8, C.rock1, -2.325, -0.85, 0, { t: 0.05 });
    S.box(X1 - QX, 0.3, 8, C.water, (X1 + QX) / 2, -0.45, 0, { t: 0.05 });
    S.box(X1 - QX, 0.4, 8, C.waterDeep, (X1 + QX) / 2, -0.8, 0, { t: 0.05 });
    S.box(10.8, 0.45, 7.8, C.rock2, -0.5, -1.22, 0, { t: 0.05, flat: true });

    // Rocky underside so the port reads as a floating island
    var under = new THREE.ConeGeometry(1, 1, 4, 3);
    (function () {
        var p = under.attributes.position;
        for (var i = 0; i < p.count; i++) {
            var y = p.getY(i);
            if (y > 0.49) continue;
            var a = Math.atan2(p.getZ(i), p.getX(i));
            var k = 1 + 0.12 * Math.sin(a * 7 + y * 9) + 0.08 * Math.sin(a * 13 - y * 5);
            p.setX(i, p.getX(i) * k);
            p.setZ(i, p.getZ(i) * k);
        }
    })();
    under.rotateX(Math.PI);
    under.rotateY(Math.PI / 4);
    S.add(under, C.rock3, -0.5, -2.35, 0, 5.2 * Math.SQRT2, 1.8, 3.75 * Math.SQRT2, { t: 0.05, flat: true });
    [[-3.6, -2.0], [2.2, 1.6], [-1.5, 2.6], [1.0, -2.4], [-4.8, 1.2]].forEach(function (s, i) {
        S.add(GEO.cone, i % 2 ? C.rock2 : C.rock3, s[0], -1.95 - (i % 3) * 0.15, s[1], 0.7, 1.1 + (i % 2) * 0.4, 0.7, { rx: Math.PI, t: 0.04, flat: true });
    });

    // Quay edge: safety stripe, crane rails, bollards, fenders
    S.box(0.12, 0.012, 8, C.yellow, 1.54, 0.006, 0, { t: 0 });
    [0.45, 1.45].forEach(function (x) { S.box(0.05, 0.014, 8, C.dark, x, 0.007, 0, { t: 0 }); });
    for (var bz = -3.5; bz <= 3.51; bz += 1) S.cyl(0.035, 0.08, C.dark, 1.53, 0.04, bz, { t: 0.012 });
    for (var fz = -3.6; fz <= 3.61; fz += 0.9) S.box(0.06, 0.16, 0.2, C.dark, 1.63, -0.16, fz, { t: 0 });

    // Roads: quay lane, yard lane, two crossings at each end and two in the middle
    S.box(0.42, 0.016, 7.9, C.asphalt, LANE_X, 0.008, 0, { t: 0 });
    S.box(0.42, 0.016, 7.9, C.asphalt, YARD_X, 0.008, 0, { t: 0 });
    S.box(2.6, 0.016, 0.42, C.asphalt, -0.125, 0.0085, -3.6, { t: 0 });
    S.box(2.6, 0.016, 0.42, C.asphalt, -0.125, 0.0085, 3.6, { t: 0 });
    S.box(2.6, 0.016, 0.92, C.asphalt, -0.125, 0.0085, 0, { t: 0 });
    for (var dz = -3.2; dz <= 3.2; dz += 0.4) {
        if (Math.abs(dz) < 0.5) continue;
        S.box(0.025, 0.004, 0.18, C.line, LANE_X + 0.17, 0.018, dz, { t: 0 });
        S.box(0.025, 0.004, 0.18, C.line, YARD_X - 0.17, 0.018, dz, { t: 0 });
    }
    S.box(2.1, 0.004, 0.025, C.yellow, -0.125, 0.018, 0, { t: 0 });

    // Yard slot markings
    [-1, 1].forEach(function (sd) {
        YROWS.forEach(function (x) { S.box(0.26, 0.004, 2.75, C.concrete2, x, 0.002, sd * 2.0, { t: 0 }); });
    });

    // Rail line behind the yard
    S.box(0.7, 0.02, 8, C.ballast, -3.75, 0.01, 0, { t: 0 });
    for (var sz = -3.9; sz <= 3.9; sz += 0.22) S.box(0.4, 0.016, 0.07, C.wood, -3.75, 0.028, sz, { t: 0 });
    [-0.11, 0.11].forEach(function (dx) { S.box(0.03, 0.03, 8, C.steel, -3.75 + dx, 0.045, 0, { t: 0 }); });

    // Warehouse with a curved blue roof
    S.box(1.25, 0.55, 2.2, C.white, -5.1, 0.275, -2.6);
    var roofGeo = new THREE.CylinderGeometry(0.64, 0.64, 2.24, 14, 1, false, Math.PI / 2, Math.PI);
    S.add(roofGeo, 0x3D7DD8, -5.1, 0.55, -2.6, 1, 1, 1, { rx: Math.PI / 2, t: 0.03 });
    [-3.3, -2.6, -1.9].forEach(function (z) { S.box(0.02, 0.36, 0.42, C.steel, -4.47, 0.2, z, { t: 0.012 }); });

    // Office block + control tower
    S.box(0.95, 0.62, 1.0, C.white, -5.05, 0.31, -0.45);
    [0.2, 0.42].forEach(function (y) {
        S.box(0.02, 0.1, 0.86, C.glass, -4.565, y, -0.45, { t: 0 });
        S.box(0.82, 0.1, 0.02, C.glass, -5.05, y, 0.055, { t: 0 });
    });
    S.box(1.0, 0.05, 1.05, C.violet, -5.05, 0.645, -0.45, { t: 0.02 });
    S.cyl(0.13, 1.6, C.white, -4.6, 0.8, 0.75, { round: true });
    S.cyl(0.26, 0.24, C.glass, -4.6, 1.72, 0.75, { round: true });
    S.cyl(0.29, 0.06, C.navy, -4.6, 1.87, 0.75, { round: true, t: 0.02 });
    S.cyl(0.015, 0.25, C.dark, -4.6, 2.02, 0.75, { t: 0 });

    // Fuel tanks
    [2.15, 3.25].forEach(function (z) {
        S.cyl(0.42, 0.55, C.white, -5.2, 0.275, z, { round: true });
        S.cyl(0.425, 0.07, C.berry, -5.2, 0.4, z, { round: true, t: 0 });
        S.cyl(0.3, 0.04, C.concrete2, -5.2, 0.57, z, { round: true, t: 0.015 });
    });

    // Small quay office + lamp posts
    S.box(0.55, 0.42, 0.85, C.white, -0.35, 0.21, -2.05);
    S.box(0.6, 0.05, 0.9, 0x3D7DD8, -0.35, 0.445, -2.05, { t: 0.02 });
    S.box(0.02, 0.1, 0.7, C.glass, -0.07, 0.27, -2.05, { t: 0 });

    function lamp(x, z) {
        S.cyl(0.022, 1.25, C.steel, x, 0.625, z, { t: 0.012 });
        S.box(0.18, 0.04, 0.09, C.steel, x, 1.25, z, { t: 0.012 });
        S.box(0.14, 0.015, 0.07, C.warm, x, 1.225, z, { t: 0 });
    }
    lamp(0.2, -1.2); lamp(0.2, 1.2); lamp(0.2, -3.2); lamp(0.2, 3.2);
    lamp(-0.8, -3.1); lamp(-0.8, 3.0);

    // Trees and bushes on the grass strip
    function tree(x, z, s, pine) {
        S.cyl(0.04 * s, 0.24 * s, C.wood, x, 0.12 * s, z, { t: 0.015 });
        if (pine) {
            S.add(GEO.cone, C.pine, x, 0.42 * s, z, 0.4 * s, 0.45 * s, 0.4 * s, { t: 0.02 });
            S.add(GEO.cone, 0x3FBF73, x, 0.66 * s, z, 0.3 * s, 0.38 * s, 0.3 * s, { t: 0.02 });
        } else {
            S.add(GEO.ico, C.leaf, x, 0.42 * s, z, 0.44 * s, 0.4 * s, 0.44 * s, { t: 0.02 });
            S.add(GEO.ico, C.leafLight, x + 0.06 * s, 0.56 * s, z + 0.04 * s, 0.26 * s, 0.24 * s, 0.26 * s, { t: 0.018 });
        }
    }
    [[-5.8, -0.9, 1, 0], [-5.75, 0.95, 0.9, 1], [-4.45, -1.15, 0.8, 0], [-5.8, 1.6, 0.85, 0], [-4.45, 1.55, 0.75, 1],
     [-4.4, 2.7, 0.8, 0], [-5.85, 2.7, 0.75, 1], [-4.45, 3.7, 0.9, 1], [-5.7, 3.75, 0.8, 0], [-4.45, -3.8, 0.85, 0],
     [-5.85, -3.85, 0.9, 1], [-5.8, -1.45, 0.7, 1]].forEach(function (t) { tree(t[0], t[1], t[2], t[3]); });

    var staticMesh = S.build(false);
    world.add(staticMesh);

    // Sea surface: toon water with drifting highlights and foam along the quay and edges
    var waterMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
            'varying vec2 vP; uniform float time;',
            'void main(){',
            '  float d = vP.x - ' + QX.toFixed(2) + ';',
            '  vec3 c = mix(vec3(0.38, 0.80, 0.94), vec3(0.17, 0.60, 0.87), smoothstep(0.0, 3.0, d));',
            '  float w = sin(vP.x * 3.1 + time * 1.1 + sin(vP.y * 1.7 + time * 0.6) * 1.3) * sin(vP.y * 2.3 - time * 0.8);',
            '  c = mix(c, vec3(0.66, 0.92, 1.0), step(0.8, w) * 0.6);',
            '  float edge = min(' + X1.toFixed(1) + ' - vP.x, ' + Z1.toFixed(1) + ' - abs(vP.y));',
            '  float foam = max(1.0 - smoothstep(0.0, 0.1 + 0.04 * sin(vP.y * 9.0 + time * 3.0), d), 1.0 - smoothstep(0.0, 0.07, edge));',
            '  gl_FragColor = vec4(mix(c, vec3(1.0), foam * 0.85), 1.0);',
            '}'
        ].join('\n')
    });
    var waterGeo = new THREE.PlaneGeometry(X1 - QX, Z1 - Z0, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    waterGeo.translate((X1 + QX) / 2, WATER_Y + 0.002, 0);
    world.add(new THREE.Mesh(waterGeo, waterMat));

    // Blinking warning lights (shared by the crane tops and the tower)
    var beaconMat = new THREE.MeshBasicMaterial({ color: 0xFF4D5E });
    var beaconGeo = new THREE.SphereGeometry(0.045, 8, 6);
    var towerBeacon = new THREE.Mesh(beaconGeo, beaconMat);
    towerBeacon.position.set(-4.6, 2.16, 0.75);
    world.add(towerBeacon);

    /* ---------- Yard containers ---------- */

    var staticBoxes = [];
    [-1, 1].forEach(function (sd) {
        [0.95, 2.45, 3.0].forEach(function (bz) {
            YROWS.forEach(function (x) {
                var tiers = 1 + Math.floor(rand() * 3);
                for (var k = 0; k < tiers; k++) staticBoxes.push([x, 0.12 + k * CSTEP, sd * bz]);
            });
        });
    });
    [-0.62, -0.34].forEach(function (x) {
        [1.15, 1.7, 2.25, 2.8].forEach(function (z) {
            var tiers = 1 + Math.floor(rand() * 2);
            for (var k = 0; k < tiers; k++) staticBoxes.push([x, 0.12 + k * CSTEP, z]);
        });
    });
    var yardStatic = new Containers(staticBoxes.length, false, world);
    staticBoxes.forEach(function (b, i) { yardStatic.set(i, b[0], b[1], b[2], 0, 1, boxColor()); });
    yardStatic.flush();

    /* ---------- Quay cranes ---------- */

    function craneKit() {
        var K = new Kit(), Y = C.yellow;
        [0.45, 1.45].forEach(function (x) {
            [-0.3, 0.3].forEach(function (z) {
                K.box(0.09, 1.9, 0.09, Y, x, 1.05, z);
                K.box(0.15, 0.08, 0.16, C.dark, x, 0.04, z, { t: 0.015 });
            });
            K.box(0.12, 0.1, 0.78, Y, x, 0.12, 0);
        });
        [-0.3, 0.3].forEach(function (z) {
            K.box(1.0, 0.07, 0.07, Y, 0.95, 1.0, z, { t: 0.02 });
            K.box(1.1, 0.1, 0.1, Y, 0.95, 1.98, z);
        });
        [-0.18, 0.18].forEach(function (z) { K.box(3.95, 0.1, 0.07, Y, 1.575, 2.07, z); });
        for (var x = -0.3; x <= 3.5; x += 0.5) K.box(0.05, 0.05, 0.36, Y, x, 2.07, 0, { t: 0.012 });
        K.box(0.5, 0.28, 0.5, C.white, -0.15, 2.26, 0);
        K.box(0.02, 0.06, 0.4, C.glass, 0.105, 2.29, 0, { t: 0 });
        [-1, 1].forEach(function (s) {
            K.beam(0.45, 2.03, 0.3 * s, 0.95, 2.9, 0.2 * s, 0.07, Y);
            K.beam(1.45, 2.03, 0.3 * s, 0.95, 2.9, 0.2 * s, 0.07, Y);
            K.beam(0.95, 2.9, 0.2 * s, 3.5, 2.12, 0.18 * s, 0.035, Y, 0.012);
            K.beam(0.95, 2.9, 0.2 * s, -0.36, 2.12, 0.18 * s, 0.035, Y, 0.012);
        });
        K.box(0.08, 0.08, 0.48, Y, 0.95, 2.9, 0, { t: 0.02 });
        return K;
    }

    function trolleyKit(color) {
        var K = new Kit();
        K.box(0.32, 0.08, 0.42, color, 0, 0, 0, { t: 0.02 });
        K.box(0.2, 0.15, 0.17, C.white, 0, -0.14, 0.3, { t: 0.018 });
        K.box(0.18, 0.06, 0.02, C.glass, 0, -0.12, 0.39, { t: 0 });
        return K;
    }

    function spreaderKit() {
        var K = new Kit();
        K.box(0.3, 0.05, 0.56, C.orange, 0, 0, 0, { t: 0.018 });
        K.box(0.08, 0.06, 0.12, C.orange, 0, 0.05, 0, { t: 0.012 });
        return K;
    }

    function cableKit() {
        var K = new Kit();
        [-0.12, 0.12].forEach(function (z) { K.box(0.014, 1, 0.014, C.dark, 0, -0.5, z, { t: 0 }); });
        return K;
    }

    var craneProto = craneKit().build(false);
    var craneTrolley = trolleyKit(C.steel).merge();
    var spreaderGeo = spreaderKit().merge();
    var cableGeo = cableKit().merge();

    function fromMerged(m, clip, noShadow) {
        var g = new THREE.Group();
        var mesh = new THREE.Mesh(m.geo, clip ? MAT.toonClip : MAT.toon);
        mesh.castShadow = !noShadow;
        mesh.receiveShadow = true;
        g.add(mesh);
        if (m.hull) g.add(new THREE.Mesh(m.hull, clip ? MAT.inkClip : MAT.ink));
        return g;
    }

    /* ---------- Ship ---------- */

    function hullShape(pad) {
        var w = 0.62 + pad, s = new THREE.Shape();
        s.moveTo(-w + 0.1, -3.3 - pad);
        s.lineTo(w - 0.1, -3.3 - pad);
        s.quadraticCurveTo(w, -3.3 - pad, w, -3.1);
        s.lineTo(w, 2.55);
        s.quadraticCurveTo(w, 3.3 + pad, 0, 3.55 + pad);
        s.quadraticCurveTo(-w, 3.3 + pad, -w, 2.55);
        s.lineTo(-w, -3.1);
        s.quadraticCurveTo(-w, -3.3 - pad, -w + 0.1, -3.3 - pad);
        return s;
    }

    function hullSlab(pad, y0, y1) {
        var g = new THREE.ExtrudeGeometry(hullShape(pad), { depth: y1 - y0, bevelEnabled: false, curveSegments: 6 });
        g.rotateX(Math.PI / 2); // shape y -> z, extrusion -> down
        g.translate(0, y1, 0);
        return g;
    }

    var ship = new THREE.Group();
    world.add(ship);

    (function () {
        var K = new Kit();
        K.add(hullSlab(0, -0.72, -0.22), C.red, 0, 0, 0, 1, 1, 1, { t: 0.035 });
        K.add(hullSlab(0, -0.22, DECK_Y), C.navy, 0, 0, 0, 1, 1, 1, { t: 0.035 });
        K.add(hullSlab(0.01, 0.24, 0.29), C.white, 0, 0, 0, 1, 1, 1, { t: 0 });
        K.add(hullSlab(-0.06, DECK_Y, DECK_Y + 0.02), C.deck, 0, 0, 0, 1, 1, 1, { t: 0 });
        // Bridge, wings, funnel, bow mast
        K.box(1.0, 0.5, 0.42, C.white, 0, DECK_Y + 0.25, -2.95);
        K.box(1.24, 0.14, 0.3, C.white, 0, DECK_Y + 0.57, -2.92);
        K.box(1.1, 0.06, 0.02, C.navy, 0, DECK_Y + 0.58, -2.765, { t: 0 });
        [0.15, 0.3].forEach(function (y) { K.box(0.02, 0.05, 0.34, C.navy, 0.505, DECK_Y + y, -2.95, { t: 0 }); });
        K.box(0.24, 0.34, 0.22, C.navy, 0, DECK_Y + 0.84, -3.12);
        K.box(0.25, 0.06, 0.23, C.gold, 0, DECK_Y + 0.9, -3.12, { t: 0 });
        K.box(0.9, 0.1, 0.35, C.navy, 0, DECK_Y + 0.05, 2.95, { t: 0.02 });
        K.box(0.04, 0.45, 0.04, C.white, 0, DECK_Y + 0.32, 3.05, { t: 0.012 });
        // Lashing posts between bays
        BAYS.forEach(function (z, i) {
            if (i === BAYS.length - 1) return;
            K.box(1.1, 0.06, 0.03, C.steel, 0, DECK_Y + 0.05, z + 0.275, { t: 0 });
        });
        ship.add(K.build(true));
    })();

    // Name on the hull, facing the camera side
    var nameCanvas = document.createElement('canvas');
    nameCanvas.width = 1024; nameCanvas.height = 96;
    var nameTex = new THREE.CanvasTexture(nameCanvas);
    function drawName() {
        var x = nameCanvas.getContext('2d');
        x.clearRect(0, 0, 1024, 96);
        x.fillStyle = '#ffffff';
        x.font = '64px "Lilita One", "Arial Black", sans-serif';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText('IONIX EXPRESS', 512, 52);
        nameTex.needsUpdate = true;
    }
    drawName();
    if (document.fonts && document.fonts.load) document.fonts.load('64px "Lilita One"').then(drawName, function () {});
    var namePlate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.225), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, clippingPlanes: CLIP }));
    namePlate.rotation.y = Math.PI / 2;
    namePlate.position.set(0.626, 0.05, -0.2);
    ship.add(namePlate);

    var deck = new Containers(BAYS.length * 8, true, ship);
    var deckColors = [];
    function loadShip() {
        for (var b = 0; b < BAYS.length; b++) {
            for (var r = 0; r < 4; r++) {
                for (var k = 0; k < 2; k++) {
                    var i = (b * 4 + r) * 2 + k;
                    deckColors[i] = boxColor();
                    deck.set(i, ROWS[r], DECK_Y + 0.14 + k * CSTEP, BAYS[b], 0, 1, deckColors[i]);
                }
            }
        }
        deck.flush();
    }
    loadShip();

    // Foam rim at the waterline and a wake that shows while the ship moves
    var foamMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, opacity: 0.75, clippingPlanes: CLIP, depthWrite: false });
    var foamGeo = new THREE.ShapeGeometry(hullShape(0.07), 6);
    foamGeo.rotateX(Math.PI / 2);
    var foam = new THREE.Mesh(foamGeo, foamMat);
    ship.add(foam);

    var wakeTex = (function () {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 128;
        var x = c.getContext('2d');
        var g = x.createLinearGradient(0, 128, 0, 0);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.beginPath(); x.moveTo(22, 128); x.lineTo(42, 128); x.lineTo(64, 0); x.lineTo(0, 0); x.closePath(); x.fill();
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = 'rgba(0,0,0,0.45)';
        for (var i = 0; i < 128; i += 16) x.fillRect(0, i, 64, 6);
        var t = new THREE.CanvasTexture(c);
        t.wrapT = THREE.RepeatWrapping;
        return t;
    })();
    var wakeMat = new THREE.MeshBasicMaterial({ map: wakeTex, transparent: true, opacity: 0, clippingPlanes: CLIP, depthWrite: false });
    var wake = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.8), wakeMat);
    wake.rotation.x = -Math.PI / 2;
    wake.position.z = -3.3 - 1.4;
    ship.add(wake);

    /* ---------- Tug ---------- */

    var tug = (function () {
        var K = new Kit();
        K.box(0.3, 0.16, 0.66, C.red, 0, -0.1, 0);
        K.add(GEO.cone, C.red, 0, -0.1, 0.4, 0.3, 0.2, 0.16, { rx: Math.PI / 2, t: 0.02 });
        K.box(0.33, 0.05, 0.69, C.dark, 0, -0.03, 0, { t: 0 });
        K.box(0.2, 0.16, 0.24, C.white, 0, 0.06, 0.04, { t: 0.02 });
        K.box(0.18, 0.05, 0.02, C.glass, 0, 0.09, 0.165, { t: 0 });
        K.box(0.24, 0.03, 0.28, C.navy, 0, 0.155, 0.04, { t: 0.015 });
        K.box(0.08, 0.12, 0.08, C.gold, 0, 0.12, -0.16, { t: 0.015 });
        var g = K.build(true);
        world.add(g);
        return g;
    })();

    /* ---------- Train ---------- */

    var train = new THREE.Group();
    world.add(train);
    (function () {
        var K = new Kit();
        K.box(0.28, 0.24, 0.62, C.violet, 0, 0.23, 0);
        K.box(0.29, 0.04, 0.63, C.gold, 0, 0.2, 0, { t: 0 });
        K.box(0.24, 0.08, 0.02, C.glass, 0, 0.29, 0.315, { t: 0 });
        K.box(0.26, 0.06, 0.52, C.dark, 0, 0.08, 0, { t: 0.015 });
        for (var i = 0; i < 4; i++) {
            var zc = -0.72 - i * 0.68;
            K.box(0.26, 0.05, 0.62, C.steel, 0, 0.13, zc, { t: 0.015 });
            K.box(0.22, 0.05, 0.5, C.dark, 0, 0.08, zc, { t: 0 });
        }
        train.add(K.build(true));
    })();
    var trainBoxes = new Containers(4, true, train);
    for (var tb = 0; tb < 4; tb++) trainBoxes.set(tb, 0, 0.275, -0.72 - tb * 0.68, 0, 1, boxColor());
    trainBoxes.flush();
    train.position.x = -3.75;

    /* ---------- Loose containers (moving between ship, cranes, trucks and yard) ---------- */

    var LOOSE_N = 48;
    var loose = new Containers(LOOSE_N, false, world);
    var looseSlots = [];
    for (var li = 0; li < LOOSE_N; li++) looseSlots.push({ i: li, on: false, mode: '', ref: null, x: 0, y: 0, z: 0, t: 0, delay: 0 });

    function grabLoose(color) {
        for (var i = 0; i < LOOSE_N; i++) {
            var c = looseSlots[i];
            if (!c.on) {
                c.on = true; c.t = 0; c.delay = 0;
                loose.set(i, 0, -50, 0, 0, 1, color);
                return c;
            }
        }
        return null;
    }

    /* ---------- Coins ---------- */

    var COIN_N = 24;
    var coinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.035, 16), toonMat(false, { color: C.gold }), COIN_N);
    coinMesh.frustumCulled = false;
    world.add(coinMesh);
    var coins = [];
    for (var ci = 0; ci < COIN_N; ci++) {
        coins.push({ on: false, x: 0, y: 0, z: 0, t: 0 });
        coinMesh.setMatrixAt(ci, tmpM.makeScale(0, 0, 0));
    }
    var coinRR = 0;

    function popCoin(x, y, z, delay) {
        var c = coins[coinRR];
        coinRR = (coinRR + 1) % COIN_N;
        c.on = true; c.x = x; c.y = y; c.z = z; c.t = -(delay || 0);
    }

    /* ---------- Truck routes ---------- */

    // Closed loop with rounded corners, sampled into a polyline
    function Path(pts, r) {
        var xs = [], zs = [], n = pts.length, i, k;
        for (i = 0; i < n; i++) {
            var p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
            var ax = p1[0] - p0[0], az = p1[1] - p0[1], la = Math.sqrt(ax * ax + az * az);
            var bx = p2[0] - p1[0], bz = p2[1] - p1[1], lb = Math.sqrt(bx * bx + bz * bz);
            var sx = p1[0] - ax / la * r, sz = p1[1] - az / la * r, ex = p1[0] + bx / lb * r, ez = p1[1] + bz / lb * r;
            for (k = 0; k <= 6; k++) {
                var t = k / 6, u = 1 - t;
                xs.push(u * u * sx + 2 * u * t * p1[0] + t * t * ex);
                zs.push(u * u * sz + 2 * u * t * p1[1] + t * t * ez);
            }
        }
        this.xs = xs; this.zs = zs; this.n = xs.length;
        this.cum = [0];
        for (i = 1; i < this.n; i++) this.cum.push(this.cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]));
        this.L = this.cum[this.n - 1] + Math.hypot(xs[0] - xs[this.n - 1], zs[0] - zs[this.n - 1]);
    }

    Path.prototype.at = function (s, out) {
        s = ((s % this.L) + this.L) % this.L;
        var j = 0, n = this.n;
        while (j < n - 1 && this.cum[j + 1] <= s) j++;
        var k = (j + 1) % n;
        var len = (j + 1 < n ? this.cum[j + 1] : this.L) - this.cum[j];
        var f = len > 0 ? (s - this.cum[j]) / len : 0;
        out.x = this.xs[j] + (this.xs[k] - this.xs[j]) * f;
        out.z = this.zs[j] + (this.zs[k] - this.zs[j]) * f;
        out.ang = Math.atan2(this.xs[k] - this.xs[j], this.zs[k] - this.zs[j]);
    };

    Path.prototype.project = function (x, z) {
        var best = 1e9, bestS = 0;
        for (var j = 0; j < this.n; j++) {
            var k = (j + 1) % this.n;
            var dx = this.xs[k] - this.xs[j], dz = this.zs[k] - this.zs[j], l2 = dx * dx + dz * dz;
            var f = l2 ? Math.max(0, Math.min(1, ((x - this.xs[j]) * dx + (z - this.zs[j]) * dz) / l2)) : 0;
            var px = this.xs[j] + dx * f - x, pz = this.zs[j] + dz * f - z, d = px * px + pz * pz;
            if (d < best) { best = d; bestS = this.cum[j] + Math.sqrt(l2) * f; }
        }
        return bestS;
    };

    var TRUCK_SPEED = 1.25, TRUCK_GAP = 0.95;
    var trucks = [];
    var pathPt = { x: 0, z: 0, ang: 0 };

    function Route(pts, load, unload) {
        this.path = new Path(pts, 0.32);
        this.L = this.path.L;
        this.sLoad = this.path.project(load[0], load[1]);
        this.sUnload = this.path.project(unload[0], unload[1]);
        this.trucks = [];
    }

    Route.prototype.addTruck = function (s, cargo) {
        var t = { route: this, s: s, v: 0, atStop: false, loaded: !!cargo, cargo: cargo, x: 0, z: 0, ang: 0, init: false };
        if (cargo) { cargo.mode = 'truck'; cargo.ref = t; }
        this.trucks.push(t);
        trucks.push(t);
        return t;
    };

    Route.prototype.truckAt = function (s, loaded) {
        for (var i = 0; i < this.trucks.length; i++) {
            var t = this.trucks[i];
            if (t.atStop && t.loaded === loaded && Math.abs(t.s - s) < 0.01) return t;
        }
        return null;
    };

    Route.prototype.update = function (dt) {
        var L = this.L, ts = this.trucks;
        for (var i = 0; i < ts.length; i++) {
            var t = ts[i];
            if (!t.atStop) {
                var gap = 1e9;
                for (var j = 0; j < ts.length; j++) {
                    if (j === i) continue;
                    var d = (ts[j].s - t.s + L) % L;
                    if (d > 1e-4 && d < gap) gap = d;
                }
                var stopS = t.loaded ? this.sUnload : this.sLoad;
                var toStop = (stopS - t.s + L) % L;
                var room = Math.min(toStop, gap - TRUCK_GAP);
                var vt = TRUCK_SPEED * Math.max(0, Math.min(1, room / 0.6));
                if (room > 0.002) vt = Math.max(vt, 0.18);
                t.v += (vt - t.v) * Math.min(1, dt * 5);
                var adv = Math.max(0, Math.min(t.v * dt, room));
                t.s = (t.s + adv) % L;
                if (toStop - adv < 0.002 && toStop <= gap - TRUCK_GAP + 0.002) {
                    t.s = stopS;
                    t.v = 0;
                    t.atStop = true;
                }
            }
            this.path.at(t.s, pathPt);
            t.x = pathPt.x; t.z = pathPt.z;
            if (!t.init) { t.ang = pathPt.ang; t.init = true; }
            var da = Math.atan2(Math.sin(pathPt.ang - t.ang), Math.cos(pathPt.ang - t.ang));
            t.ang += da * Math.min(1, dt * 10);
        }
    };

    var routeA = new Route([[LANE_X, -0.25], [LANE_X, -3.6], [YARD_X, -3.6], [YARD_X, -0.25]], [LANE_X, -1.55], [YARD_X, -1.7]);
    var routeB = new Route([[LANE_X, 0.25], [LANE_X, 3.6], [YARD_X, 3.6], [YARD_X, 0.25]], [LANE_X, 1.55], [YARD_X, 1.7]);

    var truckKit = (function () {
        var K = new Kit();
        K.box(0.22, 0.05, 0.76, C.dark, 0, 0.1, 0.02, { t: 0.015 });
        K.box(0.22, 0.17, 0.17, C.yellow, 0, 0.21, 0.31, { t: 0.02 });
        K.box(0.2, 0.06, 0.02, C.glass, 0, 0.25, 0.4, { t: 0 });
        [[0.31], [-0.12], [-0.27]].forEach(function (w) {
            [-0.1, 0.1].forEach(function (x) { K.cyl(0.055, 0.05, C.dark, x, 0.055, w[0], { rz: Math.PI / 2, t: 0 }); });
        });
        return K.merge();
    })();

    var TRUCK_N = 6;
    var truckMesh = new THREE.InstancedMesh(truckKit.geo, MAT.toon, TRUCK_N);
    var truckInk = new THREE.InstancedMesh(truckKit.hull, MAT.ink, TRUCK_N);
    truckMesh.castShadow = true;
    truckMesh.receiveShadow = true;
    truckMesh.frustumCulled = truckInk.frustumCulled = false;
    world.add(truckMesh);
    world.add(truckInk);

    /* ---------- Crane + gantry logic ---------- */

    function approach(a, b, d) { return a < b ? Math.min(a + d, b) : Math.max(a - d, b); }

    var ShipState = { state: 'docked', z: 0, y: 0, v: 0, t: 0, unloaded: 0 };
    var PER_CRANE = 12, SHIP_IN = -8.2, SHIP_OUT = 7.8, SAIL_T = 9;

    function QuayCrane(bays, handZ, route) {
        this.group = craneProto.clone();
        this.trolley = fromMerged(craneTrolley, false);
        this.spreader = fromMerged(spreaderGeo, false);
        this.cables = fromMerged(cableGeo, false, true);
        this.group.add(this.trolley, this.spreader, this.cables);
        var light = new THREE.Mesh(beaconGeo, beaconMat);
        light.position.set(0.95, 2.98, 0);
        this.group.add(light);
        world.add(this.group);
        this.bays = bays;
        this.handZ = handZ;
        this.route = route;
        this.z = handZ; this.tx = LANE_X; this.sy = CREST;
        this.state = 'idle'; this.timer = 0; this.next = 0; this.task = null; this.held = null; this.truck = null;
        this.tasks = [];
    }

    QuayCrane.prototype.plan = function () {
        this.tasks = [];
        var self = this;
        this.bays.forEach(function (b) { for (var r = 3; r >= 0; r--) self.tasks.push({ bay: b, row: r }); });
        this.next = 0;
    };

    QuayCrane.prototype.done = function () { return this.next >= this.tasks.length && this.state === 'idle'; };

    QuayCrane.prototype.update = function (dt) {
        var G = 1.0 * dt, T = 2.0 * dt, H = 2.0 * dt;
        switch (this.state) {
            case 'idle':
                if (ShipState.state === 'docked' && this.next < this.tasks.length) {
                    this.task = this.tasks[this.next++];
                    this.state = 'toPick';
                } else {
                    this.z = approach(this.z, this.handZ, G);
                    this.tx = approach(this.tx, ShipState.state === 'docked' ? LANE_X : 1.2, T);
                    this.sy = approach(this.sy, CREST, H);
                }
                break;
            case 'toPick':
                var bz = BAYS[this.task.bay], bx = SHIP_X + ROWS[this.task.row];
                this.z = approach(this.z, bz, G);
                this.tx = approach(this.tx, bx, T);
                this.sy = approach(this.sy, CREST, H);
                if (this.z === bz && this.tx === bx && this.sy === CREST) this.state = 'lowerPick';
                break;
            case 'lowerPick':
                var py = ShipState.y + DECK_Y + 0.14 + CSTEP + HANG;
                this.sy = approach(this.sy, py, H * 0.8);
                if (this.sy === py) { this.state = 'grab'; this.timer = 0.25; }
                break;
            case 'grab':
                if ((this.timer -= dt) > 0) break;
                var di = (this.task.bay * 4 + this.task.row) * 2 + 1;
                deck.hide(di);
                this.held = grabLoose(deckColors[di]);
                if (this.held) { this.held.mode = 'crane'; this.held.ref = this; }
                ShipState.unloaded++;
                this.state = 'hoist';
                break;
            case 'hoist':
                this.sy = approach(this.sy, CREST, H);
                if (this.sy === CREST) this.state = 'toDrop';
                break;
            case 'toDrop':
                this.z = approach(this.z, this.handZ, G);
                this.tx = approach(this.tx, LANE_X, T);
                if (this.z === this.handZ && this.tx === LANE_X) this.state = 'waitTruck';
                break;
            case 'waitTruck':
                this.truck = this.route.truckAt(this.route.sLoad, false);
                if (this.truck) this.state = 'lowerDrop';
                break;
            case 'lowerDrop':
                var dy = TRUCK_C_Y + HANG;
                this.sy = approach(this.sy, dy, H * 0.8);
                if (this.sy === dy) { this.state = 'release'; this.timer = 0.2; }
                break;
            case 'release':
                if ((this.timer -= dt) > 0) break;
                if (this.held) { this.held.mode = 'truck'; this.held.ref = this.truck; }
                this.truck.cargo = this.held;
                this.truck.loaded = true;
                this.truck.atStop = false;
                this.held = null;
                this.state = 'hoistEmpty';
                break;
            case 'hoistEmpty':
                this.sy = approach(this.sy, CREST, H);
                if (this.sy === CREST) this.state = 'idle';
                break;
        }
    };

    QuayCrane.prototype.draw = function () {
        this.group.position.z = this.z;
        this.trolley.position.set(this.tx, CRANE_TROLLEY_Y + 0.04, 0);
        this.spreader.position.set(this.tx, this.sy, 0);
        this.cables.position.set(this.tx, CRANE_TROLLEY_Y, 0);
        this.cables.scale.y = Math.max(0.01, CRANE_TROLLEY_Y - this.sy - 0.025);
    };

    // Yard gantry (RTG): lifts boxes off trucks and stacks them in its bay
    var rtgProto = (function () {
        var K = new Kit();
        [-0.95, -3.3].forEach(function (x) {
            [-0.3, 0.3].forEach(function (z) {
                K.box(0.08, 1.2, 0.08, C.white, x, 0.72, z);
                K.cyl(0.07, 0.08, C.dark, x, 0.07, z, { rz: Math.PI / 2, t: 0.012 });
            });
            K.box(0.12, 0.1, 0.78, C.violet, x, 0.14, 0, { t: 0.02 });
            K.box(0.1, 0.1, 0.68, C.violet, x, 1.32, 0, { t: 0.02 });
        });
        [-0.3, 0.3].forEach(function (z) { K.box(2.55, 0.1, 0.08, C.violet, -2.125, 1.32, z); });
        K.box(0.26, 0.24, 0.4, C.white, -3.3, 0.45, 0, { t: 0.02 });
        return K.build(false);
    })();
    var rtgTrolley = trolleyKit(C.white).merge();

    function Gantry(z, route) {
        this.group = rtgProto.clone();
        this.group.position.z = z;
        this.trolley = fromMerged(rtgTrolley, false);
        this.trolley.scale.setScalar(0.85);
        this.spreader = fromMerged(spreaderGeo, false);
        this.cables = fromMerged(cableGeo, false, true);
        this.group.add(this.trolley, this.spreader, this.cables);
        world.add(this.group);
        this.z = z; this.route = route;
        this.tx = YARD_X; this.sy = RREST;
        this.state = 'idle'; this.timer = 0; this.held = null; this.slot = -1;
        this.slots = [];
        for (var i = 0; i < 18; i++) this.slots.push(null);
    }

    Gantry.prototype.slotPos = function (i) {
        return { x: YROWS[i % 6], y: 0.12 + Math.floor(i / 6) * CSTEP };
    };

    Gantry.prototype.place = function (i, c) {
        var p = this.slotPos(i);
        c.mode = 'yard'; c.ref = null; c.x = p.x; c.y = p.y; c.z = this.z;
        this.slots[i] = c;
    };

    // "Sold": the stacked boxes pop away into coins
    Gantry.prototype.clear = function () {
        var n = 0;
        for (var i = 0; i < this.slots.length; i++) {
            var c = this.slots[i];
            if (!c) continue;
            c.mode = 'vanish'; c.t = 0; c.delay = n * 0.07;
            if (n % 2 === 0) popCoin(c.x, c.y + 0.25, c.z, n * 0.07);
            this.slots[i] = null;
            n++;
        }
    };

    Gantry.prototype.update = function (dt) {
        var T = 1.6 * dt, H = 1.6 * dt;
        switch (this.state) {
            case 'idle':
                this.tx = approach(this.tx, YARD_X, T);
                this.sy = approach(this.sy, RREST, H);
                if (this.tx === YARD_X && this.sy === RREST) {
                    this.truck = this.route.truckAt(this.route.sUnload, true);
                    if (this.truck) this.state = 'lowerPick';
                }
                break;
            case 'lowerPick':
                var py = TRUCK_C_Y + HANG;
                this.sy = approach(this.sy, py, H);
                if (this.sy === py) { this.state = 'grab'; this.timer = 0.2; }
                break;
            case 'grab':
                if ((this.timer -= dt) > 0) break;
                this.held = this.truck.cargo;
                if (this.held) { this.held.mode = 'rtg'; this.held.ref = this; }
                this.truck.cargo = null;
                this.truck.loaded = false;
                this.truck.atStop = false;
                this.state = 'hoist';
                break;
            case 'hoist':
                this.sy = approach(this.sy, RREST, H);
                if (this.sy !== RREST) break;
                this.slot = this.slots.indexOf(null);
                if (this.slot < 0) { this.clear(); this.slot = 0; }
                this.state = 'toSlot';
                break;
            case 'toSlot':
                var sx = this.slotPos(this.slot).x;
                this.tx = approach(this.tx, sx, T);
                if (this.tx === sx) this.state = 'lowerDrop';
                break;
            case 'lowerDrop':
                var dy = this.slotPos(this.slot).y + HANG;
                this.sy = approach(this.sy, dy, H);
                if (this.sy === dy) { this.state = 'release'; this.timer = 0.2; }
                break;
            case 'release':
                if ((this.timer -= dt) > 0) break;
                if (this.held) {
                    this.place(this.slot, this.held);
                    popCoin(this.held.x, this.held.y + 0.3, this.z);
                }
                this.held = null;
                this.state = 'hoistEmpty';
                break;
            case 'hoistEmpty':
                this.sy = approach(this.sy, RREST, H);
                if (this.sy === RREST) this.state = 'idle';
                break;
        }
    };

    Gantry.prototype.draw = function () {
        this.trolley.position.set(this.tx, RTG_TROLLEY_Y + 0.04, 0);
        this.spreader.position.set(this.tx, this.sy, 0);
        this.cables.position.set(this.tx, RTG_TROLLEY_Y, 0);
        this.cables.scale.y = Math.max(0.01, RTG_TROLLEY_Y - this.sy - 0.025);
    };

    var cranes = [new QuayCrane([3, 2, 1], -1.55, routeA), new QuayCrane([5, 6, 7], 1.55, routeB)];
    var gantries = [new Gantry(-1.7, routeA), new Gantry(1.7, routeB)];
    cranes.forEach(function (c) { c.plan(); });

    // Start mid-shift: some boxes already stacked, one truck already loaded
    gantries.forEach(function (g) {
        for (var i = 0; i < 5; i++) { var c = grabLoose(boxColor()); g.place(i, c); }
    });
    [routeA, routeB].forEach(function (r) {
        r.addTruck(r.sLoad, null);
        r.addTruck((r.sUnload - 1.3 + r.L) % r.L, grabLoose(boxColor()));
        r.addTruck((r.sUnload + 1.6) % r.L, null);
    });

    /* ---------- Ship + tug + train loop ---------- */

    function easeOut(k) { return 1 - Math.pow(1 - k, 3); }
    function easeIn(k) { return k * k * k; }

    function updateShip(dt) {
        var S = ShipState, z0 = S.z;
        S.t += dt;
        if (S.state === 'docked') {
            if (cranes[0].done() && cranes[1].done()) { S.state = 'leaving'; S.t = 0; }
        } else if (S.state === 'leaving') {
            if (S.t > 1.2) { S.state = 'depart'; S.t = 0; gantries.forEach(function (g) { g.clear(); }); }
        } else if (S.state === 'depart') {
            S.z = SHIP_OUT * easeIn(Math.min(1, S.t / SAIL_T));
            if (S.t >= SAIL_T) { S.state = 'away'; S.t = 0; }
        } else if (S.state === 'away') {
            if (S.t > 1.5) {
                loadShip();
                S.unloaded = 0; S.y = 0;
                cranes.forEach(function (c) { c.plan(); });
                S.state = 'arrive'; S.t = 0; S.z = SHIP_IN;
            }
        } else if (S.state === 'arrive') {
            S.z = SHIP_IN * (1 - easeOut(Math.min(1, S.t / SAIL_T)));
            if (S.t >= SAIL_T) { S.state = 'docked'; S.t = 0; S.z = 0; }
        }
        S.v = dt > 0 ? (S.z - z0) / dt : 0;
        // Ship rides higher as it empties
        S.y += ((S.unloaded / (PER_CRANE * 2)) * 0.1 - S.y) * Math.min(1, dt * 2);
    }

    var trainZ = -4.4, trainWait = 0;
    var TRAIN_IN = -4.4, TRAIN_OUT = 7.2;
    function updateTrain(dt) {
        if (trainWait > 0) { trainWait -= dt; return; }
        trainZ += dt * 1.1;
        if (trainZ > TRAIN_OUT) { trainZ = TRAIN_IN; trainWait = 7; }
    }

    /* ---------- Birds + clouds ---------- */

    function wingKit(side) {
        var K = new Kit();
        K.box(0.3, 0.02, 0.13, C.white, 0.15 * side, 0, 0, { t: 0.014 });
        K.box(0.1, 0.022, 0.1, 0x46507E, 0.28 * side, 0, -0.01, { t: 0 });
        return K.merge();
    }
    var wingR = wingKit(1), wingL = wingKit(-1);
    var birdBody = (function () {
        var K = new Kit();
        K.add(GEO.ico, C.white, 0, 0, 0, 0.16, 0.13, 0.32, { t: 0.018 });
        K.add(GEO.ico, C.white, 0, 0.05, 0.15, 0.11, 0.1, 0.11, { t: 0.016 });
        K.add(GEO.cone, 0xFF9F3D, 0, 0.04, 0.24, 0.05, 0.1, 0.05, { rx: Math.PI / 2, t: 0.01 });
        return K.merge();
    })();

    var birds = [];
    for (var bi = 0; bi < 3; bi++) {
        var bird = fromMerged(birdBody, false, true);
        var wr = fromMerged(wingR, false, true), wl = fromMerged(wingL, false, true);
        wr.position.set(0.05, 0.03, 0); wl.position.set(-0.05, 0.03, 0);
        bird.add(wr, wl);
        bird.userData = { a: bi * 2.1, r: 3.2 + bi * 0.9, h: 2.7 + bi * 0.35, sp: 0.35 - bi * 0.05, ph: bi * 1.7, wr: wr, wl: wl, cx: -0.5 + bi * 0.4, cz: bi - 1 };
        world.add(bird);
        birds.push(bird);
    }

    var clouds = (function () {
        var K = new Kit();
        [[-8.5, 2.6, -5.5, 1.2], [5.5, 3.4, -7.5, 1.0], [7.5, -2.2, 2.5, 0.9]].forEach(function (cd) {
            [[0, 0, 0, 0.75], [0.7, -0.12, 0.05, 0.55], [-0.68, -0.14, 0.05, 0.52], [0.22, 0.32, -0.1, 0.55], [-0.3, 0.2, 0.15, 0.45]].forEach(function (b) {
                var s = cd[3] * b[3] * 2;
                K.add(GEO.ico, C.white, cd[0] + b[0] * cd[3], cd[1] + b[1] * cd[3], cd[2] + b[2] * cd[3], s, s * 0.82, s, { t: 0.04 });
            });
        });
        var g = K.build(false, true);
        world.add(g);
        return g;
    })();

    /* ---------- Per-frame update ---------- */

    var clock = 0;

    function simulate(dt) {
        clock += dt;
        updateShip(dt);
        cranes.forEach(function (c) { c.update(dt); });
        routeA.update(dt);
        routeB.update(dt);
        gantries.forEach(function (g) { g.update(dt); });
        updateTrain(dt);

        for (var i = 0; i < COIN_N; i++) {
            var c = coins[i];
            if (c.on && (c.t += dt) > 1.3) c.on = false;
        }
        for (var j = 0; j < LOOSE_N; j++) {
            var l = looseSlots[j];
            if (l.on && l.mode === 'vanish' && (l.t += dt) > l.delay + 0.35) { l.on = false; loose.hide(j); }
        }
    }

    function draw() {
        var t = clock;

        cranes.forEach(function (c) { c.draw(); });
        gantries.forEach(function (g) { g.draw(); });

        var S = ShipState;
        ship.position.set(SHIP_X, S.y, S.z);
        foam.position.y = WATER_Y + 0.008 - S.y;
        wake.position.y = WATER_Y + 0.006 - S.y;
        wakeMat.opacity = Math.min(1, Math.abs(S.v) / 1.2) * 0.8;
        wakeTex.offset.y = t * 0.6;

        // Tug runs alongside while sailing, turns in and pushes while docked
        var push = S.state === 'docked' || S.state === 'leaving' ? 1 : S.state === 'arrive' ? Math.max(0, (S.t - SAIL_T + 2) / 2) : S.state === 'depart' ? Math.max(0, 1 - S.t / 1.5) : 0;
        push = push * push * (3 - 2 * push);
        tug.position.set(SHIP_X + 1.05 - push * 0.06, -0.2 + Math.sin(t * 2.1) * 0.012, S.z + 1.5 - push * 0.4);
        tug.rotation.y = -push * Math.PI / 2;
        tug.rotation.z = Math.sin(t * 1.7) * 0.03;

        train.position.z = trainZ;
        train.visible = trainWait <= 0;

        for (var i = 0; i < trucks.length; i++) {
            var tr = trucks[i];
            tmpObj.position.set(tr.x, ROAD_Y, tr.z);
            tmpObj.rotation.set(0, tr.ang, 0);
            tmpObj.scale.setScalar(1);
            tmpObj.updateMatrix();
            truckMesh.setMatrixAt(i, tmpObj.matrix);
            truckInk.setMatrixAt(i, tmpObj.matrix);
        }
        truckMesh.instanceMatrix.needsUpdate = truckInk.instanceMatrix.needsUpdate = true;

        for (var j = 0; j < LOOSE_N; j++) {
            var l = looseSlots[j];
            if (!l.on) continue;
            var r = l.ref;
            if (l.mode === 'crane' || l.mode === 'rtg') {
                loose.set(j, r.tx, r.sy - HANG, r.z, 0, 1);
            } else if (l.mode === 'truck') {
                loose.set(j, r.x - Math.sin(r.ang) * 0.06, TRUCK_C_Y, r.z - Math.cos(r.ang) * 0.06, r.ang, 1);
            } else if (l.mode === 'yard') {
                loose.set(j, l.x, l.y, l.z, 0, 1);
            } else if (l.mode === 'vanish') {
                var k = Math.max(0, (l.t - l.delay) / 0.35);
                loose.set(j, l.x, l.y + k * 0.15, l.z, 0, Math.max(0.001, 1 - k * k));
            }
        }
        loose.flush();
        deck.flush();

        for (var ci = 0; ci < COIN_N; ci++) {
            var cn = coins[ci];
            if (!cn.on || cn.t < 0) { coinMesh.setMatrixAt(ci, tmpM.makeScale(0, 0, 0)); continue; }
            var ct = cn.t, s = ct < 0.15 ? ct / 0.15 : ct > 1.0 ? Math.max(0, (1.3 - ct) / 0.3) : 1;
            tmpObj.position.set(cn.x, cn.y + ct * 1.1 - ct * ct * 0.35, cn.z);
            tmpObj.rotation.set(0, ct * 7, Math.PI / 2);
            tmpObj.scale.setScalar(s * 1.3);
            tmpObj.updateMatrix();
            coinMesh.setMatrixAt(ci, tmpObj.matrix);
        }
        coinMesh.instanceMatrix.needsUpdate = true;

        birds.forEach(function (bd) {
            var u = bd.userData, a = u.a + t * u.sp;
            bd.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(t * 0.8 + u.ph) * 0.25, u.cz + Math.sin(a) * u.r);
            bd.rotation.set(0, -a, 0.3);
            var flap = Math.sin(t * 8 + u.ph) * (Math.sin(t * 0.6 + u.ph) > 0.3 ? 0.15 : 0.6);
            u.wr.rotation.z = flap;
            u.wl.rotation.z = -flap;
        });

        clouds.position.x = Math.sin(t * 0.08) * 0.8;

        var blink = (t % 1.2) < 0.6;
        beaconMat.color.setHex(blink ? 0xFF4D5E : 0x8A3A4A);
        waterMat.uniforms.time.value = t;
    }

    /* ---------- Layout + interaction ---------- */

    // Matches the CSS breakpoint where the canvas moves below the headline
    var STACKED = window.matchMedia('(max-width: 760px)');

    function resize() {
        var w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        var side = !STACKED.matches;
        var az = 0.98, el = 0.6, R = 7.4;
        var tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), tanH = tanV * camera.aspect;
        var dist = side ? Math.max(R / (tanH * 0.5), R * 1.0 / tanV) : Math.max(R / (tanH * 1.04), R * 0.76 / tanV);
        camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
        camera.lookAt(-0.5, -0.5, 0);
        // Beside the headline: push the port right so it clears the text
        if (side) camera.setViewOffset(w, h, -w * 0.25, 0, w, h);
        else camera.clearViewOffset();
        camera.updateProjectionMatrix();
    }

    var mouse = { x: 0, y: 0 };
    host.parentElement.addEventListener('pointermove', function (e) {
        var r = host.getBoundingClientRect();
        mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
        mouse.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });

    // Cheap tap target: one invisible box around the slab
    var proxy = new THREE.Mesh(new THREE.BoxGeometry(11.2, 5.5, 8.4), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(-0.5, 0.4, 0);
    world.add(proxy);

    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var squash = 0;

    function pick(e) {
        var r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        var hit = raycaster.intersectObject(proxy, false);
        return hit.length ? hit[0] : null;
    }

    renderer.domElement.addEventListener('click', function (e) {
        var hit = pick(e);
        if (!hit) return;
        squash = 1;
        var p = world.worldToLocal(hit.point.clone());
        for (var i = 0; i < 3; i++) popCoin(p.x + (i - 1) * 0.3, Math.max(0.4, p.y), p.z, i * 0.06);
        if (REDUCED) render(0);
        if (window.ixAddCoins) window.ixAddCoins(25, e.clientX, e.clientY);
        if (window.ixTrack) window.ixTrack('island_tap', {}, true);
    });

    renderer.domElement.addEventListener('pointermove', function (e) {
        renderer.domElement.style.cursor = pick(e) ? 'pointer' : '';
    });

    var visible = true;
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(host);
    }

    /* ---------- Render loop ---------- */

    var rotX = 0, rotZ = 0;

    function render(t) {
        rotX += ((mouse.y * 0.06) - rotX) * 0.05;
        rotZ += ((-mouse.x * 0.04) - rotZ) * 0.05;
        squash *= 0.88;
        world.position.set(0, Math.sin(t * 0.9) * 0.12, 0);
        world.rotation.set(rotX, Math.sin(t * 0.12) * 0.1, rotZ);
        world.scale.set(1 + squash * 0.03, 1 - squash * 0.05, 1 + squash * 0.03);
        world.updateMatrix();
        CLIP[0].copy(CLIP_LOCAL[0]).applyMatrix4(world.matrix);
        CLIP[1].copy(CLIP_LOCAL[1]).applyMatrix4(world.matrix);
        draw();
        renderer.render(scene, camera);
    }

    // Start mid-shift rather than from a frozen first frame
    for (var w = 0; w < 200; w++) simulate(1 / 30);

    resize();

    if (REDUCED) {
        window.addEventListener('resize', function () { resize(); render(0); });
        window.addEventListener('load', function () { resize(); render(0); });
        render(0);
        return;
    }

    window.addEventListener('resize', resize);

    var last = 0, raf = 0, slowFrames = 0, sampled = 0, elapsed = 0;
    var MIN_DT = LOW_POWER ? 1 / 32 : 0;

    function loop(now) {
        raf = requestAnimationFrame(loop);
        now /= 1000;
        if (!last) last = now;
        var dt = now - last;
        if (!visible || dt < MIN_DT) { if (!visible) last = now; return; }
        last = now;

        // Step pixel ratio down if frames keep running slow
        if (dt < 0.25) {
            sampled++;
            if (dt > (LOW_POWER ? 0.045 : 0.028)) slowFrames++;
            if (sampled >= 90) {
                if (slowFrames > 45 && dpr > 1) {
                    dpr = Math.max(1, dpr - 0.25);
                    renderer.setPixelRatio(dpr);
                    resize();
                }
                sampled = slowFrames = 0;
            }
        }

        dt = Math.min(dt, 0.1);
        elapsed += dt;
        simulate(dt);
        render(elapsed);
    }

    renderer.domElement.addEventListener('webglcontextlost', function (e) {
        e.preventDefault();
        cancelAnimationFrame(raf);
    });

    raf = requestAnimationFrame(loop);

})();
