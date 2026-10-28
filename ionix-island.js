/* ===========================================================
   IONIX — Stylized toon floating island (homepage hero)
   Requires three.js r128 (global THREE) and ionix.js.
=========================================================== */

(function () {

    var host = document.getElementById('ix-world');
    if (!host || typeof THREE === 'undefined') return;

    var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var INK = 0x2F2545;

    var renderer;
    try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) { return; }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

    var world = new THREE.Group();
    scene.add(world);

    /* ---------- Lighting ---------- */

    world.add(new THREE.HemisphereLight(0xEAF6FF, 0xF6D9B0, 0.62));

    var sun = new THREE.DirectionalLight(0xFFF1D6, 0.95);
    sun.position.set(7, 13, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8;
    sun.shadow.camera.bottom = -8;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    world.add(sun);
    world.add(sun.target);

    var fill = new THREE.DirectionalLight(0xB8C8FF, 0.25);
    fill.position.set(-8, 4, -6);
    world.add(fill);

    /* ---------- Materials + helpers ---------- */

    var ramp = new THREE.DataTexture(new Uint8Array([130, 200, 255]), 3, 1, THREE.LuminanceFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;

    var matCache = {};
    function toon(color, flat) {
        var key = color + (flat ? 'f' : '');
        if (!matCache[key]) matCache[key] = new THREE.MeshToonMaterial({ color: color, gradientMap: ramp });
        return matCache[key];
    }

    function glow(color) {
        var key = 'g' + color;
        if (!matCache[key]) matCache[key] = new THREE.MeshBasicMaterial({ color: color });
        return matCache[key];
    }

    var hullMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

    // Normal-extruded outline for smooth closed shapes (spheres, icosahedra)
    var extrudeCache = {};
    function extrudeMat(t) {
        if (!extrudeCache[t]) {
            extrudeCache[t] = new THREE.ShaderMaterial({
                uniforms: { color: { value: new THREE.Color(INK) }, thickness: { value: t } },
                vertexShader: 'uniform float thickness; void main(){ vec3 p = position + normalize(normal) * thickness; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
                fragmentShader: 'uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }',
                side: THREE.BackSide
            });
        }
        return extrudeCache[t];
    }

    // Toon mesh + ink outline of uniform thickness t
    function part(geo, color, t, opts) {
        opts = opts || {};
        if (opts.flat && geo.index) {
            // r128 toon ignores flatShading: split vertices so normals are per-face
            geo = geo.toNonIndexed();
            geo.computeVertexNormals();
        }
        var m = new THREE.Mesh(geo, opts.mat || toon(color, opts.flat));
        m.castShadow = opts.cast !== false;
        m.receiveShadow = true;
        if (t === 0) return m;
        t = t || 0.04;
        var type = geo.type;
        if (/Sphere|Icosahedron|Dodecahedron|Octahedron/.test(type)) {
            m.add(new THREE.Mesh(geo, extrudeMat(t)));
        } else {
            geo.computeBoundingBox();
            var bb = geo.boundingBox, size = new THREE.Vector3(), c = new THREE.Vector3();
            bb.getSize(size); bb.getCenter(c);
            var o = new THREE.Mesh(geo, hullMat);
            o.scale.set((size.x + 2 * t) / Math.max(size.x, 1e-3), (size.y + 2 * t) / Math.max(size.y, 1e-3), (size.z + 2 * t) / Math.max(size.z, 1e-3));
            o.position.set(c.x - c.x * o.scale.x, c.y - c.y * o.scale.y, c.z - c.z * o.scale.z);
            m.add(o);
        }
        return m;
    }

    function at(obj, x, y, z, parent) {
        obj.position.set(x, y, z);
        if (parent) parent.add(obj);
        return obj;
    }

    function rng(seed) {
        return function () {
            seed |= 0; seed = seed + 0x6D2B79F5 | 0;
            var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    var rand = rng(7);

    /* ---------- Palette ---------- */

    var C = {
        grass: 0x72D163, grassDark: 0x56B550, dirt: 0xDB9A62, rock1: 0xC77E57, rock2: 0xA9664A, rock3: 0x8E5341,
        stone: 0xB4BEDA, wood: 0xC98A4B, woodDark: 0x9C6A3A, cream: 0xFFF6E2, berry: 0xFF7A93, gold: 0xFFC24A,
        violet: 0x8A6FD1, water: 0x5CC6EA, waterLight: 0xA3E3F5, leaf: 0x62C25A, leafLight: 0x8BD873,
        pine: 0x3A9F6A, blossom: 0xFFADC9, white: 0xFFFFFF, warm: 0xFFE08A
    };

    /* ---------- Island terrain ---------- */

    var island = new THREE.Group();
    world.add(island);

    var TOP = 0.45;

    function edge(a) {
        return 1 + 0.07 * Math.sin(3 * a + 0.5) + 0.05 * Math.sin(5 * a + 1.7) + 0.025 * Math.sin(9 * a + 2.3);
    }

    function jitter(a, y) {
        return 0.045 * Math.sin(a * 13 + y * 4) + 0.03 * Math.sin(a * 23 + y * 7 + 1.3);
    }

    function layer(rTop, rBot, h, y, color, rough) {
        var geo = new THREE.CylinderGeometry(rTop, rBot, h, 44, 2);
        var p = geo.attributes.position;
        for (var i = 0; i < p.count; i++) {
            var x = p.getX(i), z = p.getZ(i), yy = p.getY(i);
            var r = Math.sqrt(x * x + z * z);
            if (r < 1e-4) continue;
            var a = Math.atan2(z, x);
            var k = edge(a) * (1 + (rough ? jitter(a, yy) : 0));
            p.setX(i, x * k);
            p.setZ(i, z * k);
        }
        geo.computeVertexNormals();
        var m = part(geo, color, 0.05, { flat: rough });
        m.position.y = y;
        island.add(m);
        return m;
    }

    layer(4.45, 4.38, 0.42, TOP - 0.21, C.grass, false);
    layer(4.22, 3.8, 0.85, -0.4, C.dirt, true);
    layer(3.85, 3.0, 0.95, -1.28, C.rock1, true);
    layer(3.05, 1.85, 1.05, -2.27, C.rock2, true);

    var spike = new THREE.ConeGeometry(1.9, 2.1, 12, 3);
    (function () {
        var p = spike.attributes.position;
        for (var i = 0; i < p.count; i++) {
            var x = p.getX(i), z = p.getZ(i), yy = p.getY(i);
            var a = Math.atan2(z, x), k = 1 + jitter(a, yy) * 2.2;
            p.setX(i, x * k); p.setZ(i, z * k);
        }
        spike.computeVertexNormals();
    })();
    var spikeMesh = part(spike, C.rock3, 0.05, { flat: true });
    spikeMesh.rotation.x = Math.PI;
    at(spikeMesh, 0, -3.84, 0, island);

    // Hanging rock stalactites
    for (var s = 0; s < 9; s++) {
        var sa = rand() * Math.PI * 2, sr = 1.5 + rand() * 1.2;
        var st = part(new THREE.ConeGeometry(0.22 + rand() * 0.18, 0.7 + rand() * 0.7, 6), rand() > 0.5 ? C.rock2 : C.rock3, 0.04, { flat: true });
        st.rotation.x = Math.PI;
        at(st, Math.cos(sa) * sr, -2.9 - rand() * 0.4, Math.sin(sa) * sr, island);
    }

    // Grass drips over the cliff edge
    for (var d = 0; d < 34; d++) {
        var da = (d / 34) * Math.PI * 2 + rand() * 0.15;
        var dr = 4.38 * edge(da);
        var drip = part(new THREE.SphereGeometry(0.1 + rand() * 0.07, 10, 8), d % 3 ? C.grass : C.grassDark, 0.03);
        drip.scale.set(1.2, 1.4 + rand() * 0.5, 1);
        at(drip, Math.cos(da) * dr, TOP - 0.36, Math.sin(da) * dr, island);
    }

    // Hanging vines with leaf tips
    for (var v = 0; v < 8; v++) {
        var va = rand() * Math.PI * 2, vr = 4.18 * edge(va), len = 0.35 + rand() * 0.55;
        var vine = part(new THREE.CylinderGeometry(0.035, 0.03, len, 5), C.grassDark, 0.025);
        at(vine, Math.cos(va) * vr, TOP - 0.3 - len / 2, Math.sin(va) * vr, island);
        var tip = part(new THREE.IcosahedronGeometry(0.1, 0), C.leafLight, 0.025);
        at(tip, Math.cos(va) * vr, TOP - 0.32 - len, Math.sin(va) * vr, island);
    }

    /* ---------- Water: pond, stream, waterfall ---------- */

    var WA = 2.35;                 // waterfall angle
    var wx = Math.cos(WA), wz = Math.sin(WA);
    var lipR = 4.38 * edge(WA);

    var pond = part(new THREE.CylinderGeometry(0.85, 0.85, 0.06, 28), C.water, 0.035, { cast: false });
    at(pond, wx * 1.75, TOP + 0.02, wz * 1.75, island);
    var pondShine = part(new THREE.CylinderGeometry(0.42, 0.42, 0.07, 20), C.waterLight, 0, { cast: false });
    at(pondShine, wx * 1.75 - 0.15, TOP + 0.03, wz * 1.75 + 0.1, island);

    for (var ps = 0; ps < 11; ps++) {
        var pa = (ps / 11) * Math.PI * 2;
        var pst = part(new THREE.IcosahedronGeometry(0.13 + rand() * 0.07, 0), C.stone, 0.03, { flat: true });
        pst.scale.y = 0.6;
        at(pst, wx * 1.75 + Math.cos(pa) * 0.92, TOP + 0.04, wz * 1.75 + Math.sin(pa) * 0.92, island);
    }

    var streamLen = lipR - 2.45;
    var stream = part(new THREE.BoxGeometry(0.46, 0.05, streamLen + 0.15), C.water, 0.03, { cast: false });
    stream.rotation.y = Math.atan2(wx, wz);
    at(stream, wx * (2.45 + streamLen / 2), TOP + 0.01, wz * (2.45 + streamLen / 2), island);

    var fallMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
            'varying vec2 vUv; uniform float time;',
            'void main(){',
            '  float band = fract(vUv.y * 4.0 + time * 1.6 + sin(vUv.x * 18.0) * 0.06);',
            '  float streak = step(0.72, fract(vUv.x * 5.0 + sin(vUv.y * 9.0 + time * 2.0) * 0.12));',
            '  vec3 c = mix(vec3(0.27, 0.78, 0.95), vec3(0.58, 0.9, 1.0), step(0.55, band));',
            '  c = mix(c, vec3(1.0), streak * 0.75 * step(0.45, band));',
            '  float edgeL = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);',
            '  float a = smoothstep(0.0, 0.35, vUv.y) * edgeL;',
            '  gl_FragColor = vec4(c, a);',
            '}'
        ].join('\n')
    });

    var fall = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 4.2, 1, 1), fallMat);
    fall.rotation.y = Math.atan2(wx, wz);
    at(fall, wx * (lipR + 0.06), TOP - 2.1, wz * (lipR + 0.06), island);

    var foam = [];
    for (var f = 0; f < 5; f++) {
        var fm = part(new THREE.IcosahedronGeometry(0.1 + rand() * 0.06, 1), C.white, 0.025, { cast: false });
        var off = (f - 2) * 0.1;
        at(fm, wx * (lipR + 0.02) - wz * off, TOP + 0.03, wz * (lipR + 0.02) + wx * off, island);
        fm.userData.ph = rand() * 6;
        foam.push(fm);
    }

    var mist = [];
    for (var mi = 0; mi < 5; mi++) {
        var ms = part(new THREE.IcosahedronGeometry(0.2, 1), C.white, 0.025, { cast: false });
        ms.userData.ph = mi / 5;
        island.add(ms);
        mist.push(ms);
    }

    /* ---------- Buildings ---------- */

    function prism(w, h, depth, color, t) {
        var shape = new THREE.Shape();
        shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, h); shape.lineTo(-w / 2, 0);
        var geo = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
        geo.translate(0, 0, -depth / 2);
        return part(geo, color, t || 0.04);
    }

    // Bakery
    var bakery = new THREE.Group();
    bakery.position.set(-0.75, TOP, -0.55);
    bakery.rotation.y = 0.35;
    island.add(bakery);
    at(part(new THREE.BoxGeometry(1.95, 0.18, 1.5), C.stone, 0.035), 0, 0.09, 0, bakery);
    at(part(new THREE.BoxGeometry(1.75, 1.1, 1.3), C.cream), 0, 0.73, 0, bakery);
    var roof = prism(2.15, 0.85, 1.6, C.berry);
    at(roof, 0, 1.28, 0, bakery);
    roof.rotation.y = Math.PI / 2;
    var ridge = part(new THREE.BoxGeometry(0.16, 0.12, 2.2), 0xE0577A, 0.03);
    at(ridge, 0, 2.12, 0, bakery);
    ridge.rotation.y = Math.PI / 2;
    var chimney = new THREE.Group();
    at(chimney, 0.5, 1.75, 0.3, bakery);
    at(part(new THREE.BoxGeometry(0.28, 0.75, 0.28), 0xC8553D, 0.035), 0, 0, 0, chimney);
    at(part(new THREE.BoxGeometry(0.36, 0.1, 0.36), 0x8E3A2B, 0.03), 0, 0.42, 0, chimney);
    at(part(new THREE.BoxGeometry(0.42, 0.66, 0.06), C.violet, 0.035), 0, 0.51, 0.67, bakery);
    at(part(new THREE.SphereGeometry(0.035, 8, 6), C.gold, 0.015), 0.12, 0.5, 0.71, bakery);
    var awning = part(new THREE.BoxGeometry(0.66, 0.06, 0.28), C.gold, 0.03);
    awning.rotation.x = 0.35;
    at(awning, 0, 0.92, 0.78, bakery);
    [-0.58, 0.58].forEach(function (x) {
        at(part(new THREE.BoxGeometry(0.4, 0.38, 0.05), C.woodDark, 0.03), x, 0.82, 0.66, bakery);
        at(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.28, 0.06), glow(C.warm)), x, 0.82, 0.675, bakery);
        at(part(new THREE.BoxGeometry(0.48, 0.07, 0.12), C.woodDark, 0.025), x, 0.6, 0.7, bakery);
    });
    // Hanging sign with coin
    var sign = new THREE.Group();
    at(sign, 1.05, 0, 0.55, bakery);
    at(part(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 6), C.woodDark, 0.025), 0, 0.65, 0, sign);
    at(part(new THREE.BoxGeometry(0.42, 0.05, 0.05), C.woodDark, 0.02), -0.18, 1.22, 0, sign);
    var board = part(new THREE.BoxGeometry(0.38, 0.32, 0.05), C.cream, 0.03);
    at(board, -0.25, 0.98, 0, sign);
    var signCoin = part(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 16), C.gold, 0.02);
    signCoin.rotation.x = Math.PI / 2;
    at(signCoin, -0.25, 0.98, 0.04, sign);

    var smoke = [];
    for (var sm = 0; sm < 5; sm++) {
        var puff = part(new THREE.IcosahedronGeometry(0.2, 1), C.white, 0.03, { cast: false });
        puff.userData.t = sm / 5;
        bakery.add(puff);
        smoke.push(puff);
    }

    // Windmill on a little hill
    var mill = new THREE.Group();
    mill.position.set(1.55, TOP, -1.65);
    mill.rotation.y = -0.5;
    island.add(mill);
    var hill = part(new THREE.SphereGeometry(0.95, 18, 10), C.grassDark, 0.035);
    hill.scale.set(1, 0.32, 1);
    at(hill, 0, 0, 0, mill);
    at(part(new THREE.CylinderGeometry(0.4, 0.58, 1.85, 10), C.cream), 0, 1.15, 0, mill);
    at(part(new THREE.CylinderGeometry(0.5, 0.52, 0.14, 10), C.berry, 0.03), 0, 1.05, 0, mill);
    at(part(new THREE.ConeGeometry(0.58, 0.72, 10), C.violet), 0, 2.42, 0, mill);
    at(part(new THREE.BoxGeometry(0.26, 0.42, 0.05), C.woodDark, 0.03), 0, 0.5, 0.55, mill);
    at(new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), glow(C.warm)), 0, 1.55, 0.47, mill);
    var blades = new THREE.Group();
    at(blades, 0, 1.95, 0.55, mill);
    at(part(new THREE.SphereGeometry(0.11, 10, 8), C.gold, 0.025), 0, 0, 0.02, blades);
    for (var b = 0; b < 4; b++) {
        var arm = new THREE.Group();
        arm.rotation.z = b * Math.PI / 2;
        blades.add(arm);
        at(part(new THREE.BoxGeometry(0.06, 1.15, 0.05), C.woodDark, 0.02), 0, 0.62, 0, arm);
        at(part(new THREE.BoxGeometry(0.3, 0.8, 0.03), b % 2 ? C.cream : C.berry, 0.025), 0.17, 0.72, 0, arm);
    }

    // Market stall
    var stall = new THREE.Group();
    stall.position.set(1.55, TOP, 0.85);
    stall.rotation.y = -0.9;
    island.add(stall);
    at(part(new THREE.BoxGeometry(1.1, 0.5, 0.5), C.wood), 0, 0.25, 0, stall);
    at(part(new THREE.BoxGeometry(1.2, 0.06, 0.58), C.cream, 0.03), 0, 0.53, 0, stall);
    [[-0.52, -0.22], [0.52, -0.22], [-0.52, 0.22], [0.52, 0.22]].forEach(function (pp) {
        at(part(new THREE.CylinderGeometry(0.035, 0.035, 1.15, 6), C.woodDark, 0.02), pp[0], 0.58, pp[1], stall);
    });
    for (var aw = 0; aw < 6; aw++) {
        var strip = part(new THREE.BoxGeometry(0.2, 0.05, 0.78), aw % 2 ? C.white : C.berry, 0.022);
        strip.rotation.x = 0.28;
        at(strip, -0.5 + aw * 0.2, 1.2, 0.05, stall);
    }
    [C.berry, 0xFF9F3D, C.leafLight, C.gold, C.berry, 0xFF9F3D].forEach(function (col, i) {
        at(part(new THREE.SphereGeometry(0.075, 10, 8), col, 0.018), -0.4 + i * 0.16, 0.64, (i % 2) * 0.12 - 0.05, stall);
    });
    var crate = part(new THREE.BoxGeometry(0.34, 0.3, 0.34), C.wood, 0.03);
    crate.rotation.y = 0.3;
    at(crate, 0.82, 0.15, 0.25, stall);
    for (var fr = 0; fr < 4; fr++) at(part(new THREE.SphereGeometry(0.07, 8, 6), 0xFF9F3D, 0.015), 0.76 + (fr % 2) * 0.12, 0.33, 0.2 + (fr > 1 ? 0.1 : 0), stall);

    // Coin pile + chest
    var coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 18);
    var pile = new THREE.Group();
    at(pile, 2.45, TOP, -0.2, island);
    for (var cp = 0; cp < 14; cp++) {
        var pc = part(coinGeo, C.gold, 0.02);
        var ring = cp < 7 ? 0.22 : cp < 12 ? 0.11 : 0;
        var ang = cp * 2.1;
        pc.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
        at(pc, Math.cos(ang) * ring, 0.03 + (cp < 7 ? 0 : cp < 12 ? 0.06 : 0.12), Math.sin(ang) * ring, pile);
    }
    for (var stk = 0; stk < 5; stk++) at(part(coinGeo, C.gold, 0.02), -0.42, 0.03 + stk * 0.055, 0.12, pile);

    /* ---------- Path, bridge, fences, lamps ---------- */

    var PATH_R = 3.25;
    var path = new THREE.Mesh(new THREE.RingGeometry(2.98, 3.52, 64), toon(0xF4DDAE));
    path.rotation.x = -Math.PI / 2;
    path.position.y = TOP + 0.012;
    path.receiveShadow = true;
    island.add(path);

    for (var cb = 0; cb < 34; cb++) {
        var ca = (cb / 34) * Math.PI * 2;
        var cobble = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 6), toon(0xE6C891));
        cobble.receiveShadow = true;
        at(cobble, Math.cos(ca) * (PATH_R + (cb % 2 ? 0.14 : -0.14)), TOP + 0.02, Math.sin(ca) * (PATH_R + (cb % 2 ? 0.14 : -0.14)), island);
    }

    var bridge = new THREE.Group();
    bridge.rotation.y = Math.atan2(wx, wz) + Math.PI / 2;
    at(bridge, wx * PATH_R, TOP, wz * PATH_R, island);
    for (var pk = 0; pk < 6; pk++) {
        var plank = part(new THREE.BoxGeometry(0.62, 0.05, 0.11), pk % 2 ? C.wood : C.woodDark, 0.02);
        at(plank, 0, 0.09 + Math.sin((pk / 5) * Math.PI) * 0.06, -0.33 + pk * 0.13, bridge);
    }
    [-0.3, 0.3].forEach(function (x) {
        at(part(new THREE.BoxGeometry(0.04, 0.04, 0.8), C.woodDark, 0.015), x, 0.3, 0, bridge);
        [-0.36, 0.36].forEach(function (z) { at(part(new THREE.BoxGeometry(0.05, 0.3, 0.05), C.woodDark, 0.015), x, 0.18, z, bridge); });
    });

    function fence(a0, a1, r) {
        var n = Math.max(2, Math.round((a1 - a0) * r / 0.32));
        for (var i = 0; i <= n; i++) {
            var a = a0 + (a1 - a0) * (i / n);
            var post = part(new THREE.BoxGeometry(0.07, 0.32, 0.07), C.wood, 0.02);
            at(post, Math.cos(a) * r, TOP + 0.16, Math.sin(a) * r, island);
            if (i < n) {
                var am = a0 + (a1 - a0) * ((i + 0.5) / n);
                var rail = part(new THREE.BoxGeometry(0.05, 0.05, ((a1 - a0) / n) * r + 0.02), C.wood, 0.015);
                rail.rotation.y = -am;
                at(rail, Math.cos(am) * r, TOP + 0.22, Math.sin(am) * r, island);
            }
        }
    }
    fence(-0.9, 0.2, 3.95);
    fence(3.4, 4.3, 3.95);

    var lamps = [];
    [0.9, 2.0, 3.9, 5.3].forEach(function (a) {
        var lp = new THREE.Group();
        at(lp, Math.cos(a) * 2.88, TOP, Math.sin(a) * 2.88, island);
        at(part(new THREE.CylinderGeometry(0.035, 0.05, 0.85, 6), 0x3B4374, 0.02), 0, 0.42, 0, lp);
        at(part(new THREE.BoxGeometry(0.16, 0.05, 0.16), 0x3B4374, 0.02), 0, 0.88, 0, lp);
        var bulb = at(new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), glow(C.warm)), 0, 0.97, 0, lp);
        at(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 6), toon(0x3B4374)), 0, 1.07, 0, lp);
        lamps.push(bulb);
    });

    /* ---------- Vegetation ---------- */

    var swayers = [];

    function roundTree(x, z, scale, color) {
        var g = new THREE.Group();
        at(g, x, TOP, z, island);
        at(part(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), C.woodDark, 0.03), 0, 0.3, 0, g);
        var crown = new THREE.Group();
        at(crown, 0, 0.72, 0, g);
        at(part(new THREE.IcosahedronGeometry(0.42, 1), color, 0.035), 0, 0.12, 0, crown);
        at(part(new THREE.IcosahedronGeometry(0.3, 1), color, 0.035), 0.3, 0, 0.08, crown);
        at(part(new THREE.IcosahedronGeometry(0.28, 1), color, 0.035), -0.26, -0.02, -0.06, crown);
        at(part(new THREE.IcosahedronGeometry(0.24, 1), color === C.blossom ? 0xFFC6DC : C.leafLight, 0.03), 0.06, 0.42, 0.06, crown);
        g.scale.setScalar(scale);
        crown.userData.ph = rand() * 6;
        swayers.push(crown);
    }

    function pine(x, z, scale) {
        var g = new THREE.Group();
        at(g, x, TOP, z, island);
        at(part(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 6), C.woodDark, 0.03), 0, 0.2, 0, g);
        var crown = new THREE.Group();
        at(crown, 0, 0.35, 0, g);
        [[0.5, 0.65, 0.25], [0.4, 0.55, 0.6], [0.28, 0.45, 0.92]].forEach(function (c, i) {
            at(part(new THREE.ConeGeometry(c[0], c[1], 8), i === 2 ? 0x3FBF73 : C.pine, 0.035), 0, c[2], 0, crown);
        });
        g.scale.setScalar(scale);
        crown.userData.ph = rand() * 6;
        swayers.push(crown);
    }

    roundTree(-2.45, -1.05, 1.05, C.leaf);
    roundTree(-0.35, 2.15, 0.95, C.blossom);
    roundTree(0.6, -2.55, 0.9, C.leaf);
    roundTree(2.55, -1.55, 0.8, C.leaf);
    roundTree(0.75, 2.3, 0.75, C.leaf);
    pine(-1.95, -2.15, 1.1);
    pine(-2.75, 0.1, 0.95);
    pine(-0.9, -2.75, 0.85);
    pine(2.85, 1.55, 0.8);
    pine(3.85, -1.25, 0.75);
    roundTree(-3.9, 1.0, 0.7, C.blossom);
    pine(1.0, 3.95, 0.7);

    function bush(x, z, s) {
        var g = new THREE.Group();
        at(g, x, TOP, z, island);
        at(part(new THREE.IcosahedronGeometry(0.2, 1), C.leaf, 0.03), 0, 0.12, 0, g);
        at(part(new THREE.IcosahedronGeometry(0.15, 1), C.leafLight, 0.03), 0.17, 0.08, 0.05, g);
        at(part(new THREE.IcosahedronGeometry(0.14, 1), C.grassDark, 0.03), -0.15, 0.07, 0.03, g);
        g.scale.setScalar(s);
    }

    function rock(x, z, s) {
        var r = part(new THREE.IcosahedronGeometry(0.2, 0), C.stone, 0.03, { flat: true });
        r.scale.set(s, s * 0.7, s * 0.9);
        r.rotation.y = rand() * 6;
        at(r, x, TOP + 0.06 * s, z, island);
    }

    function mushroom(x, z) {
        var g = new THREE.Group();
        at(g, x, TOP, z, island);
        at(part(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6), C.cream, 0.015), 0, 0.08, 0, g);
        var cap = part(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xFF4D5E, 0.018);
        at(cap, 0, 0.15, 0, g);
        at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), glow(0xffffff)), 0.04, 0.22, 0.04, g);
    }

    bush(-1.6, 0.6, 1); bush(0.2, 1.0, 0.9); bush(-3.6, -1.9, 1.1); bush(2.2, 2.4, 0.9); bush(-0.1, -1.6, 0.8);
    bush(3.95, 0.4, 0.9); bush(-2.2, 3.0, 0.8);
    rock(-1.2, 1.5, 1.2); rock(3.9, -2.2, 1.4); rock(-3.95, -0.6, 1.1); rock(2.0, 3.55, 1.0); rock(0.3, -3.9, 1.2);
    mushroom(-2.0, -0.4); mushroom(-1.85, -0.25); mushroom(0.9, 1.6);

    // Flowers (instanced)
    var flowerGeo = new THREE.IcosahedronGeometry(0.055, 0);
    var flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshToonMaterial({ gradientMap: ramp }), 90);
    var petal = [0xFFFFFF, 0xFFE15C, 0xFF7AA8, 0xB9A6FF, 0xFF9F3D];
    var dummy = new THREE.Object3D(), col = new THREE.Color(), placed = 0, guard = 0;
    var avoid = [[-0.75, -0.55, 1.3], [1.55, -1.65, 1.0], [1.55, 0.85, 0.85], [2.45, -0.2, 0.45], [wx * 1.75, wz * 1.75, 1.05]];
    while (placed < 90 && guard++ < 2000) {
        var fa = rand() * Math.PI * 2, frr = Math.sqrt(rand()) * 4.1 * edge(fa);
        var fx = Math.cos(fa) * frr, fz = Math.sin(fa) * frr;
        if (frr > 2.9 && frr < 3.6) continue;
        var bad = avoid.some(function (o) { return (fx - o[0]) * (fx - o[0]) + (fz - o[1]) * (fz - o[1]) < o[2] * o[2]; });
        if (bad) continue;
        dummy.position.set(fx, TOP + 0.05, fz);
        dummy.scale.setScalar(0.7 + rand() * 0.6);
        dummy.updateMatrix();
        flowers.setMatrixAt(placed, dummy.matrix);
        flowers.setColorAt(placed, col.setHex(petal[placed % petal.length]));
        placed++;
    }
    flowers.count = placed;
    island.add(flowers);

    /* ---------- Delivery truck ---------- */

    var truckPivot = new THREE.Group();
    island.add(truckPivot);
    var truck = new THREE.Group();
    at(truck, PATH_R, TOP + 0.13, 0, truckPivot);
    at(part(new THREE.BoxGeometry(0.46, 0.4, 0.62), C.berry, 0.03), 0, 0.2, -0.12, truck);
    at(part(new THREE.BoxGeometry(0.44, 0.3, 0.32), C.cream, 0.03), 0, 0.13, 0.36, truck);
    at(part(new THREE.BoxGeometry(0.38, 0.14, 0.04), 0xA3E3F5, 0.015), 0, 0.22, 0.53, truck);
    at(new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), glow(C.warm)), 0.15, 0.06, 0.53, truck);
    at(new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), glow(C.warm)), -0.15, 0.06, 0.53, truck);
    var truckCoin = part(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14), C.gold, 0.018);
    truckCoin.rotation.z = Math.PI / 2;
    at(truckCoin, 0.245, 0.22, -0.12, truck);
    [[-0.24, 0.32], [0.24, 0.32], [-0.24, -0.28], [0.24, -0.28]].forEach(function (w) {
        var wheel = part(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), INK, 0.015);
        wheel.rotation.z = Math.PI / 2;
        at(wheel, w[0], -0.02, w[1], truck);
    });

    /* ---------- Sky life: birds, islets, balloon, clouds, coins ---------- */

    function makeBird() {
        var g = new THREE.Group();
        var body = part(new THREE.SphereGeometry(0.16, 12, 10), C.white, 0.025, { cast: false });
        body.scale.set(0.85, 0.75, 1.6);
        g.add(body);
        at(part(new THREE.SphereGeometry(0.1, 10, 8), C.white, 0.022, { cast: false }), 0, 0.07, 0.22, g);
        var beak = part(new THREE.ConeGeometry(0.035, 0.12, 6), 0xFF9F3D, 0.012, { cast: false });
        beak.rotation.x = Math.PI / 2;
        at(beak, 0, 0.05, 0.36, g);
        at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), glow(INK)), 0.05, 0.1, 0.29, g);
        at(new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), glow(INK)), -0.05, 0.1, 0.29, g);
        var tail = part(new THREE.ConeGeometry(0.08, 0.18, 4), 0xDDE3F5, 0.015, { cast: false });
        tail.rotation.x = -Math.PI / 2;
        at(tail, 0, 0.02, -0.3, g);
        var wings = [];
        [1, -1].forEach(function (side) {
            var pivot = new THREE.Group();
            at(pivot, 0.08 * side, 0.04, 0, g);
            var wing = part(new THREE.BoxGeometry(0.42, 0.025, 0.2), C.white, 0.018, { cast: false });
            at(wing, 0.22 * side, 0, 0, pivot);
            var tip = part(new THREE.BoxGeometry(0.16, 0.026, 0.14), 0x46507E, 0.015, { cast: false });
            at(tip, 0.48 * side, 0, -0.02, pivot);
            pivot.userData.side = side;
            wings.push(pivot);
        });
        g.userData.wings = wings;
        return g;
    }

    var birds = [];
    for (var bd = 0; bd < 6; bd++) {
        var bird = makeBird();
        bird.userData.a = (bd / 6) * Math.PI * 2 * 0.35;
        bird.userData.r = 4.9 + (bd % 3) * 0.4;
        bird.userData.h = 2.2 + (bd % 2) * 0.6 + rand() * 0.4;
        bird.userData.ph = rand() * 6;
        bird.userData.sp = 0.32 + rand() * 0.06;
        bird.scale.setScalar(0.85 + rand() * 0.3);
        world.add(bird);
        birds.push(bird);
    }

    function islet(x, y, z, s, tree) {
        var g = new THREE.Group();
        at(g, x, y, z, world);
        var top = part(new THREE.CylinderGeometry(0.62, 0.58, 0.18, 12), C.grass, 0.035);
        at(top, 0, 0, 0, g);
        var bottom = part(new THREE.ConeGeometry(0.58, 1.0, 9), C.rock1, 0.035, { flat: true });
        bottom.rotation.x = Math.PI;
        at(bottom, 0, -0.58, 0, g);
        if (tree) {
            at(part(new THREE.CylinderGeometry(0.05, 0.07, 0.35, 6), C.woodDark, 0.025), 0, 0.26, 0, g);
            at(part(new THREE.IcosahedronGeometry(0.28, 1), tree, 0.03), 0, 0.58, 0, g);
        } else {
            at(part(new THREE.IcosahedronGeometry(0.16, 0), C.stone, 0.025, { flat: true }), 0.15, 0.14, 0.1, g);
            at(part(new THREE.IcosahedronGeometry(0.14, 1), C.leaf, 0.025), -0.18, 0.15, -0.05, g);
        }
        g.scale.setScalar(s);
        g.userData.y = y;
        g.userData.ph = rand() * 6;
        return g;
    }

    var islets = [
        islet(4.2, 1.6, -4.2, 1.0, C.blossom),
        islet(-3.6, -1.9, -3.6, 0.8, C.leaf),
        islet(5.2, -2.4, 1.2, 0.65, null)
    ];

    var balloon = new THREE.Group();
    at(balloon, 3.4, 3.4, -5.5, world);
    var envelope = part(new THREE.SphereGeometry(0.7, 20, 16), C.berry, 0.04);
    envelope.scale.set(1, 1.15, 1);
    balloon.add(envelope);
    at(part(new THREE.CylinderGeometry(0.715, 0.715, 0.2, 20, 1, true), C.gold, 0.03), 0, 0, 0, balloon);
    at(part(new THREE.CylinderGeometry(0.42, 0.18, 0.4, 14), C.berry, 0.03), 0, -0.85, 0, balloon);
    [[0.14, 0.14], [-0.14, 0.14], [0.14, -0.14], [-0.14, -0.14]].forEach(function (rp) {
        at(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), glow(INK)), rp[0], -1.25, rp[1], balloon);
    });
    at(part(new THREE.BoxGeometry(0.34, 0.26, 0.34), C.wood, 0.03), 0, -1.58, 0, balloon);

    var clouds = [];
    [[-6.2, 3.2, -4.5, 1.2], [6.8, 3.9, -3.5, 1.0], [-5.0, -2.2, 2.5, 0.9], [1.5, 5.6, -7.5, 1.3]].forEach(function (cd) {
        var g = new THREE.Group();
        [[0, 0, 0, 0.75], [0.7, -0.12, 0.05, 0.55], [-0.68, -0.14, 0.05, 0.52], [0.22, 0.32, -0.1, 0.55], [-0.3, 0.2, 0.15, 0.45]].forEach(function (bl) {
            var blob = part(new THREE.IcosahedronGeometry(bl[3], 2), C.white, 0.04, { cast: false });
            blob.scale.y = 0.82;
            at(blob, bl[0], bl[1], bl[2], g);
        });
        at(g, cd[0], cd[1], cd[2], world);
        g.scale.setScalar(cd[3]);
        g.userData.x = cd[0];
        g.userData.sp = 0.15 + rand() * 0.15;
        clouds.push(g);
    });

    var orbitCoins = [];
    for (var oc = 0; oc < 5; oc++) {
        var coin = part(new THREE.CylinderGeometry(0.28, 0.28, 0.07, 22), C.gold, 0.035, { cast: false });
        coin.rotation.x = Math.PI / 2;
        coin.userData = { a: (oc / 5) * Math.PI * 2, r: 5.0 + (oc % 2) * 0.5, y: 0.9 + (oc % 3) * 0.6, s: 0.7 + rand() * 0.5 };
        world.add(coin);
        orbitCoins.push(coin);
    }

    var popCoin = part(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 18), C.gold, 0.025, { cast: false });
    stall.add(popCoin);

    // Twinkling sparkles
    var sparkGeo = new THREE.BufferGeometry();
    var sp = [];
    for (var sk = 0; sk < 60; sk++) {
        var ska = rand() * Math.PI * 2, skr = 2 + rand() * 4.5;
        sp.push(Math.cos(ska) * skr, -1 + rand() * 5, Math.sin(ska) * skr);
    }
    sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    var sparkMat = new THREE.PointsMaterial({ color: 0xFFF3B0, size: 0.09, transparent: true, opacity: 0.9, depthWrite: false });
    var sparks = new THREE.Points(sparkGeo, sparkMat);
    world.add(sparks);

    /* ---------- Layout + interaction ---------- */

    function resize() {
        var w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        var wide = camera.aspect > 1.15;
        world.scale.setScalar(wide ? 0.8 : 0.78);
        world.position.x = wide ? Math.min(5.6, 2.45 * camera.aspect) : 0;
        world.position.y = wide ? 0.1 : 0.5;
        camera.position.set(0, wide ? 8.2 : 6.8, wide ? 20 : 16);
        camera.lookAt(0, wide ? 0.2 : 0.3, 0);
        camera.updateProjectionMatrix();
    }

    var mouse = { x: 0, y: 0 };
    host.parentElement.addEventListener('pointermove', function (e) {
        var r = host.getBoundingClientRect();
        mouse.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
        mouse.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    });

    var raycaster = new THREE.Raycaster();
    var ndc = new THREE.Vector2();
    var squash = 0;

    function pick(e, target) {
        var r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        return raycaster.intersectObject(target, true).length > 0;
    }

    renderer.domElement.addEventListener('click', function (e) {
        if (pick(e, island)) {
            squash = 1;
            if (window.ixAddCoins) window.ixAddCoins(25, e.clientX, e.clientY);
            if (window.ixTrack) window.ixTrack('island_tap', {}, true);
        }
    });

    renderer.domElement.addEventListener('pointermove', function (e) {
        renderer.domElement.style.cursor = pick(e, island) ? 'pointer' : '';
    });

    var visible = true;
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(host);
    }

    /* ---------- Animation ---------- */

    var clock = new THREE.Clock();
    var rotY = -0.35;
    var tmp = new THREE.Vector3();

    function frame() {
        var t = clock.getElapsedTime();

        rotY += 0.0018;
        island.rotation.y = rotY;
        world.rotation.x += ((mouse.y * 0.1) - world.rotation.x) * 0.05;
        world.rotation.z += ((-mouse.x * 0.05) - world.rotation.z) * 0.05;
        island.position.y = Math.sin(t * 1.0) * 0.16;

        squash *= 0.88;
        island.scale.set(1 + squash * 0.05, 1 - squash * 0.07, 1 + squash * 0.05);

        blades.rotation.z = -t * 1.4;
        truckPivot.rotation.y = -t * 0.45;
        truck.position.y = TOP + 0.13 + Math.abs(Math.sin(t * 9)) * 0.015;
        fallMat.uniforms.time.value = t;

        swayers.forEach(function (c) {
            c.rotation.z = Math.sin(t * 1.3 + c.userData.ph) * 0.04;
            c.rotation.x = Math.cos(t * 1.1 + c.userData.ph) * 0.03;
        });

        smoke.forEach(function (p) {
            var k = (p.userData.t + t * 0.28) % 1;
            p.position.set(0.5 + Math.sin(k * 5) * 0.18, 2.25 + k * 1.7, 0.3 - k * 0.3);
            p.scale.setScalar(0.35 + k * 1.15);
            p.visible = k < 0.93;
        });

        foam.forEach(function (fm) { fm.scale.setScalar(0.8 + Math.sin(t * 6 + fm.userData.ph) * 0.25); });

        mist.forEach(function (ms, i) {
            var k = (ms.userData.ph + t * 0.35) % 1;
            var side = (i - 2) * 0.12;
            ms.position.set(wx * (lipR + 0.2 + k * 0.4) - wz * side, TOP - 1.6 - k * 1.4, wz * (lipR + 0.2 + k * 0.4) + wx * side);
            ms.scale.setScalar(0.5 + k * 1.1);
            ms.visible = k < 0.9;
        });

        lamps.forEach(function (l, i) { l.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.08); });

        birds.forEach(function (bd) {
            var u = bd.userData;
            var a = u.a + t * u.sp;
            var y = u.h + Math.sin(t * 0.8 + u.ph) * 0.35;
            bd.position.set(Math.cos(a) * u.r, y, Math.sin(a) * u.r);
            tmp.set(Math.cos(a + 0.1) * u.r, u.h + Math.sin((t + 0.3) * 0.8 + u.ph) * 0.35, Math.sin(a + 0.1) * u.r);
            bd.lookAt(tmp.applyMatrix4(world.matrixWorld));
            bd.rotateZ(-0.35);
            var flap = Math.sin(t * 9 + u.ph);
            var glide = (Math.sin(t * 0.6 + u.ph) > 0.4) ? 0.15 : 1;
            u.wings.forEach(function (w) { w.rotation.z = flap * 0.65 * glide * w.userData.side; });
        });

        islets.forEach(function (g) {
            g.position.y = g.userData.y + Math.sin(t * 0.9 + g.userData.ph) * 0.22;
            g.rotation.y = t * 0.15 + g.userData.ph;
        });

        balloon.position.y = 3.4 + Math.sin(t * 0.5) * 0.3;
        balloon.rotation.y = t * 0.2;

        clouds.forEach(function (cl) { cl.position.x = cl.userData.x + Math.sin(t * cl.userData.sp) * 0.9; });

        orbitCoins.forEach(function (cn) {
            var u = cn.userData;
            cn.position.set(Math.cos(u.a + t * 0.22) * u.r, u.y + Math.sin(t * 1.5 + u.a) * 0.22, Math.sin(u.a + t * 0.22) * u.r);
            cn.rotation.z = t * u.s * 3;
        });

        var pk = (t * 0.45) % 1;
        popCoin.position.set(0, 1.4 + pk * 2.0 - pk * pk * 1.1, 0.1);
        popCoin.rotation.set(Math.PI / 2, 0, t * 6);
        popCoin.visible = pk < 0.85;

        sparkMat.opacity = 0.55 + Math.sin(t * 2.4) * 0.35;
        sparks.rotation.y = -t * 0.05;

        renderer.render(scene, camera);
    }

    function loop() {
        if (visible) frame();
        requestAnimationFrame(loop);
    }

    resize();
    if (REDUCED) {
        window.addEventListener('resize', function () { resize(); frame(); });
        window.addEventListener('load', function () { resize(); frame(); });
        requestAnimationFrame(frame);
        return;
    }
    window.addEventListener('resize', resize);
    loop();

})();
